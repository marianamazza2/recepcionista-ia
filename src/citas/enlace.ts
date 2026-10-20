// =============================================================================
// La página del enlace del SMS: ver y cancelar una cita (Fase 3 · 3.5, PW-07)
// =============================================================================
// El token del enlace es lo único que identifica la cita: se busca por su hash
// (único en toda la base) y solo mientras no haya caducado (al terminar la
// cita). Un token inventado, caducado o de una cita borrada da lo mismo: nada.
//
// Cancelar aplica PR-07 exactamente como la herramienta cancelar_reserva
// (mismo cálculo de plazo, core/tools/reservas.ts → plazo): en modo
// `bloquear`, dentro del plazo no se cancela y se da el teléfono del local.
// =============================================================================

import type { Sql } from 'postgres';

import { SupabaseAdapter } from '../adapters/booking/supabase.js';
import { loadBusinessConfig, type BusinessConfig } from '../config/business.js';
import { fechaLarga, utcToLocal } from '../core/time.js';
import { nombreProfesional, nombreServicio } from '../core/tools/common.js';
import { plazo } from '../core/tools/reservas.js';
import { inTenant } from '../db/tenant.js';
import { sha256 } from '../db/widget.js';

const TOKEN_ENLACE = /^[A-Za-z0-9_-]{16,64}$/;

export interface CitaDelEnlace {
  config: BusinessConfig;
  appointmentId: string;
  estado: 'confirmada' | 'cancelada' | 'completada' | 'no_show';
  inicio: Date;
  servicio: string;
  profesional: string;
  dia: string; // 'lunes 19 de octubre de 2026'
  hora: string;
  horaFin: string;
}

/** La cita de ese enlace, o null si el token no vale (inventado, caducado o de una cita borrada). */
export async function citaPorEnlace(sql: Sql, token: string): Promise<CitaDelEnlace | null> {
  if (!TOKEN_ENLACE.test(token)) return null;
  // Sin tenant todavía: el token es lo que dice de qué negocio es.
  const [link] = await sql<{ business_id: string; appointment_id: string }[]>`
    select business_id, appointment_id from public.appointment_links
     where token_hash = ${sha256(token)} and expira_at > now()`;
  if (!link) return null;

  let config: BusinessConfig;
  try {
    config = await loadBusinessConfig(sql, { id: link.business_id });
  } catch {
    return null; // negocio pausado o borrado
  }
  const [a] = await inTenant(
    sql,
    config.id,
    (tx) => tx<{ estado: CitaDelEnlace['estado']; start_at: Date; end_at: Date; service_id: string; staff_id: string }[]>`
      select estado, start_at, end_at, service_id, staff_id from public.appointments
       where business_id = ${config.id}::uuid and id = ${link.appointment_id}::uuid`,
  );
  if (!a) return null;
  const l = utcToLocal(a.start_at, config.timezone);
  return {
    config,
    appointmentId: link.appointment_id,
    estado: a.estado,
    inicio: a.start_at,
    servicio: nombreServicio(config, a.service_id),
    profesional: nombreProfesional(config, a.staff_id),
    dia: fechaLarga(l.fecha),
    hora: l.hora,
    horaFin: utcToLocal(a.end_at, config.timezone).hora,
  };
}

export type ResultadoCancelacion =
  | { resultado: 'cancelada'; dentroDelPlazo: boolean; politica: string | null }
  | { resultado: 'ya_cancelada' }
  | { resultado: 'bloqueada'; plazoHoras: number; politica: string | null; telefono: string | null }
  | { resultado: 'no_modificable' };

/** Cancela la cita del enlace aplicando PR-07. */
export async function cancelarPorEnlace(sql: Sql, cita: CitaDelEnlace, ahora: Date): Promise<ResultadoCancelacion> {
  const { config } = cita;
  if (cita.estado === 'cancelada') return { resultado: 'ya_cancelada' };
  if (cita.estado !== 'confirmada' || cita.inicio.getTime() <= ahora.getTime()) {
    return { resultado: 'no_modificable' };
  }
  const { dentroDelPlazo } = plazo(config, cita.inicio, ahora);
  if (dentroDelPlazo && config.cancelacionModo === 'bloquear') {
    return {
      resultado: 'bloqueada',
      plazoHoras: config.cancelacionPlazoHoras,
      politica: config.politicaCancelacion,
      telefono: config.telefonoHumano,
    };
  }
  await new SupabaseAdapter({ sql, businessId: config.id }).cancelBooking(cita.appointmentId);
  return { resultado: 'cancelada', dentroDelPlazo, politica: dentroDelPlazo ? config.politicaCancelacion : null };
}
