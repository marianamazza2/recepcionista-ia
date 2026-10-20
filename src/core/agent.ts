// =============================================================================
// El loop del agente (Fase 2 · 2.4)
// =============================================================================
// Recibe la conversación y el mensaje nuevo de la clienta y devuelve la
// respuesta. Tool use MANUAL (no el tool runner del SDK): el loop tiene que
// guardar cada vuelta en la base, aplicar los límites de coste, cortar al
// derivar y usar parámetros beta (fallbacks); ver D-44.
//
// Reglas de la API que se respetan aquí (spec, "API de Claude"):
//   · Historial solo-añadir: se reenvía el `content` completo de cada
//     respuesta, con los bloques `thinking`, sin tocarlo.
//   · System prompt estable y cacheado; la fecha y la hora van en un mensaje
//     de sistema detrás del mensaje de la clienta, nunca en el system prompt.
//   · tool_choice `auto` (en Opus 5.5 forzarla da 400), `strict: true` en
//     cada herramienta, TODOS los tool_result de una vuelta en un mensaje.
//   · stop_reason se mira antes de leer la respuesta; refusal con fallbacks
//     del servidor ("default").
//   · Errores del SDK por clase, nunca por texto.
// =============================================================================

import Anthropic from '@anthropic-ai/sdk';
import type { Sql } from 'postgres';

import { SupabaseAdapter } from '../adapters/booking/supabase.js';
import type { BookingAdapter } from '../adapters/booking/types.js';
import type { BusinessConfig } from '../config/business.js';
import {
  appendMessages,
  conversationUsage,
  escalateConversation,
  getConversation,
  loadHistory,
  type MessageRow,
  type UsageDetalle,
} from '../db/conversations.js';
import { getCustomer } from '../db/customers.js';
import {
  LIMITES_DE_SERIE,
  limitsFromEnv,
  respuestaFija,
  textoParaLaClienta,
  type AgentLimits,
  type MotivoRespuestaFija,
} from './guardrails.js';
import { buildSystemPrompt, contextoDelTurno } from './prompt.js';
import { executeTool, toolDefinitions, type ToolExecution } from './tools/index.js';
import type { ToolContext } from './tools/types.js';

type MessageParam = Anthropic.Beta.BetaMessageParam;
type CreateParams = Anthropic.Beta.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.BetaMessage;

/** Fallbacks del servidor ante `refusal` (Opus 5 y 5.5): el modelo recomendado por categoría. */
export const BETA_FALLBACKS = 'server-side-fallback-2026-07-01';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AgentSettings {
  model: string;
  effort: Effort;
  /** Tope de salida por llamada (incluye el pensamiento). */
  maxTokensRespuesta: number;
  /**
   * Tiempo máximo de espera por llamada a la API, en ms. El SDK espera 10 min
   * de serie; en un chat eso es demasiado (en una prueba, una llamada tardó
   * 4 minutos). Con 2 reintentos, el peor caso es ~3 × este valor.
   */
  timeoutMs: number;
  limits: AgentLimits;
}

export const AJUSTES_DE_SERIE: AgentSettings = {
  model: 'claude-opus-5',
  effort: 'low',
  maxTokensRespuesta: 8000,
  timeoutMs: 60_000,
  limits: LIMITES_DE_SERIE,
};

const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** Modelo y esfuerzo por variable de entorno (AGENT_MODEL, AGENT_EFFORT): es decisión de Mariana, no del código. */
export function settingsFromEnv(env: NodeJS.ProcessEnv = process.env): AgentSettings {
  const effort = env.AGENT_EFFORT as Effort | undefined;
  const maxTokens = Number(env.AGENT_MAX_TOKENS_RESPUESTA);
  const timeout = Number(env.AGENT_TIMEOUT_MS);
  return {
    model: env.AGENT_MODEL?.trim() || AJUSTES_DE_SERIE.model,
    effort: effort && EFFORTS.includes(effort) ? effort : AJUSTES_DE_SERIE.effort,
    maxTokensRespuesta: Number.isInteger(maxTokens) && maxTokens > 0 ? maxTokens : AJUSTES_DE_SERIE.maxTokensRespuesta,
    timeoutMs: Number.isInteger(timeout) && timeout > 0 ? timeout : AJUSTES_DE_SERIE.timeoutMs,
    limits: limitsFromEnv(env),
  };
}

/** Lo único que el loop necesita del SDK. Los tests lo sustituyen por un modelo simulado. */
export interface ModelClient {
  create(params: CreateParams): Promise<Message>;
}

/** El cliente real. La clave sale de ANTHROPIC_API_KEY (.env), nunca del código. */
export function anthropicModelClient(settings: Pick<AgentSettings, 'timeoutMs'> = AJUSTES_DE_SERIE): ModelClient {
  const client = new Anthropic({ timeout: settings.timeoutMs, maxRetries: 2 });
  return { create: (params) => client.beta.messages.create(params) };
}

export interface AgentDeps {
  sql: Sql;
  model: ModelClient;
  settings: AgentSettings;
  /** Por defecto, el SupabaseAdapter del negocio. */
  adapter?: BookingAdapter;
  now?: () => Date;
  /** Errores inesperados (de herramientas o de la API), para el log. */
  onError?: (e: unknown) => void;
}

export type MotivoFin = 'respuesta' | MotivoRespuestaFija | 'rechazo' | 'corte';

export interface TurnResult {
  texto: string;
  /** La conversación quedó (o ya estaba) pasada a una persona. */
  escalada: boolean;
  motivoFin: MotivoFin;
  herramientas: ToolExecution[];
  llamadas: number;
  usage: UsageDetalle;
}

function vacio(): UsageDetalle {
  return { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
}

function usageDe(m: Message): UsageDetalle {
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

function textoDe(m: Message): string {
  return m.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/** Construye la petición. Lo estable (herramientas, system) va primero y cacheado. */
export function buildRequest(
  settings: AgentSettings,
  config: BusinessConfig,
  messages: MessageParam[],
): CreateParams {
  return {
    model: settings.model,
    max_tokens: settings.maxTokensRespuesta,
    tools: toolDefinitions(config),
    system: [{ type: 'text', text: buildSystemPrompt(config), cache_control: { type: 'ephemeral' } }],
    // Caché automática del historial: el punto de corte avanza solo con la
    // conversación, sin marcar a mano bloques del historial.
    cache_control: { type: 'ephemeral' },
    messages,
    output_config: { effort: settings.effort },
    betas: [BETA_FALLBACKS],
    fallbacks: 'default',
  };
}

/**
 * Procesa un mensaje de la clienta en una conversación y devuelve la respuesta.
 * Todo queda guardado en `messages` (y las derivaciones en `escalations`).
 */
export async function runAgentTurn(
  deps: AgentDeps,
  params: {
    config: BusinessConfig;
    conversationId: string;
    mensaje: string;
    /** Id del mensaje en el canal (Fase 3: el clientMessageId del widget), a messages.external_id. */
    externalId?: string;
  },
): Promise<TurnResult> {
  const { sql, model, settings } = deps;
  const { config, conversationId } = params;
  const now = deps.now ?? (() => new Date());
  const onError = deps.onError ?? (() => {});
  const mensaje = params.mensaje.trim();
  const externalId = params.externalId !== undefined ? { externalId: params.externalId } : {};

  const conv = await getConversation(sql, config.id, conversationId);
  if (!conv) {
    throw new Error(`La conversación ${conversationId} no existe en el negocio ${config.id}`);
  }

  const usage = vacio();
  const herramientas: ToolExecution[] = [];
  let llamadas = 0;

  /** Respuesta del código (no del modelo): se guarda para el log, fuera del historial de la API. */
  const fija = async (motivo: MotivoRespuestaFija, escalar: boolean): Promise<TurnResult> => {
    if (escalar) {
      await escalateConversation(sql, config.id, conversationId, `${motivo}: derivada automáticamente por el sistema`);
    }
    const texto = respuestaFija(config, motivo);
    await appendMessages(sql, config.id, conversationId, [
      { rol: 'assistant', contenido: texto, mensajes: [], extra: { respuesta_fija: motivo } },
    ]);
    return { texto, escalada: true, motivoFin: motivo, herramientas, llamadas, usage };
  };

  // PA-06: una conversación derivada no vuelve a llamar al modelo.
  if (conv.estado !== 'activa') {
    await appendMessages(sql, config.id, conversationId, [{ rol: 'user', contenido: mensaje, mensajes: [], ...externalId }]);
    return fija('conversacion_derivada', false);
  }

  const historial = await loadHistory(sql, config.id, conversationId);
  const clienta = conv.customerId ? await getCustomer(sql, config.id, conv.customerId) : null;

  // El mensaje de la clienta y, detrás, el contexto del turno como mensaje de
  // sistema: no se puede falsificar desde el chat y no invalida la caché.
  const turno: MessageParam[] = [
    { role: 'user', content: [{ type: 'text', text: mensaje }] },
    { role: 'system', content: contextoDelTurno(config, now(), clienta) },
  ];
  await appendMessages(sql, config.id, conversationId, [{ rol: 'user', contenido: mensaje, mensajes: turno, ...externalId }]);
  const mensajes = [...historial, ...turno];

  const ctx: ToolContext = {
    sql,
    adapter: deps.adapter ?? new SupabaseAdapter({ sql, businessId: config.id }),
    config,
    conversationId,
    state: { customerId: conv.customerId, estado: conv.estado },
    now,
  };

  const yaGastado = total(await usageAcumulado(sql, config.id, conversationId));

  for (let vuelta = 0; ; vuelta++) {
    if (yaGastado + total(usage) >= settings.limits.maxTokensConversacion) {
      return fija('limite_tokens', true);
    }

    let respuesta: Message;
    try {
      respuesta = await model.create(buildRequest(settings, config, mensajes));
    } catch (e) {
      // El SDK ya reintenta lo reintentable (429, 5xx, red: maxRetries). Lo
      // que llega aquí no se arregla insistiendo: se deriva (PA-05, "si algo
      // falla"). El error (Anthropic.APIError y subclases) va al log.
      onError(e);
      return fija('error', true);
    }
    llamadas++;
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

    switch (respuesta.stop_reason) {
      case 'tool_use': {
        // TODAS las herramientas pedidas, en orden, y TODOS los resultados en
        // un único mensaje. En orden y no en paralelo: identificar_cliente
        // tiene que ir antes que la reserva que la necesita.
        const resultados: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        const ejecutadas: ToolExecution[] = [];
        for (const b of respuesta.content) {
          if (b.type !== 'tool_use') continue;
          const ex = await executeTool(b.name, b.input, ctx, onError);
          ejecutadas.push(ex);
          resultados.push({ type: 'tool_result', tool_use_id: b.id, content: ex.content, ...(ex.isError ? { is_error: true } : {}) });
        }
        herramientas.push(...ejecutadas);
        const deHerramientas: MessageParam = { role: 'user', content: resultados };
        mensajes.push(deHerramientas);
        // La respuesta y sus resultados se guardan juntos: el historial nunca
        // queda con un tool_use sin su tool_result.
        await appendMessages(sql, config.id, conversationId, [
          { ...fila, extra: { herramientas: ejecutadas.map((x) => x.nombre) } },
          {
            rol: 'tool',
            contenido: ejecutadas.map((x) => `${x.nombre}: ${x.isError ? `error ${(x.resultado as { error: { motivo: string } }).error.motivo}` : 'ok'}`).join('\n'),
            mensajes: [deHerramientas],
          },
        ]);
        if (vuelta + 1 >= settings.limits.maxVueltas) {
          return fija('limite_vueltas', true);
        }
        continue;
      }

      case 'pause_turn':
        // Solo lo producen herramientas de servidor (no hay ninguna), pero si
        // llega se continúa como dice la documentación.
        await appendMessages(sql, config.id, conversationId, [fila]);
        if (vuelta + 1 >= settings.limits.maxVueltas) {
          return fija('limite_vueltas', true);
        }
        continue;

      case 'end_turn':
      case 'stop_sequence': {
        await appendMessages(sql, config.id, conversationId, [fila]);
        const texto = textoParaLaClienta(fila.contenido ?? '');
        if (!texto) {
          // Terminar sin decir nada (o solo con etiquetas internas) no es una
          // respuesta para la clienta. Si acaba de derivar, la respuesta fija
          // de derivación ya dice lo que hacía falta (PA-06).
          return ctx.state.estado === 'escalada' ? fija('conversacion_derivada', false) : fija('error', true);
        }
        return {
          texto,
          escalada: ctx.state.estado === 'escalada',
          motivoFin: 'respuesta',
          herramientas,
          llamadas,
          usage,
        };
      }

      default: {
        // refusal (también tras los fallbacks), max_tokens,
        // model_context_window_exceeded…: no hay una respuesta entera y fiable.
        await appendMessages(sql, config.id, conversationId, [fila]);
        const r = await fija('error', true);
        return { ...r, motivoFin: respuesta.stop_reason === 'refusal' ? 'rechazo' : 'corte' };
      }
    }
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
