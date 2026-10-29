// =============================================================================
// Cuentas de horarios del panel (Fase 4 · 4.3)
// =============================================================================
// Funciones puras (sin React ni red), para poder testearlas desde tests/:
//
//   · fueraDelLocal (PI-18): los tramos de un horario propio que caen, total o
//     parcialmente, fuera del horario del local ese día (o en un día que el
//     local cierra). Se PERMITE guardarlos (PD-01: el horario propio manda ese
//     día), pero el panel avisa y pide confirmación antes. No es una regla de
//     la base: es un aviso para no equivocarse al cargarlo.
//   · copiarDia: los tramos de un día, copiados a otros días (sustituyen los
//     que tuvieran). Mejora de la interfaz, sin regla de negocio.
//
// Horas 'HH:MM' locales del negocio; '24:00' es la medianoche del cierre.
// weekday: 0 = domingo … 6 = sábado (D-10).
// =============================================================================

export interface TramoDia {
  weekday: number;
  apertura: string;
  cierre: string;
}

function minutos(h: string): number {
  return Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
}

/** ¿Queda algún trozo de [desde, hasta) sin cubrir por los tramos del local? */
function quedaFuera(desde: number, hasta: number, local: { desde: number; hasta: number }[]): boolean {
  let cursor = desde;
  for (const t of [...local].sort((a, b) => a.desde - b.desde)) {
    if (t.hasta <= cursor) continue;
    if (t.desde > cursor) return true; // hueco sin cubrir
    cursor = t.hasta;
    if (cursor >= hasta) return false;
  }
  return cursor < hasta;
}

/** PI-18: los tramos propios que no caben enteros dentro del horario del local de su día. */
export function fueraDelLocal<T extends TramoDia>(propios: T[], local: TramoDia[]): T[] {
  return propios.filter((p) => {
    const delDia = local.filter((l) => l.weekday === p.weekday).map((l) => ({ desde: minutos(l.apertura), hasta: minutos(l.cierre) }));
    return quedaFuera(minutos(p.apertura), minutos(p.cierre), delDia);
  });
}

/** Copia los tramos del día `origen` a los días `destinos`, sustituyendo los que tuvieran. */
export function copiarDia<T extends TramoDia>(tramos: T[], origen: number, destinos: number[]): T[] {
  const aCopiar = tramos.filter((t) => t.weekday === origen);
  const otros = destinos.filter((d) => d !== origen);
  return [
    ...tramos.filter((t) => !otros.includes(t.weekday)),
    ...otros.flatMap((d) => aCopiar.map((t) => ({ ...t, weekday: d }))),
  ];
}

/** Días laborables (lunes a viernes) y toda la semana, para "Copiar a…". */
export const LABORABLES = [1, 2, 3, 4, 5];
export const TODA_LA_SEMANA = [1, 2, 3, 4, 5, 6, 0];
