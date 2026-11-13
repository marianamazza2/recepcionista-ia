// =============================================================================
// Clientas del negocio (Fase 2 · identificar_cliente; PA-17 desde el 13/11/2026)
// =============================================================================
// Módulo propio y no un método del BookingAdapter: las clientas viven siempre
// en nuestra base, también cuando la agenda esté en otro sistema (Google
// Calendar, Fase 7). El adaptador es la agenda; esto es el CRM mínimo.
//
// PA-17: la clienta se identifica por su EMAIL. El teléfono se guarda para que
// el local pueda llamarla, pero no identifica. Sin email, se la busca por
// teléfono (entre las fichas sin email: así lo garantiza la base).
//
// El teléfono llega ya normalizado (src/core/phone.ts) y el email, con
// normalizarEmail (src/core/email.ts).
// =============================================================================

import type { Sql } from 'postgres';

import { inTenant } from './tenant.js';

export interface Customer {
  id: string;
  telefono: string;
  nombre: string | null;
  email: string | null;
}

export interface DatosClienta {
  telefono: string;
  nombre: string;
  /** null = reserva sin email (PA-17): solo podrá cambiar su cita llamando. */
  email: string | null;
}

/**
 * Busca la clienta y, si no existe, la crea (PA-17):
 *   1. con email, por email;
 *   2. con email que no está, una ficha antigua SIN email con ese teléfono
 *      (la clienta de antes de PA-17) recibe el email: es ella;
 *   3. sin email, por teléfono entre las fichas sin email.
 * Si ya tenía nombre, no se toca (no se sobrescribe un dato del negocio con
 * lo que alguien escribe en un chat); el teléfono tampoco, por lo mismo.
 */
export async function findOrCreateCustomer(
  sql: Sql,
  businessId: string,
  datos: DatosClienta,
): Promise<{ customer: Customer; nueva: boolean }> {
  const { telefono, nombre, email } = datos;
  return inTenant(sql, businessId, async (tx) => {
    if (email) {
      const [porEmail] = await tx<Customer[]>`
        update public.customers
           set nombre = coalesce(nullif(trim(nombre), ''), ${nombre})
         where business_id = ${businessId}::uuid and email = ${email}
        returning id, telefono, nombre, email`;
      if (porEmail) return { customer: porEmail, nueva: false };

      const [antigua] = await tx<Customer[]>`
        update public.customers
           set email = ${email}, nombre = coalesce(nullif(trim(nombre), ''), ${nombre})
         where business_id = ${businessId}::uuid and telefono = ${telefono} and email is null
        returning id, telefono, nombre, email`;
      if (antigua) return { customer: antigua, nueva: false };

      // ON CONFLICT: dos conversaciones a la vez con el mismo email no pueden
      // crear dos clientas (índice único parcial por email).
      const [creada] = await tx<Customer[]>`
        insert into public.customers (business_id, telefono, nombre, email)
        values (${businessId}::uuid, ${telefono}, ${nombre}, ${email})
        on conflict (business_id, email) where email is not null do nothing
        returning id, telefono, nombre, email`;
      if (creada) return { customer: creada, nueva: true };
      const [carrera] = await tx<Customer[]>`
        select id, telefono, nombre, email from public.customers
         where business_id = ${businessId}::uuid and email = ${email}`;
      if (!carrera) throw new Error('No se pudo leer la clienta por email');
      return { customer: carrera, nueva: false };
    }

    const [creada] = await tx<Customer[]>`
      insert into public.customers (business_id, telefono, nombre)
      values (${businessId}::uuid, ${telefono}, ${nombre})
      on conflict (business_id, telefono) where email is null do nothing
      returning id, telefono, nombre, email`;
    if (creada) return { customer: creada, nueva: true };
    const [existente] = await tx<Customer[]>`
      update public.customers
         set nombre = coalesce(nullif(trim(nombre), ''), ${nombre})
       where business_id = ${businessId}::uuid and telefono = ${telefono} and email is null
      returning id, telefono, nombre, email`;
    if (!existente) throw new Error(`No se pudo leer la clienta ${telefono}`);
    return { customer: existente, nueva: false };
  });
}

/**
 * La ficha que corresponde a esos datos, sin crear nada (la misma búsqueda que
 * findOrCreateCustomer). Sirve para comprobar, antes de crear, que una
 * conversación ya identificada no "pasa a ser" otra persona (PA-08).
 */
export async function findCustomer(
  sql: Sql,
  businessId: string,
  datos: { telefono: string; email: string | null },
): Promise<Customer | null> {
  return inTenant(sql, businessId, async (tx) => {
    if (datos.email) {
      const [porEmail] = await tx<Customer[]>`
        select id, telefono, nombre, email from public.customers
         where business_id = ${businessId}::uuid and email = ${datos.email}`;
      if (porEmail) return porEmail;
    }
    const [porTelefono] = await tx<Customer[]>`
      select id, telefono, nombre, email from public.customers
       where business_id = ${businessId}::uuid and telefono = ${datos.telefono} and email is null`;
    return porTelefono ?? null;
  });
}

/** Para la Terminal (npm run chat): la clienta de ese teléfono, con o sin email. */
export async function findCustomerByPhone(sql: Sql, businessId: string, telefono: string): Promise<Customer | null> {
  const [c] = await inTenant(
    sql,
    businessId,
    (tx) => tx<Customer[]>`
      select id, telefono, nombre, email
        from public.customers
       where business_id = ${businessId}::uuid and telefono = ${telefono}
       order by (email is null), created_at
       limit 1`,
  );
  return c ?? null;
}

export async function getCustomer(sql: Sql, businessId: string, customerId: string): Promise<Customer | null> {
  const [c] = await inTenant(
    sql,
    businessId,
    (tx) => tx<Customer[]>`
      select id, telefono, nombre, email
        from public.customers
       where business_id = ${businessId}::uuid and id = ${customerId}::uuid`,
  );
  return c ?? null;
}
