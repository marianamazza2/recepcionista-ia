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
// =============================================================================

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BufferConflictError, SlotTakenError } from '../src/adapters/booking/errors.js';
import { SupabaseAdapter } from '../src/adapters/booking/supabase.js';
import { createSql } from '../src/db/client.js';
import { createTestBusiness, deleteTestBusiness, type TestBusiness } from './helpers/fixtures.js';

const N_CONEXIONES = 6;

const admin = createSql();
const conexiones = Array.from({ length: N_CONEXIONES }, () => createSql(undefined, { max: 1 }));

let neg: TestBusiness;
let adapters: SupabaseAdapter[];

beforeAll(async () => {
  neg = await createTestBusiness(admin, 'test-ts-concurrencia');
  adapters = conexiones.map((sql) => new SupabaseAdapter({ sql, businessId: neg.businessId }));
  // Abrir las conexiones antes de la carrera, para que salgan a la vez.
  await Promise.all(conexiones.map((sql) => sql`select 1`));
});

afterAll(async () => {
  await deleteTestBusiness(admin, neg.businessId);
  await Promise.all([admin.end(), ...conexiones.map((sql) => sql.end())]);
});

function reservar(adapter: SupabaseAdapter, start: Date) {
  return adapter.createBooking({
    businessId: neg.businessId,
    serviceId: neg.serviceId,
    staffId: neg.staffId,
    customerId: neg.customerId,
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
});
