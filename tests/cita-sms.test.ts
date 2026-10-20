// SMS de confirmación y página del enlace (Fase 3 · 3.5, PA-09, PW-07). Sin coste de API.
//
// Una reserva por el widget (modelo simulado) genera el SMS de prueba con su
// enlace; cancelar por el chat manda el SMS de cancelación (PW-10); la página
// del enlace muestra la cita y la cancela con PR-07 (sin otro SMS).

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { citasDelTurno } from '../src/adapters/channels/web-widget.js';
import { SmsDePrueba } from '../src/adapters/sms/prueba.js';
import type { SmsProvider } from '../src/adapters/sms/types.js';
import { createApi } from '../src/api/app.js';
import { diaParaSms, ENLACE_TAPADO, textoCancelacion, textoConfirmacion } from '../src/citas/confirmacion.js';
import { AJUSTES_DE_SERIE, type AgentSettings } from '../src/core/agent.js';
import { localToUtc } from '../src/core/time.js';
import { createSql } from '../src/db/client.js';
import { sha256 } from '../src/db/widget.js';
import { createTestBusiness, deleteTestBusiness, type TestBusiness } from './helpers/fixtures.js';
import { herramientas, ModeloSimulado, texto } from './helpers/modelo-simulado.js';

const sql = createSql(undefined, { max: 4 });
const AHORA = localToUtc('2030-10-14', '10:00', 'Europe/Madrid');
const ajustes: AgentSettings = { ...AJUSTES_DE_SERIE, limits: { maxVueltas: 4, maxTokensConversacion: 1_000_000 } };
const ORIGEN = 'http://localhost:3000';
const BASE = 'http://api.test';

let N: TestBusiness & { key: string };
let ip = 0;

beforeAll(async () => {
  const t = await createTestBusiness(sql, 'test-cita-sms');
  const key = `wk_test_${randomUUID().replaceAll('-', '')}`;
  await sql`
    update public.businesses
       set widget_key = ${key}, widget_dominios = array['localhost'], telefono_humano = '+34910000888',
           politica_cancelacion = 'Sin coste hasta 24 h antes.', direccion = 'Calle Prueba 1'
     where id = ${t.businessId}`;
  N = { ...t, key };
});

afterAll(async () => {
  await deleteTestBusiness(sql, N.businessId);
  await sql.end();
});

/** Reserva por el widget el 2030-10-15 a la hora dada y devuelve el SMS y la cita. */
async function reservar(hora: string, sms: SmsProvider = new SmsDePrueba({ silencioso: true }), now = AHORA) {
  const telefono = `+3461${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
  const modelo = new ModeloSimulado([
    herramientas({ name: 'identificar_cliente', input: { telefono, nombre: 'Clienta SMS' } }),
    herramientas({ name: 'crear_reserva', input: { servicio: 'Servicio 60 + 15', fecha: '2030-10-15', hora } }),
    texto('¡Hecho!'),
  ]);
  const api = createApi({ sql, model: modelo, settings: ajustes, sms, baseUrl: BASE, now: () => now });
  const res = await api(
    new Request(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGEN },
      body: JSON.stringify({ key: N.key, clientMessageId: randomUUID(), texto: 'Resérvamela' }),
    }),
    { ip: `10.200.0.${++ip}` },
  );
  expect(((await res.json()) as { respuesta: string }).respuesta).toBe('¡Hecho!');
  const [cita] = await sql<{ id: string }[]>`
    select a.id from public.appointments a join public.customers c on c.id = a.customer_id
     where a.business_id = ${N.businessId} and c.telefono = ${telefono}`;
  return { telefono, citaId: cita!.id };
}

/** Un mensaje por el widget en una conversación nueva, con los pasos del modelo dados. */
async function chat(sms: SmsProvider, pasos: ConstructorParameters<typeof ModeloSimulado>[0]) {
  const api = createApi({ sql, model: new ModeloSimulado(pasos), settings: ajustes, sms, baseUrl: BASE, now: () => AHORA });
  const res = await api(
    new Request(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGEN },
      body: JSON.stringify({ key: N.key, clientMessageId: randomUUID(), texto: 'Cancélamela' }),
    }),
    { ip: `10.200.0.${++ip}` },
  );
  expect(res.status).toBe(200);
}

function pagina(token: string, now = AHORA, paso?: string) {
  const api = createApi({ sql, model: new ModeloSimulado([]), settings: ajustes, sms: new SmsDePrueba({ silencioso: true }), baseUrl: BASE, now: () => now });
  return api(
    new Request(`${BASE}/cita/${token}`, paso
      ? { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `paso=${paso}` }
      : {}),
  );
}

async function estado(citaId: string): Promise<string> {
  const [a] = await sql<{ estado: string }[]>`select estado from public.appointments where id = ${citaId}`;
  return a!.estado;
}

describe('el SMS de confirmación', () => {
  it('texto de PW-07, sin año, sin datos de salud', () => {
    expect(diaParaSms('2030-10-15')).toBe('martes 15 de octubre');
    expect(textoConfirmacion('Estética X', { dia: 'martes 15 de octubre', hora: '10:00', profesional: 'Marta' }, 'https://x/cita/abc')).toBe(
      'Estética X: cita confirmada el martes 15 de octubre a las 10:00 con Marta. Para verla o cancelarla: https://x/cita/abc',
    );
  });

  it('al reservar se genera un SMS "prueba" con el enlace; la base no guarda el token', async () => {
    const sms = new SmsDePrueba({ silencioso: true });
    const { telefono, citaId } = await reservar('09:00', sms);
    expect(sms.enviados).toHaveLength(1);
    const enviado = sms.enviados[0]!;
    expect(enviado.telefono).toBe(telefono);
    expect(enviado.texto).toMatch(
      /^Test test-cita-sms: cita confirmada el martes 15 de octubre a las 09:00 con Única\. Para verla o cancelarla: http:\/\/api\.test\/cita\/[A-Za-z0-9_-]{22}$/,
    );
    const token = enviado.texto.split('/cita/')[1]!;

    const [fila] = await sql<{ estado: string; texto: string; proveedor: string; telefono: string; enviado_at: Date | null }[]>`
      select estado, texto, proveedor, telefono, enviado_at from public.sms_messages where appointment_id = ${citaId}`;
    expect(fila).toMatchObject({ estado: 'prueba', proveedor: 'prueba', telefono });
    expect(fila!.enviado_at).not.toBeNull();
    expect(fila!.texto.endsWith(`/cita/${ENLACE_TAPADO}`) || fila!.texto.endsWith(ENLACE_TAPADO)).toBe(true);
    expect(fila!.texto).not.toContain(token);

    const [link] = await sql<{ token_hash: string; expira_at: Date }[]>`
      select token_hash, expira_at from public.appointment_links where appointment_id = ${citaId}`;
    expect(link!.token_hash).toBe(sha256(token));
    expect(link!.expira_at.toISOString()).toBe(localToUtc('2030-10-15', '10:00', 'Europe/Madrid').toISOString());
  });

  it('si el envío falla, la reserva sigue valiendo y el SMS queda "fallido"', async () => {
    const roto: SmsProvider = { nombre: 'roto', enviar: async () => Promise.reject(new Error('proveedor caído')) };
    const { citaId } = await reservar('11:30', roto);
    expect(await estado(citaId)).toBe('confirmada');
    const [fila] = await sql<{ estado: string; error: string }[]>`select estado, error from public.sms_messages where appointment_id = ${citaId}`;
    expect(fila).toMatchObject({ estado: 'fallido', error: 'Error: proveedor caído' });
  });

  it('las citas del turno salen de los resultados de las herramientas', () => {
    const ok = (nombre: string, data: Record<string, unknown>) => ({ nombre, input: {}, content: '', isError: false, resultado: { ok: true as const, data } });
    expect(
      citasDelTurno({
        herramientas: [
          ok('crear_reserva', { cita: { id_cita: 'n1' } }),
          ok('reprogramar_reserva', { cita_nueva: { id_cita: 'm1' } }),
          ok('reservar_y_cambiar_cita_anterior', { reservada: true, cita_nueva: { id_cita: 'n2' }, cita_anterior_movida: { ahora: { id_cita: 'm2' } } }),
          ok('reservar_y_cambiar_cita_anterior', { sin_cambios_todavia: true }),
          ok('cancelar_reserva', { cancelada: true, cita: { id_cita: 'x' } }),
          ok('cancelar_reserva', { cancelada: true, ya_estaba_cancelada: true, cita: { id_cita: 'y' } }),
        ],
      }),
    ).toEqual({ nuevas: ['n1', 'n2'], movidas: ['m1', 'm2'], canceladas: ['x'] });
  });
});

describe('el SMS de cancelación (PW-10)', () => {
  it('texto de PW-10, con el teléfono del local o sin él', () => {
    expect(textoCancelacion('Estética X', { dia: 'martes 15 de octubre', hora: '10:00' }, '+34910000888')).toBe(
      'Estética X: tu cita del martes 15 de octubre a las 10:00 se ha cancelado. Si no fuiste tú, llama al +34910000888.',
    );
    expect(textoCancelacion('Estética X', { dia: 'martes 15 de octubre', hora: '10:00' }, null)).toBe(
      'Estética X: tu cita del martes 15 de octubre a las 10:00 se ha cancelado. Si no fuiste tú, llama al local.',
    );
  });

  it('al cancelar por el chat llega un SMS sin enlace; repetir la cancelación no manda otro', async () => {
    const { telefono, citaId } = await reservar('14:30');
    const sms = new SmsDePrueba({ silencioso: true });
    const cancelarPorChat = () =>
      chat(sms, [
        herramientas({ name: 'identificar_cliente', input: { telefono, nombre: 'Clienta SMS' } }),
        herramientas({ name: 'cancelar_reserva', input: { id_cita: citaId } }),
        texto('Cancelada.'),
      ]);
    await cancelarPorChat();
    expect(await estado(citaId)).toBe('cancelada');
    expect(sms.enviados).toEqual([
      { telefono, texto: 'Test test-cita-sms: tu cita del martes 15 de octubre a las 14:30 se ha cancelado. Si no fuiste tú, llama al +34910000888.' },
    ]);
    const filas = await sql<{ estado: string; texto: string }[]>`
      select estado, texto from public.sms_messages where appointment_id = ${citaId} order by created_at`;
    expect(filas.map((f) => f.estado)).toEqual(['prueba', 'prueba']); // confirmación + cancelación
    expect(filas[1]!.texto).toBe(sms.enviados[0]!.texto);

    await cancelarPorChat(); // ya estaba cancelada
    expect(sms.enviados).toHaveLength(1);
  }, 60_000); // tres mensajes por el widget: contra la nube, en modo transacción, pasa de 20 s
});

describe('la página del enlace', () => {
  it('muestra la cita y la cancela en dos pasos', async () => {
    const sms = new SmsDePrueba({ silencioso: true });
    const { citaId } = await reservar('13:00', sms);
    const token = sms.enviados[0]!.texto.split('/cita/')[1]!;

    const ver = await pagina(token);
    expect(ver.status).toBe(200);
    expect(ver.headers.get('referrer-policy')).toBe('no-referrer');
    const html = await ver.text();
    expect(html).toContain('Servicio 60 + 15');
    expect(html).toContain('martes 15 de octubre de 2030');
    expect(html).toContain('13:00 a 14:00');
    expect(html).toContain('Cancelar la cita');
    expect(html).toContain('escríbenos en el chat de la web');

    const seguro = await (await pagina(token, AHORA, 'preguntar')).text();
    expect(seguro).toContain('¿Seguro que quieres cancelar tu cita?');
    expect(await estado(citaId)).toBe('confirmada'); // preguntar no cambia nada

    const hecho = await (await pagina(token, AHORA, 'cancelar')).text();
    expect(hecho).toContain('Tu cita está cancelada');
    expect(await estado(citaId)).toBe('cancelada');
    // PW-10: desde la página no se manda SMS de cancelación (ya lo está viendo).
    const [n] = await sql<{ n: number }[]>`select count(*)::int as n from public.sms_messages where appointment_id = ${citaId}`;
    expect(n!.n).toBe(1);

    // Volver a abrir el enlace: sigue mostrando la cita, ya sin botón.
    const despues = await (await pagina(token)).text();
    expect(despues).toContain('Cancelada');
    expect(despues).not.toContain('Cancelar la cita');
  });

  it('PR-07 "bloquear": dentro del plazo no cancela y da el teléfono', async () => {
    await sql`update public.businesses set cancelacion_modo = 'bloquear', cancelacion_plazo_horas = 24 where id = ${N.businessId}`;
    try {
      const sms = new SmsDePrueba({ silencioso: true });
      const { citaId } = await reservar('16:00', sms);
      const token = sms.enviados[0]!.texto.split('/cita/')[1]!;
      const tresHorasAntes = localToUtc('2030-10-15', '13:00', 'Europe/Madrid');
      const html = await (await pagina(token, tresHorasAntes, 'cancelar')).text();
      expect(html).toContain('No se puede cancelar por aquí');
      expect(html).toContain('+34910000888');
      expect(await estado(citaId)).toBe('confirmada');

      // Fuera del plazo, sí.
      const html2 = await (await pagina(token, AHORA, 'cancelar')).text();
      expect(html2).toContain('Tu cita está cancelada');
      expect(await estado(citaId)).toBe('cancelada');
    } finally {
      await sql`update public.businesses set cancelacion_modo = 'informar' where id = ${N.businessId}`;
    }
  });

  it('PR-07 "informar": dentro del plazo cancela y recuerda la política', async () => {
    const sms = new SmsDePrueba({ silencioso: true });
    const { citaId } = await reservar('18:00', sms);
    const token = sms.enviados[0]!.texto.split('/cita/')[1]!;
    const html = await (await pagina(token, localToUtc('2030-10-15', '15:00', 'Europe/Madrid'), 'cancelar')).text();
    expect(html).toContain('Tu cita está cancelada');
    expect(html).toContain('Sin coste hasta 24 h antes.');
    expect(await estado(citaId)).toBe('cancelada');
  });

  it('un token inventado o caducado no muestra nada', async () => {
    expect((await pagina('a'.repeat(22))).status).toBe(404);
    expect((await pagina('no válido!')).status).toBe(404);

    const sms = new SmsDePrueba({ silencioso: true });
    const { citaId } = await reservar('20:00', sms);
    const token = sms.enviados[0]!.texto.split('/cita/')[1]!;
    await sql`update public.appointment_links set expira_at = now() - interval '1 minute' where appointment_id = ${citaId}`;
    const res = await pagina(token);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('Servicio 60 + 15');
    expect((await pagina(token, AHORA, 'cancelar')).status).toBe(404);
    expect(await estado(citaId)).toBe('confirmada');
  });
});
