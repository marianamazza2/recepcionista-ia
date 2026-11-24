// =============================================================================
// Leer un documento con la IA (Fase 5 · 5.2: PB-02, PB-04, PB-08, PB-09)
// =============================================================================
// El modelo ya lee PDF (también escaneados) y fotos (PC-21). Al subir un
// documento se le pide, en UNA sola llamada con salida estructurada:
//
//   · el texto limpio, por secciones (lo que se guarda: el archivo no, D-97);
//   · el título, una línea de qué trata y las páginas que no se pudieron leer
//     (PB-04);
//   · por sección, las palabras con que lo pediría una clienta (PB-09, la A:
//     sinónimos, cómo se dice en la calle, faltas típicas);
//   · si trae datos de personas que no son del negocio (PB-08);
//   · los valores que da para lo que está en la configuración (precio y
//     duración de cada servicio, horarios, dirección, teléfono), cada uno con
//     el trozo de texto EXACTO donde aparece. Compararlos lo hace el código
//     (comparar.ts), no el modelo;
//   · los tratamientos que explica y no están en Servicios (PB-04).
//
// El modelo es el del chat del portal (AGENT_MODEL) salvo que se fije
// CONOCIMIENTO_MODEL. Lo paga MAZZMKT, fuera de los topes (PB-07, D-99).
// =============================================================================

import type Anthropic from '@anthropic-ai/sdk';

import { anthropicModelClient, type AgentSettings, type ModelClient } from '../core/agent.js';
import type { UsageDetalle } from '../db/conversations.js';
import type { Seccion } from './trozos.js';

export type EntradaDocumento =
  | { tipo: 'pdf'; datos: Buffer; nombre: string }
  | { tipo: 'imagen'; datos: Buffer; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; nombre: string }
  | { tipo: 'texto'; texto: string; titulo: string | null };

export interface ValorLeido {
  tipo: 'precio' | 'duracion' | 'horario' | 'direccion' | 'telefono';
  /** Para precio y duración: el servicio de la configuración al que corresponde ('' si ninguno). */
  servicio: string;
  /** Cómo lo llama el documento. */
  etiqueta: string;
  euros?: number;
  minutos?: number;
  dias?: number[];
  tramos?: { desde: string; hasta: string }[];
  texto?: string;
  fragmento: string;
  textoValor: string;
}

export interface Lectura {
  legible: boolean;
  titulo: string;
  resumen: string;
  paginas: number;
  paginasIlegibles: number[];
  datosDePersonas: { hay: boolean; que: string };
  secciones: Seccion[];
  valores: ValorLeido[];
  sinServicio: string[];
  modelo: string;
  usage: UsageDetalle;
}

/** El modelo no contestó, cortó la respuesta o devolvió algo que no se entiende. */
export class LecturaFallida extends Error {
  /** Lo que se gastó si el modelo llegó a contestar (se registra igual, PB-07). */
  modelo?: string;
  usage?: UsageDetalle;
  constructor(
    readonly motivo: 'ia_no_responde' | 'demasiado_largo' | 'no_se_abre',
    detalle: string,
  ) {
    super(detalle);
    this.name = 'LecturaFallida';
  }
}

/** Salida máxima de la lectura. Sin streaming, el SDK no deja pasar de ~21.000 (D-100). */
export const MAX_TOKENS_LECTURA = 20_000;

const DIA = { type: 'string', enum: ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'] };
const NUMERO_DIA: Record<string, number> = { domingo: 0, lunes: 1, martes: 2, miércoles: 3, jueves: 4, viernes: 5, sábado: 6 };

function objeto(properties: Record<string, unknown>): Record<string, unknown> {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

const FRAGMENTO = {
  fragmento: { type: 'string', description: 'La línea o frase del texto donde aparece, copiada EXACTAMENTE igual que en "secciones" (mismas palabras, signos y espacios).' },
  texto_valor: { type: 'string', description: 'El valor tal como aparece dentro de ese fragmento, copiado exactamente ("55 €", "45 minutos", "de 9:00 a 20:00", "910 000 000").' },
};

/** El esquema de la salida estructurada. Sin nulls ni enums nulables: la API los rechaza. */
export const ESQUEMA_LECTURA = objeto({
  legible: { type: 'boolean', description: 'false si no se puede leer nada útil (en blanco, borroso, vacío).' },
  titulo: { type: 'string', description: 'Un título corto y claro, como lo pondría el negocio: "Carta de tratamientos 2026".' },
  resumen: { type: 'string', description: 'Una línea de qué trata: "Precios y descripción de 18 tratamientos faciales y corporales".' },
  paginas: { type: 'integer', description: 'Cuántas páginas tiene (una foto: 1).' },
  paginas_ilegibles: { type: 'array', items: { type: 'integer' }, description: 'Números de página (desde 1) que no se pudieron leer.' },
  datos_de_personas: objeto({
    hay: { type: 'boolean' },
    que: { type: 'string', description: 'Si hay: qué son, en pocas palabras ("una lista de clientas con teléfonos"). Si no, vacío.' },
  }),
  secciones: {
    type: 'array',
    items: objeto({
      titulo: { type: 'string', description: 'El título de la sección (el del documento, o uno corto si no tiene).' },
      texto: { type: 'string', description: 'El texto de la sección, completo y limpio, tal como lo dice el documento. Una línea por cada línea de una lista de precios.' },
      palabras: { type: 'array', items: { type: 'string' }, description: 'De 5 a 20 palabras o expresiones con que una clienta preguntaría por esto: sinónimos, cómo se dice en la calle, faltas típicas ("bótox", "pelin", "quitar manchas").' },
    }),
  },
  precios: {
    type: 'array',
    items: objeto({
      servicio: { type: 'string', description: 'El servicio de la lista de la configuración al que corresponde, escrito exactamente igual. Vacío si no es ninguno.' },
      etiqueta: { type: 'string', description: 'Cómo lo llama el documento.' },
      euros: { type: 'number' },
      ...FRAGMENTO,
    }),
  },
  duraciones: {
    type: 'array',
    items: objeto({
      servicio: { type: 'string', description: 'Como en precios.' },
      etiqueta: { type: 'string' },
      minutos: { type: 'integer' },
      ...FRAGMENTO,
    }),
  },
  horarios: {
    type: 'array',
    description: 'El horario del LOCAL (no el de una profesional). Un elemento por cada frase de horario ("de lunes a viernes de 9:00 a 20:00").',
    items: objeto({
      dias: { type: 'array', items: DIA },
      cerrado: { type: 'boolean', description: 'true si esos días está cerrado.' },
      tramos: { type: 'array', items: objeto({ desde: { type: 'string', description: 'HH:MM' }, hasta: { type: 'string', description: 'HH:MM' } }) },
      ...FRAGMENTO,
    }),
  },
  direccion: { type: 'array', description: 'La dirección del local, si la da (0 o 1 elementos).', items: objeto({ texto: { type: 'string' }, ...FRAGMENTO }) },
  telefono: { type: 'array', description: 'El teléfono del local, si lo da (0 o 1 elementos).', items: objeto({ texto: { type: 'string' }, ...FRAGMENTO }) },
  tratamientos_sin_servicio: { type: 'array', items: { type: 'string' }, description: 'Tratamientos o servicios que el documento explica u ofrece y NO están en la lista de la configuración.' },
});

function sistema(servicios: string[]): string {
  return `Lees un documento que un negocio (una clínica estética, un centro de belleza…) ha subido para que su recepcionista virtual lo conozca. Tu trabajo es pasarlo a texto y sacar unos datos, sin inventar nada. Escribe en español.

1. "secciones": el texto COMPLETO del documento, limpio y en orden, dividido en sus secciones. Copia lo que dice, con sus palabras: no resumas, no completes, no corrijas datos. Quita lo que no aporta (números de página, pies repetidos, adornos). Una lista de precios va con una línea por tratamiento. Si es una foto, lee todo lo que se vea aunque esté torcida o con sombras.
2. En cada sección, "palabras": cómo preguntaría por eso una clienta que no conoce los nombres técnicos: sinónimos, palabras de la calle, abreviaturas y faltas típicas (por ejemplo, para "toxina botulínica": bótox, botox, arrugas, patas de gallo, entrecejo).
3. "titulo" (corto) y "resumen" (una sola línea de qué trata).
4. "paginas" y "paginas_ilegibles" (las que no se pueden leer, por número). Si no se puede leer nada, "legible": false.
5. "datos_de_personas": marca "hay": true SOLO si el documento trae datos de personas que no son del negocio: una lista de clientas, un historial, un consentimiento firmado, nombres con teléfonos, DNI o datos de salud de alguien. El nombre de las profesionales del negocio, su dirección y su teléfono NO son datos de personas.
6. Los valores que da para lo que el negocio ya tiene en su configuración, cada uno con el fragmento EXACTO donde aparece (tiene que estar tal cual en "secciones") y el valor tal cual dentro de él:
   - "precios" y "duraciones" de cada tratamiento. En "servicio", el de esta lista al que corresponde, escrito igual; vacío si no es ninguno: ${servicios.length ? servicios.map((s) => `«${s}»`).join(', ') : '(el negocio todavía no tiene servicios)'}.
   - "horarios" del local (no los de una profesional), "direccion" y "telefono", solo si los da.
   - Si un precio es "desde 50 €" o un rango, no lo pongas en "precios".
7. "tratamientos_sin_servicio": los que el documento explica u ofrece y no están en esa lista.

Si el documento no tiene nada de esto, deja las listas vacías.`;
}

function bloqueDeEntrada(e: EntradaDocumento): Anthropic.Beta.BetaContentBlockParam[] {
  if (e.tipo === 'pdf') {
    return [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: e.datos.toString('base64') }, title: e.nombre }];
  }
  if (e.tipo === 'imagen') {
    return [{ type: 'text', text: `Foto: «${e.nombre}»` }, { type: 'image', source: { type: 'base64', media_type: e.mediaType, data: e.datos.toString('base64') } }];
  }
  return [{ type: 'text', text: `${e.titulo ? `Título que le ha puesto el negocio: «${e.titulo}»\n\n` : ''}Texto escrito por el negocio:\n\n${e.texto}` }];
}

function lista<T = Record<string, unknown>>(v: unknown): T[] {
  return Array.isArray(v) ? (v.filter((x) => typeof x === 'object' && x !== null) as T[]) : [];
}
function cadena(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}
function cadenas(v: unknown): string[] {
  return Array.isArray(v) ? v.map(cadena).filter(Boolean) : [];
}

/** La respuesta del modelo, comprobada campo a campo (nunca se confía en su forma). */
export function interpretarLectura(j: Record<string, unknown>): Omit<Lectura, 'modelo' | 'usage'> {
  const valores: ValorLeido[] = [];
  for (const p of lista(j.precios)) {
    const euros = Number(p.euros);
    if (Number.isFinite(euros) && euros >= 0) valores.push({ tipo: 'precio', servicio: cadena(p.servicio), etiqueta: cadena(p.etiqueta), euros, fragmento: cadena(p.fragmento), textoValor: cadena(p.texto_valor) });
  }
  for (const d of lista(j.duraciones)) {
    const m = Number(d.minutos);
    if (Number.isInteger(m) && m > 0) valores.push({ tipo: 'duracion', servicio: cadena(d.servicio), etiqueta: cadena(d.etiqueta), minutos: m, fragmento: cadena(d.fragmento), textoValor: cadena(d.texto_valor) });
  }
  for (const h of lista(j.horarios)) {
    const dias = [...new Set(cadenas(h.dias).map((d) => NUMERO_DIA[d.toLowerCase()]).filter((d): d is number => d !== undefined))];
    if (dias.length === 0) continue;
    const tramos = h.cerrado === true ? [] : lista(h.tramos).map((t) => ({ desde: cadena(t.desde), hasta: cadena(t.hasta) })).filter((t) => t.desde && t.hasta);
    if (h.cerrado !== true && tramos.length === 0) continue;
    valores.push({ tipo: 'horario', servicio: '', etiqueta: '', dias, tramos, fragmento: cadena(h.fragmento), textoValor: cadena(h.texto_valor) });
  }
  for (const tipo of ['direccion', 'telefono'] as const) {
    const x = lista(j[tipo])[0];
    if (x && cadena(x.texto)) valores.push({ tipo, servicio: '', etiqueta: '', texto: cadena(x.texto), fragmento: cadena(x.fragmento), textoValor: cadena(x.texto_valor) });
  }
  const dp = (typeof j.datos_de_personas === 'object' && j.datos_de_personas !== null ? j.datos_de_personas : {}) as Record<string, unknown>;
  const paginas = Number(j.paginas);
  return {
    legible: j.legible !== false,
    titulo: cadena(j.titulo).slice(0, 200),
    resumen: cadena(j.resumen).slice(0, 300),
    paginas: Number.isInteger(paginas) && paginas > 0 ? Math.min(paginas, 1000) : 1,
    paginasIlegibles: (Array.isArray(j.paginas_ilegibles) ? j.paginas_ilegibles : []).map(Number).filter((n) => Number.isInteger(n) && n > 0),
    datosDePersonas: { hay: dp.hay === true, que: cadena(dp.que) },
    secciones: lista(j.secciones)
      .map((s) => ({ titulo: cadena(s.titulo).slice(0, 200), texto: cadena(s.texto), palabras: cadenas(s.palabras).slice(0, 30) }))
      .filter((s) => s.texto),
    valores,
    sinServicio: [...new Set(cadenas(j.tratamientos_sin_servicio))].slice(0, 50),
  };
}

/**
 * Lee el documento con el modelo. Lanza LecturaFallida si el modelo no
 * contesta, corta la respuesta o no se entiende lo que devuelve: en ese caso
 * no se guarda nada (plan de pruebas, 53).
 */
export async function leerConIA(
  model: ModelClient,
  p: { modelo: string; entrada: EntradaDocumento; servicios: string[] },
): Promise<Lectura> {
  let r: Anthropic.Beta.BetaMessage;
  try {
    r = await model.create({
      model: p.modelo,
      max_tokens: MAX_TOKENS_LECTURA,
      system: [{ type: 'text', text: sistema(p.servicios) }],
      messages: [{ role: 'user', content: [...bloqueDeEntrada(p.entrada), { type: 'text', text: 'Lee este documento y devuelve los datos.' }] }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: ESQUEMA_LECTURA } },
    });
  } catch (e) {
    const status = (e as { status?: number })?.status;
    // 400 con un PDF: no se puede abrir (dañado o protegido).
    if (status === 400 && p.entrada.tipo === 'pdf') throw new LecturaFallida('no_se_abre', String((e as Error).message));
    throw new LecturaFallida('ia_no_responde', String((e as Error)?.message ?? e));
  }
  const usage: UsageDetalle = {
    input_tokens: r.usage.input_tokens,
    output_tokens: r.usage.output_tokens,
    cache_read_input_tokens: r.usage.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: r.usage.cache_creation_input_tokens ?? 0,
  };
  const conUso = (e: LecturaFallida) => {
    e.modelo = r.model;
    e.usage = usage;
    return e;
  };
  if (r.stop_reason === 'max_tokens') throw conUso(new LecturaFallida('demasiado_largo', 'La lectura se cortó'));
  if (r.stop_reason !== 'end_turn') throw conUso(new LecturaFallida('ia_no_responde', `stop_reason ${r.stop_reason}`));
  const texto = r.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  let j: unknown;
  try {
    j = JSON.parse(texto);
  } catch {
    throw conUso(new LecturaFallida('ia_no_responde', 'La respuesta no es JSON'));
  }
  if (typeof j !== 'object' || j === null) throw conUso(new LecturaFallida('ia_no_responde', 'La respuesta no es un objeto'));
  return { ...interpretarLectura(j as Record<string, unknown>), modelo: r.model, usage };
}

/** Tiempo máximo para leer un documento: cabe en una función de Vercel (300 s), sin reintentos. */
export const TIMEOUT_LECTURA_MS = 240_000;

/**
 * El lector de los servidores (local y Vercel): un cliente propio, con más
 * tiempo de espera que el del chat y sin reintentos (un PDF largo tarda), y el
 * modelo de CONOCIMIENTO_MODEL o, si no está, el del chat (AGENT_MODEL).
 */
export function lectorDesdeEnv(settings: Pick<AgentSettings, 'model'>, env: NodeJS.ProcessEnv = process.env): { model: ModelClient; modelo: string } {
  return {
    model: anthropicModelClient({ timeoutMs: TIMEOUT_LECTURA_MS, maxRetries: 0 }),
    modelo: env.CONOCIMIENTO_MODEL?.trim() || settings.model,
  };
}
