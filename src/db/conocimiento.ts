// =============================================================================
// Los documentos del negocio y sus trozos (Fase 5 · 5.1 y 5.2)
// =============================================================================
// Solo lectura y escritura: qué se guarda y cómo lo decide src/conocimiento/.
//
//   · Toda función recibe el businessId y trabaja en inTenant, filtrando
//     además por business_id (T-03): un negocio no ve, ni toca, ni encuentra
//     un documento de otro (PB-03, criterio 9 del spec).
//   · Un documento, sus trozos y sus valores se guardan o se reemplazan en UNA
//     transacción: nunca queda un documento a medias (plan de pruebas, 53).
//   · Los límites de PB-06 los pone la base (RA011, trigger
//     app.limite_documentos); aquí solo se cuentan para avisar antes de gastar.
//   · Las preguntas frecuentes (PI-08) viven en la misma tabla con tipo 'faq'
//     y NO son documentos: todo lo de aquí las excluye.
//   · PB-04/D-97: del archivo solo se guarda su texto (`contenido_raw`).
// =============================================================================

import type { JSONValue, Sql, TransactionSql } from 'postgres';

import { inTenant } from './tenant.js';

export type TipoDocumento = 'pdf' | 'imagen' | 'texto';
export type OrigenDocumento = 'portal' | 'panel' | 'chat';
export type EstadoDocumento = 'borrador' | 'activo';
export type TipoValor = 'precio' | 'duracion' | 'horario' | 'direccion' | 'telefono';

export interface TramoDoc {
  desde: string; // 'HH:MM'
  hasta: string; // 'HH:MM'
}

/** El valor que da el documento, ya entendido. */
export type ValorDoc = { euros: number } | { minutos: number } | { tramos: TramoDoc[] } | { texto: string };

export interface ValorNuevo {
  tipo: TipoValor;
  serviceId: string | null;
  etiqueta: string;
  dias: number[];
  valor: ValorDoc;
  fragmento: string;
  textoValor: string;
  estado: 'pendiente' | 'aceptado';
}

export interface ValorGuardado extends ValorNuevo {
  id: string;
  docId: string;
}

export interface TrozoNuevo {
  orden: number;
  titulos: string;
  contenido: string;
  palabras: string;
}

/** Lo que hace falta para guardar (o reemplazar) un documento ya leído. */
export interface DocumentoNuevo {
  tipo: TipoDocumento;
  titulo: string;
  resumen: string;
  origen: OrigenDocumento;
  estado: EstadoDocumento;
  paginas: number;
  bytes: number | null;
  nombreArchivo: string | null;
  paginasIlegibles: number[];
  sinServicio: string[];
  contenido: string;
  trozos: TrozoNuevo[];
  valores: ValorNuevo[];
}

export interface DocumentoResumido {
  id: string;
  tipo: TipoDocumento;
  titulo: string;
  resumen: string | null;
  origen: OrigenDocumento;
  estado: EstadoDocumento;
  paginas: number;
  bytes: number | null;
  nombreArchivo: string | null;
  paginasIlegibles: number[];
  sinServicio: string[];
  creado: Date;
  reemplazado: Date | null;
}

export interface TrozoEncontrado {
  chunkId: string;
  docId: string;
  documento: string;
  titulos: string;
  contenido: string;
  rango: number;
}

interface FilaDocumento {
  id: string;
  tipo: TipoDocumento;
  titulo: string;
  resumen: string | null;
  origen: OrigenDocumento;
  estado: EstadoDocumento;
  paginas: number;
  bytes: number | null;
  nombre_archivo: string | null;
  paginas_ilegibles: number[];
  sin_servicio: string[];
  created_at: Date;
  reemplazado_at: Date | null;
}

interface FilaValor {
  id: string;
  doc_id: string;
  tipo: TipoValor;
  service_id: string | null;
  etiqueta: string;
  dias: number[];
  valor: ValorDoc;
  fragmento: string;
  texto_valor: string;
  estado: 'pendiente' | 'aceptado';
}

function documento(f: FilaDocumento): DocumentoResumido {
  return {
    id: f.id,
    tipo: f.tipo,
    titulo: f.titulo,
    resumen: f.resumen,
    origen: f.origen,
    estado: f.estado,
    paginas: f.paginas,
    bytes: f.bytes,
    nombreArchivo: f.nombre_archivo,
    paginasIlegibles: f.paginas_ilegibles,
    sinServicio: f.sin_servicio,
    creado: f.created_at,
    reemplazado: f.reemplazado_at,
  };
}

function valor(f: FilaValor): ValorGuardado {
  return {
    id: f.id,
    docId: f.doc_id,
    tipo: f.tipo,
    serviceId: f.service_id,
    etiqueta: f.etiqueta,
    dias: f.dias,
    valor: f.valor,
    fragmento: f.fragmento,
    textoValor: f.texto_valor,
    estado: f.estado,
  };
}

// -----------------------------------------------------------------------------
// Lectura
// -----------------------------------------------------------------------------

/** PB-06: lo que ya ocupa el negocio (solo documentos activos). */
export async function contarDocumentos(sql: Sql, businessId: string): Promise<{ documentos: number; paginas: number }> {
  const [r] = await inTenant(
    sql,
    businessId,
    (tx) => tx<{ n: number; paginas: number }[]>`
      select count(*)::int as n, coalesce(sum(paginas), 0)::int as paginas
        from public.knowledge_docs
       where business_id = ${businessId}::uuid and tipo <> 'faq' and estado = 'activo'`,
  );
  return { documentos: r!.n, paginas: r!.paginas };
}

/** Los documentos del negocio (sin su texto), los más nuevos primero. Sin borradores salvo que se pidan. */
export async function listarDocumentos(sql: Sql, businessId: string, p: { borradores?: boolean } = {}): Promise<DocumentoResumido[]> {
  const filas = await inTenant(
    sql,
    businessId,
    (tx) => tx<FilaDocumento[]>`
      select id, tipo, titulo, resumen, origen, estado, paginas, bytes, nombre_archivo,
             paginas_ilegibles, sin_servicio, created_at, reemplazado_at
        from public.knowledge_docs
       where business_id = ${businessId}::uuid and tipo <> 'faq'
         and (estado = 'activo' or ${p.borradores ?? false})
       order by created_at desc, id`,
  );
  return filas.map(documento);
}

export async function leerDocumento(sql: Sql, businessId: string, docId: string): Promise<(DocumentoResumido & { contenido: string }) | null> {
  const [f] = await inTenant(
    sql,
    businessId,
    (tx) => tx<(FilaDocumento & { contenido_raw: string })[]>`
      select id, tipo, titulo, resumen, origen, estado, paginas, bytes, nombre_archivo,
             paginas_ilegibles, sin_servicio, created_at, reemplazado_at, contenido_raw
        from public.knowledge_docs
       where business_id = ${businessId}::uuid and id = ${docId}::uuid and tipo <> 'faq'`,
  );
  return f ? { ...documento(f), contenido: f.contenido_raw } : null;
}

/** Los valores de esos documentos (de todos si no se pasan), en un orden estable. */
export async function valoresDe(sql: Sql, businessId: string, docIds?: string[]): Promise<ValorGuardado[]> {
  const filas = await inTenant(
    sql,
    businessId,
    (tx) => tx<FilaValor[]>`
      select id, doc_id, tipo, service_id, etiqueta, dias, valor, fragmento, texto_valor, estado
        from public.knowledge_valores
       where business_id = ${businessId}::uuid
         and (${docIds === undefined} or doc_id = any(${docIds ?? []}::uuid[]))
       order by doc_id, created_at, id`,
  );
  return filas.map(valor);
}

/** Los trozos de un documento, en orden (para corregir un valor que no se encontró literal). */
export async function trozosDe(sql: Sql, businessId: string, docId: string): Promise<{ id: string; orden: number; contenido: string }[]> {
  return inTenant(
    sql,
    businessId,
    (tx) => tx<{ id: string; orden: number; contenido: string }[]>`
      select id, orden, contenido from public.knowledge_chunks
       where business_id = ${businessId}::uuid and doc_id = ${docId}::uuid
       order by orden, id`,
  );
}

/** PB-09: los mejores trozos para una consulta. La búsqueda la hace la base (app.buscar_conocimiento). */
export async function buscarTrozos(sql: Sql, businessId: string, consulta: string, limite = 5): Promise<TrozoEncontrado[]> {
  const filas = await inTenant(
    sql,
    businessId,
    (tx) => tx<{ chunk_id: string; doc_id: string; documento: string; titulos: string; contenido: string; rango: number }[]>`
      select chunk_id, doc_id, documento, titulos, contenido, rango
        from app.buscar_conocimiento(${businessId}::uuid, ${consulta}, ${limite})`,
  );
  return filas.map((f) => ({ chunkId: f.chunk_id, docId: f.doc_id, documento: f.documento, titulos: f.titulos, contenido: f.contenido, rango: Number(f.rango) }));
}

// -----------------------------------------------------------------------------
// Escritura
// -----------------------------------------------------------------------------

async function insertarContenido(tx: TransactionSql, businessId: string, docId: string, d: DocumentoNuevo): Promise<void> {
  for (const t of d.trozos) {
    await tx`
      insert into public.knowledge_chunks (business_id, doc_id, orden, titulos, contenido, palabras)
      values (${businessId}::uuid, ${docId}::uuid, ${t.orden}, ${t.titulos}, ${t.contenido}, ${t.palabras})`;
  }
  for (const v of d.valores) {
    await tx`
      insert into public.knowledge_valores (business_id, doc_id, tipo, service_id, etiqueta, dias, valor, fragmento, texto_valor, estado)
      values (${businessId}::uuid, ${docId}::uuid, ${v.tipo}, ${v.serviceId}::uuid, ${v.etiqueta}, ${v.dias}::int[],
              ${tx.json(v.valor as unknown as JSONValue)}, ${v.fragmento}, ${v.textoValor}, ${v.estado})`;
  }
}

/** Guarda un documento nuevo con sus trozos y sus valores. Lanza RA011 si se pasa de PB-06. */
export async function crearDocumento(sql: Sql, businessId: string, d: DocumentoNuevo): Promise<string> {
  return inTenant(sql, businessId, async (tx) => {
    const [r] = await tx<{ id: string }[]>`
      insert into public.knowledge_docs
        (business_id, tipo, titulo, resumen, origen, estado, paginas, bytes, nombre_archivo, paginas_ilegibles, sin_servicio, contenido_raw)
      values (${businessId}::uuid, ${d.tipo}, ${d.titulo}, ${d.resumen}, ${d.origen}, ${d.estado}, ${d.paginas}, ${d.bytes},
              ${d.nombreArchivo}, ${d.paginasIlegibles}::int[], ${d.sinServicio}::text[], ${d.contenido})
      returning id`;
    await insertarContenido(tx, businessId, r!.id, d);
    return r!.id;
  });
}

/**
 * PB-03: reemplaza el contenido de un documento por la versión nueva: texto,
 * trozos y valores. Se quedan el id, el título (el negocio puede haberlo
 * cambiado) y de dónde vino. False si no existe en este negocio.
 */
export async function reemplazarDocumento(sql: Sql, businessId: string, docId: string, d: DocumentoNuevo): Promise<boolean> {
  return inTenant(sql, businessId, async (tx) => {
    const filas = await tx`
      update public.knowledge_docs
         set tipo = ${d.tipo}, resumen = ${d.resumen}, paginas = ${d.paginas}, bytes = ${d.bytes},
             nombre_archivo = ${d.nombreArchivo}, paginas_ilegibles = ${d.paginasIlegibles}::int[],
             sin_servicio = ${d.sinServicio}::text[], contenido_raw = ${d.contenido},
             reemplazado_at = now(), updated_at = now()
       where business_id = ${businessId}::uuid and id = ${docId}::uuid and tipo <> 'faq' and estado = 'activo'
      returning id`;
    if (filas.length === 0) return false;
    await tx`delete from public.knowledge_chunks where business_id = ${businessId}::uuid and doc_id = ${docId}::uuid`;
    await tx`delete from public.knowledge_valores where business_id = ${businessId}::uuid and doc_id = ${docId}::uuid`;
    await insertarContenido(tx, businessId, docId, d);
    return true;
  });
}

/** PC-03: el negocio dijo que sí en el chat: el borrador pasa a documento (y cuenta para PB-06). */
export async function publicarBorrador(sql: Sql, businessId: string, docId: string, titulo?: string): Promise<DocumentoResumido | null> {
  const [f] = await inTenant(
    sql,
    businessId,
    (tx) => tx<FilaDocumento[]>`
      update public.knowledge_docs
         set estado = 'activo', titulo = coalesce(${titulo ?? null}, titulo), created_at = now(), updated_at = now()
       where business_id = ${businessId}::uuid and id = ${docId}::uuid and tipo <> 'faq' and estado = 'borrador'
      returning id, tipo, titulo, resumen, origen, estado, paginas, bytes, nombre_archivo,
                paginas_ilegibles, sin_servicio, created_at, reemplazado_at`,
  );
  return f ? documento(f) : null;
}

/** Los borradores que nadie confirmó en un día se tiran (el chat los vuelve a leer si hace falta). */
export async function borrarBorradoresViejos(sql: Sql, businessId: string): Promise<void> {
  await inTenant(
    sql,
    businessId,
    (tx) => tx`
      delete from public.knowledge_docs
       where business_id = ${businessId}::uuid and estado = 'borrador' and created_at < now() - interval '1 day'`,
  );
}

export async function renombrarDocumento(sql: Sql, businessId: string, docId: string, titulo: string): Promise<boolean> {
  const filas = await inTenant(
    sql,
    businessId,
    (tx) => tx`
      update public.knowledge_docs
         set titulo = ${titulo}, updated_at = now()
       where business_id = ${businessId}::uuid and id = ${docId}::uuid and tipo <> 'faq'
      returning id`,
  );
  return filas.length > 0;
}

/** PB-03: borrar cambia lo que sabe el agente al momento (los trozos se van en cascada). */
export async function borrarDocumento(sql: Sql, businessId: string, docId: string): Promise<boolean> {
  const filas = await inTenant(
    sql,
    businessId,
    (tx) => tx`
      delete from public.knowledge_docs
       where business_id = ${businessId}::uuid and id = ${docId}::uuid and tipo <> 'faq'
      returning id`,
  );
  return filas.length > 0;
}

/**
 * PB-01: corrige el texto del documento para que diga lo de la configuración y
 * deja el valor como aceptado. `reemplazo` cambia un trozo de texto literal (en
 * el documento y en todos sus trozos); `nota` se añade al final del documento
 * y a los trozos indicados cuando el valor no se encontró tal cual.
 */
export async function corregirValor(
  sql: Sql,
  businessId: string,
  v: { id: string; docId: string },
  c: {
    valor: ValorDoc;
    fragmento: string;
    textoValor: string;
    reemplazo: { de: string; a: string } | null;
    nota: { texto: string; trozos: string[] } | null;
  },
): Promise<boolean> {
  return inTenant(sql, businessId, async (tx) => {
    const filas = await tx`
      update public.knowledge_valores
         set valor = ${tx.json(c.valor as unknown as JSONValue)}, fragmento = ${c.fragmento}, texto_valor = ${c.textoValor},
             estado = 'aceptado', updated_at = now()
       where business_id = ${businessId}::uuid and id = ${v.id}::uuid and doc_id = ${v.docId}::uuid
      returning id`;
    if (filas.length === 0) return false;
    if (c.reemplazo && c.reemplazo.de !== c.reemplazo.a) {
      await tx`
        update public.knowledge_docs
           set contenido_raw = replace(contenido_raw, ${c.reemplazo.de}, ${c.reemplazo.a}), updated_at = now()
         where business_id = ${businessId}::uuid and id = ${v.docId}::uuid`;
      await tx`
        update public.knowledge_chunks
           set contenido = replace(contenido, ${c.reemplazo.de}, ${c.reemplazo.a})
         where business_id = ${businessId}::uuid and doc_id = ${v.docId}::uuid and position(${c.reemplazo.de} in contenido) > 0`;
    }
    if (c.nota) {
      await tx`
        update public.knowledge_docs
           set contenido_raw = contenido_raw || E'\n\n' || ${c.nota.texto}, updated_at = now()
         where business_id = ${businessId}::uuid and id = ${v.docId}::uuid`;
      if (c.nota.trozos.length > 0) {
        await tx`
          update public.knowledge_chunks
             set contenido = contenido || E'\n' || ${c.nota.texto}
           where business_id = ${businessId}::uuid and doc_id = ${v.docId}::uuid and id = any(${c.nota.trozos}::uuid[])`;
      }
    }
    return true;
  });
}

/** PB-04: el negocio eligió el valor del documento y la configuración ya cambió: el valor queda aceptado. */
export async function aceptarValor(sql: Sql, businessId: string, valorId: string): Promise<boolean> {
  const filas = await inTenant(
    sql,
    businessId,
    (tx) => tx`
      update public.knowledge_valores set estado = 'aceptado', updated_at = now()
       where business_id = ${businessId}::uuid and id = ${valorId}::uuid
      returning id`,
  );
  return filas.length > 0;
}
