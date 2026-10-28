// =============================================================================
// Agenda del panel y citas a mano (Fase 4 · 4.5, PR-04, PI-14)
// =============================================================================
//   · agendaDelDia: las citas de un negocio en un día local, con servicio,
//     profesional, clienta, estado y origen.
//   · cargarCitaManual: servicio, profesional, día y CUALQUIER hora, y la
//     clienta por su teléfono (si no existe, se crea). Va por el mismo
//     BookingAdapter que el agente con `manual: true`: la base se salta la
//     rejilla (PR-01) y la antelación (PD-05) y sigue impidiendo salir del
//     horario, los festivos, los solapes y el margen. Llega el mismo SMS de
//     confirmación que si reservara el agente (PA-09, PI-14).
//   · cancelarCitaManual: recepción puede cancelar siempre (PR-07); el SMS de
//     cancelación sale igual que por el chat (PW-10), solo si estaba
//     confirmada.
// =============================================================================

import type { Sql } from 'postgres';

import { SupabaseAdapter } from '../adapters/booking/supabase.js';
import type { Booking } from '../adapters/booking/types.js';
import type { SmsProvider } from '../adapters/sms/types.js';
import { loadBusinessConfig } from '../config/business.js';
import { normalizarTelefono } from '../core/phone.js';
import { inicioDelDia, localToUtc, sumarDias, utcToLocal } from '../core/time.js';
import { findOrCreateCustomer } from '../db/customers.js';
import { inTenant } from '../db/tenant.js';
import { enviarCancelacion, enviarConfirmacion, type ResultadoConfirmacion } from './confirmacion.js';

export interface CitaAgenda {
  id: string;
  inicio: Date;
  fin: Date;
  /** 'HH:MM' locales del negocio. */
  horaInicio: string;
  horaFin: string;
  estado: 'confirmada' | 'cancelada' | 'completada' | 'no_show';
  origen: 'agente' | 'manual' | 'externo';
  servicio: string;
  profesional: string;
  staffId: string;
  clienta: { nombre: string | null; telefono: string };
  notas: string | null;
}

export async function agendaDelDia(sql: Sql, businessId: string, fecha: string): Promise<CitaAgenda[]> {
  return inTenant(sql, businessId, async (tx) => {
    const [b] = await tx<{ timezone: string }[]>`select timezone from public.businesses where id = ${businessId}::uuid`;
    if (!b) return [];
    const desde = inicioDelDia(fecha, b.timezone);
    const hasta = inicioDelDia(sumarDias(fecha, 1), b.timezone);
    const rows = await tx<
      { id: string; start_at: Date; end_at: Date; estado: CitaAgenda['estado']; origen: CitaAgenda['origen']; servicio: string; profesional: string; staff_id: string; nombre: string | null; telefono: string; notas: string | null }[]
    >`
      select a.id, a.start_at, a.end_at, a.estado, a.origen, s.nombre as servicio, st.nombre as profesional, a.staff_id,
             c.nombre, c.telefono, a.notas
        from public.appointments a
        join public.services s   on s.business_id = a.business_id and s.id = a.service_id
        join public.staff st     on st.business_id = a.business_id and st.id = a.staff_id
        join public.customers c  on c.business_id = a.business_id and c.id = a.customer_id
       where a.business_id = ${businessId}::uuid
         and a.start_at >= ${desde} and a.start_at < ${hasta}
       order by a.start_at, st.nombre, a.id`;
    return rows.map((r) => ({
      id: r.id,
      inicio: r.start_at,
      fin: r.end_at,
      horaInicio: utcToLocal(r.start_at, b.timezone).hora,
      horaFin: utcToLocal(r.end_at, b.timezone).hora,
      estado: r.estado,
      origen: r.origen,
      servicio: r.servicio,
      profesional: r.profesional,
      staffId: r.staff_id,
      clienta: { nombre: r.nombre, telefono: r.telefono },
      notas: r.notas,
    }));
  });
}

export interface CitasManualesDeps {
  sql: Sql;
  sms: SmsProvider;
  baseUrl: string;
  onError?: (e: unknown) => void;
}

/** El teléfono no se entiende: el panel lo dice con palabras. */
export class TelefonoNoValido extends Error {
  constructor() {
    super('El teléfono no es válido');
    this.name = 'TelefonoNoValido';
  }
}

export interface CitaManual {
  serviceId: string;
  staffId: string;
  fecha: string; // 'YYYY-MM-DD' local
  hora: string; // 'HH:MM' local, cualquiera (PR-04)
  telefono: string;
  nombre: string;
  notas: string | null;
}

export async function cargarCitaManual(
  deps: CitasManualesDeps,
  businessId: string,
  c: CitaManual,
): Promise<{ cita: Booking; sms: ResultadoConfirmacion | null }> {
  const telefono = normalizarTelefono(c.telefono);
  if (!telefono) throw new TelefonoNoValido();
  const config = await loadBusinessConfig(deps.sql, { id: businessId });
  const inicio = localToUtc(c.fecha, c.hora, config.timezone);
  const { customer } = await findOrCreateCustomer(deps.sql, businessId, telefono, c.nombre);
  const cita = await new SupabaseAdapter({ sql: deps.sql, businessId }).createBooking({
    businessId,
    serviceId: c.serviceId,
    staffId: c.staffId,
    customerId: customer.id,
    start: inicio,
    origin: 'manual',
    manual: true,
    ...(c.notas ? { notes: c.notas } : {}),
  });
  const sms = await enviarConfirmacion({ sql: deps.sql, sms: deps.sms, baseUrl: deps.baseUrl, ...(deps.onError ? { onError: deps.onError } : {}) }, config, cita.id);
  return { cita, sms };
}

/** Cancela desde la agenda. Devuelve si se canceló ahora (false si ya lo estaba). */
export async function cancelarCitaManual(deps: CitasManualesDeps, businessId: string, appointmentId: string): Promise<boolean> {
  const [antes] = await inTenant(
    deps.sql,
    businessId,
    (tx) => tx<{ estado: string }[]>`
      select estado from public.appointments where business_id = ${businessId}::uuid and id = ${appointmentId}::uuid`,
  );
  await new SupabaseAdapter({ sql: deps.sql, businessId }).cancelBooking(appointmentId);
  if (antes?.estado !== 'confirmada') return false;
  const config = await loadBusinessConfig(deps.sql, { id: businessId });
  await enviarCancelacion({ sql: deps.sql, sms: deps.sms, baseUrl: deps.baseUrl, ...(deps.onError ? { onError: deps.onError } : {}) }, config, appointmentId);
  return true;
}
