// Cuentas de horarios del panel (Fase 4 · 4.3): el aviso de PI-18 y "Copiar a…".
// Funciones puras de admin/src/horario.ts: sin base ni navegador.

import { describe, expect, it } from 'vitest';

import { copiarDia, fueraDelLocal, LABORABLES } from '../admin/src/horario.js';

// Un local como Aurora: L–X partido, J tarde larga, V continuo, S solo mañana, D cerrado.
const LOCAL = [
  ...[1, 2, 3].flatMap((weekday) => [
    { weekday, apertura: '09:00', cierre: '14:00' },
    { weekday, apertura: '16:00', cierre: '20:00' },
  ]),
  { weekday: 4, apertura: '10:00', cierre: '14:00' },
  { weekday: 4, apertura: '16:00', cierre: '21:00' },
  { weekday: 5, apertura: '09:00', cierre: '15:00' },
  { weekday: 6, apertura: '09:00', cierre: '14:00' },
];

describe('PI-18: horario propio fuera del horario del local', () => {
  it('el caso de Mariana: el sábado de 15:00 a 20:00, con el local cerrando a las 14:00, se avisa', () => {
    expect(fueraDelLocal([{ weekday: 6, apertura: '15:00', cierre: '20:00' }], LOCAL)).toEqual([{ weekday: 6, apertura: '15:00', cierre: '20:00' }]);
  });

  it('un tramo dentro de un tramo del local no avisa', () => {
    expect(fueraDelLocal([{ weekday: 4, apertura: '16:00', cierre: '21:00' }], LOCAL)).toEqual([]);
    expect(fueraDelLocal([{ weekday: 1, apertura: '10:00', cierre: '13:00' }], LOCAL)).toEqual([]);
  });

  it('parcialmente fuera: pasado el cierre, antes de abrir o cruzando la pausa del mediodía, avisa', () => {
    const propios = [
      { weekday: 5, apertura: '12:00', cierre: '16:00' }, // el viernes cierra a las 15:00
      { weekday: 2, apertura: '08:00', cierre: '10:00' }, // el martes abre a las 9:00
      { weekday: 3, apertura: '13:00', cierre: '17:00' }, // de 14:00 a 16:00 el local está cerrado
    ];
    expect(fueraDelLocal(propios, LOCAL)).toEqual(propios);
  });

  it('en un día que el local está cerrado (domingo), avisa', () => {
    expect(fueraDelLocal([{ weekday: 0, apertura: '10:00', cierre: '12:00' }], LOCAL)).toHaveLength(1);
  });

  it('dos tramos del local pegados cubren un tramo propio que los cruza; el cierre a medianoche cuenta', () => {
    const pegados = [
      { weekday: 1, apertura: '09:00', cierre: '14:00' },
      { weekday: 1, apertura: '14:00', cierre: '24:00' },
    ];
    expect(fueraDelLocal([{ weekday: 1, apertura: '13:00', cierre: '24:00' }], pegados)).toEqual([]);
  });
});

describe('Copiar a…', () => {
  const lunes = [
    { staffId: null, weekday: 1, apertura: '09:00', cierre: '14:00' },
    { staffId: null, weekday: 1, apertura: '16:00', cierre: '20:00' },
  ];

  it('copia los tramos de un día a los días laborables', () => {
    const r = copiarDia(lunes, 1, LABORABLES);
    expect(r).toHaveLength(10);
    for (const w of LABORABLES) {
      expect(r.filter((t) => t.weekday === w).map((t) => `${t.apertura}-${t.cierre}`)).toEqual(['09:00-14:00', '16:00-20:00']);
    }
  });

  it('sustituye lo que tenían los días de destino y no toca los demás', () => {
    const conViernes = [...lunes, { staffId: null, weekday: 5, apertura: '09:00', cierre: '15:00' }, { staffId: null, weekday: 6, apertura: '10:00', cierre: '13:00' }];
    const r = copiarDia(conViernes, 1, [5]);
    expect(r.filter((t) => t.weekday === 5).map((t) => t.apertura)).toEqual(['09:00', '16:00']);
    expect(r.filter((t) => t.weekday === 6)).toEqual([{ staffId: null, weekday: 6, apertura: '10:00', cierre: '13:00' }]);
  });

  it('copiar a su propio día no duplica nada', () => {
    expect(copiarDia(lunes, 1, [1])).toEqual(lunes);
  });
});
