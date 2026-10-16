// =============================================================================
// BookingAdapter — el contrato de la agenda (maestro §7)
// =============================================================================
// El núcleo del agente (Fase 2) habla contra esta interfaz y nunca sabe qué hay
// detrás: nuestra base (SupabaseAdapter) o, más adelante, Google Calendar.
//
// Convenciones:
//   · Las fechas entran y salen como Date (instantes UTC). Presentarlas en la
//     hora del negocio es cosa del agente.
//   · Un adaptador trabaja para UN negocio. Los métodos que reciben businessId
//     (los de §7) lo comprueban contra el del adaptador; los que no, usan el
//     suyo.
//   · Los fallos de negocio llegan como errores tipados (errors.ts), nunca como
//     códigos de Postgres.
// =============================================================================

export type BookingStatus = 'confirmada' | 'cancelada' | 'completada' | 'no_show';
export type BookingOrigin = 'agente' | 'manual' | 'externo';

/** Un hueco libre: una profesional concreta a una hora concreta. */
export interface TimeSlot {
  staffId: string;
  start: Date;
  /** Fin del servicio, sin el margen (igual que se guardaría la cita). */
  end: Date;
}

export interface AvailabilityParams {
  businessId: string;
  serviceId: string;
  /** Sin staffId: huecos de todas las profesionales que hacen el servicio. */
  staffId?: string;
  from: Date;
  /** Exclusivo. Como mucho 31 días después de `from`. */
  to: Date;
}

export interface CreateBookingParams {
  businessId: string;
  serviceId: string;
  /** Sin staffId: asignación automática (PD-03) a la que menos citas tenga ese día. */
  staffId?: string;
  customerId: string;
  start: Date;
  notes?: string;
  origin?: BookingOrigin;
  /** Clave de idempotencia del canal o id en un sistema externo. */
  externalId?: string;
}

export interface Booking {
  id: string;
  businessId: string;
  staffId: string;
  serviceId: string;
  customerId: string;
  start: Date;
  end: Date;
  status: BookingStatus;
  origin: BookingOrigin;
  externalId: string | null;
  notes: string | null;
  createdAt: Date;
}

export interface BookingAdapter {
  /** Huecos libres, ordenados por inicio y luego por profesional. */
  getAvailability(params: AvailabilityParams): Promise<TimeSlot[]>;

  createBooking(params: CreateBookingParams): Promise<Booking>;

  /** Idempotente: cancelar una cita ya cancelada no falla. */
  cancelBooking(bookingId: string): Promise<void>;

  /**
   * Cancela y crea en la misma transacción, con la misma profesional y el mismo
   * servicio. Si la nueva no entra, la original queda intacta.
   */
  rescheduleBooking(bookingId: string, newStart: Date): Promise<Booking>;

  /** Todas las citas de la clienta, de la más antigua a la más reciente. */
  listBookings(params: { customerId: string }): Promise<Booking[]>;

  /** Profesional de la última cita no cancelada, o null (PD-03: "la última vez te atendió…"). */
  getLastStaff(customerId: string): Promise<string | null>;
}
