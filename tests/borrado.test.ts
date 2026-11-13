// Borrado de datos: retención del chat y derecho de supresión (PD-13), y el
// aviso de la profesional que no trabaja ningún día (PI-20). Sin coste de API.
//
// Decidido el 13/11/2026. Lo que garantiza la base está en el test SQL 14; acá
// se comprueba la capa de datos que usa el comando `npm run borrado` y la
// cuenta pura que pinta el ámbar del panel.

import { describe, expect, it, afterAll, beforeAll } from 'vitest';

import { trabajaAlgunDia } from '../admin/src/horario.js';
import { borrarClienta, borrarConversacionesVencidas, buscarClienta, MESES_RETENCION } from '../src/db/borrado.js';
import { createSql } from '../src/db/client.js';
import { createTestBusiness, deleteTestBusiness, type TestBusiness } from './helpers/fixtures.js';

const sql = createSql(undefined, { max: 2 });
let N: TestBusiness;

beforeAll(async () => {
  N = await createTestBusiness(sql, 'test-borrado');
});

afterAll(async () => {
  await deleteTestBusiness(sql, N.businessId);
  await sql.end();
});

/** Una conversación con dos mensajes, con el último mensaje en la fecha dada. */
async function conversacionCon(ultimoMensaje: string, customerId: string | null): Promise<string> {
  const [c] = await sql<{ id: string }[]>`
    insert into public.conversations (business_id, customer_id, ultimo_mensaje_at)
    values (${N.businessId}, ${customerId}, now() - make_interval(months => ${Number(ultimoMensaje)}))
    returning id`;
  const id = c!.id;
  await sql`
    insert into public.messages (business_id, conversation_id, rol, contenido) values
      (${N.businessId}, ${id}, 'user', 'tengo la piel sensible'),
      (${N.businessId}, ${id}, 'assistant', 'te lo apunto')`;
  return id;
}

const cuantosMensajes = async (conversationId: string): Promise<number> => {
  const [r] = await sql<{ n: number }[]>`select count(*)::int as n from public.messages where conversation_id = ${conversationId}`;
  return r!.n;
};

describe('PD-13: el texto del chat caduca a los 6 meses', () => {
  it('de serie son 6 meses', () => {
    expect(MESES_RETENCION).toBe(6);
  });

  it('borra el texto vencido, deja el reciente y no toca ni la conversación ni la ficha', async () => {
    const vieja = await conversacionCon('7', N.customerId);
    const nueva = await conversacionCon('0', N.customerId);

    const r = await borrarConversacionesVencidas(sql);
    expect(r.mensajes).toBeGreaterThanOrEqual(2);
    expect(await cuantosMensajes(vieja)).toBe(0);
    expect(await cuantosMensajes(nueva)).toBe(2);

    const [conv] = await sql<{ customer_id: string | null }[]>`
      select customer_id from public.conversations where id = ${vieja}`;
    expect(conv!.customer_id).toBe(N.customerId);
    const [ficha] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.customers where id = ${N.customerId}`;
    expect(ficha!.n).toBe(1);
  });

  it('con otra retención también vale, y pasarla dos veces no borra más (es idempotente)', async () => {
    const hace2meses = await conversacionCon('2', N.customerId);
    expect((await borrarConversacionesVencidas(sql, 6)).mensajes).toBe(0);

    const r = await borrarConversacionesVencidas(sql, 1);
    expect(r.mensajes).toBeGreaterThanOrEqual(2);
    expect(await cuantosMensajes(hace2meses)).toBe(0);
    expect((await borrarConversacionesVencidas(sql, 1)).mensajes).toBe(0);
  });

  it('menos de un mes de retención se rechaza', async () => {
    await expect(borrarConversacionesVencidas(sql, 0)).rejects.toMatchObject({ code: 'RA009' });
  });
});

describe('PD-13: borrar a una clienta porque lo pide', () => {
  it('se la encuentra por email y por teléfono', async () => {
    const [c] = await sql<{ id: string }[]>`
      insert into public.customers (business_id, telefono, nombre, email)
      values (${N.businessId}, '+34611000111', 'Bea', 'bea@ejemplo.test') returning id`;

    expect((await buscarClienta(sql, N.businessId, { email: 'BEA@Ejemplo.test' }))?.id).toBe(c!.id);
    expect((await buscarClienta(sql, N.businessId, { telefono: '+34611000111' }))?.id).toBe(c!.id);
    expect(await buscarClienta(sql, N.businessId, { email: 'nadie@ejemplo.test' })).toBeNull();
  });

  it('borra su texto, desliga sus conversaciones, deja su ficha anónima y sus citas en pie', async () => {
    const [c] = await sql<{ id: string }[]>`
      insert into public.customers (business_id, telefono, nombre, email)
      values (${N.businessId}, '+34611000222', 'Carla', 'carla@ejemplo.test') returning id`;
    const conv = await conversacionCon('0', c!.id);
    await sql`
      insert into public.appointments (business_id, staff_id, service_id, customer_id, start_at, end_at)
      values (${N.businessId}, ${N.staffId}, ${N.serviceId}, ${c!.id}, now() + interval '3 days', now() + interval '3 days 1 hour')`;

    const r = await borrarClienta(sql, N.businessId, c!.id);
    expect(r.mensajes).toBe(2);
    expect(r.conversaciones).toBe(1);
    expect(r.citas).toBe(1);

    expect(await cuantosMensajes(conv)).toBe(0);
    const [conversacion] = await sql<{ customer_id: string | null }[]>`
      select customer_id from public.conversations where id = ${conv}`;
    expect(conversacion!.customer_id).toBeNull();

    const [ficha] = await sql<{ nombre: string | null; email: string | null; telefono: string }[]>`
      select nombre, email, telefono from public.customers where id = ${c!.id}`;
    expect(ficha!.nombre).toBeNull();
    expect(ficha!.email).toBeNull();
    expect(ficha!.telefono).toBe(`borrada-${c!.id}`);

    const [citas] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.appointments where customer_id = ${c!.id}`;
    expect(citas!.n).toBe(1);
  });

  it('una clienta que no es de ese negocio se rechaza (T-03)', async () => {
    const otro = await createTestBusiness(sql, 'test-borrado-otro');
    try {
      await expect(borrarClienta(sql, N.businessId, otro.customerId)).rejects.toMatchObject({ code: 'RA010' });
    } finally {
      await deleteTestBusiness(sql, otro.businessId);
    }
  });
});

describe('PI-20: el panel avisa de la profesional que no trabaja ningún día', () => {
  const LOCAL = [
    { staffId: null, weekday: 1, apertura: '10:00', cierre: '14:00' },
    { staffId: null, weekday: 3, apertura: '10:00', cierre: '14:00' },
  ];

  it('sin días libres, hereda el horario del local y trabaja', () => {
    expect(trabajaAlgunDia(LOCAL, 'nuria', [])).toBe(true);
    expect(trabajaAlgunDia(LOCAL, 'nuria', [1])).toBe(true);
  });

  it('con todos los días del local marcados "no trabaja", no trabaja ninguno', () => {
    expect(trabajaAlgunDia(LOCAL, 'nuria', [1, 3])).toBe(false);
    expect(trabajaAlgunDia(LOCAL, 'nuria', [0, 1, 2, 3, 4, 5, 6])).toBe(false);
  });

  it('un tramo propio cuenta aunque el local cierre ese día (PD-01)', () => {
    const conPropio = [...LOCAL, { staffId: 'nuria', weekday: 6, apertura: '10:00', cierre: '13:00' }];
    expect(trabajaAlgunDia(conPropio, 'nuria', [1, 3])).toBe(true);
  });

  it('el tramo propio de otra profesional no la salva', () => {
    const deOtra = [...LOCAL, { staffId: 'marta', weekday: 6, apertura: '10:00', cierre: '13:00' }];
    expect(trabajaAlgunDia(deOtra, 'nuria', [1, 3])).toBe(false);
  });

  it('un negocio sin horario del local: nadie trabaja', () => {
    expect(trabajaAlgunDia([], 'nuria', [])).toBe(false);
  });
});
