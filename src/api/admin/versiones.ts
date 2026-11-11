// =============================================================================
// Versiones por sección del panel (Fase 4 · PI-22)
// =============================================================================
// PI-22 (Mariana, 05/11/2026): si la misma sección de un negocio se edita en
// dos sitios a la vez, gana la PRIMERA que se guardó. La segunda no se guarda
// y el panel avisa. Secciones distintas se siguen guardando las dos.
//
// Cómo: la ficha (GET negocios/:id) trae una huella de cada sección (un hash
// de lo que tiene). El panel la manda al guardar esa sección (campo
// `version`); si no coincide con la de ahora, alguien la cambió desde que se
// abrió: 409 cambiado_por_otra_persona y no se guarda nada. Sin migración: la
// huella se calcula de lo que ya devuelve la ficha.
//
// Límite conocido: dos guardados de la misma sección en el mismo instante
// (milisegundos) pueden pasar los dos la comprobación. Para dos personas o
// dos pestañas guardando a mano no pasa en la práctica; si el portal (Fase 9)
// lo necesita, se pasa a una columna de versión en la base.
//
// Lo que cambia solo (citasFuturas) no cuenta: una reserva nueva no hace que
// el panel diga que otra persona tocó el servicio.
// =============================================================================

import { createHash } from 'node:crypto';

import type { NegocioPanel } from '../../db/negocios.js';
import type { Entrada } from './entrada.js';
import { ErrorPanel } from './errores.js';

export interface Versiones {
  datos: string;
  reglas: string;
  chat: string;
  /** Por id de servicio, de profesional y de pregunta. */
  servicios: Record<string, string>;
  profesionales: Record<string, string>;
  preguntas: Record<string, string>;
  /** "local" y cada id de profesional (sus tramos y sus días libres). */
  horario: Record<string, string>;
}

export const TEXTO_CAMBIADO =
  'Esto lo ha cambiado otra persona (u otra pestaña) mientras lo editabas. No se ha guardado: recarga para ver lo último.';

function huella(x: unknown): string {
  return createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);
}

function sinCitas<T extends { citasFuturas: number }>(x: T): Omit<T, 'citasFuturas'> {
  const { citasFuturas: _, ...resto } = x;
  return resto;
}

export function versiones(n: NegocioPanel): Versiones {
  const horario: Record<string, string> = { local: huella(n.horario.filter((t) => t.staffId === null)) };
  for (const p of n.profesionales) {
    horario[p.id] = huella({
      tramos: n.horario.filter((t) => t.staffId === p.id),
      diasLibres: n.diasLibres.filter((d) => d.staffId === p.id),
    });
  }
  return {
    datos: huella([n.nombre, n.sector, n.timezone, n.direccion, n.telefonoHumano, n.tonoDeVoz, n.mensajeBienvenida]),
    reglas: huella(n.reglas),
    chat: huella(n.chat),
    servicios: Object.fromEntries(n.servicios.map((s) => [s.id, huella(sinCitas(s))])),
    profesionales: Object.fromEntries(n.profesionales.map((p) => [p.id, huella(sinCitas(p))])),
    preguntas: Object.fromEntries(n.preguntas.map((q) => [q.id, huella(q)])),
    horario,
  };
}

/**
 * PI-22: si el panel mandó la versión con la que abrió la sección y ya no es
 * la de ahora, no se guarda. Sin `version` (llamadas antiguas, scripts) no se
 * comprueba: el panel siempre la manda.
 */
export function comprobarVersion(e: Entrada, actual: string | undefined): void {
  const v = e.valor('version');
  if (v === undefined || v === null) return;
  if (typeof v !== 'string' || v !== actual) {
    throw new ErrorPanel(409, TEXTO_CAMBIADO, { error: 'cambiado_por_otra_persona' });
  }
}
