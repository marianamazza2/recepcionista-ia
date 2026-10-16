// =============================================================================
// Hora local del negocio ↔ instante UTC (T-01)
// =============================================================================
// La base y el adaptador trabajan con instantes (Date, UTC). El modelo habla en
// hora LOCAL del negocio: "2026-10-20", "16:00". Este es el ÚNICO sitio donde
// se convierte entre las dos cosas. El modelo nunca ve ni calcula UTC.
//
// Sin offsets a mano: la zona se resuelve con Intl (la base de datos de zonas
// de Node), igual que Postgres resuelve `AT TIME ZONE` en la base (D-29).
//
// El cambio de hora:
//   · Marzo: una hora local NO EXISTE (02:00–02:59 en Madrid). Pedirla lanza
//     InvalidLocalTimeError: no hay ningún instante que le corresponda.
//   · Octubre: una hora local ocurre DOS VECES (02:00–02:59). Se toma la
//     primera (la de verano), que es la que viene antes en el reloj.
//   Ningún negocio del MVP abre a esas horas; lo importante es no inventar.
// =============================================================================

const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'] as const;
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
] as const;

export class InvalidLocalTimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidLocalTimeError';
  }
}

/** Un momento expresado en la hora local del negocio. */
export interface LocalDateTime {
  /** 'YYYY-MM-DD' */
  fecha: string;
  /** 'HH:MM' */
  hora: string;
  /** 0 = domingo … 6 = sábado (D-10) */
  weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Partes de la hora local de un instante. */
function partes(instante: Date, timeZone: string): { y: number; m: number; d: number; h: number; mi: number; s: number } {
  const p: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(instante)) {
    if (part.type !== 'literal') {
      p[part.type] = Number(part.value);
    }
  }
  return { y: p.year!, m: p.month!, d: p.day!, h: p.hour!, mi: p.minute!, s: p.second! };
}

/** Desfase de la zona en ese instante, en milisegundos (hora local − UTC). */
function desfase(instante: Date, timeZone: string): number {
  const p = partes(instante, timeZone);
  const comoUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return comoUtc - Math.floor(instante.getTime() / 1000) * 1000;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function isFecha(s: string): boolean {
  const m = FECHA.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

export function isHora(s: string): boolean {
  return HORA.test(s);
}

/**
 * El instante en que el reloj del negocio marca `fecha` `hora`.
 * Lanza InvalidLocalTimeError si la fecha o la hora no son válidas o si esa
 * hora no existe ese día (cambio de hora de marzo).
 */
export function localToUtc(fecha: string, hora: string, timeZone: string): Date {
  if (!isFecha(fecha)) {
    throw new InvalidLocalTimeError(`Fecha no válida: "${fecha}" (formato AAAA-MM-DD)`);
  }
  if (!isHora(hora)) {
    throw new InvalidLocalTimeError(`Hora no válida: "${hora}" (formato HH:MM, de 00:00 a 23:59)`);
  }
  const [y, m, d] = fecha.split('-').map(Number) as [number, number, number];
  const [h, mi] = hora.split(':').map(Number) as [number, number];
  const comoUtc = Date.UTC(y, m - 1, d, h, mi);

  // Los dos desfases posibles alrededor de esa hora: el de unas horas antes y
  // el de unas horas después. Fuera del cambio de hora coinciden.
  const desfases = new Set([
    desfase(new Date(comoUtc - 12 * 3600_000), timeZone),
    desfase(new Date(comoUtc + 12 * 3600_000), timeZone),
  ]);
  const candidatos = [...desfases]
    .map((off) => new Date(comoUtc - off))
    .filter((c) => {
      const l = utcToLocal(c, timeZone);
      return l.fecha === fecha && l.hora === hora;
    })
    .sort((a, b) => a.getTime() - b.getTime());

  const primero = candidatos[0];
  if (!primero) {
    throw new InvalidLocalTimeError(`Las ${hora} del ${fecha} no existen en ${timeZone} (cambio de hora)`);
  }
  return primero;
}

/** La fecha, hora y día de la semana que marca el reloj del negocio en ese instante. */
export function utcToLocal(instante: Date, timeZone: string): LocalDateTime {
  const p = partes(instante, timeZone);
  return {
    fecha: `${p.y}-${pad(p.m)}-${pad(p.d)}`,
    hora: `${pad(p.h)}:${pad(p.mi)}`,
    weekday: new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(),
  };
}

/** El instante en que empieza el día local `fecha` (la medianoche del negocio). */
export function inicioDelDia(fecha: string, timeZone: string): Date {
  return localToUtc(fecha, '00:00', timeZone);
}

/** `fecha` + `dias` días de calendario. */
export function sumarDias(fecha: string, dias: number): string {
  if (!isFecha(fecha)) {
    throw new InvalidLocalTimeError(`Fecha no válida: "${fecha}" (formato AAAA-MM-DD)`);
  }
  const [y, m, d] = fecha.split('-').map(Number) as [number, number, number];
  const r = new Date(Date.UTC(y, m - 1, d + dias));
  return `${r.getUTCFullYear()}-${pad(r.getUTCMonth() + 1)}-${pad(r.getUTCDate())}`;
}

/** Día de la semana de una fecha de calendario (0 = domingo). */
export function weekdayDe(fecha: string): number {
  const [y, m, d] = fecha.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Días de calendario de `a` a `b` (positivo si `b` es posterior). */
export function diasEntre(a: string, b: string): number {
  const [ya, ma, da] = a.split('-').map(Number) as [number, number, number];
  const [yb, mb, db] = b.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}

/** "martes 20 de octubre de 2026", para que el modelo no tenga que calcular el día. */
export function fechaLarga(fecha: string): string {
  const [y, m, d] = fecha.split('-').map(Number) as [number, number, number];
  return `${DIAS_SEMANA[weekdayDe(fecha)]} ${d} de ${MESES[m - 1]} de ${y}`;
}

/** Minutos desde la medianoche de una hora 'HH:MM' (admite '24:00'). */
export function minutosDelDia(hora: string): number {
  return Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5));
}
