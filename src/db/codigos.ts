// =============================================================================
// Códigos de verificación por email (PA-16, 13/11/2026)
// =============================================================================
// Para ver, cancelar o mover una cita desde el chat, la clienta escribe el
// código que le llega a su email. Las reglas, en la base y aquí, no en el
// prompt:
//   · seis dígitos, válido 10 minutos, un solo uso;
//   · tres intentos: al tercero fallido el código se quema y hay que pedir otro;
//   · como mucho 3 códigos por conversación y hora (que nadie llene un buzón);
//   · en la base solo el hash SHA-256, ligado a la conversación (un código no
//     vale en otra conversación aunque alguien lo vea).
// Al acertar, conversations.verificada_at queda puesta para esa conversación.
// =============================================================================

import { createHash, randomInt } from 'node:crypto';

import type { Sql } from 'postgres';

import { inTenant } from './tenant.js';

export const CODIGO_MINUTOS = 10;
export const CODIGO_INTENTOS = 3;
export const CODIGOS_POR_HORA = 3;

/** El hash va ligado a la conversación: el mismo código en otra no coincide. */
export function hashCodigo(conversationId: string, codigo: string): string {
  return createHash('sha256').update(`${conversationId}:${codigo}`).digest('hex');
}

export function nuevoCodigo(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * Guarda un código nuevo para la conversación y anula los anteriores sin usar.
 * Devuelve null si ya se mandaron CODIGOS_POR_HORA en la última hora.
 */
export async function guardarCodigo(
  sql: Sql,
  businessId: string,
  datos: { conversationId: string; customerId: string; codigo: string; ahora: Date },
): Promise<{ expiraAt: Date } | null> {
  const expiraAt = new Date(datos.ahora.getTime() + CODIGO_MINUTOS * 60_000);
  return inTenant(sql, businessId, async (tx) => {
    const [fila] = await tx<{ n: number }[]>`
      select count(*)::int as n from public.codigos_verificacion
       where business_id = ${businessId}::uuid and conversation_id = ${datos.conversationId}::uuid
         and created_at > ${datos.ahora}::timestamptz - interval '1 hour'`;
    if ((fila?.n ?? 0) >= CODIGOS_POR_HORA) return null;
    await tx`
      update public.codigos_verificacion set usado_at = ${datos.ahora}
       where business_id = ${businessId}::uuid and conversation_id = ${datos.conversationId}::uuid and usado_at is null`;
    await tx`
      insert into public.codigos_verificacion (business_id, conversation_id, customer_id, codigo_hash, expira_at, created_at)
      values (${businessId}::uuid, ${datos.conversationId}::uuid, ${datos.customerId}::uuid,
              ${hashCodigo(datos.conversationId, datos.codigo)}, ${expiraAt}, ${datos.ahora})`;
    return { expiraAt };
  });
}

export type ResultadoCodigo = 'correcto' | 'incorrecto' | 'agotado' | 'caducado' | 'sin_codigo';

/**
 * Comprueba el código contra el último sin usar de la conversación. Al
 * acertar lo gasta y marca la conversación como verificada. `quedan` son los
 * intentos que le quedan tras un fallo.
 */
export async function comprobarCodigo(
  sql: Sql,
  businessId: string,
  datos: { conversationId: string; codigo: string; ahora: Date },
): Promise<{ resultado: ResultadoCodigo; quedan?: number }> {
  return inTenant(sql, businessId, async (tx) => {
    // FOR UPDATE: dos intentos a la vez no pueden pasar del límite.
    const [c] = await tx<{ id: string; codigo_hash: string; expira_at: Date; intentos: number }[]>`
      select id, codigo_hash, expira_at, intentos from public.codigos_verificacion
       where business_id = ${businessId}::uuid and conversation_id = ${datos.conversationId}::uuid and usado_at is null
       order by created_at desc
       limit 1
       for update`;
    if (!c) return { resultado: 'sin_codigo' };
    if (c.expira_at.getTime() <= datos.ahora.getTime()) {
      await tx`update public.codigos_verificacion set usado_at = ${datos.ahora} where id = ${c.id}::uuid`;
      return { resultado: 'caducado' };
    }
    if (c.codigo_hash === hashCodigo(datos.conversationId, datos.codigo.trim())) {
      await tx`update public.codigos_verificacion set usado_at = ${datos.ahora} where id = ${c.id}::uuid`;
      await tx`
        update public.conversations set verificada_at = ${datos.ahora}
         where business_id = ${businessId}::uuid and id = ${datos.conversationId}::uuid`;
      return { resultado: 'correcto' };
    }
    const intentos = c.intentos + 1;
    await tx`
      update public.codigos_verificacion
         set intentos = ${intentos}, usado_at = ${intentos >= CODIGO_INTENTOS ? datos.ahora : null}
       where id = ${c.id}::uuid`;
    return intentos >= CODIGO_INTENTOS ? { resultado: 'agotado' } : { resultado: 'incorrecto', quedan: CODIGO_INTENTOS - intentos };
  });
}
