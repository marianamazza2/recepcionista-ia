// Consumo y tope mensual (Fase 3 · 3.3). Sin coste de API.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { costeUsd } from '../src/core/costes.js';
import { createSql } from '../src/db/client.js';
import { costeDelMes, eventosDelTurno, informeConsumo, registrarUso, topeAlcanzado } from '../src/db/usage.js';
import { createTestBusiness, deleteTestBusiness, type TestBusiness } from './helpers/fixtures.js';

const sql = createSql(undefined, { max: 2 });
let N: TestBusiness;

beforeAll(async () => {
  N = await createTestBusiness(sql, 'test-consumo');
});

afterAll(async () => {
  await deleteTestBusiness(sql, N.businessId);
  await sql.end();
});

const u = (i: number, o: number, r = 0, w = 0) => ({ input_tokens: i, output_tokens: o, cache_read_input_tokens: r, cache_creation_input_tokens: w });

describe('eventos de un turno', () => {
  it('mensaje, tokens (coste por modelo) y citas', () => {
    const ev = eventosDelTurno({
      llamadas: [
        { modelo: 'claude-opus-5', usage: u(100, 20, 5000, 0) },
        { modelo: 'claude-opus-4-8', usage: u(10, 5, 0, 200) },
      ],
      citasNuevas: ['c1'],
    });
    expect(ev.map((e) => e.tipo)).toEqual(['mensaje', 'token', 'cita']);
    expect(ev[1]!.cantidad).toBe(5120 + 215);
    expect(ev[1]!.costeUsd).toBeCloseTo(costeUsd('claude-opus-5', u(100, 20, 5000))! + costeUsd('claude-opus-4-8', u(10, 5, 0, 200))!, 9);
    expect(ev[2]).toEqual({ tipo: 'cita', cantidad: 1, costeUsd: 0, detalle: { appointment_id: 'c1' } });
  });

  it('un modelo sin precio cuenta los tokens a 0 y queda anotado', () => {
    const ev = eventosDelTurno({ llamadas: [{ modelo: 'modelo-nuevo', usage: u(100, 10) }], citasNuevas: [] });
    expect(ev[1]).toMatchObject({ cantidad: 110, costeUsd: 0, detalle: { sin_precio: ['modelo-nuevo'] } });
  });

  it('sin llamadas (respuesta fija) solo el mensaje', () => {
    expect(eventosDelTurno({ llamadas: [], citasNuevas: [], respuestaFija: 'tope_mensual' })).toEqual([
      { tipo: 'mensaje', cantidad: 1, costeUsd: 0, detalle: { respuesta_fija: 'tope_mensual' } },
    ]);
  });
});

describe('tope e informe', () => {
  it('el coste del mes cuenta solo el mes natural en curso (zona del negocio)', async () => {
    await registrarUso(sql, N.businessId, null, [{ tipo: 'token', cantidad: 1000, costeUsd: 1.25 }]);
    await sql`
      insert into public.usage_events (business_id, tipo, cantidad, coste_estimado, created_at)
      values (${N.businessId}, 'token', 1, 50, date_trunc('month', now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid' - interval '1 second')`;
    expect(await costeDelMes(sql, N.businessId)).toBeCloseTo(1.25, 6);
    expect(topeAlcanzado(99.99, 100)).toBe(false);
    expect(topeAlcanzado(100, 100)).toBe(true);
  });

  it('el informe suma mensajes, conversaciones, citas, tokens y coste, y avisa desde el 80 %', async () => {
    const [fila] = await sql<{ mes: string }[]>`select to_char(now() at time zone 'Europe/Madrid', 'YYYY-MM') as mes`;
    const mes = fila!.mes;
    const [conv] = await sql<{ id: string }[]>`
      insert into public.conversations (business_id) values (${N.businessId}) returning id`;
    await registrarUso(sql, N.businessId, conv!.id, [
      { tipo: 'mensaje', cantidad: 1, costeUsd: 0 },
      { tipo: 'token', cantidad: 5000, costeUsd: 0.75 },
      { tipo: 'cita', cantidad: 1, costeUsd: 0 },
    ]);
    await sql`update public.businesses set tope_mensual_usd = 2.50 where id = ${N.businessId}`;
    const r = await informeConsumo(sql, N.businessId, mes);
    expect(r).toMatchObject({ mes, mensajes: 1, conversaciones: 1, citas: 1, tokens: 6000, topeUsd: 2.5, aviso: true });
    expect(r.costeUsd).toBeCloseTo(2.0, 6);
    expect(r.fraccionTope).toBeCloseTo(0.8, 6);

    await sql`update public.businesses set tope_mensual_usd = 100 where id = ${N.businessId}`;
    expect((await informeConsumo(sql, N.businessId, mes)).aviso).toBe(false);
    await expect(informeConsumo(sql, N.businessId, '2026-13')).rejects.toThrow('Mes no válido');
  });
});
