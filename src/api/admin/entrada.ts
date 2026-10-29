// =============================================================================
// Lectura y validación del cuerpo de las peticiones del panel (Fase 4 · 4.2)
// =============================================================================
// La forma de la petición se valida aquí (tipos, longitudes, formatos simples)
// con un mensaje en palabras para el panel. Lo que es regla de negocio
// (horarios, solapes, límites de las preguntas, lo que falta para activar…)
// lo comprueba la base, no esto.
// =============================================================================

import { isFecha, isHora } from '../../core/time.js';
import { ErrorPanel } from './errores.js';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class Entrada {
  constructor(private readonly b: Record<string, unknown>) {}

  private mal(mensaje: string): never {
    throw new ErrorPanel(400, mensaje);
  }

  /** Texto obligatorio, sin espacios a los lados. */
  texto(k: string, etiqueta: string, max = 200): string {
    const v = this.b[k];
    if (typeof v !== 'string' || v.trim() === '') this.mal(`Falta ${etiqueta}.`);
    if (v.trim().length > max) this.mal(`${mayuscula(etiqueta)}: como mucho ${max} caracteres.`);
    return v.trim();
  }

  /** Texto opcional: vacío o ausente → null. */
  textoOpcional(k: string, etiqueta: string, max = 2000): string | null {
    const v = this.b[k];
    if (v === undefined || v === null) return null;
    if (typeof v !== 'string') this.mal(`${mayuscula(etiqueta)} no es un texto.`);
    const t = v.trim();
    if (t.length > max) this.mal(`${mayuscula(etiqueta)}: como mucho ${max} caracteres.`);
    return t === '' ? null : t;
  }

  entero(k: string, etiqueta: string, min: number, max: number): number {
    const v = this.b[k];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) this.mal(`${mayuscula(etiqueta)} tiene que ser un número entero entre ${min} y ${max}.`);
    return v;
  }

  numero(k: string, etiqueta: string, min: number, max: number): number {
    const v = this.b[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) this.mal(`${mayuscula(etiqueta)} tiene que ser un número entre ${min} y ${max}.`);
    return v;
  }

  numeroOpcional(k: string, etiqueta: string, min: number, max: number): number | null {
    const v = this.b[k];
    return v === undefined || v === null || v === '' ? null : this.numero(k, etiqueta, min, max);
  }

  booleano(k: string, etiqueta: string): boolean {
    const v = this.b[k];
    if (typeof v !== 'boolean') this.mal(`Falta ${etiqueta}.`);
    return v;
  }

  opcion<T extends string>(k: string, etiqueta: string, valores: readonly T[]): T {
    const v = this.b[k];
    if (typeof v !== 'string' || !valores.includes(v as T)) this.mal(`${mayuscula(etiqueta)} no es válido.`);
    return v as T;
  }

  uuid(k: string, etiqueta: string): string {
    const v = this.b[k];
    if (typeof v !== 'string' || !UUID.test(v)) this.mal(`Falta ${etiqueta}.`);
    return v.toLowerCase();
  }

  uuidOpcional(k: string, etiqueta: string): string | null {
    const v = this.b[k];
    return v === undefined || v === null || v === '' ? null : this.uuid(k, etiqueta);
  }

  listaDeUuid(k: string, etiqueta: string): string[] {
    const v = this.b[k];
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !UUID.test(x))) this.mal(`${mayuscula(etiqueta)} no es una lista válida.`);
    return [...new Set((v as string[]).map((x) => x.toLowerCase()))];
  }

  fecha(k: string, etiqueta: string): string {
    const v = this.b[k];
    if (typeof v !== 'string' || !isFecha(v)) this.mal(`${mayuscula(etiqueta)} no es una fecha válida.`);
    return v;
  }

  hora(k: string, etiqueta: string): string {
    const v = this.b[k];
    if (typeof v !== 'string' || !isHora(v)) this.mal(`${mayuscula(etiqueta)} no es una hora válida (HH:MM).`);
    return v;
  }

  /** Lista de objetos, cada uno leído con su propia Entrada. */
  lista<T>(k: string, etiqueta: string, max: number, leer: (e: Entrada, i: number) => T): T[] {
    const v = this.b[k];
    if (!Array.isArray(v)) this.mal(`Falta ${etiqueta}.`);
    if (v.length > max) this.mal(`${mayuscula(etiqueta)}: como mucho ${max}.`);
    return v.map((x, i) => {
      if (typeof x !== 'object' || x === null || Array.isArray(x)) this.mal(`${mayuscula(etiqueta)} no es válido.`);
      return leer(new Entrada(x as Record<string, unknown>), i);
    });
  }

  valor(k: string): unknown {
    return this.b[k];
  }
}

/** 'HH:MM' o '24:00' (cierre a medianoche, como lo guarda la base). */
export function horaDeTramo(e: Entrada, k: string, etiqueta: string): string {
  return e.valor(k) === '24:00' ? '24:00' : e.hora(k, etiqueta);
}

function mayuscula(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** PW-06: un host tal cual lo compara el widget (sin esquema, puerto ni barra). */
export function normalizarDominio(d: string): string | null {
  const t = d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
  return /^(localhost|[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+)$/.test(t) ? t : null;
}
