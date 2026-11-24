// =============================================================================
// El loop del chat del portal (Fase 9 · 9.3 y 9.5)
// =============================================================================
// Mismo esquema que el loop del agente de las clientas (src/core/agent.ts,
// D-44: tool use manual, historial solo-añadir, todos los tool_result en un
// mensaje), pero con SU prompt (el guion de Mariana), SUS herramientas y sin
// nada del mundo de las clientas: aquí no hay reservas, ni derivaciones, ni
// códigos de email. Por eso vive aparte y el núcleo no se toca.
//
// Lo que este archivo garantiza:
//   · cada mensaje va a SU chat (PC-17, Fase 9b): un chat nuevo si no trae
//     ninguno, y solo chats de este negocio. Todas las conversaciones van
//     marcadas `alta` para que su gasto no cuente en el tope (PC-14) y se vea
//     aparte en el consumo;
//   · el business_id sale SIEMPRE de la sesión, nunca del chat (PC-02);
//   · los mensajes de la misma conversación se procesan de uno en uno
//     (el mismo lock que el widget, D-45) y el mismo mensaje repetido no se
//     procesa dos veces (clientMessageId, maestro §9);
//   · si algo falla, se responde con un texto en palabras y el error va al log:
//     el cliente nunca ve un error técnico;
//   · PC-22 (Fase 5): llegado el tope del mes del chat del portal, no se llama
//     al modelo y se contesta TEXTO_TOPE_PORTAL;
//   · Fase 5: las herramientas de documentos reciben quién los lee
//     (`lector`, de serie el mismo modelo) y el chat, para encontrar sus adjuntos.
// =============================================================================

import type Anthropic from '@anthropic-ai/sdk';
import type { Sql } from 'postgres';

import type { EmailProvider } from '../adapters/email/types.js';
import { BETA_FALLBACKS, type AgentSettings, type ModelClient } from '../core/agent.js';
import { appendMessages, conversationUsage, loadHistory, type MessageRow, type UsageDetalle } from '../db/conversations.js';
import { listarDocumentos } from '../db/conocimiento.js';
import { leerNegocio, type NegocioPanel } from '../db/negocios.js';
import { expandirAdjuntos, marcaDeAdjunto } from './adjuntos.js';
import { ligarAdjuntos, MAX_ADJUNTOS_POR_MENSAJE, type AdjuntoResumido } from '../db/adjuntos.js';
import { cadenaDelChat, chatDelMensaje, continuarChat, crearChat, estadoDelAlta, recortarTitulo, renombrarChat, type SeccionDelAlta } from '../db/portal.js';
import { costePortalDelMes, eventosDelTurno, registrarUso, topeAlcanzado, type LlamadaRegistrada } from '../db/usage.js';
import { conLockDeConversacion, filasDelTurno, findUserMessage } from '../db/widget.js';
import { contextoDelDia, definiciones, ejecutar, type ContextoPortal, type Resumen } from './herramientas.js';
import { promptDelPortal, type ModoChat } from './prompt.js';

type MessageParam = Anthropic.Beta.BetaMessageParam;

/** A partir de esta fracción del tope de tokens, el turno siguiente empieza otra conversación. */
const UMBRAL_NUEVA_CONVERSACION = 0.75;

/** Tope de vueltas y de tokens de una conversación del portal. */
export const LIMITES_PORTAL = {
  maxVueltas: 12,
  maxTokensConversacion: 600_000,
  maxCaracteres: 4000,
  esperaLockMs: 200_000,
};

export interface PortalChatDeps {
  sql: Sql;
  model: ModelClient;
  settings: AgentSettings;
  email: EmailProvider;
  baseUrl: string;
  now?: () => Date;
  onError?: (e: unknown) => void;
  /**
   * PC-17: pone el título de un chat nuevo a partir del primer mensaje. Sin
   * él (tests, e2e), el título es el propio mensaje recortado.
   */
  titulador?: (texto: string) => Promise<string>;
  /** Fase 5: quién lee los documentos (leer_documento). De serie, `model` y el modelo del chat. */
  lector?: { model: ModelClient; modelo: string };
}

/**
 * PC-22 (23/11/2026): al llegar al tope del mes del chat del portal, el chat
 * se pausa con este mensaje. Configuración a mano sigue. Sin euros ni
 * porcentajes (PC-09).
 */
export const TEXTO_TOPE_PORTAL =
  'Este mes ya has usado todo el asistente incluido. Puedes seguir cambiando todo a mano en Configuración, o escribirnos y te lo ampliamos.';

/** El modelo pequeño que titula los chats: barato y rápido (menos de un céntimo por chat). */
export const MODELO_TITULOS = 'claude-haiku-5-5';

/** PC-17: el titulador de verdad, con un modelo pequeño. */
export function tituladorConIA(model: ModelClient): (texto: string) => Promise<string> {
  return async (texto) => {
    const r = await model.create({
      model: MODELO_TITULOS,
      max_tokens: 40,
      system: [
        {
          type: 'text',
          text: 'Pones el título de un chat en el portal de un negocio que configura su recepcionista. Con el primer mensaje de la persona, escribe SOLO el título: de 2 a 5 palabras, en español de España, sin comillas ni punto final. Ejemplos: «Horarios del local», «Alta del equipo», «Festivo del 8 de diciembre». Si el mensaje no se entiende, «Chat nuevo».',
        },
      ],
      messages: [{ role: 'user', content: [{ type: 'text', text: texto.slice(0, 500) }] }],
    });
    return recortarTitulo(textoDe(r)) || 'Chat nuevo';
  };
}

export interface RespuestaPortal {
  respuesta: string;
  /** PC-03: el bloque que el portal dibuja debajo del mensaje, si lo hay. */
  resumen: Resumen | null;
  /** PC-11: con true, el portal aparece. */
  altaTerminada: boolean;
  /** La siguiente sección del guion que falta (9 si no falta ninguna). */
  seccion: number;
  /** PC-18: las secciones del alta que faltan. */
  faltan: SeccionDelAlta[];
  modo: ModoChat;
  /** PC-17: el chat donde va este mensaje (nuevo si no se pidió ninguno). */
  chat: { id: string; titulo: string };
  aviso?: 'mensaje_largo' | 'ocupado' | 'error' | 'tope_portal';
}

const TEXTO_ERROR = 'Perdona, ha habido un problema y no he podido responderte. Inténtalo de nuevo en un momento.';
const TEXTO_OCUPADO = 'Sigo con tu mensaje anterior. Espera un momento y vuelve a enviarlo.';

/** PC-21: los archivos del mensaje no se pueden mandar (de otro negocio, ya mandados o demasiados). */
export class AdjuntosNoValidos extends Error {
  constructor(mensaje: string) {
    super(mensaje);
  }
}

/** El chat no es de este negocio, no existe o se borró: para el portal, no existe (PC-02). */
export class ChatNoEncontrado extends Error {
  constructor() {
    super('Ese chat no existe.');
  }
}

/** La conversación donde sigue un chat (la última de su cadena). */
async function ultimaDelChat(sql: Sql, businessId: string, chatId: string): Promise<string> {
  const cadena = await cadenaDelChat(sql, businessId, chatId);
  if (cadena.length === 0) throw new ChatNoEncontrado();
  return cadena.at(-1)!;
}

function vacio(): UsageDetalle {
  return { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
}

function usageDe(m: Anthropic.Beta.BetaMessage): UsageDetalle {
  return {
    input_tokens: m.usage.input_tokens,
    output_tokens: m.usage.output_tokens,
    cache_read_input_tokens: m.usage.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: m.usage.cache_creation_input_tokens ?? 0,
  };
}

function sumar(a: UsageDetalle, b: UsageDetalle): void {
  a.input_tokens += b.input_tokens;
  a.output_tokens += b.output_tokens;
  a.cache_read_input_tokens += b.cache_read_input_tokens;
  a.cache_creation_input_tokens += b.cache_creation_input_tokens;
}

function total(u: UsageDetalle): number {
  return u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens;
}

function textoDe(m: Anthropic.Beta.BetaMessage): string {
  return m.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/**
 * Un turno del chat del portal. `clientMessageId` hace de clave de
 * idempotencia, como en el widget.
 */
export async function turnoDelPortal(
  deps: PortalChatDeps,
  p: { businessId: string; texto: string; clientMessageId: string; chatId?: string | null; adjuntos?: string[] },
): Promise<RespuestaPortal> {
  const now = deps.now ?? (() => new Date());
  const onError = deps.onError ?? (() => {});
  const texto = p.texto.trim();
  // PC-21: los archivos que van con el mensaje (ya subidos). Puede ir solo con archivos.
  const adjuntos = [...new Set(p.adjuntos ?? [])];
  if (adjuntos.length > MAX_ADJUNTOS_POR_MENSAJE) throw new AdjuntosNoValidos(`Puedes mandar hasta ${MAX_ADJUNTOS_POR_MENSAJE} archivos por mensaje.`);
  if (!texto && adjuntos.length === 0) throw new AdjuntosNoValidos('Escribe algo o adjunta un archivo.');

  const ficha = await leerNegocio(deps.sql, p.businessId);
  if (!ficha) throw new Error(`El negocio ${p.businessId} no existe`);
  const estado = await estadoDelAlta(deps.sql, p.businessId);
  const terminada = estado.terminadaAt !== null;
  const modo: ModoChat = terminada ? 'portal' : 'alta';
  const base = { altaTerminada: terminada, seccion: estado.seccion, faltan: estado.faltan, modo };

  if (texto.length > LIMITES_PORTAL.maxCaracteres) {
    return {
      respuesta: `Tu mensaje es muy largo. ¿Puedes contármelo en menos de ${LIMITES_PORTAL.maxCaracteres.toLocaleString('es-ES')} caracteres?`,
      resumen: null,
      ...base,
      chat: { id: p.chatId ?? '', titulo: '' },
      aviso: 'mensaje_largo',
    };
  }

  // PC-17: sin chat, uno nuevo con su título. El título se pide en paralelo
  // al turno y, si falla, se queda el mensaje recortado.
  // El id de idempotencia no lleva el chat: así, si se reenvía el primer
  // mensaje de un chat nuevo (se cortó la conexión), va al chat que ya abrió.
  const externalId = `portal:${p.clientMessageId}`;
  let chatId = p.chatId ?? (await chatDelMensaje(deps.sql, p.businessId, externalId));
  let titulo = '';
  let titulando: Promise<void> = Promise.resolve();
  if (!chatId) {
    // Solo con archivos, el título sale de lo que diga después el modelo… o del archivo.
    const paraTitulo = texto || 'Archivos adjuntos';
    titulo = recortarTitulo(paraTitulo);
    chatId = await crearChat(deps.sql, p.businessId, titulo);
    const id = chatId;
    if (deps.titulador && texto) {
      titulando = deps.titulador(texto).then(
        async (t) => {
          titulo = recortarTitulo(t);
          await renombrarChat(deps.sql, p.businessId, id, titulo);
        },
        (e: unknown) => onError(e),
      );
    }
  }
  const conversationId = await ultimaDelChat(deps.sql, p.businessId, chatId);

  const r = await conLockDeConversacion(deps.sql, conversationId, LIMITES_PORTAL.esperaLockMs, async () => {
    // Idempotencia: el mismo mensaje reenviado devuelve lo que ya se contestó.
    const previo = await findUserMessage(deps.sql, p.businessId, conversationId, externalId);
    if (previo) {
      const filas = await filasDelTurno(deps.sql, p.businessId, previo);
      const ultima = [...filas].reverse().find((f) => f.rol === 'assistant' && f.contenido);
      const ahora = await estadoDelAlta(deps.sql, p.businessId);
      return {
        respuesta: ultima?.contenido ?? TEXTO_ERROR,
        resumen: null,
        altaTerminada: ahora.terminadaAt !== null,
        seccion: ahora.seccion,
        faltan: ahora.faltan,
        modo,
        chat: { id: chatId, titulo },
      } satisfies RespuestaPortal;
    }
    return ejecutarTurno(deps, { businessId: p.businessId, chatId, conversationId, texto, adjuntos, externalId, ficha, modo, faltan: estado.faltan, now, onError });
  });

  // PC-21: un chat que empieza solo con archivos se titula con lo que el
  // agente reconoció en ellos («He reconocido el horario del local…»).
  if (deps.titulador && r && !texto && !p.chatId && r.valor.respuesta && !r.valor.aviso) {
    const id = chatId;
    titulando = titulando.then(() =>
      deps.titulador!(r.valor.respuesta).then(
        async (t) => {
          titulo = recortarTitulo(t);
          await renombrarChat(deps.sql, p.businessId, id, titulo);
        },
        (e: unknown) => onError(e),
      ),
    );
  }
  await titulando;
  if (!r) return { respuesta: TEXTO_OCUPADO, resumen: null, ...base, chat: { id: chatId, titulo }, aviso: 'ocupado' };
  return { ...r.valor, chat: { id: chatId, titulo: titulo || r.valor.chat.titulo } };
}

async function ejecutarTurno(
  deps: PortalChatDeps,
  p: {
    businessId: string;
    chatId: string;
    conversationId: string;
    texto: string;
    adjuntos: string[];
    externalId: string;
    ficha: NegocioPanel;
    modo: ModoChat;
    faltan: SeccionDelAlta[];
    now: () => Date;
    onError: (e: unknown) => void;
  },
): Promise<RespuestaPortal> {
  const { sql, model, settings } = deps;
  const { businessId, modo, now, onError } = p;
  let conversationId = p.conversationId;

  // Una conversación muy larga se cambia por otra nueva ANTES de que se
  // llene (alta:eval, 19/11/2026: con un cliente que habla mucho, el alta
  // llegaba al límite casi al final y se quedaba bloqueada para siempre). Lo
  // confirmado ya está guardado sección a sección y `portal.alta` sabe qué
  // falta: la nueva sigue desde ahí, sin repetir nada. Para el cliente es el
  // MISMO chat (PC-17): la nueva apunta a la vieja y el historial las junta.
  let continuacion = false;
  if (total(await usageAcumulado(sql, businessId, conversationId)) >= LIMITES_PORTAL.maxTokensConversacion * UMBRAL_NUEVA_CONVERSACION) {
    conversationId = await continuarChat(sql, businessId, conversationId);
    continuacion = true;
  }

  const ctx: ContextoPortal = {
    sql,
    email: deps.email,
    baseUrl: deps.baseUrl,
    businessId,
    conversationId,
    ficha: p.ficha,
    modo,
    now,
    onError,
    chatId: p.chatId,
    documentos: {
      sql,
      model: deps.lector?.model ?? model,
      modelo: deps.lector?.modelo ?? settings.model,
      onError,
    },
  };

  // PC-21: los archivos quedan ligados a esta conversación (solo los de este
  // negocio y sin mandar). En el historial va su marca, no sus bytes.
  let mandados: AdjuntoResumido[] = [];
  if (p.adjuntos.length > 0) {
    const ligados = await ligarAdjuntos(sql, businessId, conversationId, p.adjuntos);
    if (!ligados) throw new AdjuntosNoValidos('No he podido leer esos archivos. Vuelve a adjuntarlos.');
    mandados = ligados;
  }
  const historial = await loadHistory(sql, businessId, conversationId);
  const turno: MessageParam[] = [
    {
      role: 'user',
      content: [
        ...mandados.map(marcaDeAdjunto),
        ...(p.texto ? [{ type: 'text' as const, text: p.texto }] : mandados.length ? [{ type: 'text' as const, text: '(Sin texto: solo estos archivos.)' }] : []),
      ],
    },
    {
      role: 'system',
      content: [
        {
          type: 'text',
          text:
            contextoDelDia(p.ficha, now()) +
            (continuacion
              ? '\nEsta conversación sigue a otra que se hizo muy larga. Lo que el cliente ya confirmó está guardado: míralo con ver_configuracion si lo necesitas. No vuelvas a saludar ni a preguntar lo ya guardado: contesta a su mensaje y sigue por la sección en la que vas.'
              : ''),
        },
      ],
    },
  ];
  await appendMessages(sql, businessId, conversationId, [
    {
      rol: 'user',
      contenido: p.texto,
      mensajes: turno,
      externalId: p.externalId,
      ...(mandados.length ? { extra: { adjuntos: mandados.map(({ id, nombre, tipo }) => ({ id, nombre, tipo })) } } : {}),
    },
  ]);
  // Al modelo, con los archivos de verdad en lugar de sus marcas.
  const mensajes = await expandirAdjuntos(sql, businessId, [...historial, ...turno]);

  const usage = vacio();
  const yaGastado = total(await usageAcumulado(sql, businessId, conversationId));

  const fija = async (texto: string, motivo: string, aviso: RespuestaPortal['aviso'] = 'error'): Promise<RespuestaPortal> => {
    // A diferencia del agente de las clientas (que tras un error deriva y no
    // vuelve a llamar al modelo, PA-06), este chat sigue. La respuesta fija va
    // también al historial como mensaje del asistente: si no, el turno queda
    // con el mensaje del cliente y el contexto sin respuesta y la API rechaza
    // TODOS los mensajes siguientes (alta:eval, 19/11/2026).
    const ultimo = mensajes.at(-1);
    const delAsistente: MessageParam[] = ultimo?.role === 'assistant' ? [] : [{ role: 'assistant', content: [{ type: 'text', text: texto }] }];
    await appendMessages(sql, businessId, conversationId, [{ rol: 'assistant', contenido: texto, mensajes: delAsistente, extra: { respuesta_fija: motivo } }]);
    await registrar(deps, businessId, conversationId, p.externalId, motivo);
    const estado = await estadoDelAlta(sql, businessId);
    return { respuesta: texto, resumen: ctx.resumen ?? null, altaTerminada: estado.terminadaAt !== null, seccion: estado.seccion, faltan: estado.faltan, modo, chat: { id: p.chatId, titulo: '' }, aviso };
  };

  // PC-22: llegado el tope del mes del chat del portal, no se llama al modelo.
  const portal = await costePortalDelMes(sql, businessId);
  if (topeAlcanzado(portal.costeUsd, portal.topeUsd)) return fija(TEXTO_TOPE_PORTAL, 'tope_portal', 'tope_portal');


  for (let vuelta = 0; ; vuelta++) {
    if (yaGastado + total(usage) >= LIMITES_PORTAL.maxTokensConversacion) {
      return fija('Esta conversación se ha hecho muy larga. Recarga la página y seguimos con lo que falte.', 'limite_tokens');
    }

    let respuesta: Anthropic.Beta.BetaMessage;
    try {
      respuesta = await model.create({
        model: settings.model,
        max_tokens: settings.maxTokensRespuesta,
        tools: definiciones(modo),
        system: [
          {
            type: 'text',
            text: promptDelPortal(ctx.ficha, modo, {
              faltan: (await estadoDelAlta(sql, businessId)).faltan,
              documentos: (await listarDocumentos(sql, businessId)).map((d) => d.titulo),
            }),
            cache_control: { type: 'ephemeral' },
          },
        ],
        cache_control: { type: 'ephemeral' },
        messages: mensajes,
        output_config: { effort: settings.effort },
        betas: [BETA_FALLBACKS],
        fallbacks: 'default',
      });
    } catch (e) {
      onError(e);
      return fija(TEXTO_ERROR, 'error');
    }
    const u = usageDe(respuesta);
    sumar(usage, u);

    const delAsistente: MessageParam = { role: 'assistant', content: respuesta.content as MessageParam['content'] };
    const fila: MessageRow = {
      rol: 'assistant',
      contenido: textoDe(respuesta) || null,
      mensajes: [delAsistente],
      usage: u,
      modelo: respuesta.model,
      stopReason: respuesta.stop_reason,
    };
    mensajes.push(delAsistente);

    if (respuesta.stop_reason === 'tool_use') {
      const resultados: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      const ejecutadas: { nombre: string; isError: boolean; seccion?: string }[] = [];
      for (const b of respuesta.content) {
        if (b.type !== 'tool_use') continue;
        const ex = await ejecutar(b.name, b.input, ctx, onError);
        ejecutadas.push({ nombre: ex.nombre, isError: ex.isError });
        resultados.push({ type: 'tool_result', tool_use_id: b.id, content: ex.content, ...(ex.isError ? { is_error: true } : {}) });
      }
      const deHerramientas: MessageParam = { role: 'user', content: resultados };
      mensajes.push(deHerramientas);
      await appendMessages(sql, businessId, conversationId, [
        { ...fila, extra: { herramientas: ejecutadas.map((x) => x.nombre) } },
        {
          rol: 'tool',
          contenido: ejecutadas.map((x) => `${x.nombre}: ${x.isError ? 'error' : 'ok'}`).join('\n'),
          mensajes: [deHerramientas],
          // PC-03: deja constancia de que se enseñó el resumen de esa sección.
          ...(ctx.resumen && ejecutadas.some((x) => x.nombre === 'proponer_resumen' && !x.isError) ? { extra: { propuesta: ctx.resumen.seccion } } : {}),
        },
      ]);
      if (vuelta + 1 >= LIMITES_PORTAL.maxVueltas) {
        return fija('Me he liado con este paso. ¿Me lo vuelves a decir con otras palabras?', 'limite_vueltas');
      }
      continue;
    }

    if (respuesta.stop_reason === 'pause_turn') {
      await appendMessages(sql, businessId, conversationId, [fila]);
      if (vuelta + 1 >= LIMITES_PORTAL.maxVueltas) return fija(TEXTO_ERROR, 'limite_vueltas');
      continue;
    }

    await appendMessages(sql, businessId, conversationId, [fila]);
    if (respuesta.stop_reason !== 'end_turn' && respuesta.stop_reason !== 'stop_sequence') {
      return fija(TEXTO_ERROR, respuesta.stop_reason === 'refusal' ? 'rechazo' : 'corte');
    }
    const texto = fila.contenido ?? '';
    if (!texto) return fija(TEXTO_ERROR, 'sin_texto');

    await registrar(deps, businessId, conversationId, p.externalId);
    const estado = await estadoDelAlta(sql, businessId);
    return {
      respuesta: texto,
      resumen: ctx.resumen ?? null,
      altaTerminada: estado.terminadaAt !== null,
      seccion: estado.seccion,
      faltan: estado.faltan,
      modo,
      chat: { id: p.chatId, titulo: '' },
    };
  }
}

/** PC-14: el gasto del portal se registra igual, pero no cuenta para el tope. */
async function registrar(deps: PortalChatDeps, businessId: string, conversationId: string, externalId: string, respuestaFija?: string): Promise<void> {
  try {
    const userRow = await findUserMessage(deps.sql, businessId, conversationId, externalId);
    const filas = userRow ? await filasDelTurno(deps.sql, businessId, userRow) : [];
    const llamadas: LlamadaRegistrada[] = filas
      .filter((f) => f.rol === 'assistant' && f.usage)
      .map((f) => ({ modelo: f.modelo ?? 'desconocido', usage: f.usage! }));
    await registrarUso(deps.sql, businessId, conversationId, eventosDelTurno({ llamadas, citasNuevas: [], ...(respuestaFija ? { respuestaFija } : {}) }));
  } catch (e) {
    (deps.onError ?? (() => {}))(e);
  }
}

async function usageAcumulado(sql: Sql, businessId: string, conversationId: string): Promise<UsageDetalle> {
  const u = await conversationUsage(sql, businessId, conversationId);
  return {
    input_tokens: u.inputTokens,
    output_tokens: u.outputTokens,
    cache_read_input_tokens: u.cacheReadTokens,
    cache_creation_input_tokens: u.cacheWriteTokens,
  };
}
