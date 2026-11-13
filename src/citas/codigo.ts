// =============================================================================
// El email con el código de verificación (PA-16, 13/11/2026)
// =============================================================================
// El núcleo genera el código y guarda su hash (enviar_codigo); el canal lo
// manda con el proveedor de email que tenga. Aquí se arma el email, se guarda
// en email_messages con el código TAPADO ("[código]") y se envía. Si el envío
// falla, lanza: enviar_codigo devuelve el error y el agente da el teléfono.
// =============================================================================

import type { Sql } from 'postgres';

import type { EmailProvider } from '../adapters/email/types.js';
import { loadBusinessConfig } from '../config/business.js';
import type { EnviarCodigo } from '../core/tools/types.js';
import { CODIGO_MINUTOS } from '../db/codigos.js';
import { inTenant } from '../db/tenant.js';
import { mandar } from './confirmacion.js';

export const CODIGO_TAPADO = '[código]';

export function emailCodigo(negocio: string, nombre: string | null, codigo: string): { asunto: string; texto: string } {
  return {
    asunto: `Tu código para ${negocio}`,
    texto: [
      nombre ? `Hola, ${nombre}:` : 'Hola:',
      '',
      `Tu código para gestionar tus citas en ${negocio} es:`,
      '',
      codigo,
      '',
      `Escríbelo en el chat. Caduca en ${CODIGO_MINUTOS} minutos.`,
      '',
      'Si no lo has pedido tú, ignora este correo: sin el código nadie puede ver ni cambiar tus citas.',
    ].join('\n'),
  };
}

export function enviadorDeCodigos(deps: { sql: Sql; email: EmailProvider; onError?: (e: unknown) => void }): EnviarCodigo {
  return async ({ businessId, customerId, email, nombre, codigo }) => {
    const config = await loadBusinessConfig(deps.sql, { id: businessId });
    const { asunto, texto } = emailCodigo(config.nombre, nombre, codigo);
    const [fila] = await inTenant(
      deps.sql,
      businessId,
      (tx) => tx<{ id: string }[]>`
        insert into public.email_messages (business_id, customer_id, tipo, email, asunto, texto, estado, proveedor)
        values (${businessId}::uuid, ${customerId}::uuid, 'codigo', ${email}, ${asunto},
                ${texto.replace(codigo, CODIGO_TAPADO)}, 'pendiente', ${deps.email.nombre})
        returning id`,
    );
    const r = await mandar({ sql: deps.sql, email: deps.email, ...(deps.onError ? { onError: deps.onError } : {}) }, config, {
      emailId: fila!.id,
      para: email,
      asunto,
      texto,
    });
    if (r.estado === 'fallido') throw new Error('No se pudo mandar el email con el código');
  };
}
