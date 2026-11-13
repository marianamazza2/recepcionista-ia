// =============================================================================
// Emails de una cita: confirmación y cancelación (PW-18, PW-09, PW-10)
// =============================================================================
// Desde el 13/11/2026 (PW-18) la confirmación va por EMAIL; el SMS queda
// apagado hasta los recordatorios (Fase 6). Antes era un SMS (Fase 3 · 3.5).
//
// Al quedar confirmada una cita nueva (o la nueva hora de una cita movida,
// PW-09), si la clienta tiene email:
//   1. se crea el enlace a su página (/cita/:token), que caduca al terminar la
//      cita; en la base solo queda el hash del token;
//   2. se arma el email: día, hora, profesional, dirección, enlace, la
//      política de cancelación tal como la escribió el negocio (PR-07) y un
//      archivo .ics para añadirla al calendario. Sin el tratamiento: puede ser
//      un dato de salud (§6 del AGENTS.md; ⚠️ por confirmar con Mariana);
//   3. se guarda como `pendiente` con el enlace tapado, se "envía" con el
//      proveedor y queda `prueba`/`enviado`, o `fallido`.
//
// Al cancelarse una cita por el chat o desde el panel (PW-10): un email corto
// sin enlace, para que se entere aunque no haya sido ella. Desde la página del
// enlace no se manda: ya lo está viendo.
//
// Sin email (PA-17: reservó solo con teléfono) no se manda nada.
//
// Nunca lanza: si algo falla, la reserva sigue valiendo y el email queda
// `fallido` (o no se llega a crear) para reintentar; el error va al log.
// =============================================================================

import type { Sql, TransactionSql } from 'postgres';

import type { EmailProvider } from '../adapters/email/types.js';
import type { BusinessConfig } from '../config/business.js';
import { telefonoLegible } from '../core/phone.js';
import { fechaLarga, utcToLocal } from '../core/time.js';
import { nombreProfesional } from '../core/tools/common.js';
import { inTenant } from '../db/tenant.js';
import { nuevoToken } from '../db/widget.js';
import { archivoIcs } from './ics.js';

/** Lo que el email dice en lugar del enlace al guardarlo: el token no se guarda. */
export const ENLACE_TAPADO = '[enlace]';

/** 16 bytes = 128 bits: imposible de adivinar y un enlace corto. */
const BYTES_TOKEN_ENLACE = 16;

export interface ConfirmacionDeps {
  sql: Sql;
  email: EmailProvider;
  /** URL pública del servidor, sin barra final (ej. https://…); el enlace es {baseUrl}/cita/{token}. */
  baseUrl: string;
  onError?: (e: unknown) => void;
}

/** "lunes 19 de octubre": en un aviso el año sobra. */
export function diaCorto(fecha: string): string {
  return fechaLarga(fecha).replace(/ de \d{4}$/, '');
}

export interface DatosCita {
  nombre: string | null;
  dia: string;
  hora: string;
  profesional: string;
}

/** PW-18: asunto y cuerpo de la confirmación. */
export function emailConfirmacion(
  config: Pick<BusinessConfig, 'nombre' | 'direccion' | 'politicaCancelacion' | 'telefonoHumano'>,
  cita: DatosCita,
  enlace: string,
): { asunto: string; texto: string } {
  const lineas = [
    cita.nombre ? `Hola, ${cita.nombre}:` : 'Hola:',
    '',
    `Tu cita en ${config.nombre} está confirmada.`,
    '',
    `Día: ${cita.dia}`,
    `Hora: ${cita.hora}`,
    `Con: ${cita.profesional}`,
    ...(config.direccion ? [`Dirección: ${config.direccion}`] : []),
    '',
    `Para verla, cambiarla o cancelarla: ${enlace}`,
  ];
  if (config.politicaCancelacion) lineas.push('', `Política de cancelación: ${config.politicaCancelacion}`);
  if (config.telefonoHumano) lineas.push('', `Si lo prefieres, llámanos al ${telefonoLegible(config.telefonoHumano)}.`);
  lineas.push('', 'Te adjuntamos la cita para que la añadas a tu calendario.');
  return { asunto: `Tu cita en ${config.nombre}: ${cita.dia} a las ${cita.hora}`, texto: lineas.join('\n') };
}

/** PW-10: el aviso de cancelación, sin enlace. */
export function emailCancelacion(
  config: Pick<BusinessConfig, 'nombre' | 'telefonoHumano'>,
  cita: { nombre: string | null; dia: string; hora: string },
): { asunto: string; texto: string } {
  const llama = config.telefonoHumano ? `llámanos al ${telefonoLegible(config.telefonoHumano)}` : 'llama al local';
  return {
    asunto: `Cita cancelada en ${config.nombre}`,
    texto: [
      cita.nombre ? `Hola, ${cita.nombre}:` : 'Hola:',
      '',
      `Tu cita en ${config.nombre} del ${cita.dia} a las ${cita.hora} se ha cancelado.`,
      '',
      `Si no has sido tú, ${llama}.`,
    ].join('\n'),
  };
}

export interface ResultadoConfirmacion {
  emailId: string;
  estado: 'enviado' | 'prueba' | 'fallido';
}

interface CitaParaEmail {
  start_at: Date;
  end_at: Date;
  staff_id: string;
  estado: string;
  customer_id: string;
  email: string | null;
  nombre: string | null;
}

async function leerCita(tx: TransactionSql, businessId: string, appointmentId: string): Promise<CitaParaEmail | null> {
  const [cita] = await tx<CitaParaEmail[]>`
    select a.start_at, a.end_at, a.staff_id, a.estado, c.id as customer_id, c.email, c.nombre
      from public.appointments a
      join public.customers c on c.business_id = a.business_id and c.id = a.customer_id
     where a.business_id = ${businessId}::uuid and a.id = ${appointmentId}::uuid`;
  return cita ?? null;
}

export interface Preparado {
  emailId: string;
  para: string;
  asunto: string;
  texto: string;
  adjuntos?: { nombre: string; tipo: string; contenido: string }[];
}

export async function enviarConfirmacion(
  deps: ConfirmacionDeps,
  config: BusinessConfig,
  appointmentId: string,
): Promise<ResultadoConfirmacion | null> {
  const onError = deps.onError ?? (() => {});
  let emailId: string | null = null;
  try {
    const { token, hash } = nuevoToken(BYTES_TOKEN_ENLACE);
    const enlace = `${deps.baseUrl.replace(/\/+$/, '')}/cita/${token}`;

    const preparado = await inTenant(deps.sql, config.id, async (tx): Promise<Preparado | null> => {
      const cita = await leerCita(tx, config.id, appointmentId);
      if (!cita || cita.estado !== 'confirmada' || !cita.email) return null;
      await tx`
        insert into public.appointment_links (business_id, appointment_id, token_hash, expira_at)
        values (${config.id}::uuid, ${appointmentId}::uuid, ${hash}, ${cita.end_at})`;
      const l = utcToLocal(cita.start_at, config.timezone);
      const profesional = nombreProfesional(config, cita.staff_id);
      const { asunto, texto } = emailConfirmacion(config, { nombre: cita.nombre, dia: diaCorto(l.fecha), hora: l.hora, profesional }, enlace);
      const ics = archivoIcs({
        uid: `${appointmentId}@recepcionista`,
        inicio: cita.start_at,
        fin: cita.end_at,
        resumen: `Cita en ${config.nombre}`,
        descripcion: `Con ${profesional}. Para verla, cambiarla o cancelarla: ${enlace}`,
        lugar: config.direccion,
      });
      const [fila] = await tx<{ id: string }[]>`
        insert into public.email_messages (business_id, appointment_id, customer_id, tipo, email, asunto, texto, estado, proveedor)
        values (${config.id}::uuid, ${appointmentId}::uuid, ${cita.customer_id}::uuid, 'confirmacion', ${cita.email}, ${asunto},
                ${texto.replace(enlace, ENLACE_TAPADO)}, 'pendiente', ${deps.email.nombre})
        returning id`;
      return { emailId: fila!.id, para: cita.email, asunto, texto, adjuntos: [{ nombre: 'cita.ics', tipo: 'text/calendar', contenido: ics }] };
    });
    if (!preparado) return null;
    emailId = preparado.emailId;
    return await mandar(deps, config, preparado);
  } catch (e) {
    onError(e);
    return emailId ? { emailId, estado: 'fallido' } : null;
  }
}

export async function enviarCancelacion(
  deps: ConfirmacionDeps,
  config: BusinessConfig,
  appointmentId: string,
): Promise<ResultadoConfirmacion | null> {
  const onError = deps.onError ?? (() => {});
  let emailId: string | null = null;
  try {
    const preparado = await inTenant(deps.sql, config.id, async (tx): Promise<Preparado | null> => {
      const cita = await leerCita(tx, config.id, appointmentId);
      if (!cita || cita.estado !== 'cancelada' || !cita.email) return null;
      const l = utcToLocal(cita.start_at, config.timezone);
      const { asunto, texto } = emailCancelacion(config, { nombre: cita.nombre, dia: diaCorto(l.fecha), hora: l.hora });
      const [fila] = await tx<{ id: string }[]>`
        insert into public.email_messages (business_id, appointment_id, customer_id, tipo, email, asunto, texto, estado, proveedor)
        values (${config.id}::uuid, ${appointmentId}::uuid, ${cita.customer_id}::uuid, 'cancelacion', ${cita.email}, ${asunto},
                ${texto}, 'pendiente', ${deps.email.nombre})
        returning id`;
      return { emailId: fila!.id, para: cita.email, asunto, texto };
    });
    if (!preparado) return null;
    emailId = preparado.emailId;
    return await mandar(deps, config, preparado);
  } catch (e) {
    onError(e);
    return emailId ? { emailId, estado: 'fallido' } : null;
  }
}

/** Envía un email ya guardado como `pendiente` y deja su estado final. */
export async function mandar(
  deps: Pick<ConfirmacionDeps, 'sql' | 'email' | 'onError'>,
  config: BusinessConfig,
  preparado: Preparado,
): Promise<ResultadoConfirmacion> {
  const onError = deps.onError ?? (() => {});
  const emailId = preparado.emailId;
  try {
    const r = await deps.email.enviar({
      para: preparado.para,
      remitente: config.nombre,
      asunto: preparado.asunto,
      texto: preparado.texto,
      ...(preparado.adjuntos ? { adjuntos: preparado.adjuntos } : {}),
    });
    await inTenant(
      deps.sql,
      config.id,
      (tx) => tx`
        update public.email_messages
           set estado = ${r.estado}, proveedor_id = ${r.proveedorId ?? null}, enviado_at = now()
         where business_id = ${config.id}::uuid and id = ${emailId}::uuid`,
    );
    return { emailId, estado: r.estado };
  } catch (e) {
    onError(e);
    const motivo = (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 500);
    await inTenant(
      deps.sql,
      config.id,
      (tx) => tx`
        update public.email_messages set estado = 'fallido', error = ${motivo}
         where business_id = ${config.id}::uuid and id = ${emailId}::uuid`,
    );
    return { emailId, estado: 'fallido' };
  }
}
