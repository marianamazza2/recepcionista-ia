// Email de confirmación, código y página del enlace (PW-18, PA-16, PA-17;
// antes SMS, Fase 3 · 3.5). Sin coste de API.
//
// Una reserva por el widget (modelo simulado) genera el email de prueba con su
// enlace y el archivo de calendario; sin email no se manda nada. Cancelar por
// el chat exige el código del email (PA-16) y manda el email de cancelación
// (PW-10). La página del enlace muestra la cita y la cancela con PR-07 (sin
// otro email).

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { citasDelTurno } from '../src/adapters/channels/web-widget.js';
import { EmailDePrueba } from '../src/adapters/email/prueba.js';
import type { EmailProvider } from '../src/adapters/email/types.js';
import { createApi } from '../src/api/app.js';
import { CODIGO_TAPADO } from '../src/citas/codigo.js';
import { diaCorto, emailCancelacion, emailConfirmacion, ENLACE_TAPADO } from '../src/citas/confirmacion.js';
import { archivoIcs, escaparIcs } from '../src/citas/ics.js';
import { AJUSTES_DE_SERIE, type AgentSettings } from '../src/core/agent.js';
import { localToUtc } from '../src/core/time.js';
import { createSql } from '../src/db/client.js';
import { sha256 } from '../src/db/widget.js';
import { createTestBusiness, deleteTestBusiness, type TestBusiness } from './helpers/fixtures.js';
import { herramientas, ModeloSimulado, texto } from './helpers/modelo-simulado.js';

const sql = createSql(undefined, { max: 4 });
const AHORA = localToUtc('2030-10-14', '10:00', 'Europe/Madrid');
const ajustes: AgentSettings = { ...AJUSTES_DE_SERIE, limits: { maxVueltas: 8, maxTokensConversacion: 1_000_000 } };
const ORIGEN = 'http://localhost:3000';
const BASE = 'http://api.test';

let N: TestBusiness & { key: string };
let ip = 0;

beforeAll(async () => {
  const t = await createTestBusiness(sql, 'test-cita-email');
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

function aleatorio(): string {
  return String(Math.floor(Math.random() * 1e7)).padStart(7, '0');
}

/** Reserva por el widget el 2030-10-15 a la hora dada; con email o sin él (PA-17). */
async function reservar(
  hora: string,
  email: EmailProvider = new EmailDePrueba({ silencioso: true }),
  opciones: { conEmail?: boolean } = {},
) {
  const telefono = `+3461${aleatorio()}`;
  const correo = opciones.conEmail === false ? null : `clienta.${aleatorio()}@example.com`;
  const modelo = new ModeloSimulado([
    herramientas({ name: 'identificar_cliente', input: { email: correo, telefono, nombre: 'Clienta Email' } }),
    herramientas({ name: 'crear_reserva', input: { servicio: 'Servicio 60 + 15', fecha: '2030-10-15', hora } }),
    texto('¡Hecho!'),
  ]);
  const api = createApi({ sql, model: modelo, settings: ajustes, email, baseUrl: BASE, now: () => AHORA });
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
  return { telefono, correo, citaId: cita!.id };
}

/** Un mensaje por el widget en una conversación nueva, con los pasos del modelo dados. */
async function chat(email: EmailProvider, pasos: ConstructorParameters<typeof ModeloSimulado>[0]) {
  const api = createApi({ sql, model: new ModeloSimulado(pasos), settings: ajustes, email, baseUrl: BASE, now: () => AHORA });
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
  const api = createApi({ sql, model: new ModeloSimulado([]), settings: ajustes, email: new EmailDePrueba({ silencioso: true }), baseUrl: BASE, now: () => now });
  return api(
    new Request(`${BASE}/cita/${token}`, paso
      ? { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `paso=${paso}` }
      : {}),
  );
}

function tokenDe(email: EmailDePrueba): string {
  return /\/cita\/([A-Za-z0-9_-]{22})/.exec(email.enviados[0]!.texto)![1]!;
}

async function estado(citaId: string): Promise<string> {
  const [a] = await sql<{ estado: string }[]>`select estado from public.appointments where id = ${citaId}`;
  return a!.estado;
}

describe('el email de confirmación (PW-18)', () => {
  it('lleva día, hora, profesional, dirección, enlace, política y teléfono; no el tratamiento', () => {
    expect(diaCorto('2030-10-15')).toBe('martes 15 de octubre');
    const { asunto, texto: cuerpo } = emailConfirmacion(
      { nombre: 'Estética X', direccion: 'Calle Sol 3', politicaCancelacion: 'Avísanos 24 h antes.', telefonoHumano: '+34910000888' },
      { nombre: 'Ana', dia: 'martes 15 de octubre', hora: '10:00', profesional: 'Marta' },
      'https://x/cita/abc',
    );
    expect(asunto).toBe('Tu cita en Estética X: martes 15 de octubre a las 10:00');
    expect(cuerpo).toContain('Hola, Ana:');
    expect(cuerpo).toContain('Día: martes 15 de octubre\nHora: 10:00\nCon: Marta\nDirección: Calle Sol 3');
    expect(cuerpo).toContain('Para verla, cambiarla o cancelarla: https://x/cita/abc');
    expect(cuerpo).toContain('Política de cancelación: Avísanos 24 h antes.');
    expect(cuerpo).toContain('llámanos al 910 000 888');
  });

  it('el archivo de calendario: horas en UTC y texto escapado', () => {
    const ics = archivoIcs(
      {
        uid: 'abc@recepcionista',
        inicio: new Date('2030-10-15T08:00:00Z'),
        fin: new Date('2030-10-15T09:00:00Z'),
        resumen: 'Cita en Estética X',
        descripcion: 'Con Marta, en la 1ª planta; ver enlace',
        lugar: 'Calle Sol 3, Madrid',
      },
      new Date('2030-10-14T08:00:00Z'),
    );
    expect(ics).toContain('DTSTART:20301015T080000Z\r\nDTEND:20301015T090000Z');
    expect(ics).toContain('DESCRIPTION:Con Marta\\, en la 1ª planta\\; ver enlace');
    expect(ics).toContain('LOCATION:Calle Sol 3\\, Madrid');
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(escaparIcs('a\nb')).toBe('a\\nb');
  });

  it('al reservar con email se genera un email "prueba" con enlace y .ics; la base no guarda el token', async () => {
    const email = new EmailDePrueba({ silencioso: true });
    const { correo, citaId } = await reservar('09:00', email);
    expect(email.enviados).toHaveLength(1);
    const enviado = email.enviados[0]!;
    expect(enviado.para).toBe(correo);
    expect(enviado.remitente).toBe('Test test-cita-email');
    expect(enviado.asunto).toBe('Tu cita en Test test-cita-email: martes 15 de octubre a las 09:00');
    expect(enviado.texto).toContain('Con: Única');
    expect(enviado.texto).not.toContain('Servicio 60 + 15'); // sin el tratamiento
    expect(enviado.adjuntos?.[0]).toMatchObject({ nombre: 'cita.ics', tipo: 'text/calendar' });
    expect(enviado.adjuntos?.[0]?.contenido).toContain('DTSTART:20301015T070000Z');
    const token = tokenDe(email);

    const [fila] = await sql<{ estado: string; texto: string; proveedor: string; email: string; tipo: string; enviado_at: Date | null }[]>`
      select estado, texto, proveedor, email, tipo, enviado_at from public.email_messages where appointment_id = ${citaId}`;
    expect(fila).toMatchObject({ estado: 'prueba', proveedor: 'prueba', email: correo, tipo: 'confirmacion' });
    expect(fila!.enviado_at).not.toBeNull();
    expect(fila!.texto).toContain(ENLACE_TAPADO);
    expect(fila!.texto).not.toContain(token);

    const [link] = await sql<{ token_hash: string; expira_at: Date }[]>`
      select token_hash, expira_at from public.appointment_links where appointment_id = ${citaId}`;
    expect(link!.token_hash).toBe(sha256(token));
    expect(link!.expira_at.toISOString()).toBe(localToUtc('2030-10-15', '10:00', 'Europe/Madrid').toISOString());

    // Ningún SMS: queda apagado (PW-18).
    const [n] = await sql<{ n: number }[]>`select count(*)::int as n from public.sms_messages where appointment_id = ${citaId}`;
    expect(n!.n).toBe(0);
  });

  it('PA-17: sin email la cita vale y no se manda nada', async () => {
    const email = new EmailDePrueba({ silencioso: true });
    const { citaId } = await reservar('22:00', email, { conEmail: false });
    expect(await estado(citaId)).toBe('confirmada');
    expect(email.enviados).toHaveLength(0);
    const [n] = await sql<{ n: number }[]>`select count(*)::int as n from public.email_messages where appointment_id = ${citaId}`;
    expect(n!.n).toBe(0);
  });

  it('si el envío falla, la reserva sigue valiendo y el email queda "fallido"', async () => {
    const roto: EmailProvider = { nombre: 'roto', enviar: async () => Promise.reject(new Error('proveedor caído')) };
    const { citaId } = await reservar('11:30', roto);
    expect(await estado(citaId)).toBe('confirmada');
    const [fila] = await sql<{ estado: string; error: string }[]>`select estado, error from public.email_messages where appointment_id = ${citaId}`;
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

describe('cancelar por el chat: código (PA-16) y email de cancelación (PW-10)', () => {
  it('texto de la cancelación, con el teléfono del local o sin él', () => {
    const cita = { nombre: 'Ana', dia: 'martes 15 de octubre', hora: '10:00' };
    expect(emailCancelacion({ nombre: 'Estética X', telefonoHumano: '+34910000888' }, cita).texto).toContain(
      'Tu cita en Estética X del martes 15 de octubre a las 10:00 se ha cancelado.\n\nSi no has sido tú, llámanos al 910 000 888.',
    );
    expect(emailCancelacion({ nombre: 'Estética X', telefonoHumano: null }, cita).texto).toContain('Si no has sido tú, llama al local.');
  });

  it('sin código no cancela; con el código del email sí, y llega el aviso sin enlace', async () => {
    const { telefono, correo, citaId } = await reservar('14:30');
    const email = new EmailDePrueba({ silencioso: true });
    const identificar = herramientas({ name: 'identificar_cliente', input: { email: correo, telefono, nombre: 'Clienta Email' } });

    // Sin código: la herramienta lo rechaza y no se toca nada.
    await chat(email, [identificar, herramientas({ name: 'cancelar_reserva', input: { id_cita: citaId } }), texto('Necesito tu código.')]);
    expect(await estado(citaId)).toBe('confirmada');

    // Con código: lo pide, "la clienta" lo copia del email y se cancela.
    await chat(email, [
      identificar,
      herramientas({ name: 'enviar_codigo', input: {} }),
      () => herramientas({ name: 'verificar_codigo', input: { codigo: email.ultimoCodigo(correo!)! } }),
      herramientas({ name: 'cancelar_reserva', input: { id_cita: citaId } }),
      texto('Cancelada.'),
    ]);
    expect(await estado(citaId)).toBe('cancelada');
    expect(email.enviados.map((e) => e.asunto)).toEqual(['Tu código para Test test-cita-email', 'Cita cancelada en Test test-cita-email']);
    expect(email.enviados[1]!.texto).not.toContain('/cita/');

    // En la base el código va tapado.
    const filas = await sql<{ tipo: string; texto: string }[]>`
      select tipo, texto from public.email_messages where business_id = ${N.businessId} and email = ${correo} order by created_at`;
    expect(filas.map((f) => f.tipo)).toEqual(['confirmacion', 'codigo', 'cancelacion']);
    expect(filas[1]!.texto).toContain(CODIGO_TAPADO);
    expect(filas[1]!.texto).not.toMatch(/\b\d{6}\b/);
  }, 60_000); // varios mensajes por el widget: contra la nube, en modo transacción, pasa de 20 s

  it('sin email, el chat no puede cancelar: hay que llamar', async () => {
    const { telefono, citaId } = await reservar('06:00', new EmailDePrueba({ silencioso: true }), { conEmail: false });
    const email = new EmailDePrueba({ silencioso: true });
    let resultado = '';
    await chat(email, [
      herramientas({ name: 'identificar_cliente', input: { email: null, telefono, nombre: 'Clienta Email' } }),
      herramientas({ name: 'enviar_codigo', input: {} }),
      (p) => {
        const ultimo = p.messages.at(-1)!.content as Array<{ type: string; content?: string }>;
        resultado = ultimo.find((b) => b.type === 'tool_result')?.content ?? '';
        return texto('Llama al local.');
      },
    ]);
    expect(resultado).toContain('sin_email');
    expect(email.enviados).toHaveLength(0);
    expect(await estado(citaId)).toBe('confirmada');
  });
});

describe('la página del enlace', () => {
  it('muestra la cita y la cancela en dos pasos', async () => {
    const email = new EmailDePrueba({ silencioso: true });
    const { citaId } = await reservar('13:00', email);
    const token = tokenDe(email);

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
    // PW-10: desde la página no se manda aviso de cancelación (ya lo está viendo).
    const [n] = await sql<{ n: number }[]>`select count(*)::int as n from public.email_messages where appointment_id = ${citaId}`;
    expect(n!.n).toBe(1);

    // Volver a abrir el enlace: sigue mostrando la cita, ya sin botón.
    const despues = await (await pagina(token)).text();
    expect(despues).toContain('Cancelada');
    expect(despues).not.toContain('Cancelar la cita');
  });

  it('PR-07 "bloquear": dentro del plazo no cancela y da el teléfono', async () => {
    await sql`update public.businesses set cancelacion_modo = 'bloquear', cancelacion_plazo_horas = 24 where id = ${N.businessId}`;
    try {
      const email = new EmailDePrueba({ silencioso: true });
      const { citaId } = await reservar('16:00', email);
      const token = tokenDe(email);
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
    const email = new EmailDePrueba({ silencioso: true });
    const { citaId } = await reservar('18:00', email);
    const token = tokenDe(email);
    const html = await (await pagina(token, localToUtc('2030-10-15', '15:00', 'Europe/Madrid'), 'cancelar')).text();
    expect(html).toContain('Tu cita está cancelada');
    expect(html).toContain('Sin coste hasta 24 h antes.');
    expect(await estado(citaId)).toBe('cancelada');
  });

  it('un token inventado o caducado no muestra nada', async () => {
    expect((await pagina('a'.repeat(22))).status).toBe(404);
    expect((await pagina('no válido!')).status).toBe(404);

    const email = new EmailDePrueba({ silencioso: true });
    const { citaId } = await reservar('20:00', email);
    const token = tokenDe(email);
    await sql`update public.appointment_links set expira_at = now() - interval '1 minute' where appointment_id = ${citaId}`;
    const res = await pagina(token);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('Servicio 60 + 15');
    expect((await pagina(token, AHORA, 'cancelar')).status).toBe(404);
    expect(await estado(citaId)).toBe('confirmada');
  });
});
