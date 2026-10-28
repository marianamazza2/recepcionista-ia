// =============================================================================
// Canal widget web (Fase 3 · 3.2 y 3.3)
// =============================================================================
// Lo que pasa con un mensaje del widget, en orden:
//
//   1. Mensaje de más de 1.000 caracteres → texto fijo (PW-05). No se guarda.
//   2. Sesión (PW-03): con un token válido de este negocio cuyo último mensaje
//      fue hace menos de 2 h (PW-12), se retoma esa conversación; si no, se
//      crea una nueva y se le da al navegador un token nuevo — salvo que desde
//      esa IP ya se abrieran 10 en la última hora (PW-05).
//   3. Lock de la conversación: los mensajes de una conversación van de uno en
//      uno (D-45). Dentro del lock:
//   4. Idempotencia: si ese clientMessageId ya se procesó en esta conversación,
//      se devuelve la respuesta que se dio, sin llamar al modelo (maestro §9).
//   5. Límite de 20 mensajes por conversación y hora (PW-05) y tope mensual del
//      negocio (PW-04) → texto fijo, sin llamar al modelo.
//   6. El turno del agente (núcleo de la Fase 2, sin cambios salvo el
//      external_id).
//   7. Consumo en usage_events, SMS de confirmación de las citas nuevas y
//      movidas (PW-07, PW-09) y SMS de las canceladas (PW-10).
//
// Nunca lanza por un fallo del agente o de la base durante el turno: responde
// con un texto fijo con el teléfono del local y el error va al log.
//
// Las respuestas fijas de este canal se guardan como las de la Fase 2: con
// `mensajes: []`, en el log pero fuera del historial de la API (D-45).
// =============================================================================

import type { Sql } from 'postgres';

import type { SmsProvider } from '../sms/types.js';
import { loadBusinessConfig } from '../../config/business.js';
import { runAgentTurn, type AgentSettings, type ModelClient, type TurnResult } from '../../core/agent.js';
import { textoParaLaClienta } from '../../core/guardrails.js';
import { enviarCancelacion, enviarConfirmacion } from '../../citas/confirmacion.js';
import { appendMessages } from '../../db/conversations.js';
import { costeDelMes, eventosDelTurno, registrarUso, topeAlcanzado, type LlamadaRegistrada } from '../../db/usage.js';
import {
  conLockDeConversacion,
  conversacionesRecientesDesdeIp,
  conversationBySession,
  createWebConversation,
  estadoDeConversacion,
  filasDelTurno,
  filasParaHistorial,
  findUserMessage,
  hashIp,
  mensajesRecientes,
  nuevoToken,
  sha256,
  type WebConversation,
  type WidgetBusiness,
} from '../../db/widget.js';

/** PW-03 y PW-05. */
export interface LimitesWidget {
  maxCaracteres: number;
  mensajesPorHora: number;
  conversacionesPorHoraIp: number;
  sesionHoras: number;
  /** Cuánto espera un mensaje a que termine el anterior de la misma conversación. */
  esperaLockMs: number;
}

export const LIMITES_WIDGET: LimitesWidget = {
  maxCaracteres: 1000,
  mensajesPorHora: 20,
  conversacionesPorHoraIp: 10,
  sesionHoras: 2,
  // El peor caso de un turno es ~3 × 60 s (D-48) más las herramientas.
  esperaLockMs: 200_000,
};

export interface WebChatDeps {
  sql: Sql;
  model: ModelClient;
  settings: AgentSettings;
  sms: SmsProvider;
  /** URL pública de este servidor, para el enlace del SMS. */
  baseUrl: string;
  /** Reloj del agente (los tests lo fijan). Los límites y la sesión usan el de la base. */
  now?: () => Date;
  onError?: (e: unknown) => void;
  limites?: Partial<LimitesWidget>;
}

export type AvisoWidget =
  | 'mensaje_largo'
  | 'limite_mensajes'
  | 'limite_conversaciones'
  | 'tope_mensual'
  | 'ocupado'
  | 'error';

export interface ResultadoChat {
  /** El token que el navegador tiene que guardar (null si no se abrió conversación). */
  sessionToken: string | null;
  respuesta: string;
  /** La conversación está pasada a una persona (PA-06). */
  escalada: boolean;
  /** Se empezó una conversación nueva (el navegador debe olvidar los mensajes anteriores). */
  nuevaConversacion: boolean;
  /** Si la respuesta es un texto fijo del canal, por qué. */
  aviso?: AvisoWidget;
}

// -----------------------------------------------------------------------------
// Textos fijos del canal (sin datos de ningún negocio concreto)
// -----------------------------------------------------------------------------

function llamar(negocio: WidgetBusiness): string {
  return negocio.telefonoHumano ? `llama al ${negocio.telefonoHumano}` : 'llama al local';
}

export function textoFijo(negocio: WidgetBusiness, aviso: AvisoWidget, limites: LimitesWidget = LIMITES_WIDGET): string {
  switch (aviso) {
    case 'mensaje_largo':
      return `Tu mensaje es demasiado largo. ¿Puedes escribirlo en menos de ${limites.maxCaracteres.toLocaleString('es-ES')} caracteres?`;
    case 'limite_mensajes':
      return `Has enviado muchos mensajes seguidos y necesito una pausa. Vuelve a escribirme dentro de un rato o ${llamar(negocio)}.`;
    case 'limite_conversaciones':
      return `Ahora mismo no puedo abrir más conversaciones desde esta conexión. Inténtalo más tarde o ${llamar(negocio)}.`;
    case 'tope_mensual':
      return `Ahora mismo no puedo atenderte por aquí. Si quieres pedir o cambiar una cita, ${llamar(negocio)} y te ayudamos.`;
    case 'ocupado':
      return 'Sigo con tu mensaje anterior. Espera un momento y vuelve a enviarlo.';
    case 'error':
      return `Perdona, ha habido un problema y no he podido responderte. Inténtalo de nuevo en un momento o ${llamar(negocio)}.`;
  }
}

/** La clave de idempotencia en messages.external_id: incluye la conversación, así no choca con la de otra. */
export function externalIdWeb(conversationId: string, clientMessageId: string): string {
  return `web:${conversationId}:${clientMessageId}`;
}

// -----------------------------------------------------------------------------

export async function procesarMensajeWeb(
  deps: WebChatDeps,
  negocio: WidgetBusiness,
  p: { sessionToken?: string | undefined; clientMessageId: string; texto: string; ip: string | null },
): Promise<ResultadoChat> {
  const limites = { ...LIMITES_WIDGET, ...deps.limites };
  const onError = deps.onError ?? (() => {});
  const texto = p.texto.trim();
  const sinCambiar = (aviso: AvisoWidget): ResultadoChat => ({
    sessionToken: p.sessionToken ?? null,
    respuesta: textoFijo(negocio, aviso, limites),
    escalada: false,
    nuevaConversacion: false,
    aviso,
  });

  if (texto.length > limites.maxCaracteres) return sinCambiar('mensaje_largo');

  // --- 2. Sesión ---------------------------------------------------------------
  let conv: WebConversation | null = p.sessionToken
    ? await conversationBySession(deps.sql, negocio.id, sha256(p.sessionToken), limites.sesionHoras)
    : null;
  let sessionToken = p.sessionToken ?? null;
  let nuevaConversacion = false;
  if (!conv) {
    const ipHash = p.ip ? hashIp(negocio.id, p.ip) : null;
    if (ipHash && (await conversacionesRecientesDesdeIp(deps.sql, negocio.id, ipHash, 60)) >= limites.conversacionesPorHoraIp) {
      return { ...sinCambiar('limite_conversaciones'), sessionToken: null, nuevaConversacion: p.sessionToken !== undefined };
    }
    const t = nuevoToken();
    conv = await createWebConversation(deps.sql, negocio.id, t.hash, ipHash);
    sessionToken = t.token;
    nuevaConversacion = true;
  }
  const conversationId = conv.id;
  const externalId = externalIdWeb(conversationId, p.clientMessageId);

  // --- 3. Lock -----------------------------------------------------------------
  const r = await conLockDeConversacion(deps.sql, conversationId, limites.esperaLockMs, async () => {
    // --- 4. Idempotencia ---------------------------------------------------------
    const previo = await findUserMessage(deps.sql, negocio.id, conversationId, externalId);
    if (previo) return respuestaYaDada(deps, negocio, conversationId, previo, limites);

    const fija = async (aviso: AvisoWidget) => {
      const respuesta = textoFijo(negocio, aviso, limites);
      await appendMessages(deps.sql, negocio.id, conversationId, [
        { rol: 'user', contenido: texto, mensajes: [], externalId, extra: { respuesta_fija: aviso } },
        { rol: 'assistant', contenido: respuesta, mensajes: [], extra: { respuesta_fija: aviso } },
      ]);
      await registrarUso(deps.sql, negocio.id, conversationId, eventosDelTurno({ llamadas: [], citasNuevas: [], respuestaFija: aviso }));
      return { respuesta, escalada: (await estadoDeConversacion(deps.sql, negocio.id, conversationId)) !== 'activa', aviso };
    };

    // --- 5. Límites y tope ----------------------------------------------------------
    if ((await mensajesRecientes(deps.sql, negocio.id, conversationId, 60)) >= limites.mensajesPorHora) {
      return fija('limite_mensajes');
    }
    if (topeAlcanzado(await costeDelMes(deps.sql, negocio.id), negocio.topeMensualUsd)) {
      return fija('tope_mensual');
    }

    // --- 6. El turno -------------------------------------------------------------
    let turno: TurnResult;
    try {
      const config = await loadBusinessConfig(deps.sql, { id: negocio.id });
      turno = await runAgentTurn(
        { sql: deps.sql, model: deps.model, settings: deps.settings, onError, ...(deps.now ? { now: deps.now } : {}) },
        { config, conversationId, mensaje: texto, externalId },
      );

      // --- 7. Consumo y SMS (lo que falle aquí no cambia la respuesta) -------------
      const citas = citasDelTurno(turno);
      try {
        const userRow = await findUserMessage(deps.sql, negocio.id, conversationId, externalId);
        const llamadas = userRow ? llamadasDe(await filasDelTurno(deps.sql, negocio.id, userRow)) : [];
        await registrarUso(
          deps.sql,
          negocio.id,
          conversationId,
          eventosDelTurno({ llamadas, citasNuevas: citas.nuevas, ...(turno.motivoFin !== 'respuesta' ? { respuestaFija: turno.motivoFin } : {}) }),
        );
      } catch (e) {
        onError(e);
      }
      for (const id of [...citas.nuevas, ...citas.movidas]) {
        await enviarConfirmacion({ sql: deps.sql, sms: deps.sms, baseUrl: deps.baseUrl, onError }, config, id);
      }
      for (const id of citas.canceladas) {
        await enviarCancelacion({ sql: deps.sql, sms: deps.sms, baseUrl: deps.baseUrl, onError }, config, id);
      }
    } catch (e) {
      onError(e);
      try {
        const yaGuardado = await findUserMessage(deps.sql, negocio.id, conversationId, externalId);
        const respuesta = textoFijo(negocio, 'error', limites);
        await appendMessages(deps.sql, negocio.id, conversationId, [
          ...(yaGuardado ? [] : [{ rol: 'user' as const, contenido: texto, mensajes: [], externalId }]),
          { rol: 'assistant', contenido: respuesta, mensajes: [], extra: { respuesta_fija: 'error' } },
        ]);
      } catch (e2) {
        onError(e2);
      }
      return { respuesta: textoFijo(negocio, 'error', limites), escalada: false, aviso: 'error' as const };
    }
    return { respuesta: turno.texto, escalada: turno.escalada };
  });

  if (!r) {
    return { ...sinCambiar('ocupado'), sessionToken, nuevaConversacion };
  }
  return { sessionToken, nuevaConversacion, ...r.valor };
}

/** La respuesta que ya se dio a un mensaje repetido: la última fila del asistente de ese turno. */
async function respuestaYaDada(
  deps: WebChatDeps,
  negocio: WidgetBusiness,
  conversationId: string,
  userMessageId: string,
  limites: LimitesWidget,
): Promise<{ respuesta: string; escalada: boolean; aviso?: AvisoWidget }> {
  const filas = await filasDelTurno(deps.sql, negocio.id, userMessageId);
  const ultima = [...filas].reverse().find((f) => f.rol === 'assistant' && f.contenido);
  const respuesta = ultima ? textoParaLaClienta(ultima.contenido!) : '';
  const escalada = (await estadoDeConversacion(deps.sql, negocio.id, conversationId)) !== 'activa';
  return respuesta ? { respuesta, escalada } : { respuesta: textoFijo(negocio, 'error', limites), escalada, aviso: 'error' };
}

function llamadasDe(filas: Awaited<ReturnType<typeof filasDelTurno>>): LlamadaRegistrada[] {
  return filas
    .filter((f) => f.rol === 'assistant' && f.usage)
    .map((f) => ({ modelo: f.modelo ?? 'desconocido', usage: f.usage! }));
}

/**
 * Las citas que dejó confirmadas el turno, leídas de los resultados de las
 * herramientas: `nuevas` (reservas: cuentan como cita en el consumo) y
 * `movidas` (la cita en su hora nueva: es otra fila y necesita su propio
 * enlace). Las dos reciben SMS de confirmación. Y `canceladas` (PW-10): las
 * que cancelar_reserva canceló en este turno (no las que ya lo estaban).
 */
export function citasDelTurno(turno: Pick<TurnResult, 'herramientas'>): { nuevas: string[]; movidas: string[]; canceladas: string[] } {
  const nuevas: string[] = [];
  const movidas: string[] = [];
  const canceladas: string[] = [];
  const id = (v: unknown): string | null => {
    const x = (v as { id_cita?: unknown } | undefined)?.id_cita;
    return typeof x === 'string' ? x : null;
  };
  for (const h of turno.herramientas) {
    if (!h.resultado.ok) continue;
    const d = h.resultado.data;
    if (h.nombre === 'crear_reserva') {
      const c = id(d.cita);
      if (c) nuevas.push(c);
    } else if (h.nombre === 'reprogramar_reserva') {
      const c = id(d.cita_nueva);
      if (c) movidas.push(c);
    } else if (h.nombre === 'reservar_y_cambiar_cita_anterior' && d.reservada) {
      const c = id(d.cita_nueva);
      if (c) nuevas.push(c);
      const m = id((d.cita_anterior_movida as { ahora?: unknown } | undefined)?.ahora);
      if (m) movidas.push(m);
    } else if (h.nombre === 'cancelar_reserva' && d.cancelada && !d.ya_estaba_cancelada) {
      const c = id(d.cita);
      if (c) canceladas.push(c);
    }
  }
  return { nuevas, movidas, canceladas };
}

// -----------------------------------------------------------------------------
// Historial (PW-03)
// -----------------------------------------------------------------------------

export interface MensajeVisible {
  rol: 'clienta' | 'asistente';
  texto: string;
}

/**
 * Lo que la clienta vio: sus mensajes y, de cada turno, la última respuesta
 * del asistente (los textos intermedios que acompañan a una herramienta no
 * llegaron al navegador). null si el token no vale o caducó.
 */
export async function historialWeb(
  deps: Pick<WebChatDeps, 'sql' | 'limites'>,
  negocio: WidgetBusiness,
  sessionToken: string,
): Promise<{ mensajes: MensajeVisible[]; escalada: boolean } | null> {
  const limites = { ...LIMITES_WIDGET, ...deps.limites };
  const conv = await conversationBySession(deps.sql, negocio.id, sha256(sessionToken), limites.sesionHoras);
  if (!conv) return null;
  const filas = await filasParaHistorial(deps.sql, negocio.id, conv.id);
  const mensajes: MensajeVisible[] = [];
  let pendiente: string | null = null;
  const cerrarTurno = () => {
    if (pendiente) mensajes.push({ rol: 'asistente', texto: pendiente });
    pendiente = null;
  };
  for (const f of filas) {
    if (f.rol === 'user') {
      cerrarTurno();
      if (f.contenido) mensajes.push({ rol: 'clienta', texto: f.contenido });
    } else if (f.rol === 'assistant' && f.contenido) {
      const t = textoParaLaClienta(f.contenido);
      if (t) pendiente = t;
    }
  }
  cerrarTurno();
  return { mensajes, escalada: conv.estado !== 'activa' };
}
