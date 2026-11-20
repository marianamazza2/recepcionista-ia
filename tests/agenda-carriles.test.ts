// =============================================================================
// La agenda reparte en carriles las citas que coinciden (Fase 9 · PC-16)
// =============================================================================
// Aceptación Fase 9, caso 74: en la vista de semana, cuatro profesionales con
// cita a la misma hora se tapaban unas a otras en la columna del día. Ahora
// cada grupo de citas que se solapan se reparte el ancho, una al lado de otra.
// =============================================================================

import { describe, expect, it } from 'vitest';

import { carriles } from '../admin/src/paginas/Agenda';

const cita = (id: string, horaInicio: string, horaFin: string) => ({ id, horaInicio, horaFin });

describe('carriles de la agenda', () => {
  it('citas que no se tocan: cada una ocupa todo el ancho', () => {
    const r = carriles([cita('a', '09:00', '10:00'), cita('b', '10:00', '11:00')]);
    expect(r.get('a')).toEqual({ carril: 0, de: 1 });
    expect(r.get('b')).toEqual({ carril: 0, de: 1 });
  });

  it('cuatro a la misma hora: cuatro carriles, una al lado de otra', () => {
    const r = carriles(['a', 'b', 'c', 'd'].map((id) => cita(id, '09:00', '10:00')));
    expect([...r.values()].map((x) => x.carril).sort()).toEqual([0, 1, 2, 3]);
    expect([...r.values()].every((x) => x.de === 4)).toBe(true);
  });

  it('un carril que se libera se reutiliza dentro del mismo grupo', () => {
    // a 09–11 · b 09–09:30 · c 09:30–10 (va donde estaba b): dos carriles.
    const r = carriles([cita('a', '09:00', '11:00'), cita('b', '09:00', '09:30'), cita('c', '09:30', '10:00')]);
    expect(r.get('a')!.carril).toBe(0);
    expect(r.get('b')!.carril).toBe(1);
    expect(r.get('c')).toEqual({ carril: 1, de: 2 });
  });

  it('dos grupos separados en el día no se influyen', () => {
    const r = carriles([cita('a', '09:00', '10:00'), cita('b', '09:30', '10:30'), cita('c', '16:00', '17:00')]);
    expect(r.get('a')!.de).toBe(2);
    expect(r.get('c')).toEqual({ carril: 0, de: 1 });
  });
});
