// =============================================================================
// Adjuntos del chat del portal: imágenes y PDF (Fase 9b · PC-21)
// =============================================================================
// Lo que el negocio sube con el «+» del chat. Se guarda en portal.adjuntos
// (migración …20261122120000) con su negocio y, al mandarse con un mensaje,
// su conversación. Reglas que se cumplen aquí y no en el prompt:
//
//   · El TIPO se mira en los bytes, no en lo que diga el navegador: solo JPEG,
//     PNG, WebP, GIF y PDF (PC-21). Un .exe renombrado a .jpg no entra.
//   · Tamaño: hasta 4 MB (el máximo de una petición en Vercel es 4,5 MB; las
//     fotos se achican en el navegador antes de subir).
//   · Siempre filtrado por business_id (§1 del AGENTS.md raíz): un adjunto de
//     otro negocio no existe, ni para leerlo ni para mandarlo.
//   · Un adjunto solo se manda una vez: al mandarse queda ligado a su
//     conversación y ya no se puede «reutilizar» en otra.
//   · Fase 5 (PB-06): cuando el negocio guarda un adjunto como documento
//     desde el chat, el archivo sale de la conversación: se le quitan los
//     bytes y queda el título del documento (marcarAdjuntoGuardado). Así la
//     IA no lo vuelve a leer en cada mensaje de ese chat.
// =============================================================================

import type { Sql } from 'postgres';

import { inTenant } from './tenant.js';

export type TipoAdjunto = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | 'application/pdf';

/** PC-21: el máximo de un archivo (cabe en una petición de Vercel, 4,5 MB). */
export const MAX_BYTES_ADJUNTO = 4 * 1024 * 1024;
/** PC-21: archivos por mensaje. */
export const MAX_ADJUNTOS_POR_MENSAJE = 5;

export interface AdjuntoResumido {
  id: string;
  nombre: string;
  tipo: TipoAdjunto;
  bytes: number;
}

export interface Adjunto extends AdjuntoResumido {
  datos: Buffer;
  /** Fase 5 (PB-06): si se guardó como documento, con qué título. Desde entonces ya no tiene bytes. */
  documentoTitulo: string | null;
}

/** El tipo de verdad, mirando los primeros bytes. null si no es uno de los admitidos. */
export function tipoPorContenido(b: Uint8Array): TipoAdjunto | null {
  const empieza = (...xs: number[]) => xs.every((x, i) => b[i] === x);
  if (b.length >= 3 && empieza(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (b.length >= 8 && empieza(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (b.length >= 6 && empieza(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (b.length >= 12 && empieza(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  if (b.length >= 5 && empieza(0x25, 0x50, 0x44, 0x46, 0x2d)) return 'application/pdf';
  return null;
}

/** Un nombre de archivo presentable: sin rutas ni caracteres de control, hasta 200. */
export function limpiarNombre(n: string): string {
  const base = n.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const limpio = base.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  return (limpio || 'archivo').slice(0, 200);
}

export async function guardarAdjunto(sql: Sql, businessId: string, a: { nombre: string; tipo: TipoAdjunto; datos: Buffer }): Promise<AdjuntoResumido> {
  const [r] = await inTenant(
    sql,
    businessId,
    (tx) => tx<{ id: string }[]>`
      insert into portal.adjuntos (business_id, nombre, tipo, bytes, datos)
      values (${businessId}::uuid, ${limpiarNombre(a.nombre)}, ${a.tipo}, ${a.datos.length}, ${a.datos})
      returning id`,
  );
  return { id: r!.id, nombre: limpiarNombre(a.nombre), tipo: a.tipo, bytes: a.datos.length };
}

/**
 * Liga a la conversación los adjuntos que se mandan con un mensaje. Solo los
 * de este negocio que todavía no se mandaron; si alguno no está, no se liga
 * ninguno y devuelve null (el mensaje no sale con adjuntos a medias).
 */
export async function ligarAdjuntos(sql: Sql, businessId: string, conversationId: string, ids: string[]): Promise<AdjuntoResumido[] | null> {
  if (ids.length === 0) return [];
  return inTenant(sql, businessId, async (tx) => {
    const filas = await tx<AdjuntoResumido[]>`
      update portal.adjuntos
         set conversation_id = ${conversationId}::uuid
       where business_id = ${businessId}::uuid
         and id = any(${ids}::uuid[])
         and conversation_id is null
      returning id, nombre, tipo, bytes`;
    if (filas.length !== new Set(ids).size) {
      // Alguno no era de este negocio, no existía o ya se había mandado: nada.
      await tx`update portal.adjuntos set conversation_id = null
                where business_id = ${businessId}::uuid and id = any(${filas.map((f) => f.id)}::uuid[])`;
      return null;
    }
    // En el orden en que se mandaron.
    return ids.map((id) => filas.find((f) => f.id === id)!);
  });
}

/** Los adjuntos con sus bytes (para mandárselos al modelo). Solo de este negocio. */
export async function leerAdjuntos(sql: Sql, businessId: string, ids: string[]): Promise<Adjunto[]> {
  if (ids.length === 0) return [];
  return inTenant(
    sql,
    businessId,
    (tx) => tx<Adjunto[]>`
      select id, nombre, tipo, bytes, datos, documento_titulo as "documentoTitulo" from portal.adjuntos
       where business_id = ${businessId}::uuid and id = any(${ids}::uuid[])`,
  );
}

/** Uno, para enseñarlo en el chat. Solo si ya se mandó o lo subió este negocio. */
export async function leerAdjunto(sql: Sql, businessId: string, id: string): Promise<Adjunto | null> {
  const [a] = await leerAdjuntos(sql, businessId, [id]);
  return a ?? null;
}

/**
 * Fase 5 (PB-03): el adjunto que el negocio nombra en el chat del portal, por
 * su nombre de archivo, entre los que ya mandó en esa conversación (o en las
 * de su cadena). Sin tildes ni mayúsculas; si hay varios iguales, el último.
 * Null si no hay ninguno claro.
 */
export async function adjuntoDelChat(sql: Sql, businessId: string, conversationIds: string[], nombre: string): Promise<Adjunto | null> {
  if (conversationIds.length === 0) return null;
  const filas = await inTenant(
    sql,
    businessId,
    (tx) => tx<Adjunto[]>`
      select id, nombre, tipo, bytes, datos, documento_titulo as "documentoTitulo" from portal.adjuntos
       where business_id = ${businessId}::uuid and conversation_id = any(${conversationIds}::uuid[])
       order by created_at desc, id`,
  );
  const limpio = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const n = limpio(nombre);
  if (!n) return filas.length === 1 ? filas[0]! : null;
  return filas.find((a) => limpio(a.nombre) === n) ?? filas.find((a) => limpio(a.nombre).includes(n) || n.includes(limpio(a.nombre).replace(/\.[a-z0-9]+$/, ''))) ?? null;
}

/** PB-06: guardado como documento: el archivo sale del chat (sin bytes) y queda su título. */
export async function marcarAdjuntoGuardado(sql: Sql, businessId: string, id: string, titulo: string, ahora: Date = new Date()): Promise<void> {
  await inTenant(
    sql,
    businessId,
    (tx) => tx`
      update portal.adjuntos
         set datos = ''::bytea, documento_titulo = ${titulo.slice(0, 200)}, guardado_at = ${ahora}
       where business_id = ${businessId}::uuid and id = ${id}::uuid and guardado_at is null`,
  );
}
