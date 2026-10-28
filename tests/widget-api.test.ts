// El canal widget web (Fase 3 · 3.2, 3.3, 3.7) con el modelo simulado: sin coste de API.
//
// Contra dos negocios de prueba que se crean al empezar y se borran al terminar
// (arrastran conversaciones, consumo, citas y SMS). Las peticiones se hacen
// con Request estándar contra el mismo handler que sirve el servidor local.

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { externalIdWeb, LIMITES_WIDGET } from '../src/adapters/channels/web-widget.js';
import { SmsDePrueba } from '../src/adapters/sms/prueba.js';
import { createApi } from '../src/api/app.js';
import { AJUSTES_DE_SERIE, type AgentSettings, type ModelClient } from '../src/core/agent.js';
import { costeUsd } from '../src/core/costes.js';
import { localToUtc } from '../src/core/time.js';
import { createSql } from '../src/db/client.js';
import { hashIp, sha256 } from '../src/db/widget.js';
import { createTestBusiness, deleteTestBusiness, type TestBusiness } from './helpers/fixtures.js';
import { herramientas, ModeloSimulado, texto } from './helpers/modelo-simulado.js';

const sql = createSql(undefined, { max: 6 });
const AHORA = localToUtc('2030-10-14', '10:00', 'Europe/Madrid');
const ajustes: AgentSettings = { ...AJUSTES_DE_SERIE, limits: { maxVueltas: 4, maxTokensConversacion: 1_000_000 } };
const ORIGEN = 'http://localhost:3000';
const IP = '203.0.113.7';
let ultimaIp = 0;
/** Cada conversación de test desde su propia IP: si no, el límite de PW-05 salta entre tests. */
function ipNueva(): string {
  ultimaIp++;
  return `10.${(ultimaIp >> 8) & 255}.${ultimaIp & 255}.${Math.floor(Math.random() * 250) + 1}`;
}
const TELEFONO_LOCAL = '+34910000999';

let A: TestBusiness & { key: string };
let B: TestBusiness & { key: string };
let sms: SmsDePrueba;

function api(model: ModelClient, extra: Partial<Parameters<typeof createApi>[0]> = {}) {
  return createApi({ sql, model, settings: ajustes, sms, baseUrl: 'http://api.test', now: () => AHORA, ...extra });
}

function post(handler: ReturnType<typeof createApi>, body: Record<string, unknown>, origin: string | null = ORIGEN, ip = ipNueva()) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (origin) headers.origin = origin;
  return handler(new Request('http://api.test/api/chat', { method: 'POST', headers, body: JSON.stringify(body) }), { ip });
}

function get(handler: ReturnType<typeof createApi>, path: string, headers: Record<string, string> = { origin: ORIGEN }) {
  return handler(new Request(`http://api.test${path}`, { headers }), { ip: IP });
}

async function crearNegocio(slug: string): Promise<TestBusiness & { key: string }> {
  const t = await createTestBusiness(sql, slug);
  const key = `wk_test_${randomUUID().replaceAll('-', '')}`;
  await sql`
    update public.businesses
       set widget_key = ${key}, widget_dominios = array['localhost'], telefono_humano = ${TELEFONO_LOCAL},
           mensaje_bienvenida = 'Hola, soy la asistente virtual', privacidad_url = 'https://example.test/privacidad'
     where id = ${t.businessId}`;
  return { ...t, key };
}

beforeAll(async () => {
  A = await crearNegocio('test-widget-api-a');
  B = await crearNegocio('test-widget-api-b');
});

beforeEach(() => {
  sms = new SmsDePrueba({ silencioso: true });
});

afterAll(async () => {
  await deleteTestBusiness(sql, A.businessId);
  await deleteTestBusiness(sql, B.businessId);
  await sql.end();
});

let IP_PRIMERA: string | null = null;

/** Una conversación nueva en A con un primer mensaje respondido. */
async function empezar(modelo = new ModeloSimulado([texto('¡Hola! ¿En qué te ayudo?')])) {
  const h = api(modelo);
  const res = await post(h, { key: A.key, clientMessageId: randomUUID(), texto: 'Hola' }, ORIGEN, IP_PRIMERA ?? ipNueva());
  IP_PRIMERA = null;
  const body = (await res.json()) as { sessionToken: string; respuesta: string };
  const [conv] = await sql<{ id: string }[]>`
    select id from public.conversations where session_token_hash = ${sha256(body.sessionToken)}`;
  return { h, modelo, token: body.sessionToken, conversationId: conv!.id };
}

describe('GET /api/widget/config', () => {
  it('devuelve solo lo público del negocio, con CORS para ese origen', async () => {
    const res = await get(api(new ModeloSimulado([])), `/api/widget/config?key=${A.key}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGEN);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['aviso', 'bienvenida', 'color', 'logo', 'maxCaracteres', 'nombre']);
    expect(body).toMatchObject({
      nombre: 'Test test-widget-api-a',
      color: '#4f6d7a',
      logo: null, // PW-17: sin logo, el widget pinta la inicial
      bienvenida: 'Hola, soy la asistente virtual',
      aviso: {
        texto: 'Soy la asistente virtual de Test test-widget-api-a, al escribir aceptas nuestra política de privacidad.',
        enlace: 'https://example.test/privacidad',
      },
      maxCaracteres: 1000,
    });
    expect(JSON.stringify(body)).not.toContain(A.businessId);
  });

  it('clave inexistente → 404; dominio no permitido o sin Origin → 403 sin CORS', async () => {
    const h = api(new ModeloSimulado([]));
    expect((await get(h, '/api/widget/config?key=wk_no_existe_0000000000')).status).toBe(404);
    const ajeno = await get(h, `/api/widget/config?key=${A.key}`, { origin: 'https://otra-web.example' });
    expect(ajeno.status).toBe(403);
    expect(ajeno.headers.get('access-control-allow-origin')).toBeNull();
    expect((await get(h, `/api/widget/config?key=${A.key}`, {})).status).toBe(403);
  });
});

describe('POST /api/chat — dominio y sesión', () => {
  it('desde un dominio no permitido se rechaza sin llamar al modelo ni crear nada', async () => {
    const modelo = new ModeloSimulado([texto('no debería')]);
    const antes = await sql`select count(*)::int as n from public.conversations where business_id = ${A.businessId}`;
    const res = await post(api(modelo), { key: A.key, clientMessageId: randomUUID(), texto: 'Hola' }, 'https://copia.example');
    expect(res.status).toBe(403);
    expect(modelo.peticiones).toHaveLength(0);
    const despues = await sql`select count(*)::int as n from public.conversations where business_id = ${A.businessId}`;
    expect(despues[0]!.n).toBe(antes[0]!.n);
  });

  it('el primer mensaje abre conversación y da un token; la base guarda solo su hash', async () => {
    IP_PRIMERA = IP;
    const { token, conversationId } = await empezar();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [c] = await sql`select session_token_hash, ip_hash, canal from public.conversations where id = ${conversationId}`;
    expect(c).toMatchObject({ session_token_hash: sha256(token), ip_hash: hashIp(A.businessId, IP), canal: 'web' });
    const filas = await sql`select count(*)::int as n from public.conversations where session_token_hash = ${token}`;
    expect(filas[0]!.n).toBe(0);
  });

  it('con el token se sigue la misma conversación y el historial la devuelve', async () => {
    const { h, token, conversationId, modelo } = await empezar(
      new ModeloSimulado([texto('¡Hola! ¿En qué te ayudo?'), texto('Abrimos todos los días.')]),
    );
    const res = await post(h, { key: A.key, sessionToken: token, clientMessageId: randomUUID(), texto: '¿Qué horario tenéis?' });
    expect(await res.json()).toMatchObject({ sessionToken: token, respuesta: 'Abrimos todos los días.', nuevaConversacion: false });
    expect(modelo.peticiones).toHaveLength(2);

    const hist = await get(h, `/api/chat/historial?key=${A.key}`, { origin: ORIGEN, authorization: `Bearer ${token}` });
    expect(hist.status).toBe(200);
    expect(await hist.json()).toEqual({
      escalada: false,
      mensajes: [
        { rol: 'clienta', texto: 'Hola' },
        { rol: 'asistente', texto: '¡Hola! ¿En qué te ayudo?' },
        { rol: 'clienta', texto: '¿Qué horario tenéis?' },
        { rol: 'asistente', texto: 'Abrimos todos los días.' },
      ],
    });
    const n = await sql`select count(*)::int as n from public.messages where conversation_id = ${conversationId}`;
    expect(n[0]!.n).toBe(4);
  });

  it('sin token no se lee ninguna conversación; un token inventado tampoco', async () => {
    const h = api(new ModeloSimulado([]));
    expect((await get(h, `/api/chat/historial?key=${A.key}`)).status).toBe(401);
    const r = await get(h, `/api/chat/historial?key=${A.key}`, { origin: ORIGEN, authorization: `Bearer ${'x'.repeat(43)}` });
    expect(r.status).toBe(401);
  });

  it('el token de un negocio no sirve en otro: ni lee ni escribe su conversación', async () => {
    const { token, conversationId } = await empezar();
    const enB = await get(api(new ModeloSimulado([])), `/api/chat/historial?key=${B.key}`, { origin: ORIGEN, authorization: `Bearer ${token}` });
    expect(enB.status).toBe(401);

    const modelo = new ModeloSimulado([texto('Hola desde B')]);
    const res = await post(api(modelo), { key: B.key, sessionToken: token, clientMessageId: randomUUID(), texto: 'Hola' });
    const body = (await res.json()) as { sessionToken: string; nuevaConversacion: boolean };
    expect(body.nuevaConversacion).toBe(true);
    expect(body.sessionToken).not.toBe(token);
    const n = await sql`select count(*)::int as n from public.messages where conversation_id = ${conversationId}`;
    expect(n[0]!.n).toBe(2); // la de A sigue con su saludo y su respuesta
  });

  it('PW-03 y PW-12: pasadas 2 h desde el último mensaje empieza una conversación nueva', async () => {
    const { h, token, conversationId } = await empezar(new ModeloSimulado([texto('Hola'), texto('Hola otra vez')]));
    await sql`update public.conversations set ultimo_mensaje_at = now() - interval '2 hours 1 minute' where id = ${conversationId}`;

    const hist = await get(h, `/api/chat/historial?key=${A.key}`, { origin: ORIGEN, authorization: `Bearer ${token}` });
    expect(hist.status).toBe(401);
    const res = await post(h, { key: A.key, sessionToken: token, clientMessageId: randomUUID(), texto: 'Vuelvo' });
    const body = (await res.json()) as { sessionToken: string; nuevaConversacion: boolean };
    expect(body.nuevaConversacion).toBe(true);
    expect(body.sessionToken).not.toBe(token);
  });

  it('peticiones mal formadas → 400 sin llamar al modelo', async () => {
    const modelo = new ModeloSimulado([]);
    const h = api(modelo);
    expect((await post(h, { key: A.key, clientMessageId: 'no-es-uuid', texto: 'Hola' })).status).toBe(400);
    expect((await post(h, { key: A.key, clientMessageId: randomUUID(), texto: '   ' })).status).toBe(400);
    const roto = await h(new Request('http://api.test/api/chat', { method: 'POST', headers: { origin: ORIGEN }, body: '{no es json' }), { ip: IP });
    expect(roto.status).toBe(400);
    const enorme = await post(h, { key: A.key, clientMessageId: randomUUID(), texto: 'x'.repeat(20_000) });
    expect(enorme.status).toBe(413);
    expect(modelo.peticiones).toHaveLength(0);
  });
});

describe('idempotencia y orden', () => {
  it('el mismo clientMessageId dos veces: un solo turno, la misma respuesta', async () => {
    const { h, token, conversationId, modelo } = await empezar(new ModeloSimulado([texto('Hola'), texto('Respuesta única')]));
    const id = randomUUID();
    const r1 = await (await post(h, { key: A.key, sessionToken: token, clientMessageId: id, texto: '¿Qué tal?' })).json();
    const r2 = await (await post(h, { key: A.key, sessionToken: token, clientMessageId: id, texto: '¿Qué tal?' })).json();
    expect(r1).toEqual(r2);
    expect((r1 as { respuesta: string }).respuesta).toBe('Respuesta única');
    expect(modelo.peticiones).toHaveLength(2); // el saludo y una sola vez este
    const [m] = await sql`select count(*)::int as n from public.messages where external_id = ${externalIdWeb(conversationId, id)}`;
    expect(m!.n).toBe(1);
  });

  it('el mismo clientMessageId dos veces A LA VEZ con una reserva: una sola cita y un solo SMS', async () => {
    const telefono = '+34611222333';
    const modelo = new ModeloSimulado([
      texto('Hola'),
      herramientas({ name: 'identificar_cliente', input: { telefono, nombre: 'Ana Prueba' } }),
      herramientas({ name: 'crear_reserva', input: { servicio: 'Servicio 60 + 15', fecha: '2030-10-15', hora: '10:00' } }),
      texto('¡Hecho! Te espero el martes 15 a las 10:00.'),
    ]);
    // El modelo tarda un poco, para que las dos peticiones se solapen de verdad.
    const lento: ModelClient = { create: async (p) => (await new Promise((r) => setTimeout(r, 50)), modelo.create(p)) };
    const { token } = await empezar(modelo);
    const h = api(lento);
    const id = randomUUID();
    const cuerpo = { key: A.key, sessionToken: token, clientMessageId: id, texto: 'Sí, resérvala. Ana Prueba, 611 222 333' };
    const [x, y] = await Promise.all([post(h, cuerpo), post(h, cuerpo)]);
    const [bx, by] = [await x.json(), await y.json()];
    expect(bx).toEqual(by);
    expect((bx as { respuesta: string }).respuesta).toBe('¡Hecho! Te espero el martes 15 a las 10:00.');
    expect(modelo.peticiones).toHaveLength(4); // saludo + 3 vueltas del turno, una sola vez
    const citas = await sql`
      select a.id from public.appointments a join public.customers c on c.id = a.customer_id
       where a.business_id = ${A.businessId} and c.telefono = ${telefono} and a.estado = 'confirmada'`;
    expect(citas).toHaveLength(1);
    expect(sms.enviados).toHaveLength(1);
  });

  it('dos mensajes distintos a la vez de la misma conversación: el historial queda en orden', async () => {
    const modelo = new ModeloSimulado([texto('Hola'), texto('Respuesta 1'), texto('Respuesta 2')]);
    const lento: ModelClient = { create: async (p) => (await new Promise((r) => setTimeout(r, 80)), modelo.create(p)) };
    const { token, conversationId } = await empezar(modelo);
    const h = api(lento);
    await Promise.all([
      post(h, { key: A.key, sessionToken: token, clientMessageId: randomUUID(), texto: 'Primero' }),
      post(h, { key: A.key, sessionToken: token, clientMessageId: randomUUID(), texto: 'Segundo' }),
    ]);
    const filas = await sql<{ rol: string }[]>`
      select rol from public.messages where conversation_id = ${conversationId} order by created_at, id`;
    expect(filas.map((f) => f.rol)).toEqual(['user', 'assistant', 'user', 'assistant', 'user', 'assistant']);
    // La segunda llamada al modelo ya ve la primera respuesta: no se intercalaron.
    const ultima = modelo.peticiones.at(-1)!;
    expect(JSON.stringify(ultima.messages)).toContain('Respuesta 1');
  });
});

describe('límites (PW-05) y tope mensual (PW-04): texto fijo sin llamar al modelo', () => {
  it('un mensaje de más de 1.000 caracteres', async () => {
    const modelo = new ModeloSimulado([]);
    const res = await post(api(modelo), { key: A.key, clientMessageId: randomUUID(), texto: 'a'.repeat(1001) });
    const body = (await res.json()) as { aviso: string; respuesta: string };
    expect(body.aviso).toBe('mensaje_largo');
    expect(modelo.peticiones).toHaveLength(0);
  });

  it('más de 20 mensajes por conversación y hora', async () => {
    const { h, token, conversationId, modelo } = await empezar();
    // 19 mensajes más de la clienta en la última hora (con el saludo, 20).
    await sql`
      insert into public.messages (business_id, conversation_id, rol, contenido, tool_calls)
      select ${A.businessId}, ${conversationId}, 'user', 'spam', '{"mensajes": []}'::jsonb from generate_series(1, ${LIMITES_WIDGET.mensajesPorHora - 1})`;
    const res = await post(h, { key: A.key, sessionToken: token, clientMessageId: randomUUID(), texto: 'Uno más' });
    const body = (await res.json()) as { aviso: string; respuesta: string };
    expect(body.aviso).toBe('limite_mensajes');
    expect(body.respuesta).toContain(TELEFONO_LOCAL);
    expect(modelo.peticiones).toHaveLength(1); // solo el saludo
  });

  it('más de 10 conversaciones nuevas por hora desde la misma IP', async () => {
    const ip = '198.51.100.20';
    await sql`
      insert into public.conversations (business_id, canal, ip_hash)
      select ${A.businessId}, 'web', ${hashIp(A.businessId, ip)} from generate_series(1, ${LIMITES_WIDGET.conversacionesPorHoraIp})`;
    const modelo = new ModeloSimulado([]);
    const res = await post(api(modelo), { key: A.key, clientMessageId: randomUUID(), texto: 'Hola' }, ORIGEN, ip);
    const body = (await res.json()) as { aviso: string; sessionToken: string | null };
    expect(body).toMatchObject({ aviso: 'limite_conversaciones', sessionToken: null });
    expect(modelo.peticiones).toHaveLength(0);
    // Desde otra IP, sí.
    const otra = await post(api(new ModeloSimulado([texto('Hola')])), { key: A.key, clientMessageId: randomUUID(), texto: 'Hola' }, ORIGEN, '198.51.100.21');
    expect(((await otra.json()) as { aviso?: string }).aviso).toBeUndefined();
  });

  it('con el tope del mes alcanzado responde con el teléfono y sin llamar a la IA', async () => {
    const { h, token, modelo } = await empezar();
    await sql`update public.businesses set tope_mensual_usd = 0.50 where id = ${A.businessId}`;
    await sql`insert into public.usage_events (business_id, tipo, cantidad, coste_estimado) values (${A.businessId}, 'token', 1, 0.50)`;
    try {
      const res = await post(h, { key: A.key, sessionToken: token, clientMessageId: randomUUID(), texto: 'Quiero cita' });
      const body = (await res.json()) as { aviso: string; respuesta: string };
      expect(body.aviso).toBe('tope_mensual');
      expect(body.respuesta).toContain(TELEFONO_LOCAL);
      expect(modelo.peticiones).toHaveLength(1);
    } finally {
      await sql`delete from public.usage_events where business_id = ${A.businessId}`;
      await sql`update public.businesses set tope_mensual_usd = 100 where id = ${A.businessId}`;
    }
  });
});

describe('consumo en usage_events', () => {
  it('cada turno deja mensaje, tokens con su coste en US$ y la cita', async () => {
    const telefono = '+34611222444';
    const modelo = new ModeloSimulado([
      herramientas({ name: 'identificar_cliente', input: { telefono, nombre: 'Bea Prueba' } }),
      herramientas({ name: 'crear_reserva', input: { servicio: 'Servicio 60 + 15', fecha: '2030-10-16', hora: '11:00' } }),
      { ...texto('¡Hecho!'), usage: { input_tokens: 50, output_tokens: 10, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 } },
    ]);
    const res = await post(api(modelo), { key: A.key, clientMessageId: randomUUID(), texto: 'Cita el 16 a las 11, Bea Prueba 611222444' });
    const { sessionToken } = (await res.json()) as { sessionToken: string };
    const [conv] = await sql<{ id: string }[]>`select id from public.conversations where session_token_hash = ${sha256(sessionToken)}`;

    const ev = await sql<{ tipo: string; cantidad: string; coste_estimado: string; detalle: Record<string, unknown> }[]>`
      select tipo, cantidad, coste_estimado, detalle from public.usage_events
       where conversation_id = ${conv!.id} order by tipo`;
    expect(ev.map((e) => e.tipo)).toEqual(['mensaje', 'token', 'cita']); // orden del enum
    const porTipo = Object.fromEntries(ev.map((e) => [e.tipo, e]));
    const u1 = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    const u3 = { input_tokens: 50, output_tokens: 10, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 };
    const esperado = 2 * costeUsd('claude-opus-5', u1)! + costeUsd('claude-opus-5', u3)!;
    expect(Number(porTipo.mensaje!.cantidad)).toBe(1);
    expect(Number(porTipo.token!.cantidad)).toBe(2 * 120 + 4060);
    expect(Number(porTipo.token!.coste_estimado)).toBeCloseTo(esperado, 6);
    expect(porTipo.token!.detalle).toMatchObject({ llamadas: 3, por_modelo: { 'claude-opus-5': { output_tokens: 50 } } });
    expect(Number(porTipo.cita!.cantidad)).toBe(1);
  });

  it('una respuesta fija también cuenta como mensaje, sin tokens', async () => {
    const { h, token, conversationId } = await empezar();
    await sql`update public.businesses set tope_mensual_usd = 0 where id = ${A.businessId}`;
    try {
      await post(h, { key: A.key, sessionToken: token, clientMessageId: randomUUID(), texto: 'Hola otra vez' });
    } finally {
      await sql`update public.businesses set tope_mensual_usd = 100 where id = ${A.businessId}`;
    }
    const ev = await sql<{ tipo: string; detalle: Record<string, unknown> }[]>`
      select tipo, detalle from public.usage_events where conversation_id = ${conversationId} order by created_at`;
    expect(ev.map((e) => e.tipo)).toEqual(['mensaje', 'token', 'mensaje']);
    expect(ev[2]!.detalle).toEqual({ respuesta_fija: 'tope_mensual' });
  });
});

describe('errores', () => {
  it('si la API falla, la clienta recibe el texto fijo con el teléfono, nunca un error interno', async () => {
    const modelo = new ModeloSimulado([new Error('ECONNRESET interno')]);
    const res = await post(api(modelo), { key: A.key, clientMessageId: randomUUID(), texto: 'Hola' });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(TELEFONO_LOCAL);
    expect(body).not.toContain('ECONNRESET');
  });
});
