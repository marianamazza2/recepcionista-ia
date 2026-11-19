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
//   · una conversación por negocio (la del portal), marcada `alta` para que su
//     gasto no cuente en el tope (PC-14) y se vea aparte en el consumo;
//   · el business_id sale SIEMPRE de la sesión, nunca del chat (PC-02);
//   · los mensajes de la misma conversación se procesan de uno en uno
//     (el mismo lock que el widget, D-45) y el mismo mensaje repetido no se
//     procesa dos veces (clientMessageId, maestro §9);
//   · si algo falla, se responde con un texto en palabras y el error va al log:
//     el cliente nunca ve un error técnico.
// =============================================================================

import type Anthropic from '@anthropic-ai/sdk';
import type { Sql } from 'postgres';

import type { EmailProvider } from '../adapters/email/types.js';
import { BETA_FALLBACKS, type AgentSettings, type ModelClient } from '../core/agent.js';
import { appendMessages, conversationUsage, createConversation, getConversation, loadHistory, type MessageRow, type UsageDetalle } from '../db/conversations.js';
import { leerNegocio, type NegocioPanel } from '../db/negocios.js';
import { estadoDelAlta, guardarEstadoDelAlta } from '../db/portal.js';
import { eventosDelTurno, registrarUso, type LlamadaRegistrada } from '../db/usage.js';
import { conLockDeConversacion, filasDelTurno, findUserMessage } from '../db/widget.js';
import { contextoDelDia, definiciones, ejecutar, type ContextoPortal, type Resumen } from './herramientas.js';
import { promptDelPortal, type ModoChat } from './prompt.js';
import { utcToLocal } from '../core/time.js';

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
}

export interface RespuestaPortal {
  respuesta: string;
  /** PC-03: el bloque que el portal dibuja debajo del mensaje, si lo hay. */
  resumen: Resumen | null;
  /** PC-11: con true, el portal aparece. */
  altaTerminada: boolean;
  /** Por qué sección del guion va (para recibirle por ahí si vuelve). */
  seccion: number;
  modo: ModoChat;
  aviso?: 'mensaje_largo' | 'ocupado' | 'error';
}

const TEXTO_ERROR = 'Perdona, ha habido un problema y no he podido responderte. Inténtalo de nuevo en un momento.';
const TEXTO_OCUPADO = 'Sigo con tu mensaje anterior. Espera un momento y vuelve a enviarlo.';

/** La conversación del portal de ese negocio; la crea si no existe. */
export async function conversacionDelPortal(sql: Sql, businessId: string): Promise<{ conversationId: string; seccion: number; terminada: boolean }> {
  const estado = await estadoDelAlta(sql, businessId);
  if (estado.conversationId && (await getConversation(sql, businessId, estado.conversationId))) {
    return { conversationId: estado.conversationId, seccion: estado.seccion, terminada: estado.terminadaAt !== null };
  }
  const conv = await createConversation(sql, businessId, null, 'web', { alta: true });
  await guardarEstadoDelAlta(sql, businessId, { conversationId: conv.id });
  return { conversationId: conv.id, seccion: estado.seccion, terminada: estado.terminadaAt !== null };
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
  p: { businessId: string; texto: string; clientMessageId: string },
): Promise<RespuestaPortal> {
  const now = deps.now ?? (() => new Date());
  const onError = deps.onError ?? (() => {});
  const texto = p.texto.trim();

  const ficha = await leerNegocio(deps.sql, p.businessId);
  if (!ficha) throw new Error(`El negocio ${p.businessId} no existe`);
  const { conversationId, seccion, terminada } = await conversacionDelPortal(deps.sql, p.businessId);
  const modo: ModoChat = terminada ? 'portal' : 'alta';

  if (texto.length > LIMITES_PORTAL.maxCaracteres) {
    return {
      respuesta: `Tu mensaje es muy largo. ¿Puedes contármelo en menos de ${LIMITES_PORTAL.maxCaracteres.toLocaleString('es-ES')} caracteres?`,
      resumen: null,
      altaTerminada: terminada,
      seccion,
      modo,
      aviso: 'mensaje_largo',
    };
  }

  const externalId = `portal:${conversationId}:${p.clientMessageId}`;

  const r = await conLockDeConversacion(deps.sql, conversationId, LIMITES_PORTAL.esperaLockMs, async () => {
    // Idempotencia: el mismo mensaje reenviado devuelve lo que ya se contestó.
    const previo = await findUserMessage(deps.sql, p.businessId, conversationId, externalId);
    if (previo) {
      const filas = await filasDelTurno(deps.sql, p.businessId, previo);
      const ultima = [...filas].reverse().find((f) => f.rol === 'assistant' && f.contenido);
      const estado = await estadoDelAlta(deps.sql, p.businessId);
      return {
        respuesta: ultima?.contenido ?? TEXTO_ERROR,
        resumen: null,
        altaTerminada: estado.terminadaAt !== null,
        seccion: estado.seccion,
        modo,
      } satisfies RespuestaPortal;
    }
    return ejecutarTurno(deps, { businessId: p.businessId, conversationId, texto, externalId, ficha, modo, seccion, now, onError });
  });

  if (!r) return { respuesta: TEXTO_OCUPADO, resumen: null, altaTerminada: terminada, seccion, modo, aviso: 'ocupado' };
  return r.valor;
}

async function ejecutarTurno(
  deps: PortalChatDeps,
  p: {
    businessId: string;
    conversationId: string;
    texto: string;
    externalId: string;
    ficha: NegocioPanel;
    modo: ModoChat;
    seccion: number;
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
  // confirmado ya está guardado sección a sección y `portal.alta` sabe por
  // dónde va: la nueva sigue desde ahí, sin repetir nada.
  let continuacion = false;
  if (total(await usageAcumulado(sql, businessId, conversationId)) >= LIMITES_PORTAL.maxTokensConversacion * UMBRAL_NUEVA_CONVERSACION) {
    const nueva = await createConversation(sql, businessId, null, 'web', { alta: true });
    await guardarEstadoDelAlta(sql, businessId, { conversationId: nueva.id });
    conversationId = nueva.id;
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
  };

  const historial = await loadHistory(sql, businessId, conversationId);
  const turno: MessageParam[] = [
    { role: 'user', content: [{ type: 'text', text: p.texto }] },
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
  await appendMessages(sql, businessId, conversationId, [{ rol: 'user', contenido: p.texto, mensajes: turno, externalId: p.externalId }]);
  const mensajes = [...historial, ...turno];

  const usage = vacio();
  const yaGastado = total(await usageAcumulado(sql, businessId, conversationId));

  const fija = async (texto: string, motivo: string): Promise<RespuestaPortal> => {
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
    return { respuesta: texto, resumen: ctx.resumen ?? null, altaTerminada: estado.terminadaAt !== null, seccion: estado.seccion, modo, aviso: 'error' };
  };

  for (let vuelta = 0; ; vuelta++) {
    if (yaGastado + total(usage) >= LIMITES_PORTAL.maxTokensConversacion) {
      return fija('Esta conversación se ha hecho muy larga. Recarga la página y seguimos con lo que falte.', 'limite_tokens');
    }

    const hora = utcToLocal(now(), ctx.ficha.timezone).hora;
    let respuesta: Anthropic.Beta.BetaMessage;
    try {
      respuesta = await model.create({
        model: settings.model,
        max_tokens: settings.maxTokensRespuesta,
        tools: definiciones(modo),
        system: [{ type: 'text', text: promptDelPortal(ctx.ficha, modo, { seccion: p.seccion, horaLocal: hora }), cache_control: { type: 'ephemeral' } }],
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
      modo,
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
