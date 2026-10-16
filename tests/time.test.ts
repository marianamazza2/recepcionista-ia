// Conversión hora local ↔ UTC (T-01). Sin base de datos.
//
// Cambios de hora de Madrid usados (fechas lejanas, como en la Fase 1, D-29):
//   · 31/03/2030: a las 02:00 pasa a ser las 03:00 (la hora 02:xx no existe).
//   · 27/10/2030: a las 03:00 vuelve a ser las 02:00 (la hora 02:xx ocurre dos veces).

import { describe, expect, it } from 'vitest';

import {
  InvalidLocalTimeError,
  diasEntre,
  fechaLarga,
  inicioDelDia,
  localToUtc,
  sumarDias,
  utcToLocal,
  weekdayDe,
} from '../src/core/time.js';

const TZ = 'Europe/Madrid';

describe('localToUtc / utcToLocal', () => {
  it('en invierno Madrid es UTC+1 y en verano UTC+2', () => {
    expect(localToUtc('2030-01-15', '09:00', TZ).toISOString()).toBe('2030-01-15T08:00:00.000Z');
    expect(localToUtc('2030-07-15', '09:00', TZ).toISOString()).toBe('2030-07-15T07:00:00.000Z');
  });

  it('las 9:00 del lunes antes y después del cambio de octubre son instantes con distinto desfase', () => {
    // El mismo caso que fija la Fase 1 (D-29): 07:00 UTC antes, 08:00 UTC después.
    expect(localToUtc('2030-10-21', '09:00', TZ).toISOString()).toBe('2030-10-21T07:00:00.000Z');
    expect(localToUtc('2030-10-28', '09:00', TZ).toISOString()).toBe('2030-10-28T08:00:00.000Z');
  });

  it('el mismo día del cambio, las horas antes y después de la madrugada usan su propio desfase', () => {
    expect(localToUtc('2030-10-27', '01:30', TZ).toISOString()).toBe('2030-10-26T23:30:00.000Z');
    expect(localToUtc('2030-10-27', '10:00', TZ).toISOString()).toBe('2030-10-27T09:00:00.000Z');
    expect(localToUtc('2030-03-31', '01:30', TZ).toISOString()).toBe('2030-03-31T00:30:00.000Z');
    expect(localToUtc('2030-03-31', '10:00', TZ).toISOString()).toBe('2030-03-31T08:00:00.000Z');
  });

  it('marzo: una hora que no existe se rechaza, no se inventa', () => {
    expect(() => localToUtc('2030-03-31', '02:30', TZ)).toThrow(InvalidLocalTimeError);
  });

  it('octubre: una hora que ocurre dos veces se resuelve a la primera (la de verano)', () => {
    const t = localToUtc('2030-10-27', '02:30', TZ);
    expect(t.toISOString()).toBe('2030-10-27T00:30:00.000Z');
    // La segunda vez que el reloj marca 02:30 es una hora después, y vuelve
    // a leerse como 02:30 local.
    const segunda = new Date(t.getTime() + 3600_000);
    expect(utcToLocal(segunda, TZ)).toMatchObject({ fecha: '2030-10-27', hora: '02:30' });
  });

  it('ida y vuelta cada 30 minutos durante los dos días de cambio', () => {
    for (const fecha of ['2030-03-31', '2030-10-27']) {
      for (let m = 0; m < 24 * 60; m += 30) {
        const hora = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
        if (fecha === '2030-03-31' && hora.startsWith('02:')) continue; // no existen
        expect(utcToLocal(localToUtc(fecha, hora, TZ), TZ)).toMatchObject({ fecha, hora });
      }
    }
  });

  it('el día local de un instante cambia a medianoche local, no a medianoche UTC', () => {
    // 23:30 UTC del 20/10 son las 01:30 del 21/10 en Madrid (verano).
    expect(utcToLocal(new Date('2030-10-20T23:30:00Z'), TZ)).toEqual({
      fecha: '2030-10-21',
      hora: '01:30',
      weekday: 1,
    });
  });

  it('otra zona horaria funciona igual (Canarias va una hora por detrás)', () => {
    expect(localToUtc('2030-07-15', '09:00', 'Atlantic/Canary').toISOString()).toBe('2030-07-15T08:00:00.000Z');
  });

  it('rechaza formatos y fechas imposibles', () => {
    expect(() => localToUtc('2030-02-30', '10:00', TZ)).toThrow(InvalidLocalTimeError);
    expect(() => localToUtc('30/10/2030', '10:00', TZ)).toThrow(InvalidLocalTimeError);
    expect(() => localToUtc('2030-10-30', '24:00', TZ)).toThrow(InvalidLocalTimeError);
    expect(() => localToUtc('2030-10-30', '9:00', TZ)).toThrow(InvalidLocalTimeError);
  });
});

describe('aritmética de calendario', () => {
  it('inicioDelDia es la medianoche local, también el día del cambio', () => {
    expect(inicioDelDia('2030-10-27', TZ).toISOString()).toBe('2030-10-26T22:00:00.000Z');
    expect(inicioDelDia('2030-10-28', TZ).toISOString()).toBe('2030-10-27T23:00:00.000Z');
    // El día del cambio de octubre dura 25 horas.
    expect(inicioDelDia('2030-10-28', TZ).getTime() - inicioDelDia('2030-10-27', TZ).getTime()).toBe(25 * 3600_000);
  });

  it('sumarDias, diasEntre y weekdayDe no dependen de la zona', () => {
    expect(sumarDias('2030-12-31', 1)).toBe('2031-01-01');
    expect(sumarDias('2030-03-01', -1)).toBe('2030-02-28');
    expect(diasEntre('2030-10-25', '2030-10-28')).toBe(3);
    expect(weekdayDe('2030-10-27')).toBe(0); // domingo
    expect(fechaLarga('2030-10-28')).toBe('lunes 28 de octubre de 2030');
  });
});
