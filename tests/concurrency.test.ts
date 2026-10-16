// =============================================================================
// Concurrencia (DT-01): reservas simultáneas desde conexiones distintas
// =============================================================================
// Cada "clienta" usa su propia conexión, como dos peticiones que llegan a la
// vez a dos instancias del backend.
//
//   1. Mismo hueco a la vez → exactamente una entra (lo garantiza no_overlap).
//   2. Dos huecos distintos que solo chocan por el margen → exactamente una
//      entra. Esto NO lo protege no_overlap (T-02): lo protege el advisory lock
//      de book_appointment.
//   3. La prueba determinista del lock: una transacción con una reserva sin
//      confirmar hace ESPERAR a la otra, que al seguir ve la cita y la rechaza.
//   4. PR-08: la MISMA clienta, a la vez, con dos profesionales distintas →
//      entra una. El lock es por profesional y no las serializa: lo frena la
//      restricción no_overlap_cliente.
//
// Cada conexión reserva para una clienta distinta (como en la realidad): si
// fueran la misma, PR-08 contestaría "ya tiene cita" en vez de "ocupado".
// =============================================================================

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BufferConflictError, CustomerBusyError, SlotTakenError } from '../src/adapters/booking/errors.js';
import { SupabaseAdapter } from '../src/adapters/booking/supabase.js';
import { createSql } from '../src/db/client.js';
import { createTestBusiness, deleteTestBusiness, type TestBusiness } from './helpers/fixtures.js';

const N_CONEXIONES = 6;

const admin = createSql();
const conexiones = Array.from({ length: N_CONEXIONES }, () => createSql(undefined, { max: 1 }));

let neg: TestBusiness;
let adapters: SupabaseAdapter[];
let clientas: string[];

beforeAll(async () => {
  neg = await createTestBusiness(admin, 'test-ts-concurrencia');
  adapters = conexiones.map((sql) => new SupabaseAdapter({ sql, businessId: neg.businessId }));
  clientas = [];
  for (let i = 0; i < N_CONEXIONES; i++) {
    const [c] = await admin<{ id: string }[]>`
      insert into public.customers (business_id, telefono, nombre)
      values (${neg.businessId}, ${'+3461100' + String(i + 1).padStart(4, '0')}, ${'Clienta ' + (i + 1)})
      returning id`;
    clientas.push(c!.id);
  }
  // Abrir las conexiones antes de la carrera, para que salgan a la vez.
  await Promise.all(conexiones.map((sql) => sql`select 1`));
});

afterAll(async () => {
  await deleteTestBusiness(admin, neg.businessId);
  await Promise.all([admin.end(), ...conexiones.map((sql) => sql.end())]);
});

function reservar(adapter: SupabaseAdapter, start: Date, staffId: string = neg.staffId) {
  const i = adapters.indexOf(adapter);
  return adapter.createBooking({
    businessId: neg.businessId,
    serviceId: neg.serviceId,
    staffId,
    customerId: clientas[i]!,
    start,
  });
}

async function citasConfirmadas(desde: Date, hasta: Date): Promise<number> {
  const [row] = await admin<{ n: number }[]>`
    select count(*)::int as n from public.appointments
     where business_id = ${neg.businessId}
       and estado = 'confirmada'
       and start_at >= ${desde} and start_at < ${hasta}`;
  return row?.n ?? 0;
}

describe('concurrencia (DT-01)', () => {
  it(`${N_CONEXIONES} conexiones reservan el mismo hueco a la vez → entra exactamente una`, async () => {
    const start = new Date('2030-11-12T10:00:00+01:00');
    const resultados = await Promise.allSettled(adapters.map((a) => reservar(a, start)));

    const ok = resultados.filter((r) => r.status === 'fulfilled');
    const ko = resultados.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(ko).toHaveLength(N_CONEXIONES - 1);
    for (const r of ko) {
      expect(r.reason).toBeInstanceOf(SlotTakenError);
    }
    expect(
      await citasConfirmadas(new Date('2030-11-12T00:00:00+01:00'), new Date('2030-11-13T00:00:00+01:00')),
    ).toBe(1);
  });

  it('dos huecos que solo chocan por el margen, a la vez → entra exactamente una (10 rondas)', async () => {
    // Servicio de 60 + 15: 10:00 y 11:00 no se solapan, pero la de las 11:00
    // pisa el margen de la de las 10:00 (hasta las 11:15). no_overlap dejaría
    // pasar a las dos; el lock no.
    for (let ronda = 0; ronda < 10; ronda++) {
      const dia = String(13 + ronda).padStart(2, '0');
      const a10 = new Date(`2030-11-${dia}T10:00:00+01:00`);
      const a11 = new Date(`2030-11-${dia}T11:00:00+01:00`);
      const [a, b] = adapters;
      const resultados = await Promise.allSettled([reservar(a!, a10), reservar(b!, a11)]);

      const ok = resultados.filter((r) => r.status === 'fulfilled');
      const ko = resultados.filter((r) => r.status === 'rejected');
      expect(ok, `ronda ${ronda}`).toHaveLength(1);
      expect(ko[0]?.reason, `ronda ${ronda}`).toBeInstanceOf(BufferConflictError);
      expect(
        await citasConfirmadas(new Date(`2030-11-${dia}T00:00:00+01:00`), new Date(`2030-11-${dia}T23:00:00+01:00`)),
      ).toBe(1);
    }
  });

  it('una reserva sin confirmar hace esperar a la otra, que al seguir la ve y se rechaza', async () => {
    const [sqlA] = conexiones;
    const [, adapterB] = adapters;
    const a10 = new Date('2030-11-26T10:00:00+01:00');
    const a11 = new Date('2030-11-26T11:00:00+01:00');

    let soltarA!: () => void;
    const puertaA = new Promise<void>((resolve) => {
      soltarA = resolve;
    });
    let reservadaA!: () => void;
    const aDentro = new Promise<void>((resolve) => {
      reservadaA = resolve;
    });

    // A: reserva las 10:00 y deja la transacción ABIERTA hasta que se le diga.
    const transaccionA = sqlA!.begin(async (tx) => {
      await tx`select app.set_business_id(${neg.businessId}::uuid)`;
      await tx`
        select * from public.book_appointment(
          ${neg.businessId}::uuid, ${neg.serviceId}::uuid, ${neg.staffId}::uuid,
          ${neg.customerId}::uuid, ${a10}::timestamptz)`;
      reservadaA();
      await puertaA;
    });
    await aDentro;

    // B: pide las 11:00. Tiene que quedarse esperando el lock de la profesional.
    const reservaB = reservar(adapterB!, a11);
    reservaB.catch(() => {}); // el rechazo se comprueba abajo
    try {
      const estadoB = await Promise.race([
        reservaB.then(
          () => 'terminó',
          () => 'terminó',
        ),
        new Promise((resolve) => setTimeout(() => resolve('esperando'), 500)),
      ]);
      expect(estadoB).toBe('esperando');
    } finally {
      // A confirma pase lo que pase: si el test falla, que no deje la
      // transacción abierta bloqueando la limpieza.
      soltarA();
      await transaccionA;
    }

    // B sigue, ve la cita de las 10:00 y se rechaza por el margen.
    await expect(reservaB).rejects.toBeInstanceOf(BufferConflictError);
    expect(
      await citasConfirmadas(new Date('2030-11-26T00:00:00+01:00'), new Date('2030-11-27T00:00:00+01:00')),
    ).toBe(1);
  });

  it('PR-08: la misma clienta a la vez con dos profesionales → entra una, la otra CustomerBusyError', async () => {
    // Una segunda profesional que hace el mismo servicio (hereda el horario 24 h).
    const [otra] = await admin<{ id: string }[]>`
      insert into public.staff (business_id, nombre) values (${neg.businessId}, 'Segunda') returning id`;
    await admin`
      insert into public.staff_services (business_id, staff_id, service_id)
      values (${neg.businessId}, ${otra!.id}, ${neg.serviceId})`;

    const [a, b] = adapters;
    const misma = clientas[0]!;
    const inicio = new Date('2030-11-28T10:00:00+01:00');
    const una = (ad: SupabaseAdapter, staffId: string) =>
      ad.createBooking({ businessId: neg.businessId, serviceId: neg.serviceId, staffId, customerId: misma, start: inicio });

    for (let ronda = 0; ronda < 5; ronda++) {
      const resultados = await Promise.allSettled([una(a!, neg.staffId), una(b!, otra!.id)]);
      const ok = resultados.filter((r) => r.status === 'fulfilled');
      const ko = resultados.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(ok).toHaveLength(1);
      expect(ko).toHaveLength(1);
      expect(ko[0]!.reason).toBeInstanceOf(CustomerBusyError);
      // Se cancela la que entró para la ronda siguiente.
      await admin`update public.appointments set estado = 'cancelada' where customer_id = ${misma} and start_at = ${inicio}`;
    }
  });
});
