// =============================================================================
// Subir, reemplazar y resolver un documento (Fase 5 · 5.2, 5.4 y 5.5)
// =============================================================================
// EL ÚNICO CAMINO para que un documento entre en la base de conocimiento
// (PC-05): lo usan las rutas de Documentos (panel y portal,
// src/api/admin/negocio.ts) y el chat del portal (src/alta/herramientas.ts).
// Una regla nueva se escribe aquí una vez.
//
// Al subir:
//   1. Se comprueba el archivo en el código, antes de gastar: el tipo por sus
//      bytes (PDF o foto; un Word renombrado no, PB-02), hasta 4 MB, que no
//      esté protegido con contraseña, y los límites de PB-06 (20 documentos,
//      100 páginas; el límite de verdad lo pone la base, RA011).
//   2. La IA lo lee (leer.ts). Lo que cuesta se apunta SIEMPRE, se guarde o no,
//      como `preparar_documento` (PB-07, D-99).
//   3. Si no se puede leer, o trae datos de personas (PB-08), no se guarda
//      nada y se dice con una frase.
//   4. Se parte en trozos (trozos.ts) y se comparan sus valores con la
//      configuración de ahora (comparar.ts): lo que no coincide queda
//      'pendiente' para preguntarle al negocio (PB-04).
//   5. Se guarda en una transacción (db/conocimiento.ts).
//
// Resolver (PB-04 / PB-01): «lo de mi configuración» corrige el texto del
// documento; «lo del documento» cambia la configuración con LAS MISMAS
// funciones y validaciones de siempre (db/negocios.ts), después de que el
// negocio confirme (el portal con un cuadro, el chat con su resumen, PC-03).
// =============================================================================

import type { Sql } from 'postgres';

import type { ModelClient } from '../core/agent.js';
import { normalizarTelefono } from '../core/phone.js';
import { tipoPorContenido } from '../db/adjuntos.js';
import {
  aceptarValor,
  borrarBorradoresViejos,
  contarDocumentos,
  corregirValor,
  crearDocumento,
  leerDocumento,
  listarDocumentos,
  reemplazarDocumento,
  trozosDe,
  valoresDe,
  type DocumentoNuevo,
  type DocumentoResumido,
  type OrigenDocumento,
  type TipoDocumento,
  type ValorNuevo,
} from '../db/conocimiento.js';
import { guardarDatos, guardarHorario, guardarServicio, leerNegocio, NoEncontrado, type NegocioPanel, type QueHacerConCitas } from '../db/negocios.js';
import { registrarUso } from '../db/usage.js';
import { costeUsd } from '../core/costes.js';
import { comparar, correccion, trozosQueLoMencionan, type Comparacion, type Referencia } from './comparar.js';
import { LecturaFallida, leerConIA, type EntradaDocumento, type Lectura, type ValorLeido } from './leer.js';
import { partirEnTrozos, textoDelDocumento } from './trozos.js';

/** PB-06 (23/11/2026). Los mismos números que el trigger app.limite_documentos. */
export const LIMITES_DOCUMENTOS = { documentos: 20, paginas: 100, bytes: 4 * 1024 * 1024, caracteresTexto: 30_000 };
/** Un texto escrito cuenta una página cada ~3.000 caracteres (PB-06). */
const CARACTERES_POR_PAGINA = 3000;

export type MotivoDocumento =
  | 'tipo_no_valido'
  | 'demasiado_grande'
  | 'protegido'
  | 'vacio'
  | 'texto_largo'
  | 'limite_documentos'
  | 'limite_paginas'
  | 'ilegible'
  | 'datos_de_personas'
  | 'ia_no_responde'
  | 'demasiado_largo'
  | 'no_encontrado'
  | 'ya_resuelto'
  | 'no_se_puede';

/** Un documento que no se guarda, con la frase que ve el negocio. */
export class ErrorDocumento extends Error {
  constructor(
    readonly motivo: MotivoDocumento,
    mensaje: string,
    readonly status = 400,
  ) {
    super(mensaje);
    this.name = 'ErrorDocumento';
  }
}

export const TEXTOS: Record<Exclude<MotivoDocumento, 'limite_paginas' | 'datos_de_personas'>, string> = {
  tipo_no_valido: 'Solo se pueden subir PDF y fotos (JPG, PNG o WebP). Si es un Word o un Excel, guárdalo como PDF y súbelo otra vez.',
  demasiado_grande: 'Ese archivo pasa de 4 MB. Prueba con un PDF más pequeño o sube una foto de las páginas que hacen falta.',
  protegido: 'Ese PDF está protegido con contraseña y no se puede leer. Quítale la contraseña (o guárdalo otra vez como PDF) y vuelve a subirlo.',
  vacio: 'El documento está vacío.',
  texto_largo: `El texto es muy largo: como mucho ${LIMITES_DOCUMENTOS.caracteresTexto.toLocaleString('es-ES')} caracteres. Divídelo en varios.`,
  limite_documentos: `Ya tienes ${LIMITES_DOCUMENTOS.documentos} documentos: borra alguno o júntalos.`,
  ilegible: 'No he podido leer nada en este documento: puede estar en blanco, vacío o muy borroso. Prueba con otro archivo o con una foto más nítida.',
  ia_no_responde: 'Ahora mismo no he podido leer el documento. No se ha guardado nada: inténtalo de nuevo en un momento.',
  demasiado_largo: 'Este documento tiene demasiado texto para leerlo de una vez. Divídelo en partes más cortas (por ejemplo, una por sección) y súbelas por separado.',
  no_encontrado: 'Ese documento no existe.',
  ya_resuelto: 'Eso ya está resuelto.',
  no_se_puede: 'Eso no se puede cambiar desde aquí.',
};

function textoLimitePaginas(quedan: number): string {
  return quedan <= 0
    ? `Ya tienes las ${LIMITES_DOCUMENTOS.paginas} páginas que caben entre todos tus documentos: borra alguno para subir otro.`
    : `Con este documento pasarías de las ${LIMITES_DOCUMENTOS.paginas} páginas que caben entre todos tus documentos (te quedan ${quedan}). Borra alguno o sube solo las páginas que hacen falta.`;
}

/** PB-08: «Este documento tiene datos de clientas y no lo hemos guardado». */
export function textoDatosDePersonas(que: string): string {
  return `Este documento tiene datos de clientas${que ? ` (${que})` : ''} y no lo hemos guardado. Sube solo información de tu negocio.`;
}

export interface DocumentosDeps {
  sql: Sql;
  /** El cliente de la IA para leer documentos (con más tiempo de espera que el del chat). */
  model: ModelClient;
  /** El modelo que lee (CONOCIMIENTO_MODEL o, de serie, el del chat). */
  modelo: string;
  onError?: (e: unknown) => void;
}

/** Lo que llega para subir: un archivo (PDF o foto) o un texto escrito. */
export type Subida = { archivo: Buffer; nombre: string } | { texto: string; titulo: string | null };

// -----------------------------------------------------------------------------
// La configuración, como la necesita comparar.ts
// -----------------------------------------------------------------------------

/** Desde la ficha del panel o del portal. Un precio que el agente no puede decir cuenta como «sin precio». */
export function referenciaDeFicha(n: NegocioPanel): Referencia {
  return {
    servicios: n.servicios.map((s) => ({ id: s.id, nombre: s.nombre, precio: s.precioVisible ? s.precio : null, duracionMin: s.duracionMin, activo: s.activo })),
    horarioLocal: n.horario.filter((t) => t.staffId === null),
    direccion: n.direccion,
    telefono: n.telefonoHumano,
  };
}

/** Busca un servicio por nombre, sin tildes ni mayúsculas; null si no hay uno claro. */
export function servicioPorNombre<T extends { nombre: string }>(cosas: T[], nombre: string): T | null {
  const limpio = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const n = limpio(nombre);
  if (!n) return null;
  const exactas = cosas.filter((c) => limpio(c.nombre) === n);
  if (exactas.length === 1) return exactas[0]!;
  const parciales = cosas.filter((c) => limpio(c.nombre).includes(n) || n.includes(limpio(c.nombre)));
  return parciales.length === 1 ? parciales[0]! : null;
}

// -----------------------------------------------------------------------------
// Comprobar antes de gastar
// -----------------------------------------------------------------------------

/** Páginas de un PDF contando sus objetos /Page; null si no se pueden contar (objetos comprimidos). */
export function paginasDePdf(b: Buffer): number | null {
  const s = b.toString('latin1');
  const paginas = s.match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0;
  const cuentas = [...s.matchAll(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/g)].map((m) => Number(m[1]));
  const n = Math.max(paginas, ...cuentas, 0);
  return n > 0 ? n : null;
}

interface Preparada {
  tipo: TipoDocumento;
  entrada: EntradaDocumento;
  bytes: number | null;
  nombreArchivo: string | null;
  /** Páginas que se pueden saber antes de leerlo (null si no se sabe). */
  paginas: number | null;
}

export function comprobarSubida(s: Subida): Preparada {
  if ('texto' in s) {
    const texto = s.texto.trim();
    if (!texto) throw new ErrorDocumento('vacio', 'Escribe el texto que quieres que sepa el agente.');
    if (texto.length > LIMITES_DOCUMENTOS.caracteresTexto) throw new ErrorDocumento('texto_largo', TEXTOS.texto_largo);
    return { tipo: 'texto', entrada: { tipo: 'texto', texto, titulo: s.titulo?.trim() || null }, bytes: null, nombreArchivo: null, paginas: Math.max(1, Math.ceil(texto.length / CARACTERES_POR_PAGINA)) };
  }
  if (s.archivo.length === 0) throw new ErrorDocumento('vacio', 'El archivo está vacío.');
  if (s.archivo.length > LIMITES_DOCUMENTOS.bytes) throw new ErrorDocumento('demasiado_grande', TEXTOS.demasiado_grande, 413);
  const tipo = tipoPorContenido(s.archivo);
  if (!tipo) throw new ErrorDocumento('tipo_no_valido', TEXTOS.tipo_no_valido, 415);
  if (tipo === 'application/pdf') {
    if (s.archivo.includes('/Encrypt')) throw new ErrorDocumento('protegido', TEXTOS.protegido);
    return { tipo: 'pdf', entrada: { tipo: 'pdf', datos: s.archivo, nombre: s.nombre }, bytes: s.archivo.length, nombreArchivo: s.nombre, paginas: paginasDePdf(s.archivo) };
  }
  return { tipo: 'imagen', entrada: { tipo: 'imagen', datos: s.archivo, mediaType: tipo, nombre: s.nombre }, bytes: s.archivo.length, nombreArchivo: s.nombre, paginas: 1 };
}

async function comprobarLimites(sql: Sql, businessId: string, paginas: number | null, reemplaza: DocumentoResumido | null): Promise<void> {
  const ya = await contarDocumentos(sql, businessId);
  if (!reemplaza && ya.documentos >= LIMITES_DOCUMENTOS.documentos) throw new ErrorDocumento('limite_documentos', TEXTOS.limite_documentos, 409);
  const ocupadas = ya.paginas - (reemplaza?.paginas ?? 0);
  if (paginas !== null && ocupadas + paginas > LIMITES_DOCUMENTOS.paginas) {
    throw new ErrorDocumento('limite_paginas', textoLimitePaginas(LIMITES_DOCUMENTOS.paginas - ocupadas), 409);
  }
}

/** RA011 de la base (PB-06) → la misma frase que el aviso de antes. */
function limiteDeLaBase(e: unknown): ErrorDocumento | null {
  const pg = e as { code?: string; detail?: string };
  if (pg?.code !== 'RA011') return null;
  if (pg.detail?.startsWith('paginas:')) return new ErrorDocumento('limite_paginas', textoLimitePaginas(Number(pg.detail.slice(8))), 409);
  return new ErrorDocumento('limite_documentos', TEXTOS.limite_documentos, 409);
}

// -----------------------------------------------------------------------------
// Subir y reemplazar
// -----------------------------------------------------------------------------

/** PB-07: lo que costó leerlo, aparte y fuera de los topes. Nunca hace fallar la subida. */
async function apuntarCoste(deps: DocumentosDeps, businessId: string, modelo: string, usage: Lectura['usage'], detalle: Record<string, unknown>): Promise<void> {
  try {
    const total = usage.input_tokens + usage.output_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens;
    await registrarUso(deps.sql, businessId, null, [
      { tipo: 'token', cantidad: total, costeUsd: costeUsd(modelo, usage) ?? 0, concepto: 'preparar_documento', detalle: { ...detalle, modelo, ...usage } },
    ]);
  } catch (e) {
    deps.onError?.(e);
  }
}

/** Lo que la IA leyó, listo para guardar: trozos, valores comparados y títulos. */
function aGuardar(l: Lectura, p: Preparada, origen: OrigenDocumento, estado: 'activo' | 'borrador', ficha: NegocioPanel): DocumentoNuevo {
  const titulo = (p.entrada.tipo === 'texto' && p.entrada.titulo) || l.titulo || p.nombreArchivo?.replace(/\.[^.]+$/, '') || 'Documento';
  const secciones = l.secciones.length > 0 ? l.secciones : [{ titulo: '', texto: p.entrada.tipo === 'texto' ? p.entrada.texto : '', palabras: [] }];
  const contenido = textoDelDocumento(secciones);
  const activos = ficha.servicios.filter((s) => s.activo);
  const r = referenciaDeFicha(ficha);
  const valores: ValorNuevo[] = [];
  const vistos = new Set<string>();
  for (const v of l.valores) {
    const nuevo = valorNuevo(v, activos, contenido);
    if (!nuevo) continue;
    const clave = nuevo.serviceId ? `${nuevo.tipo}:${nuevo.serviceId}` : nuevo.tipo === 'horario' ? `${nuevo.tipo}:${nuevo.dias.join(',')}` : nuevo.tipo;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    // PB-04: lo que no coincide ya al subir queda pendiente de contestar.
    const c = comparar({ ...nuevo, id: '', docId: '', estado: 'pendiente' }, r);
    valores.push({ ...nuevo, estado: c.estado === 'pregunta' ? 'pendiente' : 'aceptado' });
  }
  // Un tratamiento «sin servicio» que en realidad ya está en Servicios no se sugiere.
  const sinServicio = l.sinServicio.filter((t) => !servicioPorNombre(activos, t));
  return {
    tipo: p.tipo,
    titulo: titulo.slice(0, 200),
    resumen: l.resumen,
    origen,
    estado,
    paginas: Math.max(1, p.tipo === 'texto' ? (p.paginas ?? 1) : Math.max(p.paginas ?? 0, l.paginas)),
    bytes: p.bytes,
    nombreArchivo: p.nombreArchivo,
    paginasIlegibles: l.paginasIlegibles,
    sinServicio,
    contenido,
    trozos: partirEnTrozos(titulo, secciones),
    valores,
  };
}

/** Un valor leído → lo que se guarda. Sin servicio de la configuración, un precio o una duración no se comparan. */
function valorNuevo(v: ValorLeido, servicios: NegocioPanel['servicios'], contenido: string): Omit<ValorNuevo, 'estado'> | null {
  // El fragmento tiene que estar tal cual en el texto: si no, «Corregirlo»
  // no sabría dónde cambiar (y se añade una nota, comparar.ts).
  const fragmento = v.fragmento && contenido.includes(v.fragmento) ? v.fragmento : '';
  const textoValor = fragmento && v.textoValor && fragmento.includes(v.textoValor) ? v.textoValor : '';
  const base = { etiqueta: (v.etiqueta || v.servicio).slice(0, 300), fragmento: fragmento.slice(0, 2000), textoValor: textoValor.slice(0, 500), dias: [] as number[], serviceId: null as string | null };
  switch (v.tipo) {
    case 'precio':
    case 'duracion': {
      const s = servicioPorNombre(servicios, v.servicio) ?? servicioPorNombre(servicios, v.etiqueta);
      if (!s) return null;
      return v.tipo === 'precio' ? { ...base, tipo: 'precio', serviceId: s.id, valor: { euros: v.euros! } } : { ...base, tipo: 'duracion', serviceId: s.id, valor: { minutos: v.minutos! } };
    }
    case 'horario':
      return { ...base, tipo: 'horario', dias: [...(v.dias ?? [])].sort(), valor: { tramos: v.tramos ?? [] } };
    case 'direccion':
    case 'telefono':
      return { ...base, tipo: v.tipo, valor: { texto: v.texto ?? '' } };
  }
}

export interface DocumentoSubido {
  id: string;
  titulo: string;
  resumen: string;
  paginas: number;
  paginasIlegibles: number[];
  sinServicio: string[];
  /** PB-04: lo que hay que preguntarle al negocio. */
  preguntas: Comparacion[];
}

/**
 * Lee y guarda un documento nuevo. `estado: 'borrador'` es el del chat del
 * portal: se guarda para enseñar el resumen, pero no existe para el agente
 * hasta que el negocio dice que sí (PC-03).
 */
export async function subirDocumento(
  deps: DocumentosDeps,
  businessId: string,
  subida: Subida,
  p: { origen: OrigenDocumento; estado?: 'activo' | 'borrador'; reemplaza?: string },
): Promise<DocumentoSubido> {
  const preparada = comprobarSubida(subida);
  const reemplaza = p.reemplaza ? await leerDocumento(deps.sql, businessId, p.reemplaza) : null;
  if (p.reemplaza && (!reemplaza || reemplaza.estado !== 'activo')) throw new ErrorDocumento('no_encontrado', TEXTOS.no_encontrado, 404);
  const estado = p.estado ?? 'activo';
  // También para un borrador del chat: no se gasta en leer lo que después no cabría.
  if (estado === 'borrador') await borrarBorradoresViejos(deps.sql, businessId);
  await comprobarLimites(deps.sql, businessId, preparada.paginas, reemplaza);
  const ficha = await leerNegocio(deps.sql, businessId);
  if (!ficha) throw new ErrorDocumento('no_encontrado', 'Ese negocio no existe.', 404);

  let lectura: Lectura;
  const detalle = { documento: preparada.nombreArchivo ?? (preparada.entrada.tipo === 'texto' ? preparada.entrada.titulo : null), origen: p.origen, tipo: preparada.tipo };
  try {
    lectura = await leerConIA(deps.model, { modelo: deps.modelo, entrada: preparada.entrada, servicios: ficha.servicios.filter((s) => s.activo).map((s) => s.nombre) });
  } catch (e) {
    if (e instanceof LecturaFallida) {
      if (e.usage) await apuntarCoste(deps, businessId, e.modelo ?? deps.modelo, e.usage, { ...detalle, fallo: e.motivo });
      if (e.motivo === 'no_se_abre') throw new ErrorDocumento('protegido', TEXTOS.protegido);
      if (e.motivo === 'demasiado_largo') throw new ErrorDocumento('demasiado_largo', TEXTOS.demasiado_largo, 413);
      deps.onError?.(e);
      throw new ErrorDocumento('ia_no_responde', TEXTOS.ia_no_responde, 503);
    }
    throw e;
  }
  await apuntarCoste(deps, businessId, lectura.modelo, lectura.usage, detalle);

  if (!lectura.legible || lectura.secciones.length === 0) throw new ErrorDocumento('ilegible', TEXTOS.ilegible, 422);
  if (lectura.datosDePersonas.hay) throw new ErrorDocumento('datos_de_personas', textoDatosDePersonas(lectura.datosDePersonas.que), 422);

  const doc = aGuardar(lectura, preparada, reemplaza?.origen ?? p.origen, estado, ficha);
  let id: string;
  try {
    if (reemplaza) {
      if (!(await reemplazarDocumento(deps.sql, businessId, reemplaza.id, doc))) throw new ErrorDocumento('no_encontrado', TEXTOS.no_encontrado, 404);
      id = reemplaza.id;
    } else {
      id = await crearDocumento(deps.sql, businessId, doc);
    }
  } catch (e) {
    throw limiteDeLaBase(e) ?? e;
  }
  const r = referenciaDeFicha(ficha);
  const preguntas = (await valoresDe(deps.sql, businessId, [id])).map((v) => comparar(v, r)).filter((c) => c.estado === 'pregunta');
  return {
    id,
    titulo: reemplaza?.titulo ?? doc.titulo,
    resumen: doc.resumen,
    paginas: doc.paginas,
    paginasIlegibles: doc.paginasIlegibles,
    sinServicio: doc.sinServicio,
    preguntas,
  };
}

// -----------------------------------------------------------------------------
// Lo que se enseña en Documentos (panel y portal)
// -----------------------------------------------------------------------------

export interface AvisoDeValor {
  valorId: string;
  que: string;
  documento: string;
  configuracion: string;
}

export interface DocumentoDeLaFicha {
  id: string;
  tipo: TipoDocumento;
  titulo: string;
  resumen: string | null;
  origen: OrigenDocumento;
  paginas: number;
  paginasIlegibles: number[];
  sinServicio: string[];
  creado: string;
  reemplazado: string | null;
  /** PB-04: «tu carta dice 55 €, tu configuración 60 €: ¿cuál es el correcto?». */
  preguntas: AvisoDeValor[];
  /** PB-01: la configuración cambió después y el documento dice lo de antes. */
  viejos: AvisoDeValor[];
}

export interface DocumentosDeLaFicha {
  documentos: DocumentoDeLaFicha[];
  usados: { documentos: number; paginas: number };
  limites: { documentos: number; paginas: number; bytes: number };
}

function aviso(c: Comparacion): AvisoDeValor {
  return { valorId: c.valor.id, que: c.que, documento: c.documento, configuracion: c.configuracion };
}

/** Los documentos con sus avisos, comparados con la configuración de AHORA (D-98). */
export async function documentosDeLaFicha(sql: Sql, businessId: string, ficha: NegocioPanel): Promise<DocumentosDeLaFicha> {
  const docs = await listarDocumentos(sql, businessId);
  const valores = await valoresDe(sql, businessId, docs.map((d) => d.id));
  const r = referenciaDeFicha(ficha);
  const activos = ficha.servicios.filter((s) => s.activo);
  return {
    documentos: docs.map((d) => {
      const cs = valores.filter((v) => v.docId === d.id).map((v) => comparar(v, r));
      return {
        id: d.id,
        tipo: d.tipo,
        titulo: d.titulo,
        resumen: d.resumen,
        origen: d.origen,
        paginas: d.paginas,
        paginasIlegibles: d.paginasIlegibles,
        // Si el negocio ya lo dio de alta, deja de sugerirse.
        sinServicio: d.sinServicio.filter((t) => !servicioPorNombre(activos, t)),
        creado: d.creado.toISOString(),
        reemplazado: d.reemplazado?.toISOString() ?? null,
        preguntas: cs.filter((c) => c.estado === 'pregunta').map(aviso),
        viejos: cs.filter((c) => c.estado === 'viejo').map(aviso),
      };
    }),
    usados: { documentos: docs.length, paginas: docs.reduce((t, d) => t + d.paginas, 0) },
    limites: { documentos: LIMITES_DOCUMENTOS.documentos, paginas: LIMITES_DOCUMENTOS.paginas, bytes: LIMITES_DOCUMENTOS.bytes },
  };
}

// -----------------------------------------------------------------------------
// Resolver un valor (PB-04, PB-01)
// -----------------------------------------------------------------------------

export type Usar = 'configuracion' | 'documento';

/**
 * PB-04 / PB-01. `configuracion`: el documento pasa a decir lo de la
 * configuración (vale para una pregunta y para un documento viejo:
 * «Corregirlo»). `documento`: la configuración pasa a decir lo del documento,
 * con las funciones y validaciones de siempre; solo para una pregunta de PB-04
 * (un documento viejo no le enmienda la plana a un cambio que el negocio acaba
 * de hacer). Devuelve las citas que hay que cancelar si un horario nuevo deja
 * fuera citas y se eligió cancelarlas (PI-21).
 */
export async function resolverValor(
  sql: Sql,
  businessId: string,
  p: { docId: string; valorId: string; usar: Usar; citas?: QueHacerConCitas },
): Promise<{ cancelar: string[]; comparacion: Comparacion }> {
  const v = (await valoresDe(sql, businessId, [p.docId])).find((x) => x.id === p.valorId);
  if (!v) throw new ErrorDocumento('no_encontrado', 'Ese dato del documento no existe.', 404);
  const ficha = await leerNegocio(sql, businessId);
  if (!ficha) throw new NoEncontrado('El negocio');
  const r = referenciaDeFicha(ficha);
  const c = comparar(v, r);
  if (c.estado === 'ok') {
    await aceptarValor(sql, businessId, v.id);
    return { cancelar: [], comparacion: c };
  }
  if (c.estado === 'sin_comparar') throw new ErrorDocumento('no_se_puede', TEXTOS.no_se_puede, 409);

  if (p.usar === 'configuracion') {
    const corr = correccion(v, r)!;
    const trozos = corr.nota ? await trozosDe(sql, businessId, v.docId) : [];
    await corregirValor(sql, businessId, v, {
      valor: corr.valor,
      fragmento: corr.fragmento,
      textoValor: corr.textoValor,
      reemplazo: corr.reemplazo,
      nota: corr.nota ? { texto: corr.nota, trozos: trozosQueLoMencionan(trozos, v) } : null,
    });
    return { cancelar: [], comparacion: c };
  }

  if (c.estado !== 'pregunta') {
    throw new ErrorDocumento('no_se_puede', 'Ese documento quedó viejo porque cambiaste tu configuración: corrígelo o reemplázalo por la versión nueva.', 409);
  }
  let cancelar: string[] = [];
  const d = v.valor as Record<string, unknown>;
  switch (v.tipo) {
    case 'precio':
    case 'duracion': {
      const s = ficha.servicios.find((x) => x.id === v.serviceId);
      if (!s) throw new ErrorDocumento('no_encontrado', 'Ese servicio ya no existe.', 404);
      await guardarServicio(sql, businessId, s.id, {
        nombre: s.nombre,
        descripcion: s.descripcion,
        duracionMin: v.tipo === 'duracion' ? Number(d.minutos) : s.duracionMin,
        bufferMin: s.bufferMin,
        precio: v.tipo === 'precio' ? Number(d.euros) : s.precio,
        precioVisible: v.tipo === 'precio' ? true : s.precioVisible,
        activo: s.activo,
      });
      break;
    }
    case 'horario': {
      const tramos = [
        ...ficha.horario.filter((t) => t.staffId === null && !v.dias.includes(t.weekday)).map((t) => ({ weekday: t.weekday, apertura: t.apertura, cierre: t.cierre })),
        ...v.dias.flatMap((w) => ((d.tramos as { desde: string; hasta: string }[]) ?? []).map((t) => ({ weekday: w, apertura: t.desde, cierre: t.hasta }))),
      ];
      cancelar = await guardarHorario(sql, businessId, null, tramos, [], p.citas ?? 'preguntar');
      break;
    }
    case 'direccion':
    case 'telefono': {
      const texto = String(d.texto ?? '').trim();
      const telefono = v.tipo === 'telefono' ? normalizarTelefono(texto) : ficha.telefonoHumano;
      if (v.tipo === 'telefono' && !telefono) throw new ErrorDocumento('no_se_puede', `«${texto}» no es un teléfono que se pueda guardar. Cámbialo a mano en Tu negocio.`, 409);
      await guardarDatos(sql, businessId, {
        nombre: ficha.nombre,
        sector: ficha.sector,
        timezone: ficha.timezone,
        direccion: v.tipo === 'direccion' ? texto : ficha.direccion,
        telefonoHumano: telefono,
        tonoDeVoz: ficha.tonoDeVoz,
        mensajeBienvenida: ficha.mensajeBienvenida,
      });
      break;
    }
  }
  await aceptarValor(sql, businessId, v.id);
  return { cancelar, comparacion: c };
}
