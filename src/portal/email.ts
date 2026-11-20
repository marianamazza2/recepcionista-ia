// =============================================================================
// Los emails del portal (Fase 9 · 9.2, PC-02, PC-15)
// =============================================================================
// Dos emails, los dos al contacto que Mariana puso en la invitación:
//
//   · el enlace de invitación, cuando ella lo genera (puede dárselo a mano,
//     pero así le llega sin copiar nada);
//   · el código de seis dígitos que confirma ese email antes de crear la
//     cuenta (PC-02). Como en PA-16, el código va TAPADO en lo que se guarda.
//
// Van por el mismo EmailProvider que la confirmación de una cita (PW-18): hoy
// el de prueba (salen en la Terminal). PC-15: antes del primer cliente real
// hay que conectar uno de verdad; eso es de Mariana y no bloquea la fase.
// =============================================================================

import type { Sql } from 'postgres';

import type { EmailProvider } from '../adapters/email/types.js';
import { mandar } from '../citas/confirmacion.js';
import { inTenant } from '../db/tenant.js';
import { CODIGO_MINUTOS, INVITACION_DIAS } from '../db/portal.js';

/** Lo que se guarda en lugar del código (como CODIGO_TAPADO de PA-16). */
export const CODIGO_TAPADO = '[código]';
/** Lo que se guarda en lugar del enlace (como ENLACE_TAPADO de PW-18). */
export const ENLACE_TAPADO = '[enlace]';

export interface EmailsPortalDeps {
  sql: Sql;
  email: EmailProvider;
  onError?: (e: unknown) => void;
}

export interface NegocioDelEmail {
  id: string;
  nombre: string;
}

export function emailInvitacion(negocio: string, enlace: string): { asunto: string; texto: string } {
  return {
    asunto: `Tu acceso al portal de ${negocio}`,
    texto: [
      'Hola:',
      '',
      `Ya puedes configurar la recepcionista de ${negocio}. Abre este enlace y te guío paso a paso:`,
      '',
      enlace,
      '',
      `El enlace vale una sola vez y caduca en ${INVITACION_DIAS} días. Al abrirlo te mandamos un código a este mismo correo para confirmar que eres tú.`,
      '',
      'Si no esperabas este correo, ignóralo.',
    ].join('\n'),
  };
}

export function emailCodigoPortal(negocio: string, codigo: string): { asunto: string; texto: string } {
  return {
    asunto: `Tu código para el portal de ${negocio}`,
    texto: [
      'Hola:',
      '',
      `Tu código para crear tu cuenta en el portal de ${negocio} es:`,
      '',
      codigo,
      '',
      `Escríbelo en la pantalla. Caduca en ${CODIGO_MINUTOS} minutos.`,
      '',
      'Si no lo has pedido tú, ignora este correo: sin el código nadie puede crear la cuenta.',
    ].join('\n'),
  };
}

/** Guarda el email (con el secreto tapado) y lo manda. Devuelve su estado. */
async function mandarDelPortal(
  deps: EmailsPortalDeps,
  negocio: NegocioDelEmail,
  para: string,
  armado: { asunto: string; texto: string },
  tapar: { secreto: string; por: string },
): Promise<'enviado' | 'prueba' | 'fallido'> {
  const [fila] = await inTenant(
    deps.sql,
    negocio.id,
    (tx) => tx<{ id: string }[]>`
      insert into public.email_messages (business_id, tipo, email, asunto, texto, estado, proveedor)
      values (${negocio.id}::uuid, 'codigo', ${para}, ${armado.asunto},
              ${armado.texto.replace(tapar.secreto, tapar.por)}, 'pendiente', ${deps.email.nombre})
      returning id`,
  );
  const r = await mandar({ sql: deps.sql, email: deps.email, ...(deps.onError ? { onError: deps.onError } : {}) }, negocio, {
    emailId: fila!.id,
    para,
    asunto: armado.asunto,
    texto: armado.texto,
  });
  return r.estado;
}

export async function enviarEmailInvitacion(
  deps: EmailsPortalDeps,
  negocio: NegocioDelEmail,
  para: string,
  enlace: string,
): Promise<'enviado' | 'prueba' | 'fallido'> {
  return mandarDelPortal(deps, negocio, para, emailInvitacion(negocio.nombre, enlace), { secreto: enlace, por: ENLACE_TAPADO });
}

export async function enviarCodigoPortal(
  deps: EmailsPortalDeps,
  negocio: NegocioDelEmail,
  para: string,
  codigo: string,
): Promise<'enviado' | 'prueba' | 'fallido'> {
  return mandarDelPortal(deps, negocio, para, emailCodigoPortal(negocio.nombre, codigo), { secreto: codigo, por: CODIGO_TAPADO });
}
