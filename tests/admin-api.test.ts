// El panel interno por su API (Fase 4 · 4.2–4.8), con el modelo simulado y un
// proveedor de cuentas falso: sin coste de API ni Supabase Auth.
//
// Los negocios que se dan de alta aquí se borran al terminar (arrastran todo
// en cascada); la persona del panel, también.

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { OutsideHoursError } from '../src/adapters/booking/errors.js';
import { SupabaseAdapter } from '../src/adapters/booking/supabase.js';
import { SmsDePrueba } from '../src/adapters/sms/prueba.js';
import { createApi } from '../src/api/app.js';
import { loadBusinessConfig } from '../src/config/business.js';
import { AJUSTES_DE_SERIE, type AgentSettings } from '../src/core/agent.js';
import { buildSystemPrompt } from '../src/core/prompt.js';
import { localToUtc } from '../src/core/time.js';
import { createSql } from '../src/db/client.js';
import { guardarPersonaPanel } from '../src/db/personas.js';
import { informeConsumo } from '../src/db/usage.js';
import { AuthFalsa } from './helpers/auth-falsa.js';
import { herramientas, ModeloSimulado, texto, type Guion } from './helpers/modelo-simulado.js';

// Cada test da de alta un negocio entero (una docena de peticiones): contra
// Supabase, en Frankfurt, pasa de los 20 s de serie.
vi.setConfig({ testTimeout: 120_000 });

const sql = createSql(undefined, { max: 6 });
const AHORA = localToUtc('2030-10-14', '10:00', 'Europe/Madrid'); // lunes
const ajustes: AgentSettings = { ...AJUSTES_DE_SERIE, limits: { maxVueltas: 4, maxTokensConversacion: 1_000_000 } };
const ORIGEN = 'http://localhost:3000';
const EMAIL = `panel-${randomUUID().slice(0, 8)}@example.test`;
const PASSWORD = 'una-contraseña-de-test';
const auth = new AuthFalsa();
const sms = new SmsDePrueba({ silencioso: true });
const creados: string[] = [];
let userId: string;
let token: string;
let ultimaIp = 0;

function api(modelo: ModeloSimulado = new ModeloSimulado([]), conAuth = true) {
  return createApi({ sql, model: modelo, settings: ajustes, sms, baseUrl: 'http://api.test', now: () => AHORA, auth: conAuth ? auth : null });
}

async function pedir(
  h: ReturnType<typeof createApi>,
  metodo: string,
  ruta: string,
  body?: unknown,
  t: string | null = token,
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (t) headers.authorization = `Bearer ${t}`;
  const res = await h(
    new Request(`http://api.test/api/admin/${ruta}`, { method: metodo, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }),
    { ip: `10.40.${(++ultimaIp >> 8) & 255}.${ultimaIp & 255}` },
  );
  return { status: res.status, body: await res.json() };
}

const SEMANA = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, apertura: '10:00', cierre: '14:00' }));

/** Un negocio dado de alta entero por la API, como lo haría Mariana en el panel. */
async function alta(nombre: string): Promise<{ id: string; servicioId: string; profesionalId: string; key: string }> {
  const h = api();
  const c = await pedir(h, 'POST', 'negocios', { nombre, sector: 'peluquería' });
  expect(c.status).toBe(201);
  const id = c.body.id as string;
  creados.push(id);
  await pedir(h, 'PUT', `negocios/${id}/datos`, { nombre, sector: 'peluquería', timezone: 'Europe/Madrid', direccion: 'Calle Inventada 1', telefonoHumano: '+34910000123', tonoDeVoz: null, mensajeBienvenida: '¡Hola! Soy la asistente virtual.' });
  let n = await pedir(h, 'POST', `negocios/${id}/servicios`, { nombre: 'Corte', descripcion: null, duracionMin: 60, bufferMin: 15, precio: 20, precioVisible: true, activo: true });
  const servicioId = n.body.servicios[0].id as string;
  n = await pedir(h, 'POST', `negocios/${id}/profesionales`, { nombre: 'Nora', activo: true, servicioIds: [servicioId] });
  const profesionalId = n.body.profesionales[0].id as string;
  await pedir(h, 'PUT', `negocios/${id}/horario`, { staffId: null, tramos: SEMANA });
  n = await pedir(h, 'PUT', `negocios/${id}/chat`, { dominios: ['localhost'], color: '#336699', logo: null, privacidadUrl: null, topeMensualUsd: 50 });
  expect(n.status).toBe(200);
  return { id, servicioId, profesionalId, key: n.body.widgetKey };
}

beforeAll(async () => {
  userId = auth.crearUsuario(EMAIL, PASSWORD);
  await guardarPersonaPanel(sql, userId, EMAIL);
  token = auth.tokenPara(EMAIL);
});

afterAll(async () => {
  for (const id of creados) await sql`delete from public.businesses where id = ${id}`;
  await sql`delete from panel.personas where user_id = ${userId}`;
  await sql.end();
});

// -----------------------------------------------------------------------------

describe('cuentas (PI-01)', () => {
  const RUTAS: Array<[string, string]> = [
    ['GET', 'yo'],
    ['GET', 'negocios'],
    ['POST', 'negocios'],
    ['GET', `negocios/${randomUUID()}`],
    ['PUT', `negocios/${randomUUID()}/chat`],
    ['POST', `negocios/${randomUUID()}/activar`],
    ['POST', `negocios/${randomUUID()}/clave`],
    ['GET', `negocios/${randomUUID()}/conversaciones`],
    ['POST', `negocios/${randomUUID()}/derivaciones/${randomUUID()}/resolver`],
    ['GET', `negocios/${randomUUID()}/agenda`],
    ['POST', `negocios/${randomUUID()}/citas`],
    ['POST', `negocios/${randomUUID()}/probar`],
    ['GET', 'consumo'],
  ];

  it('sin token, con un token inventado o de alguien que no está en la lista → 401 en todas las rutas', async () => {
    const h = api();
    auth.crearUsuario('intrusa@example.test', 'x');
    const ajena = auth.tokenPara('intrusa@example.test');
    for (const [m, r] of RUTAS) {
      for (const t of [null, 'token-inventado-0000000000', ajena, 'wk_demo_estetica_aurora_0001']) {
        const res = await pedir(h, m, r, m === 'GET' ? undefined : {}, t);
        expect(res.status, `${m} ${r} con ${t ?? 'nada'}`).toBe(401);
      }
    }
  });

  it('un token caducado deja de valer', async () => {
    const t = auth.tokenPara(EMAIL);
    expect((await pedir(api(), 'GET', 'yo', undefined, t)).status).toBe(200);
    auth.caducar(t);
    expect((await pedir(api(), 'GET', 'yo', undefined, t)).status).toBe(401);
  });

  it('entrar: contraseña mala o cuenta fuera de la lista → 401; la buena da la sesión', async () => {
    const h = api();
    expect((await pedir(h, 'POST', 'sesion', { email: EMAIL, password: 'mala' }, null)).status).toBe(401);
    expect((await pedir(h, 'POST', 'sesion', { email: 'intrusa@example.test', password: 'x' }, null)).status).toBe(401);
    const ok = await pedir(h, 'POST', 'sesion', { email: EMAIL.toUpperCase(), password: PASSWORD }, null);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ email: EMAIL, expiraEn: 3600 });
    expect((await pedir(h, 'GET', 'yo', undefined, ok.body.accessToken)).body).toEqual({ email: EMAIL });
    const renovada = await pedir(h, 'POST', 'sesion/renovar', { refreshToken: ok.body.refreshToken }, null);
    expect(renovada.status).toBe(200);
    expect((await pedir(h, 'GET', 'yo', undefined, renovada.body.accessToken)).status).toBe(200);
  });

  it('sin proveedor de cuentas configurado el panel no se abre (503)', async () => {
    expect((await pedir(api(new ModeloSimulado([]), false), 'GET', 'negocios')).status).toBe(503);
  });
});

describe('alta de un negocio (PI-03) y el agente', () => {
  it('un negocio nuevo empieza en prueba, sin dominios, y dice lo que le falta', async () => {
    const h = api();
    const c = await pedir(h, 'POST', 'negocios', { nombre: 'Barbería Ñandú Test' });
    creados.push(c.body.id);
    expect(c.body.slug).toBe('barberia-nandu-test');
    const n = await pedir(h, 'GET', `negocios/${c.body.id}`);
    expect(n.body).toMatchObject({ estado: 'trial', chat: { dominios: [] }, widgetJs: 'http://api.test/widget.js' });
    expect(n.body.widgetKey).toMatch(/^wk_/);
    expect(n.body.loQueFalta.map((f: { codigo: string }) => f.codigo)).toEqual(['servicio', 'profesional', 'horario', 'telefono', 'dominio']);

    const otro = await pedir(h, 'POST', 'negocios', { nombre: 'Barbería Ñandú Test' });
    creados.push(otro.body.id);
    expect(otro.body.slug).toBe('barberia-nandu-test-2');
  });

  it('activar con datos incompletos se rechaza con la lista de lo que falta', async () => {
    const h = api();
    const c = await pedir(h, 'POST', 'negocios', { nombre: 'Incompleto Test' });
    creados.push(c.body.id);
    const r = await pedir(h, 'POST', `negocios/${c.body.id}/activar`);
    expect(r.status).toBe(409);
    expect(r.body.falta).toEqual(['servicio', 'profesional', 'horario', 'telefono', 'dominio']);
    expect(r.body.mensaje).toBe('Falta: un servicio activo · una profesional activa que haga algún servicio · horario del local · teléfono del local · un dominio para el chat');
  });

  it('alta completa por la API → se activa y el agente ofrece huecos y reserva por el widget', async () => {
    const n = await alta('Peluquería Alta Test');
    const act = await pedir(api(), 'POST', `negocios/${n.id}/activar`);
    expect(act.status).toBe(200);
    expect(act.body).toMatchObject({ estado: 'activo', loQueFalta: [] });

    const telefono = `+34999${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;
    let vistoHueco = false;
    const modelo = new ModeloSimulado([
      herramientas({ name: 'consultar_disponibilidad', input: { servicio: 'Corte', fecha_desde: '2030-10-15' } }),
      (p): Guion => {
        vistoHueco = JSON.stringify(p.messages.at(-1)).includes('10:00');
        return texto('El martes 15 tengo a las 10:00. ¿Te la reservo?');
      },
      herramientas({ name: 'identificar_cliente', input: { telefono, nombre: 'Clienta Alta' } }),
      herramientas({ name: 'crear_reserva', input: { servicio: 'Corte', fecha: '2030-10-15', hora: '10:00', profesional: 'Nora' } }),
      texto('¡Hecho! Tienes cita el martes 15 a las 10:00 con Nora.'),
    ]);
    const h = api(modelo);
    const chat = (body: Record<string, unknown>) =>
      h(new Request('http://api.test/api/chat', { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGEN }, body: JSON.stringify(body) }), { ip: '10.41.0.1' });
    const r1 = (await (await chat({ key: n.key, clientMessageId: randomUUID(), texto: 'Quiero un corte el martes' })).json()) as { sessionToken: string };
    expect(vistoHueco).toBe(true);
    await chat({ key: n.key, sessionToken: r1.sessionToken, clientMessageId: randomUUID(), texto: `Sí, soy Clienta Alta, ${telefono}` });

    const citas = await sql`select a.origen, s.nombre as servicio from public.appointments a join public.services s on s.id = a.service_id where a.business_id = ${n.id}`;
    expect(citas).toEqual([{ origen: 'agente', servicio: 'Corte' }]);
    expect(sms.enviados.some((s) => s.telefono === telefono && s.texto.startsWith('Peluquería Alta Test: cita confirmada'))).toBe(true);
  });
});

describe('editar (PI-04, PI-08, PI-09, PI-10)', () => {
  it('desactivar un servicio con citas: no se borra, el agente deja de ofrecerlo y las citas siguen', async () => {
    const n = await alta('Desactivar Test');
    const h = api();
    const cita = await pedir(h, 'POST', `negocios/${n.id}/citas`, { serviceId: n.servicioId, staffId: n.profesionalId, fecha: '2030-10-15', hora: '11:00', telefono: '+34999000111', nombre: 'Clienta Desactivar' });
    expect(cita.status).toBe(201);
    const antes = await pedir(h, 'GET', `negocios/${n.id}`);
    expect(antes.body.servicios[0].citasFuturas).toBe(1);

    const r = await pedir(h, 'PUT', `negocios/${n.id}/servicios/${n.servicioId}`, { nombre: 'Corte', descripcion: null, duracionMin: 60, bufferMin: 15, precio: 20, precioVisible: true, activo: false });
    expect(r.status).toBe(200);
    expect(r.body.servicios[0]).toMatchObject({ id: n.servicioId, activo: false });
    const config = await loadBusinessConfig(sql, { id: n.id });
    expect(config.servicios).toEqual([]);
    expect(buildSystemPrompt(config)).not.toContain('Corte');
    const [c] = await sql`select estado from public.appointments where id = ${cita.body.id}`;
    expect(c!.estado).toBe('confirmada');
  });

  it('preguntas frecuentes: van al prompt en el siguiente mensaje y el límite lo pone la base (RA007)', async () => {
    const n = await alta('Preguntas Test');
    const h = api();
    const r = await pedir(h, 'POST', `negocios/${n.id}/preguntas`, { pregunta: '¿Hay wifi?', respuesta: 'Sí, gratis para clientas.', orden: 1 });
    expect(r.status).toBe(200);
    expect(r.body.preguntas).toMatchObject([{ pregunta: '¿Hay wifi?', respuesta: 'Sí, gratis para clientas.' }]);
    expect(buildSystemPrompt(await loadBusinessConfig(sql, { id: n.id }))).toContain('- P: ¿Hay wifi?\n  R: Sí, gratis para clientas.');

    for (let i = 0; i < 19; i++) {
      expect((await pedir(h, 'POST', `negocios/${n.id}/preguntas`, { pregunta: `P${i}`, respuesta: 'R' })).status).toBe(200);
    }
    const de21 = await pedir(h, 'POST', `negocios/${n.id}/preguntas`, { pregunta: 'La 21', respuesta: 'No cabe' });
    expect(de21.status).toBe(409);
    expect(de21.body.mensaje).toContain('como mucho 20');

    const borrar = await pedir(h, 'DELETE', `negocios/${n.id}/preguntas/${r.body.preguntas[0].id}`);
    expect(borrar.body.preguntas).toHaveLength(19);
  });

  it('cambiar la clave: la anterior deja de funcionar en el widget al momento', async () => {
    const n = await alta('Clave Test');
    const h = api();
    const config = (k: string) => h(new Request(`http://api.test/api/widget/config?key=${k}`, { headers: { origin: ORIGEN } }), { ip: null });
    expect((await config(n.key)).status).toBe(200);
    const r = await pedir(h, 'POST', `negocios/${n.id}/clave`);
    expect(r.body.widgetKey).not.toBe(n.key);
    expect((await config(n.key)).status).toBe(404);
    expect((await config(r.body.widgetKey)).status).toBe(200);
  });

  it('logo: uno pequeño se guarda; uno demasiado grande o que no es una imagen se rechaza con palabras', async () => {
    const n = await alta('Logo Test');
    const h = api();
    const chat = { dominios: ['localhost', 'https://www.Ejemplo.test/'], color: '#336699', privacidadUrl: null, topeMensualUsd: 50 };
    const pequeno = `data:image/png;base64,${Buffer.alloc(3000, 7).toString('base64')}`;
    const ok = await pedir(h, 'PUT', `negocios/${n.id}/chat`, { ...chat, logo: pequeno });
    expect(ok.status).toBe(200);
    expect(ok.body.chat).toMatchObject({ logo: pequeno, dominios: ['localhost', 'www.ejemplo.test'] });

    const grande = `data:image/png;base64,${'A'.repeat(200_001)}`;
    const mal = await pedir(h, 'PUT', `negocios/${n.id}/chat`, { ...chat, logo: grande });
    expect(mal.status).toBe(400);
    expect(mal.body.mensaje).toContain('como mucho 200000');
    const noImagen = await pedir(h, 'PUT', `negocios/${n.id}/chat`, { ...chat, logo: 'https://otra-web.example/logo.png' });
    expect(noImagen.status).toBe(409);
    expect(noImagen.body.mensaje).toBe('El logo tiene que ser PNG, JPG, SVG o WebP de hasta ~150 KB.');
    const color = await pedir(h, 'PUT', `negocios/${n.id}/chat`, { ...chat, logo: null, color: 'rojo' });
    expect(color.body.mensaje).toBe('El color tiene que ser del tipo #8a5a63.');
  });

  it('festivos (PI-12): del local un día entero o de una profesional por horas; se borran', async () => {
    const n = await alta('Festivos Test');
    const h = api();
    await pedir(h, 'POST', `negocios/${n.id}/festivos`, { staffId: null, fechaDesde: '2030-10-21', motivo: 'Festivo local' });
    const r = await pedir(h, 'POST', `negocios/${n.id}/festivos`, { staffId: n.profesionalId, fechaDesde: '2030-10-22', horaDesde: '12:00', horaHasta: '14:00', motivo: 'Formación' });
    expect(r.body.festivos).toMatchObject([
      { staffId: null, fechaDesde: '2030-10-21', fechaHasta: '2030-10-21', diaEntero: true, motivo: 'Festivo local' },
      { staffId: n.profesionalId, fechaDesde: '2030-10-22', horaDesde: '12:00', horaHasta: '14:00', diaEntero: false },
    ]);
    const mal = await pedir(h, 'POST', `negocios/${n.id}/festivos`, { staffId: null, fechaDesde: '2030-10-22', horaDesde: '14:00', horaHasta: '12:00' });
    expect(mal.body.mensaje).toBe('El final tiene que ser después del inicio.');
    const b = await pedir(h, 'DELETE', `negocios/${n.id}/festivos/${r.body.festivos[0].id}`);
    expect(b.body.festivos).toHaveLength(1);
  });

  it('horario: un tramo que cierra antes de abrir se rechaza y no cambia nada', async () => {
    const n = await alta('Horario Test');
    const r = await pedir(api(), 'PUT', `negocios/${n.id}/horario`, { staffId: null, tramos: [{ weekday: 1, apertura: '10:00', cierre: '20:00' }, { weekday: 2, apertura: '14:00', cierre: '10:00' }] });
    expect(r.status).toBe(409);
    expect(r.body.mensaje).toBe('En cada tramo, el cierre tiene que ser después de la apertura.');
    const d = await pedir(api(), 'GET', `negocios/${n.id}`);
    expect(d.body.horario).toHaveLength(5);
  });
});

describe('citas a mano (PR-04, PI-14)', () => {
  it('a las 10:15 (fuera de la rejilla) y dentro de la antelación se crean, con SMS; fuera de horario, en festivo o pisando otra, no', async () => {
    const n = await alta('Agenda Test');
    const h = api();
    const cita = (fecha: string, hora: string, telefono = '+34999000222') =>
      pedir(h, 'POST', `negocios/${n.id}/citas`, { serviceId: n.servicioId, staffId: n.profesionalId, fecha, hora, telefono, nombre: 'Clienta Manual' });

    const r = await cita('2030-10-16', '10:15');
    expect(r.status).toBe(201);
    expect(r.body.sms).toBe('prueba');
    expect(sms.enviados.at(-1)?.texto).toContain('Agenda Test: cita confirmada el miércoles 16 de octubre a las 10:15 con Nora');

    // Dentro de la antelación: la base mide contra su reloj (now()), así que
    // se usa el día de hoy de verdad con un negocio que abre las 24 h.
    await pedir(h, 'PUT', `negocios/${n.id}/horario`, { staffId: null, tramos: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, apertura: '00:00', cierre: '24:00' })) });
    const [fila] = await sql<{ hoy: string; hora: string }[]>`
      select to_char(t, 'YYYY-MM-DD') as hoy, to_char(t, 'HH24:MI') as hora
        from (select (date_trunc('hour', now()) + interval '1 hour 15 minutes') at time zone 'Europe/Madrid' as t) x`;
    const pronto = await cita(fila!.hoy, fila!.hora, '+34999000333');
    expect(pronto.status).toBe(201);

    await pedir(h, 'PUT', `negocios/${n.id}/horario`, { staffId: null, tramos: SEMANA });
    const fuera = await cita('2030-10-16', '13:30', '+34999000444');
    expect(fuera.status).toBe(409);
    expect(fuera.body.motivo).toBe('outside_hours');
    const pisa = await cita('2030-10-16', '10:45', '+34999000444');
    expect(pisa.body.motivo).toBe('slot_taken');
    await pedir(h, 'POST', `negocios/${n.id}/festivos`, { staffId: null, fechaDesde: '2030-10-17' });
    const festivo = await cita('2030-10-17', '10:15', '+34999000444');
    expect(festivo.body).toMatchObject({ motivo: 'time_off', mensaje: 'Ese día u hora es festivo o la profesional está ausente.' });
    expect((await cita('2030-10-16', '11:30', 'no es un teléfono')).body.mensaje).toContain('El teléfono no es válido');

    const agenda = await pedir(h, 'GET', `negocios/${n.id}/agenda?fecha=2030-10-16`);
    expect(agenda.body.citas).toMatchObject([{ horaInicio: '10:15', horaFin: '11:15', origen: 'manual', servicio: 'Corte', profesional: 'Nora', estado: 'confirmada', clienta: { telefono: '+34999000222' } }]);

    const cancelar = await pedir(h, 'POST', `negocios/${n.id}/citas/${r.body.id}/cancelar`);
    expect(cancelar.body).toEqual({ cancelada: true });
    expect(sms.enviados.at(-1)?.texto).toContain('se ha cancelado');
    expect((await pedir(h, 'POST', `negocios/${n.id}/citas/${r.body.id}/cancelar`)).body).toEqual({ cancelada: false });
  });

  it('el agente, al mover una cita cargada a mano, sigue respetando la rejilla', async () => {
    const n = await alta('Mover Manual Test');
    const r = await pedir(api(), 'POST', `negocios/${n.id}/citas`, { serviceId: n.servicioId, staffId: n.profesionalId, fecha: '2030-10-16', hora: '10:15', telefono: '+34999000666', nombre: 'Clienta Mover' });
    const agenda = new SupabaseAdapter({ sql, businessId: n.id });
    await expect(agenda.rescheduleBooking(r.body.id, localToUtc('2030-10-17', '10:15', 'Europe/Madrid'))).rejects.toBeInstanceOf(OutsideHoursError);
    const movida = await agenda.rescheduleBooking(r.body.id, localToUtc('2030-10-17', '10:00', 'Europe/Madrid'));
    expect(movida.origin).toBe('manual');
  });
});

describe('probar el chat (PI-13), visor (PI-06, PI-07) y consumo (PI-11)', () => {
  it('la conversación de prueba queda marcada, el visor la enseña con sus herramientas y el consumo la separa', async () => {
    const n = await alta('Probar Test');
    const modelo = new ModeloSimulado([
      herramientas({ name: 'consultar_disponibilidad', input: { servicio: 'Corte', fecha_desde: '2030-10-15' } }),
      texto('Tengo el martes 15 a las 10:00.'),
      herramientas({ name: 'derivar_a_humano', input: { motivo: 'dato_desconocido', resumen: 'Pregunta por el aparcamiento' } }),
      texto('Eso no lo sé, se lo paso al equipo. ¿Puedo ayudarte en algo más?'),
    ]);
    const h = api(modelo);
    const p1 = await pedir(h, 'POST', `negocios/${n.id}/probar`, { texto: '¿Tienes hueco el martes?' });
    expect(p1.status).toBe(200);
    expect(p1.body.respuesta).toBe('Tengo el martes 15 a las 10:00.');
    const p2 = await pedir(h, 'POST', `negocios/${n.id}/probar`, { sessionToken: p1.body.sessionToken, texto: '¿Hay aparcamiento?' });
    expect(p2.body.nuevaConversacion).toBe(false);

    // La sesión de prueba no sirve en el widget.
    const widget = await h(
      new Request('http://api.test/api/chat/historial?key=' + n.key, { headers: { origin: ORIGEN, authorization: `Bearer ${p1.body.sessionToken}` } }),
      { ip: null },
    );
    expect(widget.status).toBe(401);

    const lista = await pedir(h, 'GET', `negocios/${n.id}/conversaciones?filtro=pruebas`);
    expect(lista.body).toHaveLength(1);
    expect(lista.body[0]).toMatchObject({ prueba: true, mensajes: 2, derivaciones: 1, derivacionesPendientes: 1 });
    expect(lista.body[0].costeUsd).toBeGreaterThan(0);

    const conv = await pedir(h, 'GET', `negocios/${n.id}/conversaciones/${lista.body[0].id}`);
    const tipos = conv.body.lineas.map((l: { tipo: string; nombre?: string }) => l.nombre ?? l.tipo);
    expect(tipos).toEqual(['clienta', 'consultar_disponibilidad', 'asistente', 'clienta', 'derivar_a_humano', 'asistente']);
    const consulta = conv.body.lineas[1];
    expect(consulta.entrada).toEqual({ servicio: 'Corte', fecha_desde: '2030-10-15' });
    expect(JSON.stringify(consulta.resultado)).toContain('10:00');

    const der = await pedir(h, 'GET', `negocios/${n.id}/derivaciones`);
    expect(der.body).toMatchObject([{ conversationId: lista.body[0].id, prueba: true }]);
    const resuelta = await pedir(h, 'POST', `negocios/${n.id}/derivaciones/${der.body[0].id}/resolver`);
    expect(resuelta.body).toEqual([]);

    const mes = '2030-10';
    const informe = await informeConsumo(sql, n.id, new Date().toISOString().slice(0, 7));
    expect(informe.mensajes).toBe(0);
    expect(informe.pruebas.mensajes).toBe(2);
    expect(informe.pruebas.conversaciones).toBe(1);
    expect(informe.pruebas.costeUsd).toBeGreaterThan(0);
    expect(informe.fraccionTope).toBeCloseTo(informe.pruebas.costeUsd / 50, 9);
    const todos = await pedir(h, 'GET', 'consumo');
    expect(todos.body.find((x: { businessId: string }) => x.businessId === n.id)).toMatchObject({ pruebas: { mensajes: 2 } });
    expect((await pedir(h, 'GET', `consumo?mes=${mes}`)).status).toBe(200);
  });

  it('un negocio pausado no se prueba ni atiende', async () => {
    const n = await alta('Pausa Test');
    const h = api();
    await pedir(h, 'POST', `negocios/${n.id}/activar`);
    const p = await pedir(h, 'POST', `negocios/${n.id}/pausar`);
    expect(p.body.estado).toBe('pausado');
    expect((await pedir(h, 'POST', `negocios/${n.id}/probar`, { texto: 'Hola' })).status).toBe(409);
    const config = await h(new Request(`http://api.test/api/widget/config?key=${n.key}`, { headers: { origin: ORIGEN } }), { ip: null });
    expect(config.status).toBe(404);
  });

  it('un negocio no ve las conversaciones, derivaciones ni citas de otro', async () => {
    const a = await alta('Aislamiento A Test');
    const b = await alta('Aislamiento B Test');
    const h = api(new ModeloSimulado([texto('Hola, soy la asistente.')]));
    await pedir(h, 'POST', `negocios/${a.id}/probar`, { texto: 'Hola' });
    const deA = await pedir(h, 'GET', `negocios/${a.id}/conversaciones`);
    expect(deA.body).toHaveLength(1);
    expect((await pedir(h, 'GET', `negocios/${b.id}/conversaciones`)).body).toEqual([]);
    expect((await pedir(h, 'GET', `negocios/${b.id}/conversaciones/${deA.body[0].id}`)).status).toBe(404);

    const cita = await pedir(h, 'POST', `negocios/${a.id}/citas`, { serviceId: a.servicioId, staffId: a.profesionalId, fecha: '2030-10-16', hora: '10:00', telefono: '+34999000555', nombre: 'De A' });
    expect((await pedir(h, 'POST', `negocios/${b.id}/citas/${cita.body.id}/cancelar`)).status).toBe(404);
    // Con el servicio de A en el negocio B: la base no lo deja.
    const cruzada = await pedir(h, 'POST', `negocios/${b.id}/citas`, { serviceId: a.servicioId, staffId: b.profesionalId, fecha: '2030-10-16', hora: '11:00', telefono: '+34999000555', nombre: 'Cruzada' });
    expect(cruzada.status).toBe(409);
    expect((await pedir(h, 'PUT', `negocios/${b.id}/servicios/${a.servicioId}`, { nombre: 'X', descripcion: null, duracionMin: 30, bufferMin: 0, precio: null, precioVisible: true, activo: true })).status).toBe(404);
    const prof = await pedir(h, 'PUT', `negocios/${b.id}/profesionales/${b.profesionalId}`, { nombre: 'Nora', activo: true, servicioIds: [a.servicioId] });
    expect(prof.status).toBe(409);
  });
});
