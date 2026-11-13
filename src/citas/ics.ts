// =============================================================================
// El archivo .ics de una cita (PW-18, 13/11/2026)
// =============================================================================
// Va adjunto al email de confirmación para que la clienta la añada al
// calendario del móvil con un toque: es lo que más ayuda a que no falte.
// Formato iCalendar (RFC 5545): horas en UTC (sufijo Z), líneas con CRLF y
// texto escapado. Sin el tratamiento (ver confirmacion.ts).
// =============================================================================

export interface DatosIcs {
  uid: string;
  inicio: Date;
  fin: Date;
  resumen: string;
  descripcion: string;
  lugar: string | null;
}

/** 2026-11-16T09:00:00Z → 20261116T090000Z */
function utc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** RFC 5545 §3.3.11: barra invertida, punto y coma, coma y saltos de línea. */
export function escaparIcs(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

export function archivoIcs(d: DatosIcs, ahora: Date = new Date()): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MAZZMKT//Recepcionista IA//ES',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${d.uid}`,
    `DTSTAMP:${utc(ahora)}`,
    `DTSTART:${utc(d.inicio)}`,
    `DTEND:${utc(d.fin)}`,
    `SUMMARY:${escaparIcs(d.resumen)}`,
    `DESCRIPTION:${escaparIcs(d.descripcion)}`,
    ...(d.lugar ? [`LOCATION:${escaparIcs(d.lugar)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}
