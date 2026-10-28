// =============================================================================
// Piezas comunes del panel (Fase 4 · 4.3): rutas por hash, avisos, formatos
// =============================================================================

import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { ErrorApi } from './api';

/** La ruta es el hash (#/negocios/…): sin dependencias de router. */
export function useRuta(): string[] {
  const leer = () => window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [ruta, setRuta] = useState(leer);
  useEffect(() => {
    const f = () => setRuta(leer());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return ruta;
}

export function ir(ruta: string): void {
  window.location.hash = `#/${ruta}`;
}

/** Carga algo de la API y lo deja en estado; `recargar` lo vuelve a pedir. */
export function useCarga<T>(fn: () => Promise<T>, deps: unknown[]): { datos: T | null; error: string | null; recargar: () => void; poner: (t: T) => void } {
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vez, setVez] = useState(0);
  useEffect(() => {
    let vivo = true;
    setError(null);
    fn().then(
      (d) => vivo && setDatos(d),
      (e: unknown) => vivo && setError(mensajeDe(e)),
    );
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, vez]);
  return { datos, error, recargar: useCallback(() => setVez((v) => v + 1), []), poner: setDatos };
}

export function mensajeDe(e: unknown): string {
  return e instanceof ErrorApi ? e.message : 'No se ha podido conectar con el servidor.';
}

/** Ejecuta una acción con "guardando…", y el error o el aviso de guardado. */
export function useAccion(): { ocupado: boolean; error: string | null; ok: string | null; hacer: (f: () => Promise<unknown>, ok?: string) => Promise<boolean> } {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const hacer = useCallback(async (f: () => Promise<unknown>, textoOk = 'Guardado.') => {
    setOcupado(true);
    setError(null);
    setOk(null);
    try {
      await f();
      setOk(textoOk);
      return true;
    } catch (e) {
      setError(mensajeDe(e));
      return false;
    } finally {
      setOcupado(false);
    }
  }, []);
  return { ocupado, error, ok, hacer };
}

export function Aviso({ error, ok }: { error?: string | null; ok?: string | null }) {
  if (error) return <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>;
  if (ok) return <p role="status" className="mt-3 text-sm text-emerald-700">{ok}</p>;
  return null;
}

export function Bloque({ titulo, ayuda, children, id }: { titulo: string; ayuda?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="tarjeta scroll-mt-24">
      <h2 className="text-base font-semibold">{titulo}</h2>
      {ayuda ? <p className="mt-1 text-sm text-slate-500">{ayuda}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Cargando() {
  return <p className="text-sm text-slate-500">Cargando…</p>;
}

export const ESTADOS: Record<string, { texto: string; clase: string }> = {
  trial: { texto: 'En prueba', clase: 'bg-amber-100 text-amber-900' },
  activo: { texto: 'Activo', clase: 'bg-emerald-100 text-emerald-900' },
  pausado: { texto: 'Pausado', clase: 'bg-slate-200 text-slate-700' },
};

export function EtiquetaEstado({ estado }: { estado: string }) {
  const e = ESTADOS[estado] ?? { texto: estado, clase: 'bg-slate-100' };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${e.clase}`}>{e.texto}</span>;
}

/** Lunes primero, como se lee un horario en España. weekday: 0 = domingo. */
export const SEMANA: { weekday: number; nombre: string }[] = [
  { weekday: 1, nombre: 'Lunes' },
  { weekday: 2, nombre: 'Martes' },
  { weekday: 3, nombre: 'Miércoles' },
  { weekday: 4, nombre: 'Jueves' },
  { weekday: 5, nombre: 'Viernes' },
  { weekday: 6, nombre: 'Sábado' },
  { weekday: 0, nombre: 'Domingo' },
];

export function fechaHora(iso: string, tz?: string): string {
  return new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short', ...(tz ? { timeZone: tz } : {}) });
}

/** 'AAAA-MM-DD' → '16/10/2030'. */
export function fechaCorta(f: string): string {
  const [y, m, d] = f.split('-');
  return `${d}/${m}/${y}`;
}

export function usd(n: number, dec = 4): string {
  return `${n.toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec })} US$`;
}

/** Motivos de derivar_a_humano y de las derivaciones automáticas (core/tools/derivar.ts). */
const MOTIVOS: Record<string, string> = {
  dato_desconocido: 'No sabía la respuesta',
  la_clienta_lo_pide: 'Pidió hablar con una persona',
  insiste_en_hora_no_disponible: 'Insistía en una hora que no hay',
  salud: 'Pregunta de salud',
  queja: 'Queja o reclamación',
  cancelacion_bloqueada: 'Cancelación fuera de plazo',
  no_entiendo: 'No la entendía',
  error: 'Algo falló',
  otro: 'Otro motivo',
  limite_vueltas: 'Límite de pasos del agente',
  limite_tokens: 'Conversación demasiado larga',
};

/** "dato_desconocido: pregunta por el parking" → título y resumen. */
export function motivo(m: string | null): { titulo: string; resumen: string } {
  if (!m) return { titulo: 'Sin motivo', resumen: '' };
  const i = m.indexOf(': ');
  const codigo = i >= 0 ? m.slice(0, i) : m;
  return { titulo: MOTIVOS[codigo] ?? codigo, resumen: i >= 0 ? m.slice(i + 2) : '' };
}
