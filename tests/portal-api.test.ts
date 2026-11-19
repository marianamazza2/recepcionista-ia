// =============================================================================
// El portal del cliente por su API (Fase 9 · 9.2, 9.4, 9.4b)
// =============================================================================
// Sin coste de API (el chat va en alta-chat.test.ts, con el modelo simulado).
// Lo que se comprueba aquí:
//   · PC-02: el enlace de invitación (válido, usado, caducado, anulado,
//     inventado), el código del email y que la cuenta queda ligada a SU
//     negocio;
//   · PC-11: entrar con email y contraseña, salir, la sesión;
//   · aislamiento: una cuenta no lee ni escribe otro negocio por ninguna ruta;
//   · PC-09: no ve el tope ni puede activar;
//   · PC-16: la agenda y las citas a mano desde el portal;
//   · PC-06: los turnos sueltos desde el portal y desde el panel;
//   · PC-05: el panel ve exactamente lo mismo.
// Los negocios de prueba se borran al terminar (arrastran todo en cascada).

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { EmailDePrueba } from '../src/adapters/email/prueba.js';
import { createApi } from '../src/api/app.js';
import { AJUSTES_DE_SERIE, type AgentSettings } from '../src/core/agent.js';
import { localToUtc } from '../src/core/time.js';
import { createSql } from '../src/db/client.js';
import { guardarPersonaPanel } from '../src/db/personas.js';
import { AuthFalsa } from './helpers/auth-falsa.js';
import { ModeloSimulado } from './helpers/modelo-simulado.js';

vi.setConfig({ testTimeout: 120_000 });

const sql = createSql(undefined, { max: 6 });
const AHORA = localToUtc('2030-10-14', '10:00', 'Europe/Madrid'); // lunes
const ajustes: AgentSettings = { ...AJUSTES_DE_SERIE, limits: { maxVueltas: 4, maxTokensConversacion: 1_000_000 } };
const EMAIL_PANEL = `panel-portal-${randomUUID().slice(0, 8)}@example.test`;
const auth = new AuthFalsa();
const email = new EmailDePrueba({ silencioso: true });
const creados: string[] = [];
let userId: string;
let tokenPanel: string;
let ultimaIp = 0;

const h = () => createApi({ sql, model: new ModeloSimulado([]), settings: ajustes, email, baseUrl: 'http://api.test', now: () => AHORA, auth });

async function pedir(ruta: string, metodo: string, camino: string, body?: unknown, t?: string | null): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (t) headers.authorization = `Bearer ${t}`;
  const res = await h()(
    new Request(`http://api.test/api/${ruta}/${camino}`, { method: metodo, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }),
    { ip: `10.90.${(++ultimaIp >> 8) & 255}.${ultimaIp & 255}` },
  );
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const panel = (metodo: string, camino: string, body?: unknown, t: string | null = tokenPanel) => pedir('admin', metodo, camino, body, t);
const portal = (metodo: string, camino: string, body?: unknown, t?: string | null) => pedir('portal', metodo, camino, body, t);

const SEMANA = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, apertura: '10:00', cierre: '14:00' }));

/** Un negocio con lo mínimo, dado de alta desde el panel (como haría Mariana). */
async function alta(nombre: string): Promise<{ id: string; servicioId: string; profesionalId: string }> {
  const c = await panel('POST', 'negocios', { nombre, sector: 'estética' });
  expect(c.status).toBe(201);
  const id = c.body.id as string;
  creados.push(id);
  await panel('PUT', `negocios/${id}/datos`, { nombre, sector: 'estética', timezone: 'Europe/Madrid', direccion: 'Calle Inventada 1', telefonoHumano: '+34910000123', tonoDeVoz: null, mensajeBienvenida: null });
  let n = await panel('POST', `negocios/${id}/servicios`, { nombre: 'Limpieza', descripcion: null, duracionMin: 60, bufferMin: 0, precio: 40, precioVisible: true, activo: true });
  const servicioId = n.body.servicios[0].id as string;
  n = await panel('POST', `negocios/${id}/profesionales`, { nombre: 'Núria', activo: true, servicioIds: [servicioId] });
  const profesionalId = n.body.profesionales[0].id as string;
  await panel('PUT', `negocios/${id}/horario`, { staffId: null, tramos: SEMANA });
  await panel('PUT', `negocios/${id}/chat`, { dominios: ['localhost'], color: '#336699', logo: null, privacidadUrl: null, topeMensualUsd: 50 });
  return { id, servicioId, profesionalId };
}

/** Invita, confirma el código del email de prueba y crea la cuenta: devuelve el token de sesión. */
async function cuentaDePrueba(businessId: string, correo: string): Promise<string> {
  const inv = await panel('POST', `negocios/${businessId}/invitacion`, { email: correo });
  expect(inv.status).toBe(201);
  const token = (inv.body.enlace as string).split('/').pop()!;
  const abierto = await portal('POST', 'invitacion', { token });
  expect(abierto.status).toBe(200);
  const codigo = ultimoCodigo(correo);
  const cuenta = await portal('POST', 'cuenta', { token, codigo, password: 'una-contraseña-larga' });
  expect(cuenta.status).toBe(201);
  return cuenta.body.sessionToken as string;
}

/** El código de seis dígitos del último email mandado a ese correo (proveedor de prueba). */
function ultimoCodigo(correo: string): string {
  const e = [...email.enviados].reverse().find((x) => x.para === correo && /\b\d{6}\b/.test(x.texto));
  expect(e, `no hay ningún email con código para ${correo}`).toBeTruthy();
  return /\b(\d{6})\b/.exec(e!.texto)![1]!;
}

beforeAll(async () => {
  userId = auth.crearUsuario(EMAIL_PANEL, 'da-igual');
  await guardarPersonaPanel(sql, userId, EMAIL_PANEL);
  tokenPanel = auth.tokenPara(EMAIL_PANEL);
});

afterAll(async () => {
  for (const id of creados) await sql`delete from public.businesses where id = ${id}`;
  await sql`delete from panel.personas where user_id = ${userId}`;
  await sql.end();
});

// -----------------------------------------------------------------------------

describe('el enlace de invitación (PC-02)', () => {
  it('se genera desde el panel, abre la creación de cuenta y manda el código al email invitado', async () => {
    const n = await alta('Invitación Test');
    const correo = `contacto-${randomUUID().slice(0, 6)}@ejemplo.test`;
    const inv = await panel('POST', `negocios/${n.id}/invitacion`, { email: correo });
    expect(inv.status).toBe(201);
    expect(inv.body.enlace).toContain('/portal/#/invitacion/');
    expect(inv.body.invitacion).toMatchObject({ email: correo });

    const token = (inv.body.enlace as string).split('/').pop()!;
    const abierto = await portal('POST', 'invitacion', { token });
    expect(abierto.status).toBe(200);
    // El email se tapa: se ve a dónde va el código, no el correo entero.
    expect(abierto.body).toMatchObject({ negocio: 'Invitación Test' });
    expect(abierto.body.email).not.toBe(correo);
    expect(abierto.body.email).toContain('@ejemplo.test');
    expect(ultimoCodigo(correo)).toMatch(/^\d{6}$/);
  });

  it('un enlace inventado, usado, anulado o caducado no abre nada y dice lo mismo', async () => {
    const n = await alta('Enlaces Test');
    const correo = `contacto-${randomUUID().slice(0, 6)}@ejemplo.test`;

    // Inventado.
    const inventado = await portal('POST', 'invitacion', { token: 'a'.repeat(43) });
    expect(inventado.status).toBe(404);
    expect(inventado.body.mensaje).toBe('Este enlace ya no sirve. Pídele uno nuevo a MAZZMKT.');

    // Usado.
    const sesion = await cuentaDePrueba(n.id, correo);
    expect(sesion).toBeTruthy();
    const inv2 = await panel('GET', `negocios/${n.id}/invitacion`);
    expect(inv2.body.invitacion).toBeNull(); // ya no hay ninguno vivo

    // Generar otro anula el anterior (PC-02).
    const a = await panel('POST', `negocios/${n.id}/invitacion`, { email: correo });
    const tokenA = (a.body.enlace as string).split('/').pop()!;
    const b = await panel('POST', `negocios/${n.id}/invitacion`, { email: correo });
    const tokenB = (b.body.enlace as string).split('/').pop()!;
    expect((await portal('POST', 'invitacion', { token: tokenA })).status).toBe(404);
    expect((await portal('POST', 'invitacion', { token: tokenB })).status).toBe(200);

    // Anular desde el panel.
    await panel('DELETE', `negocios/${n.id}/invitacion`);
    expect((await portal('POST', 'invitacion', { token: tokenB })).status).toBe(404);

    // Caducado: se envejece la fila 8 días.
    const c = await panel('POST', `negocios/${n.id}/invitacion`, { email: correo });
    const tokenC = (c.body.enlace as string).split('/').pop()!;
    await sql`update portal.invitaciones set expira_at = now() - interval '1 day' where business_id = ${n.id}`;
    expect((await portal('POST', 'invitacion', { token: tokenC })).status).toBe(404);
  });

  it('sin el código del email no se crea la cuenta, y a los tres fallos se quema', async () => {
    const n = await alta('Codigo Test');
    const correo = `contacto-${randomUUID().slice(0, 6)}@ejemplo.test`;
    const inv = await panel('POST', `negocios/${n.id}/invitacion`, { email: correo });
    const token = (inv.body.enlace as string).split('/').pop()!;
    await portal('POST', 'invitacion', { token });

    for (const intento of [1, 2]) {
      const r = await portal('POST', 'cuenta', { token, codigo: '000000', password: 'una-contraseña-larga' });
      expect(r.status, `intento ${intento}`).toBe(400);
      expect(r.body.error).toBe('codigo_incorrecto');
    }
    const tercero = await portal('POST', 'cuenta', { token, codigo: '000000', password: 'una-contraseña-larga' });
    expect(tercero.body.error).toBe('codigo_agotado');
    // Y el código bueno ya no sirve: hay que pedir otro.
    expect((await portal('POST', 'cuenta', { token, codigo: ultimoCodigo(correo), password: 'una-contraseña-larga' })).status).toBe(400);
    // Con un código nuevo, sí.
    await portal('POST', 'invitacion', { token });
    const ok = await portal('POST', 'cuenta', { token, codigo: ultimoCodigo(correo), password: 'una-contraseña-larga' });
    expect(ok.status).toBe(201);
  });

  it('la contraseña corta se rechaza con un mensaje claro y no crea nada', async () => {
    const n = await alta('Password Test');
    const correo = `contacto-${randomUUID().slice(0, 6)}@ejemplo.test`;
    const inv = await panel('POST', `negocios/${n.id}/invitacion`, { email: correo });
    const token = (inv.body.enlace as string).split('/').pop()!;
    await portal('POST', 'invitacion', { token });
    const r = await portal('POST', 'cuenta', { token, codigo: ultimoCodigo(correo), password: 'corta' });
    expect(r.status).toBe(400);
    expect(r.body.mensaje).toContain('al menos 10 caracteres');
    // El enlace sigue sirviendo.
    expect((await portal('POST', 'invitacion', { token })).status).toBe(200);
  });
});

describe('entrar y salir (PC-11)', () => {
  it('entra con email y contraseña, sale, y la sesión deja de valer', async () => {
    const n = await alta('Sesión Test');
    const correo = `contacto-${randomUUID().slice(0, 6)}@ejemplo.test`;
    const sesion = await cuentaDePrueba(n.id, correo);

    const yo = await portal('GET', 'yo', undefined, sesion);
    expect(yo.status).toBe(200);
    expect(yo.body).toMatchObject({ email: correo, negocio: { id: n.id, nombre: 'Sesión Test', estado: 'trial' }, alta: { terminada: false } });

    // Entrar otra vez con sus credenciales.
    const entrar = await portal('POST', 'sesion', { email: correo.toUpperCase(), password: 'una-contraseña-larga' });
    expect(entrar.status).toBe(200);
    expect(entrar.body.negocio.id).toBe(n.id);

    // Contraseña mal, email que no existe: la misma respuesta.
    const mal = await portal('POST', 'sesion', { email: correo, password: 'otra-cosa-larga' });
    expect(mal.status).toBe(401);
    expect(mal.body.mensaje).toBe('Email o contraseña incorrectos.');
    const noExiste = await portal('POST', 'sesion', { email: 'nadie@ejemplo.test', password: 'otra-cosa-larga' });
    expect(noExiste.status).toBe(401);
    expect(noExiste.body.mensaje).toBe(mal.body.mensaje);

    // Salir.
    expect((await portal('POST', 'salir', {}, sesion)).status).toBe(200);
    expect((await portal('GET', 'yo', undefined, sesion)).status).toBe(401);
  });

  it('sin sesión (o con un token del panel, o con uno inventado) no se ve nada', async () => {
    const n = await alta('Sin Sesión Test');
    const rutas: Array<[string, string]> = [
      ['GET', 'yo'],
      ['GET', 'chat'],
      ['POST', 'chat'],
      ['GET', 'negocio'],
      ['PUT', 'negocio/datos'],
      ['POST', 'negocio/servicios'],
      ['GET', 'negocio/agenda'],
      ['POST', 'negocio/citas'],
      ['POST', 'negocio/turnos-sueltos'],
    ];
    for (const [metodo, camino] of rutas) {
      expect((await portal(metodo, camino, metodo === 'GET' ? undefined : {})).status, `${metodo} ${camino} sin token`).toBe(401);
      expect((await portal(metodo, camino, metodo === 'GET' ? undefined : {}, tokenPanel)).status, `${metodo} ${camino} con token del panel`).toBe(401);
      expect((await portal(metodo, camino, metodo === 'GET' ? undefined : {}, 'inventado')).status, `${metodo} ${camino} inventado`).toBe(401);
    }
    expect(n.id).toBeTruthy();
  });

  it('una sesión caducada no vale', async () => {
    const n = await alta('Caducada Test');
    const sesion = await cuentaDePrueba(n.id, `contacto-${randomUUID().slice(0, 6)}@ejemplo.test`);
    expect((await portal('GET', 'yo', undefined, sesion)).status).toBe(200);
    await sql`update portal.sesiones set expira_at = now() - interval '1 minute' where business_id = ${n.id}`;
    expect((await portal('GET', 'yo', undefined, sesion)).status).toBe(401);
  });
});

describe('una cuenta solo ve su negocio', () => {
  it('no hay forma de pedir otro negocio: ni por la dirección ni por la API', async () => {
    const mio = await alta('Mío Test');
    const ajeno = await alta('Ajeno Test');
    const sesion = await cuentaDePrueba(mio.id, `contacto-${randomUUID().slice(0, 6)}@ejemplo.test`);

    // La ficha que devuelve el portal es siempre la de la sesión.
    const ficha = await portal('GET', 'negocio', undefined, sesion);
    expect(ficha.body.id).toBe(mio.id);

    // Meter el id de otro negocio en la ruta no lleva a ningún sitio.
    for (const camino of [`negocio/${ajeno.id}`, `negocio/../admin/negocios/${ajeno.id}`, `negocios/${ajeno.id}`]) {
      const r = await portal('GET', camino, undefined, sesion);
      expect(r.status, camino).toBe(404);
      expect(JSON.stringify(r.body)).not.toContain('Ajeno Test');
    }

    // Y el panel sigue viendo los dos (PI-01).
    expect((await panel('GET', `negocios/${ajeno.id}`)).body.nombre).toBe('Ajeno Test');
  });

  it('lo que escribe el portal se guarda en SU negocio, no en otro', async () => {
    const mio = await alta('Escribe Mío');
    const ajeno = await alta('Escribe Ajeno');
    const sesion = await cuentaDePrueba(mio.id, `contacto-${randomUUID().slice(0, 6)}@ejemplo.test`);
    const antes = await panel('GET', `negocios/${ajeno.id}`);

    const r = await portal('POST', 'negocio/servicios', { nombre: 'Peeling', descripcion: null, duracionMin: 45, bufferMin: 5, precio: 60, precioVisible: true, activo: true }, sesion);
    expect(r.status).toBe(200);
    expect(r.body.servicios.map((s: { nombre: string }) => s.nombre)).toContain('Peeling');

    const despues = await panel('GET', `negocios/${ajeno.id}`);
    expect(despues.body.servicios).toHaveLength(antes.body.servicios.length);
    // PC-05: el panel ve exactamente lo que ve el portal.
    const enElPanel = await panel('GET', `negocios/${mio.id}`);
    expect(enElPanel.body.servicios.map((s: { nombre: string }) => s.nombre).sort()).toEqual(r.body.servicios.map((s: { nombre: string }) => s.nombre).sort());
  });
});

describe('lo que el cliente no puede hacer (PC-09)', () => {
  it('no ve el tope, no lo cambia y no puede activar ni pausar su negocio', async () => {
    const n = await alta('Tope Test');
    const sesion = await cuentaDePrueba(n.id, `contacto-${randomUUID().slice(0, 6)}@ejemplo.test`);

    const ficha = await portal('GET', 'negocio', undefined, sesion);
    expect(ficha.body.chat.topeMensualUsd).toBeUndefined();
    expect(ficha.body.chat.color).toBe('#336699');

    // Guardar el chat desde el portal conserva el tope que puso Mariana.
    const guardado = await portal('PUT', 'negocio/chat', { dominios: ['clinicatest.es'], color: '#112233', logo: null, privacidadUrl: null, topeMensualUsd: 99999 }, sesion);
    expect(guardado.status).toBe(200);
    expect(guardado.body.chat.topeMensualUsd).toBeUndefined();
    expect((await panel('GET', `negocios/${n.id}`)).body.chat).toMatchObject({ topeMensualUsd: 50, color: '#112233', dominios: ['clinicatest.es'] });

    // Activar, pausar y la clave no existen en el portal.
    for (const camino of ['negocio/activar', 'negocio/pausar', 'negocio/clave', 'negocio/probar', 'negocio/conversaciones', 'consumo']) {
      expect((await portal('POST', camino, {}, sesion)).status, camino).toBe(404);
    }
    expect((await panel('GET', `negocios/${n.id}`)).body.estado).toBe('trial');
  });
});

describe('la agenda del portal (PC-16)', () => {
  it('carga una cita a mano, la ve en su columna y la cancela; el panel ve lo mismo', async () => {
    const n = await alta('Agenda Portal');
    const sesion = await cuentaDePrueba(n.id, `contacto-${randomUUID().slice(0, 6)}@ejemplo.test`);

    const cita = await portal(
      'POST',
      'negocio/citas',
      { serviceId: n.servicioId, staffId: n.profesionalId, fecha: '2030-10-15', hora: '10:15', telefono: '+34999100100', nombre: 'Clienta Portal', email: 'clienta-portal@ejemplo.test', notas: null },
      sesion,
    );
    expect(cita.status).toBe(201);
    expect(email.enviados.at(-1)?.asunto).toContain('Agenda Portal');

    const agenda = await portal('GET', 'negocio/agenda?fecha=2030-10-15', undefined, sesion);
    expect(agenda.status).toBe(200);
    expect(agenda.body.profesionales.map((p: { nombre: string }) => p.nombre)).toEqual(['Núria']);
    expect(agenda.body.dias[0].citas).toMatchObject([{ horaInicio: '10:15', horaFin: '11:15', servicio: 'Limpieza', profesional: 'Núria', staffId: n.profesionalId }]);
    expect(agenda.body.dias[0].tramos).toMatchObject([{ staffId: n.profesionalId, desde: '10:00', hasta: '14:00', suelto: false }]);

    // La semana, y el panel viendo lo mismo (PC-05).
    const semana = await portal('GET', 'negocio/agenda?fecha=2030-10-14&dias=7', undefined, sesion);
    expect(semana.body.dias).toHaveLength(7);
    expect(semana.body.dias[1].citas).toHaveLength(1);
    const enElPanel = await panel('GET', `negocios/${n.id}/agenda?fecha=2030-10-15`);
    expect(enElPanel.body.dias[0].citas[0].id).toBe(cita.body.id);

    // Fuera de horario no la carga y lo dice con palabras.
    const fuera = await portal('POST', 'negocio/citas', { serviceId: n.servicioId, staffId: n.profesionalId, fecha: '2030-10-15', hora: '22:00', telefono: '+34999100101', nombre: 'Tarde', email: null, notas: null }, sesion);
    expect(fuera.status).toBe(409);
    expect(fuera.body.mensaje).toContain('fuera del horario');

    // Cancelar desde el portal manda el aviso (PW-10).
    const cancelada = await portal('POST', `negocio/citas/${cita.body.id}/cancelar`, {}, sesion);
    expect(cancelada.body).toEqual({ cancelada: true });
    expect(email.enviados.at(-1)?.asunto).toBe('Cita cancelada en Agenda Portal');
  });

  it('una cuenta no ve ni cancela las citas de otro negocio', async () => {
    const mio = await alta('Agenda Mía');
    const otro = await alta('Agenda Otra');
    const sesion = await cuentaDePrueba(mio.id, `contacto-${randomUUID().slice(0, 6)}@ejemplo.test`);
    const ajena = await panel('POST', `negocios/${otro.id}/citas`, { serviceId: otro.servicioId, staffId: otro.profesionalId, fecha: '2030-10-15', hora: '11:00', telefono: '+34999100200', nombre: 'Clienta Ajena' });
    expect(ajena.status).toBe(201);

    const agenda = await portal('GET', 'negocio/agenda?fecha=2030-10-15', undefined, sesion);
    expect(agenda.body.dias[0].citas).toHaveLength(0);
    const intento = await portal('POST', `negocio/citas/${ajena.body.id}/cancelar`, {}, sesion);
    expect(intento.status).toBe(404);
    expect(intento.body.mensaje).toBe('Esa cita no existe en este negocio.');
    expect((await panel('GET', `negocios/${otro.id}/agenda?fecha=2030-10-15`)).body.dias[0].citas[0].estado).toBe('confirmada');
  });
});

describe('turnos sueltos (PC-06)', () => {
  it('se cargan desde el portal y desde el panel, y el motor los aplica', async () => {
    const n = await alta('Turnos Portal');
    const sesion = await cuentaDePrueba(n.id, `contacto-${randomUUID().slice(0, 6)}@ejemplo.test`);
    // El domingo 2030-10-20 el local cierra; con turno suelto, Núria trabaja.
    const r = await portal('POST', 'negocio/turnos-sueltos', { staffId: n.profesionalId, fecha: '2030-10-20', apertura: '10:00', cierre: '14:00', motivo: 'Puente' }, sesion);
    expect(r.status).toBe(200);
    expect(r.body.turnosSueltos).toMatchObject([{ fecha: '2030-10-20', apertura: '10:00', cierre: '14:00', motivo: 'Puente' }]);

    const agenda = await portal('GET', 'negocio/agenda?fecha=2030-10-20', undefined, sesion);
    expect(agenda.body.dias[0].tramos).toMatchObject([{ desde: '10:00', hasta: '14:00', suelto: true }]);

    // Y el agente de las clientas puede dar cita ese día (el motor, D-26).
    const cita = await portal('POST', 'negocio/citas', { serviceId: n.servicioId, staffId: n.profesionalId, fecha: '2030-10-20', hora: '10:00', telefono: '+34999100300', nombre: 'Domingo', email: null, notas: null }, sesion);
    expect(cita.status).toBe(201);

    // Las horas y el día se validan.
    expect((await portal('POST', 'negocio/turnos-sueltos', { staffId: n.profesionalId, fecha: '2030-10-21', apertura: '14:00', cierre: '10:00' }, sesion)).status).toBe(400);
    expect((await portal('POST', 'negocio/turnos-sueltos', { staffId: n.profesionalId, fecha: '2030-10-20', apertura: '12:00', cierre: '16:00' }, sesion)).status).toBe(409);

    // Borrarlo desde el panel (PC-06: también desde tu panel).
    const id = r.body.turnosSueltos[0].id as string;
    const borrado = await panel('DELETE', `negocios/${n.id}/turnos-sueltos/${id}`);
    expect(borrado.status).toBe(200);
    expect(borrado.body.turnosSueltos).toHaveLength(0);
  });
});

describe('el aviso de alta terminada (PC-13)', () => {
  it('aparece en el panel y se apaga al revisarlo', async () => {
    const n = await alta('Aviso Test');
    await cuentaDePrueba(n.id, `contacto-${randomUUID().slice(0, 6)}@ejemplo.test`);
    expect((await panel('GET', 'altas')).body.map((a: { businessId: string }) => a.businessId)).not.toContain(n.id);

    await sql`update portal.alta set terminada_at = now() where business_id = ${n.id}`;
    const pendientes = await panel('GET', 'altas');
    expect(pendientes.body.map((a: { businessId: string }) => a.businessId)).toContain(n.id);
    expect(pendientes.body.find((a: { businessId: string }) => a.businessId === n.id).negocio).toBe('Aviso Test');

    const revisada = await panel('POST', `negocios/${n.id}/alta/revisada`);
    expect(revisada.body.map((a: { businessId: string }) => a.businessId)).not.toContain(n.id);
  });
});
