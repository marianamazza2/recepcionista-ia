// =============================================================================
// SMS de una cita: confirmación y cancelación (Fase 3 · 3.5, PA-09, PW-07, PW-10)
// =============================================================================
// Al quedar confirmada una cita nueva (o la nueva hora de una cita movida):
//   1. se crea el enlace a su página (/cita/:token), que caduca al terminar la
//      cita; en la base solo queda el hash del token;
//   2. se arma el texto (sin datos de salud: solo negocio, día, hora y
//      profesional) y se guarda el SMS como `pendiente`, con el enlace tapado;
//   3. se "envía" con el proveedor y se marca `prueba`/`enviado`, o `fallido`.
//
// Al cancelarse una cita por el chat (PW-10, confirmada por Mariana el
// 20/10/2026): un SMS corto sin enlace, para que la dueña del teléfono se
// entere aunque no haya sido ella. Desde la página del enlace no se manda: ya
// lo está viendo.
//
// Nunca lanza: si algo falla, la reserva sigue valiendo y el SMS queda
// `fallido` (o no se llega a crear) para reintentar; el error va al log.
// =============================================================================

import type { Sql } from 'postgres';

import type { SmsProvider } from '../adapters/sms/types.js';
import type { BusinessConfig } from '../config/business.js';
import { fechaLarga, utcToLocal } from '../core/time.js';
import { nombreProfesional } from '../core/tools/common.js';
import { inTenant } from '../db/tenant.js';
import { nuevoToken } from '../db/widget.js';

/** Lo que el SMS dice en lugar del enlace al guardarlo: el token no se guarda. */
export const ENLACE_TAPADO = '[enlace]';

/** 16 bytes = 128 bits: imposible de adivinar y un enlace corto (cabe mejor en un SMS). */
const BYTES_TOKEN_ENLACE = 16;

export interface ConfirmacionDeps {
  sql: Sql;
  sms: SmsProvider;
  /** URL pública del servidor, sin barra final (ej. https://…); el enlace es {baseUrl}/cita/{token}. */
  baseUrl: string;
  onError?: (e: unknown) => void;
}

/** "lunes 19 de octubre": en un SMS el año sobra. */
export function diaParaSms(fecha: string): string {
  return fechaLarga(fecha).replace(/ de \d{4}$/, '');
}

/** PW-07: "{negocio}: cita confirmada el {día} a las {hora} con {profesional}. Para verla o cancelarla: {enlace}" */
export function textoConfirmacion(
  negocio: string,
  cita: { dia: string; hora: string; profesional: string },
  enlace: string,
): string {
  return `${negocio}: cita confirmada el ${cita.dia} a las ${cita.hora} con ${cita.profesional}. Para verla o cancelarla: ${enlace}`;
}

/** PW-10: "{negocio}: tu cita del {día} a las {hora} se ha cancelado. Si no fuiste tú, llama al {teléfono}." */
export function textoCancelacion(negocio: string, cita: { dia: string; hora: string }, telefono: string | null): string {
  return `${negocio}: tu cita del ${cita.dia} a las ${cita.hora} se ha cancelado. Si no fuiste tú, ${telefono ? `llama al ${telefono}` : 'llama al local'}.`;
}

export interface ResultadoConfirmacion {
  smsId: string;
  estado: 'enviado' | 'prueba' | 'fallido';
}

export async function enviarConfirmacion(
  deps: ConfirmacionDeps,
  config: BusinessConfig,
  appointmentId: string,
): Promise<ResultadoConfirmacion | null> {
  const onError = deps.onError ?? (() => {});
  let smsId: string | null = null;
  try {
    const { token, hash } = nuevoToken(BYTES_TOKEN_ENLACE);
    const enlace = `${deps.baseUrl.replace(/\/+$/, '')}/cita/${token}`;

    const preparado = await inTenant(deps.sql, config.id, async (tx) => {
      const [cita] = await tx<{ start_at: Date; end_at: Date; staff_id: string; estado: string; telefono: string }[]>`
        select a.start_at, a.end_at, a.staff_id, a.estado, c.telefono
          from public.appointments a
          join public.customers c on c.business_id = a.business_id and c.id = a.customer_id
         where a.business_id = ${config.id}::uuid and a.id = ${appointmentId}::uuid`;
      if (!cita || cita.estado !== 'confirmada') return null;
      await tx`
        insert into public.appointment_links (business_id, appointment_id, token_hash, expira_at)
        values (${config.id}::uuid, ${appointmentId}::uuid, ${hash}, ${cita.end_at})`;
      const l = utcToLocal(cita.start_at, config.timezone);
      const texto = textoConfirmacion(
        config.nombre,
        { dia: diaParaSms(l.fecha), hora: l.hora, profesional: nombreProfesional(config, cita.staff_id) },
        enlace,
      );
      const [sms] = await tx<{ id: string }[]>`
        insert into public.sms_messages (business_id, appointment_id, telefono, texto, estado, proveedor)
        values (${config.id}::uuid, ${appointmentId}::uuid, ${cita.telefono},
                ${texto.replace(enlace, ENLACE_TAPADO)}, 'pendiente', ${deps.sms.nombre})
        returning id`;
      return { smsId: sms!.id, telefono: cita.telefono, texto };
    });
    if (!preparado) return null;
    smsId = preparado.smsId;
    return await mandar(deps, config, preparado);
  } catch (e) {
    onError(e);
    return smsId ? { smsId, estado: 'fallido' } : null;
  }
}

export async function enviarCancelacion(
  deps: ConfirmacionDeps,
  config: BusinessConfig,
  appointmentId: string,
): Promise<ResultadoConfirmacion | null> {
  const onError = deps.onError ?? (() => {});
  let smsId: string | null = null;
  try {
    const preparado = await inTenant(deps.sql, config.id, async (tx) => {
      const [cita] = await tx<{ start_at: Date; estado: string; telefono: string }[]>`
        select a.start_at, a.estado, c.telefono
          from public.appointments a
          join public.customers c on c.business_id = a.business_id and c.id = a.customer_id
         where a.business_id = ${config.id}::uuid and a.id = ${appointmentId}::uuid`;
      if (!cita || cita.estado !== 'cancelada') return null;
      const l = utcToLocal(cita.start_at, config.timezone);
      const texto = textoCancelacion(config.nombre, { dia: diaParaSms(l.fecha), hora: l.hora }, config.telefonoHumano);
      const [sms] = await tx<{ id: string }[]>`
        insert into public.sms_messages (business_id, appointment_id, telefono, texto, estado, proveedor)
        values (${config.id}::uuid, ${appointmentId}::uuid, ${cita.telefono}, ${texto}, 'pendiente', ${deps.sms.nombre})
        returning id`;
      return { smsId: sms!.id, telefono: cita.telefono, texto };
    });
    if (!preparado) return null;
    smsId = preparado.smsId;
    return await mandar(deps, config, preparado);
  } catch (e) {
    onError(e);
    return smsId ? { smsId, estado: 'fallido' } : null;
  }
}

/** Envía un SMS ya guardado como `pendiente` y deja su estado final. */
async function mandar(
  deps: ConfirmacionDeps,
  config: BusinessConfig,
  preparado: { smsId: string; telefono: string; texto: string },
): Promise<ResultadoConfirmacion> {
  const onError = deps.onError ?? (() => {});
  const smsId = preparado.smsId;
  try {
    const r = await deps.sms.enviar({ telefono: preparado.telefono, texto: preparado.texto });
    await inTenant(
      deps.sql,
      config.id,
      (tx) => tx`
        update public.sms_messages
           set estado = ${r.estado}, proveedor_id = ${r.proveedorId ?? null}, enviado_at = now()
         where business_id = ${config.id}::uuid and id = ${smsId}::uuid`,
    );
    return { smsId, estado: r.estado };
  } catch (e) {
    onError(e);
    const motivo = (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 500);
    await inTenant(
      deps.sql,
      config.id,
      (tx) => tx`
        update public.sms_messages set estado = 'fallido', error = ${motivo}
         where business_id = ${config.id}::uuid and id = ${smsId}::uuid`,
    );
    return { smsId, estado: 'fallido' };
  }
}
