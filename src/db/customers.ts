// =============================================================================
// Clientas del negocio (Fase 2 · identificar_cliente)
// =============================================================================
// Módulo propio y no un método del BookingAdapter: las clientas viven siempre
// en nuestra base, también cuando la agenda esté en otro sistema (Google
// Calendar, Fase 7). El adaptador es la agenda; esto es el CRM mínimo.
//
// El teléfono llega ya normalizado (src/core/phone.ts).
// =============================================================================

import type { Sql } from 'postgres';

import { inTenant } from './tenant.js';

export interface Customer {
  id: string;
  telefono: string;
  nombre: string | null;
}

/**
 * Busca la clienta por teléfono y, si no existe, la crea. Si existe sin nombre,
 * le pone el que dio; si ya tenía uno, no se toca (no se sobrescribe un dato
 * del negocio con lo que alguien escribe en un chat).
 */
export async function findOrCreateCustomer(
  sql: Sql,
  businessId: string,
  telefono: string,
  nombre: string,
): Promise<{ customer: Customer; nueva: boolean }> {
  return inTenant(sql, businessId, async (tx) => {
    // ON CONFLICT: dos conversaciones a la vez con el mismo teléfono no
    // pueden crear dos clientas (UNIQUE (business_id, telefono)).
    const [creada] = await tx<Customer[]>`
      insert into public.customers (business_id, telefono, nombre)
      values (${businessId}::uuid, ${telefono}, ${nombre})
      on conflict (business_id, telefono) do nothing
      returning id, telefono, nombre`;
    if (creada) {
      return { customer: creada, nueva: true };
    }
    const [existente] = await tx<Customer[]>`
      update public.customers
         set nombre = coalesce(nullif(trim(nombre), ''), ${nombre})
       where business_id = ${businessId}::uuid
         and telefono = ${telefono}
      returning id, telefono, nombre`;
    if (!existente) {
      throw new Error(`No se pudo leer la clienta ${telefono}`);
    }
    return { customer: existente, nueva: false };
  });
}

export async function findCustomerByPhone(sql: Sql, businessId: string, telefono: string): Promise<Customer | null> {
  const [c] = await inTenant(
    sql,
    businessId,
    (tx) => tx<Customer[]>`
      select id, telefono, nombre
        from public.customers
       where business_id = ${businessId}::uuid and telefono = ${telefono}`,
  );
  return c ?? null;
}

export async function getCustomer(sql: Sql, businessId: string, customerId: string): Promise<Customer | null> {
  const [c] = await inTenant(
    sql,
    businessId,
    (tx) => tx<Customer[]>`
      select id, telefono, nombre
        from public.customers
       where business_id = ${businessId}::uuid and id = ${customerId}::uuid`,
  );
  return c ?? null;
}
