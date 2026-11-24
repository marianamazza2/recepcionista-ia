// =============================================================================
// Un solo valor, siempre: comparar un documento con la configuración
// (Fase 5 · 5.2 y 5.4: PB-04, PB-01)
// =============================================================================
// La IA, al leer un documento, saca los valores que da para lo que hay en la
// configuración (precio y duración de cada servicio, horarios del local,
// dirección y teléfono). LA COMPARACIÓN LA HACE ESTE ARCHIVO, no el modelo
// (spec, «contexto técnico»): así una contradicción sale siempre igual y con
// los valores exactos.
//
// Se compara cada vez que se leen (al listar Documentos y al buscar para una
// clienta), contra la configuración de AHORA. Por eso, cuando el negocio
// cambia un precio en Configuración, el documento que decía el viejo queda
// marcado solo (D-98):
//
//   · coincide             → nada que decir;
//   · no coincide y el valor está 'pendiente' (no coincidía ya al subirlo y el
//     negocio todavía no eligió) → PB-04: se le pregunta cuál es el correcto;
//   · no coincide y estaba 'aceptado' (coincidía o ya se decidió) → la
//     configuración cambió después: PB-01, el documento «quedó viejo»
//     (Corregirlo o Reemplazar).
//
// Corregir (PB-01) es reescribir en el texto del documento el valor por el de
// la configuración, dentro del trozo exacto donde aparece (`fragmento`).
//
// Un precio que la configuración no deja decir (precio_visible = false, o sin
// precio) se trata como «sin precio»: el documento no puede saltarse ese
// guardrail del agente (⚠️ propuesta en decisiones-producto.md, bajo PB-04).
// Este archivo es puro: sin base, sin modelo, sin reloj.
// =============================================================================

import { normalizarTelefono, telefonoLegible } from '../core/phone.js';
import type { TipoValor, TramoDoc, ValorDoc, ValorGuardado } from '../db/conocimiento.js';

export const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'] as const;

/** Lo que se necesita de la configuración para comparar (sale de la ficha del panel o de la del agente). */
export interface Referencia {
  servicios: { id: string; nombre: string; precio: number | null; duracionMin: number; activo: boolean }[];
  /** Tramos del local (sin profesional). weekday: 0 = domingo. */
  horarioLocal: { weekday: number; apertura: string; cierre: string }[];
  direccion: string | null;
  telefono: string | null;
}

export type EstadoComparacion = 'ok' | 'pregunta' | 'viejo' | 'sin_comparar';

export interface Comparacion {
  valor: ValorGuardado;
  estado: EstadoComparacion;
  /** «el precio de Limpieza facial», «el horario de lunes a viernes». */
  que: string;
  /** Lo que dice el documento, para enseñarlo («55 €»). */
  documento: string;
  /** Lo que dice la configuración («60 €», «sin precio»). */
  configuracion: string;
}

// -----------------------------------------------------------------------------
// Formatos (lo que se enseña y lo que se escribe al corregir)
// -----------------------------------------------------------------------------

export function euros(n: number): string {
  return `${Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',')} €`;
}

export function minutos(m: number): string {
  if (m < 60 || m % 30 !== 0) return `${m} min`;
  const h = m / 60;
  return Number.isInteger(h) ? `${h} ${h === 1 ? 'hora' : 'horas'}` : `${String(h).replace('.', ',')} horas`;
}

/** '9:00' → '09:00'. Null si no es una hora. */
export function hora(s: string): string | null {
  const m = /^(\d{1,2})[:.h]?(\d{2})?$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2] ?? '0');
  if (h > 24 || mi > 59 || (h === 24 && mi > 0)) return null;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

function horaLegible(h: string): string {
  return h.replace(/^0(\d)/, '$1');
}

export function tramosLegibles(ts: TramoDoc[]): string {
  if (ts.length === 0) return 'cerrado';
  return ts.map((t) => `de ${horaLegible(t.desde)} a ${horaLegible(t.hasta)}`).join(' y ');
}

/** [1,2,3,4,5] → «lunes a viernes»; [1,3] → «lunes y miércoles»; [6,0] → «sábado y domingo». */
export function diasLegibles(dias: number[]): string {
  const orden = [1, 2, 3, 4, 5, 6, 0];
  const ds = orden.filter((d) => dias.includes(d));
  if (ds.length === 0) return '';
  if (ds.length >= 3 && ds.every((d, i) => i === 0 || orden.indexOf(d) === orden.indexOf(ds[i - 1]!) + 1)) {
    return `${DIAS[ds[0]!]} a ${DIAS[ds.at(-1)!]}`;
  }
  const n = ds.map((d) => DIAS[d]!);
  return n.length === 1 ? n[0]! : `${n.slice(0, -1).join(', ')} y ${n.at(-1)}`;
}

function sinTildes(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// -----------------------------------------------------------------------------
// La comparación
// -----------------------------------------------------------------------------

function tramosDelLocal(r: Referencia, weekday: number): TramoDoc[] {
  return r.horarioLocal
    .filter((t) => t.weekday === weekday)
    .map((t) => ({ desde: t.apertura, hasta: t.cierre }))
    .sort((a, b) => a.desde.localeCompare(b.desde));
}

function mismosTramos(a: TramoDoc[], b: TramoDoc[]): boolean {
  const n = (ts: TramoDoc[]) =>
    ts
      .map((t) => `${hora(t.desde) ?? t.desde}-${hora(t.hasta) ?? t.hasta}`)
      .sort()
      .join(',');
  return n(a) === n(b);
}

const ABREVIATURAS: [RegExp, string][] = [
  [/\bc\s*\/\s*/g, 'calle '],
  [/\bc\.\s*/g, 'calle '],
  [/\bavda?\.?\s/g, 'avenida '],
  [/\bav\.\s*/g, 'avenida '],
  [/\bpza\.?\s/g, 'plaza '],
  [/\bpl\.\s*/g, 'plaza '],
  [/\bpso\.?\s/g, 'paseo '],
  [/\bn[ºo°]\s*/g, ''],
];

function dirNormal(s: string): string {
  let t = sinTildes(s);
  for (const [re, x] of ABREVIATURAS) t = t.replace(re, x);
  return t.replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Dos direcciones son la misma si una contiene a la otra o si los números del
 * documento (calle y código postal) están en la de la configuración y
 * comparten alguna palabra de verdad («Calle Mayor 12» = «C/ Mayor, 12, 28013
 * Madrid»). Un número distinto («Mayor 14») es otra dirección.
 */
export function mismaDireccion(a: string, b: string): boolean {
  const x = dirNormal(a);
  const y = dirNormal(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const numeros = (s: string) => new Set(s.match(/\d+/g) ?? []);
  const nx = numeros(x);
  const ny = numeros(y);
  const vacias = new Set(['calle', 'avenida', 'plaza', 'paseo', 'local', 'bajo', 'piso', 'puerta', 'madrid', 'barcelona']);
  const palabras = (s: string) => new Set(s.split(' ').filter((w) => w.length >= 4 && !/\d/.test(w) && !vacias.has(w)));
  const px = palabras(x);
  const comunes = [...palabras(y)].filter((w) => px.has(w));
  const [menos, mas] = nx.size <= ny.size ? [nx, ny] : [ny, nx];
  return menos.size > 0 && [...menos].every((n) => mas.has(n)) && comunes.length > 0;
}

/** El valor que tiene ahora la configuración para lo mismo que dice el documento (null si no se puede comparar). */
export function valorDeLaConfiguracion(v: ValorGuardado, r: Referencia): ValorDoc | 'sin_precio' | null {
  switch (v.tipo) {
    case 'precio': {
      const s = r.servicios.find((x) => x.id === v.serviceId);
      if (!s || !s.activo) return null;
      return s.precio === null ? 'sin_precio' : { euros: s.precio };
    }
    case 'duracion': {
      const s = r.servicios.find((x) => x.id === v.serviceId);
      if (!s || !s.activo) return null;
      return { minutos: s.duracionMin };
    }
    case 'horario': {
      if (v.dias.length === 0 || r.horarioLocal.length === 0) return null;
      const primero = tramosDelLocal(r, v.dias[0]!);
      // Si esos días no tienen el mismo horario en la configuración, el valor
      // de la configuración son varios: se devuelve el del primero y la
      // comparación día a día (abajo) dice que no coincide.
      return { tramos: primero };
    }
    case 'direccion':
      return r.direccion ? { texto: r.direccion } : null;
    case 'telefono':
      return r.telefono ? { texto: r.telefono } : null;
  }
}

function coincide(v: ValorGuardado, r: Referencia, conf: ValorDoc | 'sin_precio'): boolean | null {
  const d = v.valor as Record<string, unknown>;
  switch (v.tipo) {
    case 'precio':
      return conf !== 'sin_precio' && typeof d.euros === 'number' && Math.abs(d.euros - (conf as { euros: number }).euros) < 0.005;
    case 'duracion':
      return typeof d.minutos === 'number' && d.minutos === (conf as { minutos: number }).minutos;
    case 'horario':
      return Array.isArray(d.tramos) && v.dias.every((w) => mismosTramos(d.tramos as TramoDoc[], tramosDelLocal(r, w)));
    case 'direccion':
      return typeof d.texto === 'string' ? mismaDireccion(d.texto, (conf as { texto: string }).texto) : null;
    case 'telefono': {
      const a = typeof d.texto === 'string' ? normalizarTelefono(d.texto) : null;
      if (!a) return null;
      return a === normalizarTelefono((conf as { texto: string }).texto);
    }
  }
}

/** Cómo se enseña un valor (del documento o de la configuración). */
export function legible(tipo: TipoValor, x: ValorDoc | 'sin_precio', dias: number[] = [], r?: Referencia): string {
  if (x === 'sin_precio') return 'sin precio (se confirma en el local)';
  const d = x as Record<string, unknown>;
  switch (tipo) {
    case 'precio':
      return euros(Number(d.euros));
    case 'duracion':
      return minutos(Number(d.minutos));
    case 'horario': {
      if (r && dias.length > 1) {
        // La configuración puede tener días distintos dentro de lo que el documento junta.
        const porDia = dias.map((w) => ({ w, t: tramosLegibles(tramosDelLocal(r, w)) }));
        if (new Set(porDia.map((p) => p.t)).size > 1) return porDia.map((p) => `${DIAS[p.w]} ${p.t}`).join('; ');
      }
      return tramosLegibles((d.tramos as TramoDoc[]) ?? []);
    }
    case 'telefono': {
      const t = normalizarTelefono(String(d.texto ?? ''));
      return t ? telefonoLegible(t) : String(d.texto ?? '');
    }
    case 'direccion':
      return String(d.texto ?? '');
  }
}

export function queEs(v: ValorGuardado, r: Referencia): string {
  const s = r.servicios.find((x) => x.id === v.serviceId)?.nombre ?? v.etiqueta;
  switch (v.tipo) {
    case 'precio':
      return `el precio de ${s}`;
    case 'duracion':
      return `la duración de ${s}`;
    case 'horario':
      return `el horario del local ${v.dias.length > 1 ? 'de' : 'el'} ${diasLegibles(v.dias)}`;
    case 'direccion':
      return 'la dirección del local';
    case 'telefono':
      return 'el teléfono del local';
  }
}

/** PB-04 / PB-01: cómo está este valor del documento respecto de la configuración de ahora. */
export function comparar(v: ValorGuardado, r: Referencia): Comparacion {
  const conf = valorDeLaConfiguracion(v, r);
  const base = { valor: v, que: queEs(v, r), documento: legible(v.tipo, v.valor, v.dias) };
  if (conf === null) return { ...base, estado: 'sin_comparar', configuracion: '' };
  const c = coincide(v, r, conf);
  const configuracion = legible(v.tipo, conf, v.dias, r);
  if (c === null) return { ...base, estado: 'sin_comparar', configuracion };
  if (c) return { ...base, estado: 'ok', configuracion };
  return { ...base, estado: v.estado === 'pendiente' ? 'pregunta' : 'viejo', configuracion };
}

// -----------------------------------------------------------------------------
// Corregir el texto (PB-01): que el documento diga lo de la configuración
// -----------------------------------------------------------------------------

const NUMERO = /\d+(?:[.,]\d+)?/;

/** Cambia el primer número de `t` por `n`, con el mismo estilo de decimales. */
function cambiarNumero(t: string, n: number): string | null {
  const m = NUMERO.exec(t);
  if (!m) return null;
  const decimales = /[.,](\d+)$/.exec(m[0]);
  const sep = m[0].includes(',') ? ',' : '.';
  const nuevo = decimales ? n.toFixed(decimales[1]!.length).replace('.', sep) : Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',');
  return t.slice(0, m.index) + nuevo + t.slice(m.index + m[0].length);
}

/** El texto del valor tal como lo diría el documento, pero con lo de la configuración. */
export function textoCorregido(v: ValorGuardado, r: Referencia): string {
  const conf = valorDeLaConfiguracion(v, r);
  if (conf === null) return v.textoValor;
  switch (v.tipo) {
    case 'precio':
      if (conf === 'sin_precio') return 'precio a consultar en el local';
      return cambiarNumero(v.textoValor, (conf as { euros: number }).euros) ?? euros((conf as { euros: number }).euros);
    case 'duracion': {
      const m = (conf as { minutos: number }).minutos;
      // «1 hora» con 75 minutos no se arregla cambiando el número.
      if (/hora|\bh\b/i.test(v.textoValor) && !/min/i.test(v.textoValor)) return minutos(m);
      return cambiarNumero(v.textoValor, m) ?? minutos(m);
    }
    case 'horario':
      return legible('horario', conf, v.dias, r);
    case 'direccion':
      return (conf as { texto: string }).texto;
    case 'telefono': {
      const t = normalizarTelefono((conf as { texto: string }).texto);
      return t ? telefonoLegible(t) : (conf as { texto: string }).texto;
    }
  }
}

export interface Correccion {
  /** El valor que queda guardado (el de la configuración). */
  valor: ValorDoc;
  fragmento: string;
  textoValor: string;
  /** Cambiar este texto literal en el documento y en sus trozos; null si no se puede. */
  reemplazo: { de: string; a: string } | null;
  /** Si no se encontró el valor tal cual: una línea para añadir. */
  nota: string | null;
}

/**
 * PB-01: lo que hay que cambiar en el documento para que diga lo de la
 * configuración. Si el valor no está tal cual en su trozo (la IA lo resumió),
 * se añade una nota con el valor que vale.
 */
export function correccion(v: ValorGuardado, r: Referencia): Correccion | null {
  const conf = valorDeLaConfiguracion(v, r);
  if (conf === null) return null;
  const nuevoValor: ValorDoc = conf === 'sin_precio' ? { texto: 'sin precio' } : conf;
  const nuevoTexto = textoCorregido(v, r);
  if (v.fragmento && v.textoValor && v.fragmento.includes(v.textoValor)) {
    const fragmento = v.fragmento.replace(v.textoValor, () => nuevoTexto);
    return { valor: nuevoValor, fragmento, textoValor: nuevoTexto, reemplazo: { de: v.fragmento, a: fragmento }, nota: null };
  }
  const que = queEs(v, r);
  const nota = `Dato actualizado: ${que.charAt(0).toUpperCase()}${que.slice(1)}: ${legible(v.tipo, conf, v.dias, r)}.`;
  return { valor: nuevoValor, fragmento: v.fragmento, textoValor: nuevoTexto, reemplazo: null, nota };
}

/**
 * PB-01 al buscar: el trozo tal como lo tiene que leer el agente, con lo de la
 * configuración en lugar de lo que el documento dice distinto. Devuelve el
 * texto y si alguna corrección no se pudo aplicar (para avisar al agente).
 */
export function aplicarAlTrozo(texto: string, comparaciones: Comparacion[], r: Referencia): { texto: string; sinAplicar: Comparacion[] } {
  let t = texto;
  const sinAplicar: Comparacion[] = [];
  for (const c of comparaciones) {
    if (c.estado !== 'pregunta' && c.estado !== 'viejo') continue;
    const corr = correccion(c.valor, r);
    if (corr?.reemplazo && t.includes(corr.reemplazo.de)) {
      t = t.split(corr.reemplazo.de).join(corr.reemplazo.a);
    } else if (mencionaElValor(t, c.valor)) {
      sinAplicar.push(c);
    }
  }
  return { texto: t, sinAplicar };
}

/** ¿El trozo habla de eso (tiene la etiqueta o el valor tal cual)? */
function mencionaElValor(texto: string, v: ValorGuardado): boolean {
  const t = sinTildes(texto);
  if (v.textoValor && t.includes(sinTildes(v.textoValor))) return true;
  const palabras = sinTildes(v.etiqueta).split(/\s+/).filter((w) => w.length >= 4);
  return palabras.length > 0 && palabras.every((w) => t.includes(w));
}

/** Para elegir a qué trozos se añade la nota cuando el valor no se encontró literal. */
export function trozosQueLoMencionan(trozos: { id: string; contenido: string }[], v: ValorGuardado): string[] {
  const ids = trozos.filter((x) => mencionaElValor(x.contenido, v)).map((x) => x.id);
  return ids.length > 0 ? ids : trozos.slice(0, 1).map((x) => x.id);
}
