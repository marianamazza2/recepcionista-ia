// =============================================================================
// SupabaseAdapter contra la base (spec de fase 1.8)
// =============================================================================
// Disponibilidad de Estética Aurora con los seeds, reserva, cancelación,
// reprogramación y errores tipados. Corre contra DATABASE_URL: el Postgres
// local o el proyecto Supabase.
// =============================================================================

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  BookingNotFoundError,
  BufferConflictError,
  InvalidRangeError,
  InvalidReferenceError,
  NoStaffAvailableError,
  OutsideHoursError,
  SlotTakenError,
  StaffDoesNotProvideServiceError,
  TenantMismatchError,
  TimeOffError,
  TooSoonError,
  CustomerBusyError,
} from '../src/adapters/booking/errors.js';
import { SupabaseAdapter } from '../src/adapters/booking/supabase.js';
import { createSql } from '../src/db/client.js';
import {
  AURORA,
  createTestBusiness,
  createTestCustomer,
  deleteTestBusiness,
  deleteTestCustomers,
  horaMadrid,
  rejilla,
  type TestBusiness,
} from './helpers/fixtures.js';

const sql = createSql();
const aurora = new SupabaseAdapter({ sql, businessId: AURORA.businessId });

/** Un día local de Madrid de octubre de 2030 (antes del cambio de hora: +02:00). */
function diaOctubre2030(dia: number): { from: Date; to: Date } {
  const dd = String(dia).padStart(2, '0');
  const sig = String(dia + 1).padStart(2, '0');
  return {
    from: new Date(`2030-10-${dd}T00:00:00+02:00`),
    to: new Date(`2030-10-${sig}T00:00:00+02:00`),
  };
}

async function horasDe(serviceId: string, staffId: string, dia: number): Promise<string[]> {
  const slots = await aurora.getAvailability({
    businessId: AURORA.businessId,
    serviceId,
    staffId,
    ...diaOctubre2030(dia),
  });
  return slots.map((s) => horaMadrid(s.start));
}

let clienta: string;
let otra: string;

beforeAll(async () => {
  await deleteTestCustomers(sql, AURORA.businessId);
  clienta = await createTestCustomer(sql, AURORA.businessId);
  // PR-08: los choques con un hueco ocupado se prueban con OTRA clienta (la
  // misma no puede tener dos citas a la vez: eso es CustomerBusyError).
  otra = await createTestCustomer(sql, AURORA.businessId);
});

afterAll(async () => {
  await deleteTestCustomers(sql, AURORA.businessId);
  await sql.end();
});

// =============================================================================
describe('disponibilidad de Estética Aurora (seeds)', () => {
  it('lunes: horario partido 9–14 / 16–20 para las dos, facial de 60 min', async () => {
    const esperado = [...rejilla('09:00', '13:00'), ...rejilla('16:00', '19:00')];
    expect(await horasDe(AURORA.services.facial, AURORA.staff.marta, 14)).toEqual(esperado);
    expect(await horasDe(AURORA.services.facial, AURORA.staff.lucia, 14)).toEqual(esperado);
  });

  it('jueves: Lucía solo en su horario propio (16–21) y Marta en el del local (PD-01)', async () => {
    expect(await horasDe(AURORA.services.facial, AURORA.staff.lucia, 17)).toEqual(
      rejilla('16:00', '20:00'),
    );
    expect(await horasDe(AURORA.services.facial, AURORA.staff.marta, 17)).toEqual([
      ...rejilla('10:00', '13:00'),
      ...rejilla('16:00', '20:00'),
    ]);
  });

  it('viernes: jornada continua 9–15', async () => {
    expect(await horasDe(AURORA.services.facial, AURORA.staff.marta, 18)).toEqual(
      rejilla('09:00', '14:00'),
    );
  });

  it('fin de semana: sin huecos', async () => {
    const slots = await aurora.getAvailability({
      businessId: AURORA.businessId,
      serviceId: AURORA.services.facial,
      from: new Date('2030-10-19T00:00:00+02:00'),
      to: new Date('2030-10-21T00:00:00+02:00'),
    });
    expect(slots).toEqual([]);
  });

  it('solo aparece quien hace el servicio (el láser solo lo hace Lucía)', async () => {
    const slots = await aurora.getAvailability({
      businessId: AURORA.businessId,
      serviceId: AURORA.services.laser,
      ...diaOctubre2030(14),
    });
    expect(slots.length).toBeGreaterThan(0);
    expect(new Set(slots.map((s) => s.staffId))).toEqual(new Set([AURORA.staff.lucia]));
  });

  it('devuelve Date en UTC, con end = fin del servicio, ordenados por inicio', async () => {
    const slots = await aurora.getAvailability({
      businessId: AURORA.businessId,
      serviceId: AURORA.services.facial,
      ...diaOctubre2030(14),
    });
    const [primero] = slots;
    expect(primero?.start).toBeInstanceOf(Date);
    // 9:00 en Madrid (CEST) = 07:00 UTC
    expect(primero?.start.toISOString()).toBe('2030-10-14T07:00:00.000Z');
    expect(primero?.end.toISOString()).toBe('2030-10-14T08:00:00.000Z');
    const inicios = slots.map((s) => s.start.getTime());
    expect(inicios).toEqual([...inicios].sort((a, b) => a - b));
  });

  it('rango de más de 31 días → InvalidRangeError', async () => {
    await expect(
      aurora.getAvailability({
        businessId: AURORA.businessId,
        serviceId: AURORA.services.facial,
        from: new Date('2030-10-01T00:00:00Z'),
        to: new Date('2030-12-01T00:00:00Z'),
      }),
    ).rejects.toBeInstanceOf(InvalidRangeError);
  });

  it('pedir por otro negocio → TenantMismatchError', async () => {
    await expect(
      aurora.getAvailability({
        businessId: randomUUID(),
        serviceId: AURORA.services.facial,
        ...diaOctubre2030(14),
      }),
    ).rejects.toBeInstanceOf(TenantMismatchError);
  });
});

// =============================================================================
describe('reservas en Estética Aurora', () => {
  // Martes 15/10/2030: día de reservas de este bloque.
  const a = (hhmm: string) => new Date(`2030-10-15T${hhmm}:00+02:00`);

  it('crea una reserva con profesional y desaparece de la disponibilidad', async () => {
    const cita = await aurora.createBooking({
      businessId: AURORA.businessId,
      serviceId: AURORA.services.facial,
      staffId: AURORA.staff.marta,
      customerId: clienta,
      start: a('10:00'),
      notes: 'Primera visita',
    });

    expect(cita).toMatchObject({
      businessId: AURORA.businessId,
      staffId: AURORA.staff.marta,
      customerId: clienta,
      status: 'confirmada',
      origin: 'agente',
      notes: 'Primera visita',
    });
    expect(cita.start.toISOString()).toBe('2030-10-15T08:00:00.000Z');
    expect(cita.end.getTime() - cita.start.getTime()).toBe(60 * 60_000);

    const horas = await horasDe(AURORA.services.facial, AURORA.staff.marta, 15);
    // 10:00 ocupada; 9:00 y 9:30 caen por el margen; 11:00 por el margen de esta.
    expect(horas).not.toContain('09:30');
    expect(horas).not.toContain('10:00');
    expect(horas).not.toContain('11:00');
    expect(horas).toContain('11:30');

    const lista = await aurora.listBookings({ customerId: clienta });
    expect(lista.map((b) => b.id)).toContain(cita.id);
  });

  it('sin profesional asigna sola (PD-03)', async () => {
    // A las 12:00 las dos están libres; Marta ya tiene una cita ese día y
    // Lucía ninguna → Lucía.
    const cita = await aurora.createBooking({
      businessId: AURORA.businessId,
      serviceId: AURORA.services.facial,
      customerId: clienta,
      start: a('12:00'),
    });
    expect(cita.staffId).toBe(AURORA.staff.lucia);
  });

  it('getLastStaff: la de la última cita ya pasada, no las futuras (PR-06)', async () => {
    // Hasta acá la clienta solo tiene citas en 2030: son futuras y no cuentan.
    expect(await aurora.getLastStaff(clienta)).toBeNull();

    // Una cita de hace una semana con Marta (insertada a mano: la reserva no
    // deja usar fechas pasadas).
    const haceUnaSemana = new Date(Date.now() - 7 * 24 * 3600_000);
    haceUnaSemana.setUTCMinutes(0, 0, 0);
    await sql`
      insert into public.appointments
        (business_id, staff_id, service_id, customer_id, start_at, end_at, estado)
      values (${AURORA.businessId}, ${AURORA.staff.marta}, ${AURORA.services.facial}, ${clienta},
              ${haceUnaSemana}, ${new Date(haceUnaSemana.getTime() + 3600_000)}, 'completada')`;

    expect(await aurora.getLastStaff(clienta)).toBe(AURORA.staff.marta);
  });

  it('getLastStaff de una clienta sin historial → null', async () => {
    const nueva = await createTestCustomer(sql, AURORA.businessId);
    expect(await aurora.getLastStaff(nueva)).toBeNull();
  });

  it('errores tipados: fuera de horario, ocupado, margen, servicio, referencia', async () => {
    const base = {
      businessId: AURORA.businessId,
      serviceId: AURORA.services.facial,
      staffId: AURORA.staff.marta,
      customerId: otra,
    };

    await expect(
      aurora.createBooking({ ...base, start: new Date('2030-10-19T10:00:00+02:00') }), // sábado
    ).rejects.toBeInstanceOf(OutsideHoursError);
    await expect(aurora.createBooking({ ...base, start: a('14:30') })).rejects.toBeInstanceOf(
      OutsideHoursError,
    );
    await expect(aurora.createBooking({ ...base, start: a('10:30') })).rejects.toBeInstanceOf(
      SlotTakenError,
    );
    await expect(aurora.createBooking({ ...base, start: a('11:00') })).rejects.toBeInstanceOf(
      BufferConflictError,
    );
    await expect(
      aurora.createBooking({ ...base, serviceId: AURORA.services.laser, start: a('16:00') }),
    ).rejects.toBeInstanceOf(StaffDoesNotProvideServiceError);
    await expect(
      aurora.createBooking({ ...base, customerId: randomUUID(), start: a('16:00') }),
    ).rejects.toBeInstanceOf(InvalidReferenceError);
  });

  it('el error tipado conserva el original de Postgres en cause', async () => {
    const error = await aurora
      .createBooking({
        businessId: AURORA.businessId,
        serviceId: AURORA.services.facial,
        staffId: AURORA.staff.marta,
        customerId: otra,
        start: a('10:00'),
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SlotTakenError);
    expect((error as SlotTakenError).reason).toBe('slot_taken');
    expect(((error as Error).cause as { code: string }).code).toBe('23P01');
  });

  it('cancela: el hueco vuelve, es idempotente y una cita inexistente da BookingNotFoundError', async () => {
    const cita = await aurora.createBooking({
      businessId: AURORA.businessId,
      serviceId: AURORA.services.facial,
      staffId: AURORA.staff.marta,
      customerId: clienta,
      start: a('17:00'),
    });
    expect(await horasDe(AURORA.services.facial, AURORA.staff.marta, 15)).not.toContain('17:00');

    await aurora.cancelBooking(cita.id);
    expect(await horasDe(AURORA.services.facial, AURORA.staff.marta, 15)).toContain('17:00');

    await expect(aurora.cancelBooking(cita.id)).resolves.toBeUndefined();
    await expect(aurora.cancelBooking(randomUUID())).rejects.toBeInstanceOf(BookingNotFoundError);

    const [guardada] = (await aurora.listBookings({ customerId: clienta })).filter(
      (b) => b.id === cita.id,
    );
    expect(guardada?.status).toBe('cancelada');
  });

  it('reprograma: cancela la original y crea la nueva con la misma profesional', async () => {
    const original = await aurora.createBooking({
      businessId: AURORA.businessId,
      serviceId: AURORA.services.facial,
      staffId: AURORA.staff.marta,
      customerId: clienta,
      start: a('18:00'),
      notes: 'Piel sensible',
    });

    // Media hora antes: solapa con la propia original, que deja de contar.
    const nueva = await aurora.rescheduleBooking(original.id, a('17:30'));
    expect(nueva.id).not.toBe(original.id);
    expect(nueva).toMatchObject({ staffId: AURORA.staff.marta, notes: 'Piel sensible' });
    expect(horaMadrid(nueva.start)).toBe('17:30');

    const lista = await aurora.listBookings({ customerId: clienta });
    expect(lista.find((b) => b.id === original.id)?.status).toBe('cancelada');
    expect(lista.find((b) => b.id === nueva.id)?.status).toBe('confirmada');
  });

  it('reprogramar a un hueco imposible falla y deja la original intacta', async () => {
    const original = await aurora.createBooking({
      businessId: AURORA.businessId,
      serviceId: AURORA.services.facial,
      staffId: AURORA.staff.lucia,
      customerId: clienta,
      start: a('16:00'),
    });

    await expect(
      aurora.rescheduleBooking(original.id, new Date('2030-10-19T10:00:00+02:00')),
    ).rejects.toBeInstanceOf(OutsideHoursError);
    // A las 12:00 la clienta ya tiene otra cita (la de la asignación automática
    // de arriba, con Lucía): PR-08 lo rechaza antes que el hueco ocupado.
    await expect(aurora.rescheduleBooking(original.id, a('12:00'))).rejects.toBeInstanceOf(
      CustomerBusyError,
    );
    // Y un hueco ocupado por OTRA clienta: Marta tiene la de las 10:00.
    const deOtra = await aurora.createBooking({
      businessId: AURORA.businessId,
      serviceId: AURORA.services.facial,
      staffId: AURORA.staff.lucia,
      customerId: otra,
      start: a('19:00'),
    });
    await expect(aurora.rescheduleBooking(original.id, a('19:00'))).rejects.toBeInstanceOf(SlotTakenError);
    await aurora.cancelBooking(deOtra.id);

    const lista = await aurora.listBookings({ customerId: clienta });
    const tras = lista.find((b) => b.id === original.id);
    expect(tras?.status).toBe('confirmada');
    expect(tras?.start.getTime()).toBe(original.start.getTime());
  });

  it('PR-08 changeExistingAndBook: mueve la anterior y reserva la nueva a su hora, todo junto', async () => {
    // Jueves 17/10/2030 (Marta 10–14 y 16–21; Lucía solo 16–21).
    const j = (hhmm: string) => new Date(`2030-10-17T${hhmm}:00+02:00`);
    const quien = await createTestCustomer(sql, AURORA.businessId);
    const anterior = await aurora.createBooking({
      businessId: AURORA.businessId, serviceId: AURORA.services.facial, staffId: AURORA.staff.lucia,
      customerId: quien, start: j('17:00'),
    });
    const nueva = {
      businessId: AURORA.businessId, serviceId: AURORA.services.facial, customerId: quien, start: j('17:00'),
    };

    // Directamente no puede: ya tiene cita a esa hora.
    await expect(aurora.createBooking(nueva)).rejects.toBeInstanceOf(CustomerBusyError);

    // Si recolocar la anterior falla (a las 17:30 se pisaría con la nueva), no cambia nada.
    const fallo = await aurora
      .changeExistingAndBook({ existingBookingId: anterior.id, existing: { action: 'reschedule', newStart: j('17:30') }, booking: nueva })
      .catch((e: unknown) => e);
    expect(fallo).toBeInstanceOf(CustomerBusyError);
    expect((fallo as CustomerBusyError).step).toBe('existing');
    let citas = (await aurora.listBookings({ customerId: quien })).filter((b) => b.status === 'confirmada');
    expect(citas.map((b) => b.id)).toEqual([anterior.id]);

    // Si la nueva no puede (un sábado), tampoco cambia nada.
    const falloNueva = await aurora
      .changeExistingAndBook({
        existingBookingId: anterior.id,
        existing: { action: 'reschedule', newStart: j('19:00') },
        booking: { ...nueva, start: new Date('2030-10-19T10:00:00+02:00') },
      })
      .catch((e: unknown) => e);
    expect(falloNueva).toBeInstanceOf(OutsideHoursError);
    expect((falloNueva as OutsideHoursError).step).toBe('new');
    citas = (await aurora.listBookings({ customerId: quien })).filter((b) => b.status === 'confirmada');
    expect(citas.map((b) => b.id)).toEqual([anterior.id]);

    // Bien: la anterior pasa a las 19:00 con Lucía y la nueva ocupa las 17:00.
    const r = await aurora.changeExistingAndBook({
      existingBookingId: anterior.id,
      existing: { action: 'reschedule', newStart: j('19:00') },
      booking: nueva,
    });
    expect(r.created.start.getTime()).toBe(j('17:00').getTime());
    expect(r.changed).toMatchObject({ staffId: AURORA.staff.lucia, serviceId: AURORA.services.facial, status: 'confirmada' });
    expect(r.changed.start.getTime()).toBe(j('19:00').getTime());
    citas = (await aurora.listBookings({ customerId: quien })).filter((b) => b.status === 'confirmada');
    expect(citas).toHaveLength(2);

    // Y anular en vez de mover.
    const r2 = await aurora.changeExistingAndBook({
      existingBookingId: r.changed.id,
      existing: { action: 'cancel' },
      booking: { ...nueva, start: j('19:00') },
    });
    expect(r2.changed.status).toBe('cancelada');
    expect(r2.created.start.getTime()).toBe(j('19:00').getTime());
  });

  it('otro negocio no puede tocar una cita de Aurora', async () => {
    const cita = await aurora.createBooking({
      businessId: AURORA.businessId,
      serviceId: AURORA.services.facial,
      staffId: AURORA.staff.marta,
      customerId: clienta,
      start: a('19:00'),
    });
    const otro = new SupabaseAdapter({ sql, businessId: randomUUID() });
    await expect(otro.cancelBooking(cita.id)).rejects.toBeInstanceOf(BookingNotFoundError);
    await expect(otro.listBookings({ customerId: clienta })).resolves.toEqual([]);
  });
});

// =============================================================================
describe('errores que necesitan un negocio propio', () => {
  let neg: TestBusiness;
  let adapter: SupabaseAdapter;

  beforeAll(async () => {
    neg = await createTestBusiness(sql, 'test-ts-errores');
    adapter = new SupabaseAdapter({ sql, businessId: neg.businessId });
  });

  afterAll(async () => {
    await deleteTestBusiness(sql, neg.businessId);
  });

  it('antelación mínima → TooSoonError', async () => {
    // Siguiente media hora en punto + 30 min: en la rejilla, abierto (24 h) y a
    // menos de las 2 h de antelación de serie.
    const media = 30 * 60_000;
    const start = new Date(Math.ceil(Date.now() / media) * media + media);
    await expect(
      adapter.createBooking({
        businessId: neg.businessId,
        serviceId: neg.serviceId,
        staffId: neg.staffId,
        customerId: neg.customerId,
        start,
      }),
    ).rejects.toBeInstanceOf(TooSoonError);
  });

  it('festivo → TimeOffError', async () => {
    await sql`
      insert into public.time_off (business_id, desde, hasta, motivo)
      values (${neg.businessId}, '2030-11-05 00:00+01', '2030-11-06 00:00+01', 'Festivo')`;
    await expect(
      adapter.createBooking({
        businessId: neg.businessId,
        serviceId: neg.serviceId,
        staffId: neg.staffId,
        customerId: neg.customerId,
        start: new Date('2030-11-05T10:00:00+01:00'),
      }),
    ).rejects.toBeInstanceOf(TimeOffError);
  });

  it('asignación automática sin nadie libre → NoStaffAvailableError', async () => {
    const params = {
      businessId: neg.businessId,
      serviceId: neg.serviceId,
      customerId: neg.customerId,
      start: new Date('2030-11-06T10:00:00+01:00'),
    };
    await adapter.createBooking(params);
    // Otra clienta: la misma no podría tener dos citas a la vez (PR-08).
    const segunda = await createTestCustomer(sql, neg.businessId);
    await expect(adapter.createBooking({ ...params, customerId: segunda })).rejects.toBeInstanceOf(
      NoStaffAvailableError,
    );
  });

  it('PR-08: la misma clienta no puede tener dos citas que se pisen → CustomerBusyError (RA006)', async () => {
    const quien = await createTestCustomer(sql, neg.businessId);
    const params = {
      businessId: neg.businessId,
      serviceId: neg.serviceId,
      customerId: quien,
      start: new Date('2030-11-07T10:00:00+01:00'),
    };
    await adapter.createBooking(params);
    const e = await adapter.createBooking({ ...params, start: new Date('2030-11-07T10:30:00+01:00') }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(CustomerBusyError);
    expect((e as CustomerBusyError).reason).toBe('customer_busy');
    expect(((e as Error).cause as { code: string }).code).toBe('RA006');
  });
});
