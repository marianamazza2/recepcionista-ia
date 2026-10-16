// =============================================================================
// Fixtures de los tests de integración
// =============================================================================
// Los tests TypeScript confirman transacciones de verdad (el de concurrencia no
// tiene otra forma de probarse), así que no pueden apoyarse en un ROLLBACK
// como los SQL. En su lugar:
//   · los negocios de prueba se crean al empezar y se borran al terminar (el
//     borrado del negocio arrastra todo en cascada, D-03);
//   · contra Estética Aurora solo se escribe con una clienta propia del test,
//     en fechas de 2030, y se borra al terminar.
//
// Las fechas son fijas y lejanas para no depender del día en que se corren.
// =============================================================================

import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

export const AURORA = {
  businessId: 'a0000000-0000-4000-8000-000000000001',
  services: {
    facial: 'b0000000-0000-4000-8000-000000000001', // 60 + 10, Marta y Lucía
    laser: 'b0000000-0000-4000-8000-000000000002', // 30 + 5, solo Lucía
    corporal: 'b0000000-0000-4000-8000-000000000003', // 90 + 15, solo Marta
  },
  staff: {
    marta: 'c0000000-0000-4000-8000-000000000001',
    lucia: 'c0000000-0000-4000-8000-000000000002',
  },
} as const;

/** Prefijo de teléfono de las clientas que crean los tests (para limpiar restos). */
const TELEFONO_TEST = '+34999';

/** Crea una clienta de prueba en un negocio y devuelve su id. */
export async function createTestCustomer(sql: Sql, businessId: string): Promise<string> {
  const id = randomUUID();
  const telefono = TELEFONO_TEST + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  await sql`
    insert into public.customers (id, business_id, telefono, nombre)
    values (${id}, ${businessId}, ${telefono}, 'Clienta de test')`;
  return id;
}

/** Borra las clientas de prueba de un negocio y sus citas (incluidos restos de ejecuciones anteriores). */
export async function deleteTestCustomers(sql: Sql, businessId: string): Promise<void> {
  await sql`
    delete from public.appointments a
     using public.customers c
     where c.id = a.customer_id
       and c.business_id = ${businessId}
       and c.telefono like ${TELEFONO_TEST + '%'}`;
  await sql`
    delete from public.customers
     where business_id = ${businessId}
       and telefono like ${TELEFONO_TEST + '%'}`;
}

export interface TestBusiness {
  businessId: string;
  serviceId: string;
  staffId: string;
  customerId: string;
}

/**
 * Negocio de prueba que abre las 24 horas todos los días, con una sola
 * profesional y un servicio de 60 min + 15 de margen. Abrir las 24 h permite
 * probar la antelación a cualquier hora del día en que corra el test.
 */
export async function createTestBusiness(sql: Sql, slug: string): Promise<TestBusiness> {
  const businessId = randomUUID();
  const serviceId = randomUUID();
  const staffId = randomUUID();
  const customerId = randomUUID();

  await sql.begin(async (tx) => {
    await tx`delete from public.businesses where slug = ${slug}`;
    await tx`
      insert into public.businesses (id, nombre, slug, timezone, estado)
      values (${businessId}, ${'Test ' + slug}, ${slug}, 'Europe/Madrid', 'activo')`;
    await tx`
      insert into public.staff (id, business_id, nombre)
      values (${staffId}, ${businessId}, 'Única')`;
    await tx`
      insert into public.services (id, business_id, nombre, duracion_min, buffer_min)
      values (${serviceId}, ${businessId}, 'Servicio 60 + 15', 60, 15)`;
    await tx`
      insert into public.staff_services (business_id, staff_id, service_id)
      values (${businessId}, ${staffId}, ${serviceId})`;
    await tx`
      insert into public.business_hours (business_id, weekday, hora_apertura, hora_cierre)
      select ${businessId}, d, '00:00', '24:00' from generate_series(0, 6) d`;
    await tx`
      insert into public.customers (id, business_id, telefono, nombre)
      values (${customerId}, ${businessId}, '+34611000000', 'Clienta del negocio de test')`;
  });

  return { businessId, serviceId, staffId, customerId };
}

export async function deleteTestBusiness(sql: Sql, businessId: string): Promise<void> {
  await sql`delete from public.businesses where id = ${businessId}`;
}

const HORA_MADRID = new Intl.DateTimeFormat('es-ES', {
  timeZone: 'Europe/Madrid',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** 'HH:MM' en hora de Madrid, para comparar con el horario del local. */
export function horaMadrid(d: Date): string {
  return HORA_MADRID.format(d);
}

/** Inicios 'HH:MM' cada 30 min, de `desde` a `hasta` incluidos. */
export function rejilla(desde: string, hasta: string): string[] {
  const aMin = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
  const out: string[] = [];
  for (let m = aMin(desde); m <= aMin(hasta); m += 30) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  return out;
}
