// =============================================================================
// Datos del canal widget web (Fase 3 · 3.2)
// =============================================================================
//   · El negocio por su clave pública (todavía sin tenant que declarar, como
//     loadBusinessConfig), solo si está activo (PI-16).
//   · Sesiones: el navegador guarda un token aleatorio; la base, solo su
//     SHA-256 (conversations.session_token_hash). Una conversación se encuentra
//     por (negocio, hash del token) y solo si su último mensaje es de las
//     últimas 2 h (PW-03, PW-12). El id de la conversación nunca viaja solo.
//   · Lock por conversación: dos mensajes de la misma conversación se procesan
//     de uno en uno (el historial es solo-añadir, D-45).
//   · Lo que hace falta para idempotencia, límites e historial.
// =============================================================================

import { createHash, randomBytes } from 'node:crypto';

import type { Sql } from 'postgres';

import { inTenant } from './tenant.js';

export interface WidgetBusiness {
  id: string;
  nombre: string;
  timezone: string;
  widgetKey: string;
  dominios: string[];
  color: string;
  /** PW-17: data URL del logo o null. */
  logo: string | null;
  privacidadUrl: string | null;
  mensajeBienvenida: string | null;
  telefonoHumano: string | null;
  topeMensualUsd: number;
}

interface WidgetBusinessRow {
  id: string;
  nombre: string;
  timezone: string;
  widget_key: string;
  widget_dominios: string[];
  widget_color: string;
  widget_logo: string | null;
  privacidad_url: string | null;
  mensaje_bienvenida: string | null;
  telefono_humano: string | null;
  tope_mensual_usd: string;
}

/**
 * El negocio de esa clave, si está ACTIVO. PI-16 (29/10/2026): "Activar" es
 * el interruptor de publicar: en prueba o pausado, el widget no aparece en
 * ninguna web aunque tenga dominios y el código pegado. Para probar antes de
 * activar está "Probar el chat" del panel (businessParaProbar).
 */
export async function businessByWidgetKey(sql: Sql, key: string): Promise<WidgetBusiness | null> {
  const [b] = await sql<WidgetBusinessRow[]>`
    select id, nombre, timezone, widget_key, widget_dominios, widget_color, widget_logo, privacidad_url,
           mensaje_bienvenida, telefono_humano, tope_mensual_usd
      from public.businesses
     where widget_key = ${key} and estado = 'activo'`;
  return b ? aWidgetBusiness(b) : null;
}

/**
 * PI-13: el mismo negocio por su id, para "Probar el chat" desde el panel (que
 * no pasa por la clave ni por los dominios). Null si no existe o está pausado.
 */
export async function businessParaProbar(sql: Sql, id: string): Promise<WidgetBusiness | null> {
  const [b] = await inTenant(
    sql,
    id,
    (tx) => tx<WidgetBusinessRow[]>`
      select id, nombre, timezone, widget_key, widget_dominios, widget_color, widget_logo, privacidad_url,
             mensaje_bienvenida, telefono_humano, tope_mensual_usd
        from public.businesses
       where id = ${id}::uuid and estado in ('activo', 'trial')`,
  );
  return b ? aWidgetBusiness(b) : null;
}

function aWidgetBusiness(b: WidgetBusinessRow): WidgetBusiness {
  return {
    id: b.id,
    nombre: b.nombre,
    timezone: b.timezone,
    widgetKey: b.widget_key,
    dominios: b.widget_dominios,
    color: b.widget_color,
    logo: b.widget_logo,
    privacidadUrl: b.privacidad_url,
    mensajeBienvenida: b.mensaje_bienvenida,
    telefonoHumano: b.telefono_humano,
    topeMensualUsd: Number(b.tope_mensual_usd),
  };
}

// -----------------------------------------------------------------------------
// Tokens
// -----------------------------------------------------------------------------

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** Un token aleatorio en base64url y su hash (lo único que se guarda). */
export function nuevoToken(bytes = 32): { token: string; hash: string } {
  const token = randomBytes(bytes).toString('base64url');
  return { token, hash: sha256(token) };
}

/** PW-05: la IP no se guarda; solo un hash ligado al negocio. */
export function hashIp(businessId: string, ip: string): string {
  return sha256(`${businessId}:${ip}`);
}

// -----------------------------------------------------------------------------
// Sesiones (PW-03)
// -----------------------------------------------------------------------------

export interface WebConversation {
  id: string;
  estado: 'activa' | 'escalada' | 'cerrada';
}

/**
 * La conversación de ese token en ese negocio, si su último mensaje es de las
 * últimas `horas`. PI-13: una sesión de prueba del panel no sirve en el widget
 * ni al revés (`prueba` tiene que coincidir).
 */
export async function conversationBySession(
  sql: Sql,
  businessId: string,
  tokenHash: string,
  horas: number,
  prueba = false,
): Promise<WebConversation | null> {
  const [c] = await inTenant(
    sql,
    businessId,
    (tx) => tx<WebConversation[]>`
      select id, estado
        from public.conversations
       where business_id = ${businessId}::uuid
         and session_token_hash = ${tokenHash}
         and prueba = ${prueba}
         and ultimo_mensaje_at > now() - make_interval(hours => ${horas})`,
  );
  return c ?? null;
}

export async function createWebConversation(
  sql: Sql,
  businessId: string,
  tokenHash: string,
  ipHash: string | null,
  prueba = false,
): Promise<WebConversation> {
  const [c] = await inTenant(
    sql,
    businessId,
    (tx) => tx<WebConversation[]>`
      insert into public.conversations (business_id, canal, session_token_hash, ip_hash, prueba)
      values (${businessId}::uuid, 'web', ${tokenHash}, ${ipHash}, ${prueba})
      returning id, estado`,
  );
  return c!;
}

export async function estadoDeConversacion(sql: Sql, businessId: string, conversationId: string): Promise<WebConversation['estado']> {
  const [c] = await inTenant(
    sql,
    businessId,
    (tx) => tx<{ estado: WebConversation['estado'] }[]>`
      select estado from public.conversations
       where business_id = ${businessId}::uuid and id = ${conversationId}::uuid`,
  );
  return c?.estado ?? 'cerrada';
}

/** PW-05: conversaciones nuevas desde esa IP (hash) en los últimos `minutos`. */
export async function conversacionesRecientesDesdeIp(sql: Sql, businessId: string, ipHash: string, minutos: number): Promise<number> {
  const [r] = await inTenant(
    sql,
    businessId,
    (tx) => tx<{ n: number }[]>`
      select count(*)::int as n from public.conversations
       where business_id = ${businessId}::uuid
         and ip_hash = ${ipHash}
         and created_at > now() - make_interval(mins => ${minutos})`,
  );
  return r!.n;
}

/** PW-05: mensajes de la clienta en esa conversación en los últimos `minutos`. */
export async function mensajesRecientes(sql: Sql, businessId: string, conversationId: string, minutos: number): Promise<number> {
  const [r] = await inTenant(
    sql,
    businessId,
    (tx) => tx<{ n: number }[]>`
      select count(*)::int as n from public.messages
       where business_id = ${businessId}::uuid
         and conversation_id = ${conversationId}::uuid
         and rol = 'user'
         and created_at > now() - make_interval(mins => ${minutos})`,
  );
  return r!.n;
}

// -----------------------------------------------------------------------------
// Lock por conversación
// -----------------------------------------------------------------------------
// Un advisory lock de transacción con clave derivada del id de la conversación
// (con prefijo propio, como app.lock_clienta). La transacción que lo tiene se
// queda abierta mientras dura el turno; el turno escribe por otras conexiones.
//
// Se pide con pg_try_advisory_xact_lock y, si está ocupado, se reintenta cada
// poco SIN quedarse con la conexión mientras espera. Con un lock bloqueante,
// N peticiones a la vez con un pool de N conexiones se quedarían todas
// esperando y el turno que tiene el lock no tendría conexión para escribir.
// Funciona igual con el pooler de Supabase en modo transacción.

const REINTENTO_LOCK_MS = 150;

/**
 * Ejecuta `fn` con el lock de la conversación. Devuelve null si no se
 * consiguió en `esperaMaxMs` (otro mensaje de la misma conversación sigue en
 * curso).
 */
export async function conLockDeConversacion<T>(
  sql: Sql,
  conversationId: string,
  esperaMaxMs: number,
  fn: () => Promise<T>,
): Promise<{ valor: T } | null> {
  const limite = Date.now() + esperaMaxMs;
  for (;;) {
    let conseguido = false;
    const r = await sql.begin(async (tx) => {
      const [l] = await tx<{ ok: boolean }[]>`
        select pg_try_advisory_xact_lock(hashtextextended('widget:conversation:' || ${conversationId}::text, 0)) as ok`;
      if (!l!.ok) return undefined;
      conseguido = true;
      // Lo que tarde el turno, más margen: el statement_timeout de Supabase
      // (2 min) no aplica a una transacción en espera, pero el idle sí podría.
      await tx`set local idle_in_transaction_session_timeout = '10min'`;
      return { valor: await fn() };
    });
    if (conseguido) return r as { valor: T };
    if (Date.now() + REINTENTO_LOCK_MS > limite) return null;
    await new Promise((res) => setTimeout(res, REINTENTO_LOCK_MS));
  }
}

// -----------------------------------------------------------------------------
// Turnos (idempotencia) e historial
// -----------------------------------------------------------------------------

/** El id de la fila del mensaje de la clienta con ese external_id en esa conversación. */
export async function findUserMessage(
  sql: Sql,
  businessId: string,
  conversationId: string,
  externalId: string,
): Promise<string | null> {
  const [m] = await inTenant(
    sql,
    businessId,
    (tx) => tx<{ id: string }[]>`
      select id from public.messages
       where business_id = ${businessId}::uuid
         and conversation_id = ${conversationId}::uuid
         and external_id = ${externalId}
         and rol = 'user'`,
  );
  return m?.id ?? null;
}

export interface FilaDelTurno {
  rol: 'user' | 'assistant' | 'tool';
  contenido: string | null;
  modelo: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  } | null;
}

/** Las filas que vinieron después del mensaje de la clienta, hasta el siguiente mensaje suyo. */
export async function filasDelTurno(sql: Sql, businessId: string, userMessageId: string): Promise<FilaDelTurno[]> {
  const rows = await inTenant(
    sql,
    businessId,
    (tx) => tx<FilaDelTurno[]>`
      with u as (
        select conversation_id, created_at, id from public.messages
         where business_id = ${businessId}::uuid and id = ${userMessageId}::uuid
      ), siguiente as (
        select min(m.created_at) as hasta
          from public.messages m, u
         where m.business_id = ${businessId}::uuid
           and m.conversation_id = u.conversation_id
           and m.rol = 'user'
           and (m.created_at, m.id) > (u.created_at, u.id)
      )
      select m.rol, m.contenido, m.tool_calls ->> 'modelo' as modelo, m.tool_calls -> 'usage' as usage
        from public.messages m, u, siguiente s
       where m.business_id = ${businessId}::uuid
         and m.conversation_id = u.conversation_id
         and (m.created_at, m.id) > (u.created_at, u.id)
         and (s.hasta is null or m.created_at < s.hasta)
       order by m.created_at, m.id`,
  );
  return rows;
}

/** Todas las filas de la conversación con lo que hace falta para mostrarla. */
export async function filasParaHistorial(
  sql: Sql,
  businessId: string,
  conversationId: string,
): Promise<{ rol: 'user' | 'assistant' | 'tool'; contenido: string | null }[]> {
  return inTenant(
    sql,
    businessId,
    (tx) => tx<{ rol: 'user' | 'assistant' | 'tool'; contenido: string | null }[]>`
      select rol, contenido from public.messages
       where business_id = ${businessId}::uuid and conversation_id = ${conversationId}::uuid
       order by created_at, id`,
  );
}
