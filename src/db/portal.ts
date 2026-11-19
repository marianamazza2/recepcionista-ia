// =============================================================================
// Datos del portal del cliente (Fase 9 · 9.1 y 9.2)
// =============================================================================
// Invitaciones (PC-02), el código que confirma el email, cuentas (PC-11),
// sesiones y el estado del alta por chat (PC-03, PC-13). Todo vive en el
// esquema `portal` (no expuesto por PostgREST: aquí hay contraseñas y
// tokens), con RLS activo y sin política, como panel.personas.
//
//   · De la base solo salen HASHES: el token del enlace, el del código y el
//     de la sesión se guardan en sha256 (como el widget y PA-16). Un enlace o
//     una sesión no se pueden reconstruir desde aquí.
//   · Toda función recibe el businessId salvo las que todavía lo están
//     resolviendo (una invitación por su token, una cuenta por su email, una
//     sesión por su token): son las únicas lecturas sin tenant, y lo primero
//     que devuelven es a qué negocio pertenecen.
//   · PC-02: una invitación vale UNA vez, caduca a los 7 días y se anula sola
//     cuando se genera otra para el mismo negocio.
//   · PC-11: una cuenta pertenece a UN negocio. El business_id de la sesión
//     es el que manda en toda la API del portal; de la URL o del chat, nunca.
// =============================================================================

import type { Sql } from 'postgres';

import { inTenant } from './tenant.js';
import { nuevoToken, sha256 } from './widget.js';

/** PC-02: lo que dura un enlace de invitación. */
export const INVITACION_DIAS = 7;
/** El código del email: mismas reglas que PA-16. */
export const CODIGO_MINUTOS = 10;
export const CODIGO_INTENTOS = 3;
export const CODIGOS_POR_HORA = 5;
/** Cuánto vale una sesión del portal sin usarse (se renueva en cada petición). */
export const SESION_HORAS = 12;

// -----------------------------------------------------------------------------
// Invitaciones (PC-02)
// -----------------------------------------------------------------------------

export interface Invitacion {
  id: string;
  businessId: string;
  email: string;
  expiraAt: Date;
  usadaAt: Date | null;
  anuladaAt: Date | null;
  createdAt: Date;
}

interface InvitacionRow {
  id: string;
  business_id: string;
  email: string;
  expira_at: Date;
  usada_at: Date | null;
  anulada_at: Date | null;
  created_at: Date;
}

function aInvitacion(r: InvitacionRow): Invitacion {
  return {
    id: r.id,
    businessId: r.business_id,
    email: r.email,
    expiraAt: r.expira_at,
    usadaAt: r.usada_at,
    anuladaAt: r.anulada_at,
    createdAt: r.created_at,
  };
}

/**
 * PC-02: genera el enlace de un negocio. Anula las invitaciones anteriores
 * que seguían vivas (Mariana "genera otro" y el anterior deja de valer al
 * momento) y devuelve el token UNA sola vez: en la base queda solo su hash.
 */
export async function crearInvitacion(
  sql: Sql,
  businessId: string,
  email: string,
  ahora: Date = new Date(),
): Promise<{ invitacion: Invitacion; token: string }> {
  const { token, hash } = nuevoToken();
  const expiraAt = new Date(ahora.getTime() + INVITACION_DIAS * 24 * 60 * 60 * 1000);
  const invitacion = await inTenant(sql, businessId, async (tx) => {
    await tx`
      update portal.invitaciones set anulada_at = ${ahora}
       where business_id = ${businessId}::uuid and usada_at is null and anulada_at is null`;
    const [r] = await tx<InvitacionRow[]>`
      insert into portal.invitaciones (business_id, email, token_hash, expira_at)
      values (${businessId}::uuid, ${email}, ${hash}, ${expiraAt})
      returning *`;
    return aInvitacion(r!);
  });
  return { invitacion, token };
}

/** PC-02: anula el enlace vivo de un negocio. Devuelve si había alguno. */
export async function anularInvitaciones(sql: Sql, businessId: string, ahora: Date = new Date()): Promise<boolean> {
  const filas = await inTenant(
    sql,
    businessId,
    (tx) => tx`
      update portal.invitaciones set anulada_at = ${ahora}
       where business_id = ${businessId}::uuid and usada_at is null and anulada_at is null
      returning id`,
  );
  return filas.length > 0;
}

/** El enlace vivo de un negocio (para que el panel diga si lo hay y hasta cuándo). */
export async function invitacionDelNegocio(sql: Sql, businessId: string): Promise<Invitacion | null> {
  const [r] = await inTenant(
    sql,
    businessId,
    (tx) => tx<InvitacionRow[]>`
      select * from portal.invitaciones
       where business_id = ${businessId}::uuid and usada_at is null and anulada_at is null
       order by created_at desc limit 1`,
  );
  return r ? aInvitacion(r) : null;
}

export type MotivoInvitacion = 'usada' | 'caducada' | 'anulada' | 'no_existe';

/**
 * La invitación de un token, solo si SIRVE. Lectura sin tenant a propósito:
 * es la que resuelve a qué negocio pertenece. Un token inventado, usado,
 * caducado o anulado devuelve el motivo y nada más (nunca el negocio).
 */
export async function invitacionPorToken(
  sql: Sql,
  token: string,
  ahora: Date = new Date(),
): Promise<{ ok: true; invitacion: Invitacion } | { ok: false; motivo: MotivoInvitacion }> {
  const [r] = await sql<InvitacionRow[]>`
    select * from portal.invitaciones where token_hash = ${sha256(token)}`;
  if (!r) return { ok: false, motivo: 'no_existe' };
  if (r.usada_at) return { ok: false, motivo: 'usada' };
  if (r.anulada_at) return { ok: false, motivo: 'anulada' };
  if (r.expira_at.getTime() <= ahora.getTime()) return { ok: false, motivo: 'caducada' };
  return { ok: true, invitacion: aInvitacion(r) };
}

// -----------------------------------------------------------------------------
// El código que confirma el email (PC-02)
// -----------------------------------------------------------------------------

/** El hash va ligado a la invitación: el mismo código en otra no coincide. */
export function hashCodigoPortal(invitacionId: string, codigo: string): string {
  return sha256(`${invitacionId}:${codigo}`);
}

/**
 * Guarda un código nuevo para esa invitación y anula los anteriores sin usar.
 * Null si ya se mandaron CODIGOS_POR_HORA en la última hora.
 */
export async function guardarCodigoPortal(
  sql: Sql,
  invitacion: Invitacion,
  codigo: string,
  ahora: Date = new Date(),
): Promise<{ expiraAt: Date } | null> {
  const expiraAt = new Date(ahora.getTime() + CODIGO_MINUTOS * 60_000);
  return inTenant(sql, invitacion.businessId, async (tx) => {
    const [fila] = await tx<{ n: number }[]>`
      select count(*)::int as n from portal.codigos
       where invitacion_id = ${invitacion.id}::uuid
         and created_at > ${ahora}::timestamptz - interval '1 hour'`;
    if ((fila?.n ?? 0) >= CODIGOS_POR_HORA) return null;
    await tx`
      update portal.codigos set usado_at = ${ahora}
       where invitacion_id = ${invitacion.id}::uuid and usado_at is null`;
    await tx`
      insert into portal.codigos (business_id, invitacion_id, codigo_hash, expira_at, created_at)
      values (${invitacion.businessId}::uuid, ${invitacion.id}::uuid, ${hashCodigoPortal(invitacion.id, codigo)}, ${expiraAt}, ${ahora})`;
    return { expiraAt };
  });
}

export type ResultadoCodigoPortal = 'correcto' | 'incorrecto' | 'agotado' | 'caducado' | 'sin_codigo';

/** Igual que PA-16: tres intentos, diez minutos, un solo uso. */
export async function comprobarCodigoPortal(
  sql: Sql,
  invitacion: Invitacion,
  codigo: string,
  ahora: Date = new Date(),
): Promise<{ resultado: ResultadoCodigoPortal; quedan?: number }> {
  return inTenant(sql, invitacion.businessId, async (tx) => {
    const [c] = await tx<{ id: string; codigo_hash: string; expira_at: Date; intentos: number }[]>`
      select id, codigo_hash, expira_at, intentos from portal.codigos
       where invitacion_id = ${invitacion.id}::uuid and usado_at is null
       order by created_at desc limit 1 for update`;
    if (!c) return { resultado: 'sin_codigo' as const };
    if (c.expira_at.getTime() <= ahora.getTime()) {
      await tx`update portal.codigos set usado_at = ${ahora} where id = ${c.id}::uuid`;
      return { resultado: 'caducado' as const };
    }
    if (c.codigo_hash === hashCodigoPortal(invitacion.id, codigo.trim())) {
      await tx`update portal.codigos set usado_at = ${ahora} where id = ${c.id}::uuid`;
      return { resultado: 'correcto' as const };
    }
    const intentos = c.intentos + 1;
    await tx`
      update portal.codigos set intentos = ${intentos}, usado_at = ${intentos >= CODIGO_INTENTOS ? ahora : null}
       where id = ${c.id}::uuid`;
    return intentos >= CODIGO_INTENTOS
      ? { resultado: 'agotado' as const }
      : { resultado: 'incorrecto' as const, quedan: CODIGO_INTENTOS - intentos };
  });
}

// -----------------------------------------------------------------------------
// Cuentas (PC-11)
// -----------------------------------------------------------------------------

export interface CuentaPortal {
  id: string;
  businessId: string;
  email: string;
  activa: boolean;
}

interface CuentaRow {
  id: string;
  business_id: string;
  email: string;
  password_hash: string;
  activa: boolean;
}

/** La cuenta con su hash de contraseña, por email. Sin tenant: resuelve el negocio. */
export async function cuentaPorEmail(sql: Sql, email: string): Promise<(CuentaPortal & { passwordHash: string }) | null> {
  const [r] = await sql<CuentaRow[]>`select * from portal.cuentas where email = ${email}`;
  return r ? { id: r.id, businessId: r.business_id, email: r.email, activa: r.activa, passwordHash: r.password_hash } : null;
}

/**
 * PC-02 + PC-11: gasta la invitación y crea la cuenta, en una transacción. Si
 * la invitación ya no vale (otra pestaña la usó), no crea nada y devuelve
 * null: que sirva una sola vez lo decide la base, no el orden de las llamadas.
 */
export async function crearCuentaConInvitacion(
  sql: Sql,
  invitacion: Invitacion,
  passwordHash: string,
  ahora: Date = new Date(),
): Promise<CuentaPortal | null> {
  return inTenant(sql, invitacion.businessId, async (tx) => {
    const usada = await tx`
      update portal.invitaciones set usada_at = ${ahora}
       where id = ${invitacion.id}::uuid and usada_at is null and anulada_at is null and expira_at > ${ahora}
      returning id`;
    if (usada.length === 0) return null;
    const [c] = await tx<CuentaRow[]>`
      insert into portal.cuentas (business_id, email, password_hash)
      values (${invitacion.businessId}::uuid, ${invitacion.email}, ${passwordHash})
      returning *`;
    return { id: c!.id, businessId: c!.business_id, email: c!.email, activa: c!.activa };
  });
}

// -----------------------------------------------------------------------------
// Sesiones
// -----------------------------------------------------------------------------

export interface SesionPortal {
  cuentaId: string;
  businessId: string;
  email: string;
}

/** Abre una sesión y devuelve el token (en la base, solo su hash). */
export async function abrirSesion(sql: Sql, cuenta: CuentaPortal, ahora: Date = new Date()): Promise<string> {
  const { token, hash } = nuevoToken();
  const expiraAt = new Date(ahora.getTime() + SESION_HORAS * 60 * 60 * 1000);
  await inTenant(sql, cuenta.businessId, async (tx) => {
    await tx`
      insert into portal.sesiones (cuenta_id, business_id, token_hash, expira_at)
      values (${cuenta.id}::uuid, ${cuenta.businessId}::uuid, ${hash}, ${expiraAt})`;
    await tx`update portal.cuentas set ultimo_acceso_at = ${ahora} where id = ${cuenta.id}::uuid`;
  });
  return token;
}

/**
 * La sesión de ese token, si vale, renovando su caducidad (sesión deslizante).
 * Sin tenant a propósito: es la que dice de qué negocio es. Una sesión
 * caducada o de una cuenta desactivada no vale.
 */
export async function sesionPorToken(sql: Sql, token: string, ahora: Date = new Date()): Promise<SesionPortal | null> {
  const expiraAt = new Date(ahora.getTime() + SESION_HORAS * 60 * 60 * 1000);
  const [r] = await sql<{ cuenta_id: string; business_id: string; email: string }[]>`
    update portal.sesiones s
       set ultimo_uso_at = ${ahora}, expira_at = ${expiraAt}
      from portal.cuentas c
     where s.token_hash = ${sha256(token)}
       and s.expira_at > ${ahora}
       and c.id = s.cuenta_id
       and c.activa
    returning s.cuenta_id, s.business_id, c.email`;
  return r ? { cuentaId: r.cuenta_id, businessId: r.business_id, email: r.email } : null;
}

/** Salir: la sesión deja de valer al momento. */
export async function cerrarSesion(sql: Sql, token: string): Promise<void> {
  await sql`delete from portal.sesiones where token_hash = ${sha256(token)}`;
}

/** Limpieza: las sesiones caducadas no sirven para nada. */
export async function borrarSesionesCaducadas(sql: Sql, ahora: Date = new Date()): Promise<number> {
  const filas = await sql`delete from portal.sesiones where expira_at <= ${ahora} returning id`;
  return filas.length;
}

// -----------------------------------------------------------------------------
// El estado del alta (PC-03, PC-11, PC-13)
// -----------------------------------------------------------------------------

export interface EstadoAlta {
  businessId: string;
  /** 0 bienvenida … 9 cierre (las secciones del guion). */
  seccion: number;
  conversationId: string | null;
  terminadaAt: Date | null;
  revisadaAt: Date | null;
}

interface AltaRow {
  business_id: string;
  seccion: number;
  conversation_id: string | null;
  terminada_at: Date | null;
  revisada_at: Date | null;
}

function aEstado(r: AltaRow): EstadoAlta {
  return {
    businessId: r.business_id,
    seccion: r.seccion,
    conversationId: r.conversation_id,
    terminadaAt: r.terminada_at,
    revisadaAt: r.revisada_at,
  };
}

/** El estado del alta del negocio; lo crea en la sección 0 si todavía no existe. */
export async function estadoDelAlta(sql: Sql, businessId: string): Promise<EstadoAlta> {
  const [r] = await inTenant(
    sql,
    businessId,
    (tx) => tx<AltaRow[]>`
      insert into portal.alta (business_id) values (${businessId}::uuid)
      on conflict (business_id) do update set business_id = excluded.business_id
      returning *`,
  );
  return aEstado(r!);
}

/**
 * Guarda por dónde va el alta. `terminada` solo se pone una vez (si ya estaba
 * terminada, no se cambia la fecha: el aviso de PC-13 no se repite).
 */
export async function guardarEstadoDelAlta(
  sql: Sql,
  businessId: string,
  cambios: { seccion?: number; conversationId?: string; terminada?: boolean },
  ahora: Date = new Date(),
): Promise<EstadoAlta> {
  await estadoDelAlta(sql, businessId);
  const [r] = await inTenant(
    sql,
    businessId,
    (tx) => tx<AltaRow[]>`
      update portal.alta
         set seccion         = coalesce(${cambios.seccion ?? null}::smallint, seccion),
             conversation_id = coalesce(${cambios.conversationId ?? null}::uuid, conversation_id),
             terminada_at    = case when ${cambios.terminada ?? false} then coalesce(terminada_at, ${ahora}) else terminada_at end,
             updated_at      = ${ahora}
       where business_id = ${businessId}::uuid
      returning *`,
  );
  return aEstado(r!);
}

/** PC-13: las altas terminadas que Mariana no ha revisado todavía. */
export interface AltaTerminada {
  businessId: string;
  negocio: string;
  terminadaAt: Date;
}

export async function altasPendientesDeRevisar(sql: Sql): Promise<AltaTerminada[]> {
  // Sin tenant a propósito: el panel ve todos los negocios (PI-01).
  const rows = await sql<{ business_id: string; nombre: string; terminada_at: Date }[]>`
    select a.business_id, b.nombre, a.terminada_at
      from portal.alta a
      join public.businesses b on b.id = a.business_id
     where a.terminada_at is not null and a.revisada_at is null
     order by a.terminada_at desc`;
  return rows.map((r) => ({ businessId: r.business_id, negocio: r.nombre, terminadaAt: r.terminada_at }));
}

/** PC-13: Mariana ya lo revisó; el aviso desaparece. */
export async function marcarAltaRevisada(sql: Sql, businessId: string, ahora: Date = new Date()): Promise<boolean> {
  const filas = await inTenant(
    sql,
    businessId,
    (tx) => tx`
      update portal.alta set revisada_at = ${ahora}, updated_at = ${ahora}
       where business_id = ${businessId}::uuid and terminada_at is not null and revisada_at is null
      returning business_id`,
  );
  return filas.length > 0;
}

// -----------------------------------------------------------------------------
// El resumen para confirmar (PC-03)
// -----------------------------------------------------------------------------
// "Antes de guardar cada sección enseña un resumen visual para confirmar."
// Eso no se puede dejar al prompt, así que se comprueba en el código: la
// herramienta que propone el resumen deja una marca en la conversación
// (una fila de `messages` con `propuesta` en tool_calls) y las herramientas
// que guardan solo funcionan si hay una marca de esa sección Y el cliente ha
// escrito algo DESPUÉS. Así el código garantiza que vio el resumen y
// contestó; si ese "sí" era un "no", el modelo lo entiende y no guarda.

/**
 * ¿Hay un resumen de esa sección enseñado y contestado en esta conversación?
 * Mira la última propuesta de esa sección y si hay algún mensaje del cliente
 * posterior.
 */
export async function hayConfirmacion(
  sql: Sql,
  businessId: string,
  conversationId: string,
  seccion: string,
): Promise<boolean> {
  const [r] = await inTenant(
    sql,
    businessId,
    (tx) => tx<{ confirmada: boolean }[]>`
      with propuesta as (
        select created_at, id from public.messages
         where business_id = ${businessId}::uuid
           and conversation_id = ${conversationId}::uuid
           and tool_calls ->> 'propuesta' = ${seccion}
         order by created_at desc, id desc
         limit 1
      )
      select exists (
        select 1 from public.messages m, propuesta p
         where m.business_id = ${businessId}::uuid
           and m.conversation_id = ${conversationId}::uuid
           and m.rol = 'user'
           and (m.created_at, m.id) > (p.created_at, p.id)
      ) as confirmada
        from propuesta`,
  );
  return r?.confirmada ?? false;
}
