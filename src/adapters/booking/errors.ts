// =============================================================================
// Errores tipados del motor de reservas
// =============================================================================
// Traducen los SQLSTATE de book_appointment / available_slots (spec de fase 1.3,
// docs/DECISIONES.md D-20) a clases, para que el agente decida qué decir sin
// conocer códigos de Postgres:
//
//   if (e instanceof OutsideHoursError) → PD-04: "no abrimos" + huecos cercanos
//
// Todas heredan de BookingError, que lleva un `reason` estable (útil para logs
// y para serializar el resultado de una tool) y el error original en `cause`.
// =============================================================================

export type BookingErrorReason =
  | 'slot_taken'
  | 'outside_hours'
  | 'time_off'
  | 'too_soon'
  | 'buffer_conflict'
  | 'no_staff_available'
  | 'staff_does_not_provide_service'
  | 'invalid_reference'
  | 'invalid_range'
  | 'booking_not_found'
  | 'booking_not_cancellable'
  | 'tenant_mismatch';

export abstract class BookingError extends Error {
  abstract readonly reason: BookingErrorReason;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** 23P01 — El hueco ya está ocupado. Ofrecer otro. */
export class SlotTakenError extends BookingError {
  readonly reason = 'slot_taken';
}

/** RA001 — Fuera del horario de la profesional o del local (o fuera de la rejilla). */
export class OutsideHoursError extends BookingError {
  readonly reason = 'outside_hours';
}

/** RA002 — Cae en un festivo del negocio o en una ausencia de la profesional. */
export class TimeOffError extends BookingError {
  readonly reason = 'time_off';
}

/** RA003 — No respeta la antelación mínima del negocio. */
export class TooSoonError extends BookingError {
  readonly reason = 'too_soon';
}

/** RA004 — No respeta el margen con otra cita. */
export class BufferConflictError extends BookingError {
  readonly reason = 'buffer_conflict';
}

/** RA005 — Asignación automática: ninguna profesional libre a esa hora. */
export class NoStaffAvailableError extends BookingError {
  readonly reason = 'no_staff_available';
}

/** 23514 — La profesional no presta ese servicio. */
export class StaffDoesNotProvideServiceError extends BookingError {
  readonly reason = 'staff_does_not_provide_service';
}

/** 23503 — Algo no es de ese negocio o está inactivo. Error de programación. */
export class InvalidReferenceError extends BookingError {
  readonly reason = 'invalid_reference';
}

/** 22023 — Rango de fechas inválido o de más de 31 días. */
export class InvalidRangeError extends BookingError {
  readonly reason = 'invalid_range';
}

/** La cita no existe en este negocio. */
export class BookingNotFoundError extends BookingError {
  readonly reason = 'booking_not_found';
}

/** La cita ya está completada o marcada como no presentada. */
export class BookingNotCancellableError extends BookingError {
  readonly reason = 'booking_not_cancellable';
}

/** Se pidió operar sobre un negocio distinto del del adaptador. */
export class TenantMismatchError extends BookingError {
  readonly reason = 'tenant_mismatch';
}

type BookingErrorClass = new (message: string, options?: { cause?: unknown }) => BookingError;

const POR_SQLSTATE: Record<string, BookingErrorClass> = {
  '23P01': SlotTakenError,
  RA001: OutsideHoursError,
  RA002: TimeOffError,
  RA003: TooSoonError,
  RA004: BufferConflictError,
  RA005: NoStaffAvailableError,
  '23514': StaffDoesNotProvideServiceError,
  '23503': InvalidReferenceError,
  '22023': InvalidRangeError,
};

/**
 * Si `error` es un error de Postgres con un SQLSTATE conocido, devuelve el error
 * tipado equivalente. Si no, devuelve `error` tal cual.
 */
export function translateDatabaseError(error: unknown): unknown {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return error;
  }
  const code = (error as { code: unknown }).code;
  const Clase = typeof code === 'string' ? POR_SQLSTATE[code] : undefined;
  if (!Clase) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(code);
  return new Clase(message, { cause: error });
}
