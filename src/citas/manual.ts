// =============================================================================
// Agenda del panel y citas a mano (Fase 4 · 4.5, PR-04, PI-14)
// =============================================================================
//   · agendaDelDia: las citas de un negocio en un día local, con servicio,
//     profesional, clienta, estado y origen.
//   · agendaDelRango (Fase 9, PC-16): lo mismo para varios días seguidos y,
//     además, QUÉ HORAS trabaja cada profesional cada día (app.tramos_efectivos:
//     PD-01, PI-19 y los turnos sueltos de PC-06). Con eso la agenda visual
//     del portal y del panel dibuja las columnas y sombrea lo cerrado sin
//     repetir ninguna regla de horario en el navegador.
//   · cargarCitaManual: servicio, profesional, día y CUALQUIER hora, y la
//     clienta por su email (PA-17) o, sin email, por su teléfono (si no
//     existe, se crea). Va por el mismo BookingAdapter que el agente con
//     `manual: true`: la base se salta la rejilla (PR-01) y la antelación
//     (PD-05) y sigue impidiendo salir del horario, los festivos, los solapes
//     y el margen. Le llega el mismo email de confirmación que si reservara el
//     agente (PW-18, PI-14), si tiene email.
//   · cancelarCitaManual: recepción puede cancelar siempre (PR-07); el email
//     de cancelación sale igual que por el chat (PW-10), solo si estaba
//     confirmada.
// =============================================================================

import type { Sql, TransactionSql } from 'postgres';

import { SupabaseAdapter } from '../adapters/booking/supabase.js';
import type { Booking } from '../adapters/booking/types.js';
import type { EmailProvider } from '../adapters/email/types.js';
import { loadBusinessConfig } from '../config/business.js';
import { normalizarEmail } from '../core/email.js';
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
  clienta: { nombre: string | null; telefono: string; email: string | null };
  notas: string | null;
}

export async function agendaDelDia(sql: Sql, businessId: string, fecha: string): Promise<CitaAgenda[]> {
  return inTenant(sql, businessId, async (tx) => {
    const [b] = await tx<{ timezone: string }[]>`select timezone from public.businesses where id = ${businessId}::uuid`;
    if (!b) return [];
    return citasDelDia(tx, businessId, fecha, b.timezone);
  });
}

/** Las citas de un día local, ya dentro del tenant. */
async function citasDelDia(tx: TransactionSql, businessId: string, fecha: string, timezone: string): Promise<CitaAgenda[]> {
  const desde = inicioDelDia(fecha, timezone);
  const hasta = inicioDelDia(sumarDias(fecha, 1), timezone);
  const rows = await tx<
    { id: string; start_at: Date; end_at: Date; estado: CitaAgenda['estado']; origen: CitaAgenda['origen']; servicio: string; profesional: string; staff_id: string; nombre: string | null; telefono: string; email: string | null; notas: string | null }[]
  >`
    select a.id, a.start_at, a.end_at, a.estado, a.origen, s.nombre as servicio, st.nombre as profesional, a.staff_id,
           c.nombre, c.telefono, c.email, a.notas
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
    horaInicio: utcToLocal(r.start_at, timezone).hora,
    horaFin: utcToLocal(r.end_at, timezone).hora,
    estado: r.estado,
    origen: r.origen,
    servicio: r.servicio,
    profesional: r.profesional,
    staffId: r.staff_id,
    clienta: { nombre: r.nombre, telefono: r.telefono, email: r.email },
    notas: r.notas,
  }));
}

/** PC-16: un tramo trabajado, en hora local, para dibujar la columna del día. */
export interface TramoAgenda {
  staffId: string;
  /** 'HH:MM' locales; '24:00' es medianoche del día siguiente. */
  desde: string;
  hasta: string;
  /** PC-06: sale de un turno suelto (ese día manda sobre el horario de siempre). */
  suelto: boolean;
}

export interface DiaAgenda {
  fecha: string; // 'YYYY-MM-DD' local
  tramos: TramoAgenda[];
  citas: CitaAgenda[];
}

export interface AgendaRango {
  desde: string;
  dias: DiaAgenda[];
  /** Las profesionales activas, en el orden de las columnas. */
  profesionales: { id: string; nombre: string }[];
}

/**
 * PC-16: la agenda de `dias` días seguidos desde `desde`, con las citas y los
 * tramos de cada profesional. Es lo único que necesita la agenda visual.
 */
export async function agendaDelRango(sql: Sql, businessId: string, desde: string, dias: number): Promise<AgendaRango> {
  const fechas = Array.from({ length: Math.max(1, Math.min(dias, 14)) }, (_, i) => sumarDias(desde, i));
  return inTenant(sql, businessId, async (tx) => {
    const [b] = await tx<{ timezone: string }[]>`select timezone from public.businesses where id = ${businessId}::uuid`;
    if (!b) return { desde, dias: [], profesionales: [] };
    const profesionales = await tx<{ id: string; nombre: string }[]>`
      select id, nombre from public.staff
       where business_id = ${businessId}::uuid and activo
       order by nombre, id`;
    const out: DiaAgenda[] = [];
    for (const fecha of fechas) {
      const tramos: TramoAgenda[] = [];
      for (const p of profesionales) {
        const filas = await tx<{ desde: string; hasta: string; suelto: boolean }[]>`
          select to_char(t.desde at time zone ${b.timezone}, 'HH24:MI') as desde,
                 case when (t.hasta at time zone ${b.timezone})::date > ${fecha}::date
                      then '24:00' else to_char(t.hasta at time zone ${b.timezone}, 'HH24:MI') end as hasta,
                 t.suelto
            from app.tramos_efectivos(${businessId}::uuid, ${p.id}::uuid, ${fecha}::date) t
           order by t.desde`;
        for (const f of filas) tramos.push({ staffId: p.id, desde: f.desde, hasta: f.hasta, suelto: f.suelto });
      }
      out.push({ fecha, tramos, citas: await citasDelDia(tx, businessId, fecha, b.timezone) });
    }
    return { desde, dias: out, profesionales: profesionales.map((p) => ({ id: p.id, nombre: p.nombre })) };
  });
}

export interface CitasManualesDeps {
  sql: Sql;
  email: EmailProvider;
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

/** El email no se entiende (PA-17): el panel lo dice con palabras. */
export class EmailNoValido extends Error {
  constructor() {
    super('El email no es válido');
    this.name = 'EmailNoValido';
  }
}

export interface CitaManual {
  serviceId: string;
  staffId: string;
  fecha: string; // 'YYYY-MM-DD' local
  hora: string; // 'HH:MM' local, cualquiera (PR-04)
  telefono: string;
  nombre: string;
  /** PA-17: opcional; sin él no le llega la confirmación. */
  email: string | null;
  notas: string | null;
}

export async function cargarCitaManual(
  deps: CitasManualesDeps,
  businessId: string,
  c: CitaManual,
): Promise<{ cita: Booking; email: ResultadoConfirmacion | null }> {
  const telefono = normalizarTelefono(c.telefono);
  if (!telefono) throw new TelefonoNoValido();
  const email = c.email?.trim() ? normalizarEmail(c.email) : null;
  if (c.email?.trim() && !email) throw new EmailNoValido();
  const config = await loadBusinessConfig(deps.sql, { id: businessId });
  const inicio = localToUtc(c.fecha, c.hora, config.timezone);
  const { customer } = await findOrCreateCustomer(deps.sql, businessId, { telefono, nombre: c.nombre, email });
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
  const aviso = await enviarConfirmacion({ sql: deps.sql, email: deps.email, baseUrl: deps.baseUrl, ...(deps.onError ? { onError: deps.onError } : {}) }, config, cita.id);
  return { cita, email: aviso };
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
  await enviarCancelacion({ sql: deps.sql, email: deps.email, baseUrl: deps.baseUrl, ...(deps.onError ? { onError: deps.onError } : {}) }, config, appointmentId);
  return true;
}
