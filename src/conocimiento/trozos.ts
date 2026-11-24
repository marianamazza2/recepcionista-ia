// =============================================================================
// Partir un documento en trozos para buscar (Fase 5 · 5.2, PB-09)
// =============================================================================
// Lo que se busca son trozos, no documentos enteros: así el agente recibe solo
// lo que responde a la pregunta (y cuesta menos, PB-07). Reglas del spec:
//
//   · por secciones y párrafos, de unos 1.000–1.500 caracteres;
//   · con algo de solape (la última línea del trozo anterior, si es corta),
//     para que una explicación que cae entre dos trozos no se pierda;
//   · sin partir una lista de precios a la mitad: solo se corta entre líneas
//     (y, si una línea sola es enorme, entre frases);
//   · el título del documento y el de la sección van en cada trozo (en
//     `titulos`, que se busca con más peso y el agente ve).
//
// Las «palabras con que lo pediría una clienta» son de la sección (las
// escribe la IA al leerla) y van en todos sus trozos.
// Puro: sin base ni modelo.
// =============================================================================

import type { TrozoNuevo } from '../db/conocimiento.js';

export const TROZO_MAX = 1500;
export const TROZO_OBJETIVO = 1000;
const SOLAPE_MAX = 200;

export interface Seccion {
  titulo: string;
  texto: string;
  palabras: string[];
}

/** El texto entero del documento tal como se guarda (`contenido_raw`). */
export function textoDelDocumento(secciones: Seccion[]): string {
  return secciones
    .map((s) => (s.titulo ? `## ${s.titulo}\n${s.texto.trim()}` : s.texto.trim()))
    .filter(Boolean)
    .join('\n\n');
}

/** Una línea demasiado larga, en frases (y en último caso, a cuchillo). */
function partirLinea(l: string): string[] {
  if (l.length <= TROZO_MAX) return [l];
  const frases = l.match(/[^.!?]+[.!?]+\s*|[^.!?]+$/g) ?? [l];
  const out: string[] = [];
  let actual = '';
  for (const f of frases) {
    if ((actual + f).length > TROZO_MAX && actual) {
      out.push(actual.trim());
      actual = '';
    }
    if (f.length > TROZO_MAX) {
      for (let i = 0; i < f.length; i += TROZO_MAX) out.push(f.slice(i, i + TROZO_MAX).trim());
    } else {
      actual += f;
    }
  }
  if (actual.trim()) out.push(actual.trim());
  return out;
}

/** Los bloques de una sección: párrafos, o líneas si un párrafo no cabe en un trozo. */
function bloques(texto: string): string[] {
  const parrafos = texto
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parrafos.flatMap((p) => (p.length <= TROZO_MAX ? [p] : p.split('\n').flatMap((l) => partirLinea(l.trim())).filter(Boolean)));
}

/** La cola corta del trozo anterior que se repite al principio del siguiente. */
function solape(trozo: string): string {
  const ultima = trozo.split('\n').at(-1) ?? '';
  return ultima.length <= SOLAPE_MAX ? ultima : '';
}

export function partirEnTrozos(tituloDocumento: string, secciones: Seccion[]): TrozoNuevo[] {
  const out: TrozoNuevo[] = [];
  for (const s of secciones) {
    const titulos = s.titulo ? `${tituloDocumento} · ${s.titulo}` : tituloDocumento;
    const palabras = [...new Set(s.palabras.map((p) => p.trim()).filter(Boolean))].join(', ');
    let actual = '';
    const cerrar = () => {
      if (actual.trim()) out.push({ orden: out.length + 1, titulos, contenido: actual.trim(), palabras });
    };
    for (const b of bloques(s.texto)) {
      const junto = actual ? `${actual}\n${b}` : b;
      if (actual && (junto.length > TROZO_MAX || actual.length >= TROZO_OBJETIVO)) {
        cerrar();
        const cola = solape(actual);
        actual = cola && `${cola}\n${b}`.length <= TROZO_MAX ? `${cola}\n${b}` : b;
      } else {
        actual = junto;
      }
    }
    cerrar();
  }
  return out;
}
