// =============================================================================
// Borrado de datos: retención del chat y derecho de supresión (PD-13)
// =============================================================================
// Decidido por Mariana el 13/11/2026 (PD-13, sale de PD-11):
//   · La ficha de la clienta y las citas se guardan SIEMPRE.
//   · El TEXTO del chat caduca a los 6 meses. La conversación se queda, ligada
//     a su clienta, para poder seguir contando cuántas hubo.
//   · Si una clienta pide que la borren, se borra ella: su texto entero, sus
//     conversaciones desligadas y su ficha anónima. Sus citas siguen en la
//     agenda del negocio.
//
// El borrado de verdad lo hacen dos funciones de Postgres (migración
// 20261113130000): así vale igual desde la Terminal, desde el panel o desde una
// tarea programada, y el histórico no depende de que nadie se acuerde.
//
// Aunque la conexión haga BYPASSRLS, toda consulta filtra por business_id
// (regla de oro, T-03): borrar_clienta lo exige y rechaza una clienta de otro
// negocio (RA010).
// =============================================================================

import type { Sql } from 'postgres';

/** PD-13: meses que se guarda el texto del chat. */
export const MESES_RETENCION = 6;

export interface BorradoVencido {
  conversaciones: number;
  mensajes: number;
}

/**
 * PD-13: borra el texto de las conversaciones sin actividad desde hace
 * `meses`. Idempotente: pasarla dos veces no borra nada la segunda.
 */
export async function borrarConversacionesVencidas(
  sql: Sql,
  meses: number = MESES_RETENCION,
): Promise<BorradoVencido> {
  const [r] = await sql<{ conversaciones: number; mensajes: number }[]>`
    select conversaciones, mensajes from app.borrar_conversaciones_vencidas(${meses})
  `;
  return { conversaciones: Number(r?.conversaciones ?? 0), mensajes: Number(r?.mensajes ?? 0) };
}

export interface ClientaBorrada {
  mensajes: number;
  conversaciones: number;
  citas: number;
}

/** PD-13: la clienta que lo pide. Devuelve qué se borró y cuántas citas quedan sin nombre. */
export async function borrarClienta(sql: Sql, businessId: string, customerId: string): Promise<ClientaBorrada> {
  const [r] = await sql<{ mensajes: number; conversaciones: number; citas: number }[]>`
    select mensajes, conversaciones, citas from app.borrar_clienta(${businessId}, ${customerId})
  `;
  return {
    mensajes: Number(r?.mensajes ?? 0),
    conversaciones: Number(r?.conversaciones ?? 0),
    citas: Number(r?.citas ?? 0),
  };
}

/** Busca a una clienta de un negocio por email o por teléfono, para poder borrarla. */
export async function buscarClienta(
  sql: Sql,
  businessId: string,
  quien: { email?: string; telefono?: string },
): Promise<{ id: string; nombre: string | null; email: string | null; telefono: string } | null> {
  const email = quien.email?.trim().toLowerCase();
  const rows = await sql<{ id: string; nombre: string | null; email: string | null; telefono: string }[]>`
    select id, nombre, email, telefono
      from public.customers
     where business_id = ${businessId}
       and ${email ? sql`email = ${email}` : sql`telefono = ${quien.telefono ?? ''}`}
     limit 1
  `;
  return rows[0] ?? null;
}
