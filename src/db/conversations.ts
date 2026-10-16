// =============================================================================
// Conversaciones, mensajes y derivaciones (Fase 2 · 2.4)
// =============================================================================
// Cada fila de `messages` guarda, en `tool_calls`, los mensajes EXACTOS que esa
// fila aporta al historial que se manda a la API (`mensajes`), tal cual se
// enviaron o se recibieron: el `content` completo del asistente, con sus
// bloques `thinking` sin tocar. El historial de la siguiente llamada es la
// concatenación de esos mensajes en orden (solo-añadir: nunca se edita una fila
// anterior; el modelo invalida su razonamiento si el historial cambia).
//
//   rol        contenido (para leer)          tool_calls.mensajes (para la API)
//   user       lo que escribió la clienta     [user, system con fecha y hora]
//   assistant  el texto de la respuesta       [assistant con el content completo]
//   tool       resumen de las herramientas    [user con todos los tool_result]
//
// Las respuestas fijas del código (derivación por límites, conversación ya
// derivada) se guardan con `mensajes: []`: se ven en el log, pero no entran en
// el historial de la API porque no las escribió el modelo.
//
// `created_at` se escribe con clock_timestamp() para que las filas de una
// misma transacción queden ordenadas (now() es el inicio de la transacción).
// =============================================================================

import type Anthropic from '@anthropic-ai/sdk';
import type { JSONValue, Sql } from 'postgres';

import { inTenant } from './tenant.js';

export type ConversationEstado = 'activa' | 'escalada' | 'cerrada';

export interface Conversation {
  id: string;
  businessId: string;
  customerId: string | null;
  estado: ConversationEstado;
}

/** Tokens de una llamada a la API, tal como los da `usage`. */
export interface UsageDetalle {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export interface MessageRow {
  rol: 'user' | 'assistant' | 'tool';
  contenido: string | null;
  /** Lo que esta fila aporta al historial de la API. */
  mensajes: Anthropic.Beta.BetaMessageParam[];
  /** Solo en las filas del asistente que vienen de una llamada a la API. */
  usage?: UsageDetalle;
  modelo?: string;
  stopReason?: string | null;
  /** Lo que se registra además para auditar (herramientas, motivo de una respuesta fija…). */
  extra?: Record<string, unknown>;
}

interface ConversationRow {
  id: string;
  business_id: string;
  customer_id: string | null;
  estado: ConversationEstado;
}

function toConversation(r: ConversationRow): Conversation {
  return { id: r.id, businessId: r.business_id, customerId: r.customer_id, estado: r.estado };
}

export async function createConversation(
  sql: Sql,
  businessId: string,
  customerId: string | null,
  canal: 'web' | 'whatsapp' | 'instagram' = 'web',
): Promise<Conversation> {
  const [row] = await inTenant(
    sql,
    businessId,
    (tx) => tx<ConversationRow[]>`
      insert into public.conversations (business_id, customer_id, canal)
      values (${businessId}::uuid, ${customerId}::uuid, ${canal})
      returning id, business_id, customer_id, estado`,
  );
  return toConversation(row!);
}

export async function getConversation(sql: Sql, businessId: string, conversationId: string): Promise<Conversation | null> {
  const [row] = await inTenant(
    sql,
    businessId,
    (tx) => tx<ConversationRow[]>`
      select id, business_id, customer_id, estado
        from public.conversations
       where business_id = ${businessId}::uuid and id = ${conversationId}::uuid`,
  );
  return row ? toConversation(row) : null;
}

/** La conversación activa más reciente de esa clienta, para retomarla. */
export async function findActiveConversation(
  sql: Sql,
  businessId: string,
  customerId: string,
): Promise<Conversation | null> {
  const [row] = await inTenant(
    sql,
    businessId,
    (tx) => tx<ConversationRow[]>`
      select id, business_id, customer_id, estado
        from public.conversations
       where business_id = ${businessId}::uuid
         and customer_id = ${customerId}::uuid
         and estado = 'activa'
       order by ultimo_mensaje_at desc
       limit 1`,
  );
  return row ? toConversation(row) : null;
}

/**
 * Asocia la clienta a la conversación. Una conversación ya identificada no
 * cambia de clienta (PA-08): devuelve false si ya tenía otra.
 */
export async function setConversationCustomer(
  sql: Sql,
  businessId: string,
  conversationId: string,
  customerId: string,
): Promise<boolean> {
  const rows = await inTenant(
    sql,
    businessId,
    (tx) => tx`
      update public.conversations
         set customer_id = ${customerId}::uuid
       where business_id = ${businessId}::uuid
         and id = ${conversationId}::uuid
         and (customer_id is null or customer_id = ${customerId}::uuid)
      returning id`,
  );
  return rows.length === 1;
}

/**
 * PA-06: registra la derivación y deja la conversación escalada. Si ya estaba
 * escalada no se crea otra escalación: el equipo ya tiene el aviso.
 *
 * PA-12: con `cerrar: false` solo se registra la consulta para el equipo y la
 * conversación sigue activa (el agente sigue atendiendo).
 */
export async function escalateConversation(
  sql: Sql,
  businessId: string,
  conversationId: string,
  motivo: string,
  opts: { cerrar: boolean } = { cerrar: true },
): Promise<{ escalationId: string; nueva: boolean }> {
  return inTenant(sql, businessId, async (tx) => {
    if (!opts.cerrar) {
      const [esc] = await tx<{ id: string }[]>`
        insert into public.escalations (business_id, conversation_id, motivo)
        values (${businessId}::uuid, ${conversationId}::uuid, ${motivo})
        returning id`;
      return { escalationId: esc!.id, nueva: true };
    }
    const [conv] = await tx<{ estado: ConversationEstado }[]>`
      select estado from public.conversations
       where business_id = ${businessId}::uuid and id = ${conversationId}::uuid
         for update`;
    if (!conv) {
      throw new Error(`La conversación ${conversationId} no existe en este negocio`);
    }
    if (conv.estado === 'escalada') {
      const [prev] = await tx<{ id: string }[]>`
        select id from public.escalations
         where business_id = ${businessId}::uuid and conversation_id = ${conversationId}::uuid
         order by created_at desc limit 1`;
      if (prev) {
        return { escalationId: prev.id, nueva: false };
      }
    }
    const [esc] = await tx<{ id: string }[]>`
      insert into public.escalations (business_id, conversation_id, motivo)
      values (${businessId}::uuid, ${conversationId}::uuid, ${motivo})
      returning id`;
    await tx`
      update public.conversations
         set estado = 'escalada'
       where business_id = ${businessId}::uuid and id = ${conversationId}::uuid`;
    return { escalationId: esc!.id, nueva: true };
  });
}

/** Guarda varias filas en una transacción y actualiza `ultimo_mensaje_at`. */
export async function appendMessages(
  sql: Sql,
  businessId: string,
  conversationId: string,
  rows: MessageRow[],
): Promise<void> {
  await inTenant(sql, businessId, async (tx) => {
    for (const r of rows) {
      const toolCalls = {
        mensajes: r.mensajes,
        ...(r.usage ? { usage: r.usage } : {}),
        ...(r.modelo ? { modelo: r.modelo } : {}),
        ...(r.stopReason !== undefined ? { stop_reason: r.stopReason } : {}),
        ...(r.extra ?? {}),
      };
      const tokensIn = r.usage
        ? r.usage.input_tokens + r.usage.cache_read_input_tokens + r.usage.cache_creation_input_tokens
        : 0;
      const tokensOut = r.usage?.output_tokens ?? 0;
      await tx`
        insert into public.messages
          (business_id, conversation_id, rol, contenido, tool_calls, tokens_in, tokens_out, created_at)
        values
          (${businessId}::uuid, ${conversationId}::uuid, ${r.rol}, ${r.contenido},
           ${tx.json(toolCalls as unknown as JSONValue)}, ${tokensIn}, ${tokensOut}, clock_timestamp())`;
    }
    await tx`
      update public.conversations
         set ultimo_mensaje_at = now()
       where business_id = ${businessId}::uuid and id = ${conversationId}::uuid`;
  });
}

/** El historial para la API: los mensajes de cada fila, en orden. */
export async function loadHistory(
  sql: Sql,
  businessId: string,
  conversationId: string,
): Promise<Anthropic.Beta.BetaMessageParam[]> {
  const rows = await inTenant(
    sql,
    businessId,
    (tx) => tx<{ tool_calls: { mensajes?: Anthropic.Beta.BetaMessageParam[] } | null }[]>`
      select tool_calls
        from public.messages
       where business_id = ${businessId}::uuid and conversation_id = ${conversationId}::uuid
       order by created_at, id`,
  );
  return rows.flatMap((r) => r.tool_calls?.mensajes ?? []);
}

export interface ConversationUsage {
  llamadas: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** El modelo de cada llamada, por si cambió a mitad (fallbacks). */
  porModelo: Record<string, UsageDetalle>;
}

/** Suma de tokens de todas las llamadas a la API de la conversación. */
export async function conversationUsage(
  sql: Sql,
  businessId: string,
  conversationId: string,
): Promise<ConversationUsage> {
  const rows = await inTenant(
    sql,
    businessId,
    (tx) => tx<{ usage: UsageDetalle; modelo: string | null }[]>`
      select tool_calls -> 'usage' as usage, tool_calls ->> 'modelo' as modelo
        from public.messages
       where business_id = ${businessId}::uuid
         and conversation_id = ${conversationId}::uuid
         and rol = 'assistant'
         and tool_calls ? 'usage'`,
  );
  const total: ConversationUsage = {
    llamadas: rows.length,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    porModelo: {},
  };
  for (const { usage, modelo } of rows) {
    total.inputTokens += usage.input_tokens;
    total.outputTokens += usage.output_tokens;
    total.cacheReadTokens += usage.cache_read_input_tokens;
    total.cacheWriteTokens += usage.cache_creation_input_tokens;
    const m = (total.porModelo[modelo ?? 'desconocido'] ??= {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    });
    m.input_tokens += usage.input_tokens;
    m.output_tokens += usage.output_tokens;
    m.cache_read_input_tokens += usage.cache_read_input_tokens;
    m.cache_creation_input_tokens += usage.cache_creation_input_tokens;
  }
  return total;
}
