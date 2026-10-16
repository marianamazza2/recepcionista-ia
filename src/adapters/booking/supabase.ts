// =============================================================================
// SupabaseAdapter — la agenda vive en nuestra base (maestro §7, v1)
// =============================================================================
// Conexión DIRECTA a Postgres (librería `postgres`), no supabase-js. Cada
// operación es una transacción que:
//   1. declara el tenant con app.set_business_id() — scope de transacción, así
//      una conexión reutilizada del pool nunca hereda el negocio de otra
//      petición (D-15, D-16);
//   2. llama a la función SQL (available_slots, book_appointment…);
//   3. confirma o deshace todo junto.
// Por PostgREST no se puede hacer eso en una sola unidad, y así los tests
// corren igual contra el Postgres local y contra Supabase.
//
// Toda la lógica de "qué es un hueco válido" está en la base
// (app.slot_es_valido). Acá no se recalcula nada: se llama y se traducen los
// errores.
//
// Aunque el backend conecte con un rol que hace BYPASSRLS, cada consulta filtra
// por business_id explícitamente (T-03): es la barrera principal.
//
// Nivel de aislamiento: READ COMMITTED (el de defecto). El advisory lock de
// book_appointment depende de eso; ver la migración 20261016120200.
// =============================================================================

import type { Sql, TransactionSql } from 'postgres';

import {
  BookingNotCancellableError,
  BookingNotFoundError,
  TenantMismatchError,
  translateDatabaseError,
} from './errors.js';
import type {
  AvailabilityParams,
  Booking,
  BookingAdapter,
  BookingOrigin,
  BookingStatus,
  CreateBookingParams,
  TimeSlot,
} from './types.js';

interface AppointmentRow {
  id: string;
  business_id: string;
  staff_id: string;
  service_id: string;
  customer_id: string;
  start_at: Date;
  end_at: Date;
  estado: BookingStatus;
  origen: BookingOrigin;
  external_id: string | null;
  notas: string | null;
  created_at: Date;
}

interface SlotRow {
  staff_id: string;
  start_at: Date;
  end_at: Date;
}

export interface SupabaseAdapterOptions {
  /** Cliente de `postgres` (ver src/db/client.ts). El adaptador no lo cierra. */
  sql: Sql;
  /** El negocio para el que trabaja este adaptador. */
  businessId: string;
}

export class SupabaseAdapter implements BookingAdapter {
  private readonly sql: Sql;
  readonly businessId: string;

  constructor({ sql, businessId }: SupabaseAdapterOptions) {
    this.sql = sql;
    this.businessId = businessId;
  }

  async getAvailability(params: AvailabilityParams): Promise<TimeSlot[]> {
    this.assertTenant(params.businessId);
    const rows = await this.inTenant(
      (tx) => tx<SlotRow[]>`
        select staff_id, start_at, end_at
          from public.available_slots(
                 p_business_id => ${this.businessId}::uuid,
                 p_service_id  => ${params.serviceId}::uuid,
                 p_from        => ${params.from}::timestamptz,
                 p_to          => ${params.to}::timestamptz,
                 p_staff_id    => ${params.staffId ?? null}::uuid)`,
    );
    return rows.map((r) => ({ staffId: r.staff_id, start: r.start_at, end: r.end_at }));
  }

  async createBooking(params: CreateBookingParams): Promise<Booking> {
    this.assertTenant(params.businessId);
    return this.inTenant((tx) => this.book(tx, params));
  }

  async cancelBooking(bookingId: string): Promise<void> {
    await this.inTenant(async (tx) => {
      const cita = await this.lockAppointment(tx, bookingId);
      if (cita.estado === 'cancelada') {
        return;
      }
      if (cita.estado !== 'confirmada') {
        throw new BookingNotCancellableError(
          `La cita ${bookingId} está en estado "${cita.estado}" y no se puede cancelar`,
        );
      }
      await tx`
        update public.appointments
           set estado = 'cancelada'
         where id = ${bookingId}::uuid
           and business_id = ${this.businessId}::uuid`;
    });
  }

  async rescheduleBooking(bookingId: string, newStart: Date): Promise<Booking> {
    // Todo en UNA transacción: si la reserva nueva falla (hueco ocupado, fuera
    // de horario…), el ROLLBACK deshace también la cancelación y la original
    // queda como estaba. La cancelación va primero para que la cita no se
    // bloquee a sí misma al moverla media hora.
    return this.inTenant(async (tx) => {
      const cita = await this.lockAppointment(tx, bookingId);
      if (cita.estado !== 'confirmada') {
        throw new BookingNotCancellableError(
          `La cita ${bookingId} está en estado "${cita.estado}" y no se puede reprogramar`,
        );
      }
      await tx`
        update public.appointments
           set estado = 'cancelada'
         where id = ${bookingId}::uuid
           and business_id = ${this.businessId}::uuid`;

      // El external_id no se copia: es UNIQUE por negocio y la original lo
      // conserva.
      return this.book(tx, {
        businessId: this.businessId,
        serviceId: cita.service_id,
        staffId: cita.staff_id,
        customerId: cita.customer_id,
        start: newStart,
        origin: cita.origen,
        ...(cita.notas === null ? {} : { notes: cita.notas }),
      });
    });
  }

  async listBookings({ customerId }: { customerId: string }): Promise<Booking[]> {
    const rows = await this.inTenant(
      (tx) => tx<AppointmentRow[]>`
        select *
          from public.appointments
         where business_id = ${this.businessId}::uuid
           and customer_id = ${customerId}::uuid
         order by start_at, id`,
    );
    return rows.map(toBooking);
  }

  async getLastStaff(customerId: string): Promise<string | null> {
    const [row] = await this.inTenant(
      (tx) => tx<{ staff_id: string | null }[]>`
        select public.ultima_profesional(${this.businessId}::uuid, ${customerId}::uuid) as staff_id`,
    );
    return row?.staff_id ?? null;
  }

  // ---------------------------------------------------------------------------

  private async book(tx: TransactionSql, params: CreateBookingParams): Promise<Booking> {
    const [row] = await tx<AppointmentRow[]>`
      select *
        from public.book_appointment(
               p_business_id => ${this.businessId}::uuid,
               p_service_id  => ${params.serviceId}::uuid,
               p_staff_id    => ${params.staffId ?? null}::uuid,
               p_customer_id => ${params.customerId}::uuid,
               p_start_at    => ${params.start}::timestamptz,
               p_notas       => ${params.notes ?? null}::text,
               p_origen      => ${params.origin ?? 'agente'}::public.appointment_origen,
               p_external_id => ${params.externalId ?? null}::text)`;
    if (!row) {
      throw new Error('book_appointment no devolvió ninguna fila');
    }
    return toBooking(row);
  }

  /** Lee la cita de ESTE negocio bloqueándola hasta el final de la transacción. */
  private async lockAppointment(tx: TransactionSql, bookingId: string): Promise<AppointmentRow> {
    const [cita] = await tx<AppointmentRow[]>`
      select *
        from public.appointments
       where id = ${bookingId}::uuid
         and business_id = ${this.businessId}::uuid
         for update`;
    if (!cita) {
      throw new BookingNotFoundError(`La cita ${bookingId} no existe en este negocio`);
    }
    return cita;
  }

  /** Abre una transacción con el tenant declarado y traduce los errores de Postgres. */
  private async inTenant<T>(fn: (tx: TransactionSql) => Promise<T>): Promise<T> {
    try {
      const result = await this.sql.begin(async (tx) => {
        await tx`select app.set_business_id(${this.businessId}::uuid)`;
        return fn(tx);
      });
      return result as T;
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  private assertTenant(businessId: string): void {
    if (businessId !== this.businessId) {
      throw new TenantMismatchError(
        `Este adaptador trabaja para el negocio ${this.businessId}, no para ${businessId}`,
      );
    }
  }
}

function toBooking(r: AppointmentRow): Booking {
  return {
    id: r.id,
    businessId: r.business_id,
    staffId: r.staff_id,
    serviceId: r.service_id,
    customerId: r.customer_id,
    start: r.start_at,
    end: r.end_at,
    status: r.estado,
    origin: r.origen,
    externalId: r.external_id,
    notes: r.notas,
    createdAt: r.created_at,
  };
}
