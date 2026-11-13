// La clienta es su email (PA-17) y el código del email (PA-16). Sin coste de API.
//
// Herramientas llamadas directamente, contra un negocio de test: identificar
// por email (y la ficha antigua sin email), que ver, cancelar o mover exija el
// código, y las reglas del código (hash, intentos, caducidad, límite por hora,
// ligado a la conversación).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SupabaseAdapter } from '../src/adapters/booking/supabase.js';
import { loadBusinessConfig, type BusinessConfig } from '../src/config/business.js';
import { normalizarEmail } from '../src/core/email.js';
import { localToUtc } from '../src/core/time.js';
import { executeTool } from '../src/core/tools/index.js';
import type { EnviarCodigo, ToolContext } from '../src/core/tools/types.js';
import { createSql } from '../src/db/client.js';
import { hashCodigo } from '../src/db/codigos.js';
import { createConversation } from '../src/db/conversations.js';
import { createTestBusiness, deleteTestBusiness, type TestBusiness } from './helpers/fixtures.js';

const sql = createSql(undefined, { max: 4 });
const AHORA = localToUtc('2030-10-14', '10:00', 'Europe/Madrid');

let N: TestBusiness;
let config: BusinessConfig;
let n = 0;

beforeAll(async () => {
  N = await createTestBusiness(sql, 'test-codigo');
  await sql`update public.businesses set telefono_humano = '+34910000777' where id = ${N.businessId}`;
  config = await loadBusinessConfig(sql, { id: N.businessId });
});

afterAll(async () => {
  await deleteTestBusiness(sql, N.businessId);
  await sql.end();
});

/** Una conversación nueva, con un buzón falso que guarda los códigos que "se mandan". */
async function nuevoCtx(opts: { now?: Date; sinEnvio?: boolean } = {}) {
  const conv = await createConversation(sql, N.businessId, null);
  const buzon: { email: string; codigo: string }[] = [];
  const enviar: EnviarCodigo = async ({ email, codigo }) => {
    buzon.push({ email, codigo });
  };
  const ctx: ToolContext = {
    sql,
    adapter: new SupabaseAdapter({ sql, businessId: N.businessId }),
    config,
    conversationId: conv.id,
    state: { customerId: null, estado: 'activa', verificada: false },
    now: () => opts.now ?? AHORA,
    ...(opts.sinEnvio ? {} : { enviarCodigo: enviar }),
  };
  return { ctx, buzon };
}

function datos(r: { resultado: { ok: boolean } }): Record<string, any> {
  const res = r.resultado as { ok: true; data: Record<string, any> } | { ok: false; error: Record<string, any> };
  return res.ok ? res.data : res.error;
}

function correo(): string {
  return `clienta.${++n}.${Date.now()}@example.com`;
}

function movil(): string {
  return `+3462${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
}

let dia = 14;

/** Identificada por email, con una cita a las 10:00 (cada una en su día: solo hay una profesional). */
async function conCita() {
  const { ctx, buzon } = await nuevoCtx();
  const email = correo();
  expect((await executeTool('identificar_cliente', { email, telefono: movil(), nombre: 'Clienta Código' }, ctx)).isError).toBe(false);
  const fecha = `2030-10-${++dia}`;
  const r = await executeTool('crear_reserva', { servicio: 'Servicio 60 + 15', fecha, hora: '10:00' }, ctx);
  expect(r.isError).toBe(false);
  return { ctx, buzon, email, fecha, citaId: datos(r).cita.id_cita as string };
}

describe('normalizarEmail', () => {
  it('minúsculas y sin espacios; rechaza lo que no es un email', () => {
    expect(normalizarEmail('  Maria.Lopez@Gmail.COM ')).toBe('maria.lopez@gmail.com');
    for (const malo of ['maria', 'maria@gmail', 'maria @gmail.com', 'maria@.com', 'maria@gmail.', 'a@b..com', '']) {
      expect(normalizarEmail(malo), malo).toBeNull();
    }
  });
});

describe('identificar_cliente por email (PA-17)', () => {
  it('el email identifica: el mismo email, otro día y con mayúsculas, es la misma ficha', async () => {
    const email = correo();
    const a = await nuevoCtx();
    const r1 = datos(await executeTool('identificar_cliente', { email, telefono: movil(), nombre: 'Ana' }, a.ctx));
    expect(r1).toMatchObject({ identificada: true, email, clienta_nueva: true });
    const b = await nuevoCtx();
    const r2 = datos(await executeTool('identificar_cliente', { email: email.toUpperCase(), telefono: movil(), nombre: 'Otra' }, b.ctx));
    expect(r2).toMatchObject({ clienta_nueva: false });
    expect(b.ctx.state.customerId).toBe(a.ctx.state.customerId);
  });

  it('el mismo móvil con dos emails son dos fichas (una madre y su hija)', async () => {
    const tel = movil();
    const a = await nuevoCtx();
    await executeTool('identificar_cliente', { email: correo(), telefono: tel, nombre: 'Madre' }, a.ctx);
    const b = await nuevoCtx();
    await executeTool('identificar_cliente', { email: correo(), telefono: tel, nombre: 'Hija' }, b.ctx);
    expect(a.ctx.state.customerId).not.toBe(b.ctx.state.customerId);
  });

  it('una clienta de antes (solo teléfono) que da su email recibe el email en su ficha', async () => {
    const tel = movil();
    const a = await nuevoCtx();
    await executeTool('identificar_cliente', { email: null, telefono: tel, nombre: 'Antigua' }, a.ctx);
    const email = correo();
    const b = await nuevoCtx();
    const r = datos(await executeTool('identificar_cliente', { email, telefono: tel, nombre: 'Antigua' }, b.ctx));
    expect(r.clienta_nueva).toBe(false);
    expect(b.ctx.state.customerId).toBe(a.ctx.state.customerId);
    const [c] = await sql<{ email: string }[]>`select email from public.customers where id = ${b.ctx.state.customerId!}`;
    expect(c!.email).toBe(email);
  });

  it('sin email reserva igual y avisa de que no le llegará nada', async () => {
    const { ctx } = await nuevoCtx();
    const r = datos(await executeTool('identificar_cliente', { email: null, telefono: movil(), nombre: 'Sin Email' }, ctx));
    expect(r.email).toBeNull();
    expect(r.sin_email).toContain('tendrá que llamar al local');
  });

  it('un email mal escrito se rechaza sin crear nada', async () => {
    const { ctx } = await nuevoCtx();
    const r = await executeTool('identificar_cliente', { email: 'maria@gmail', telefono: movil(), nombre: 'X' }, ctx);
    expect(datos(r).motivo).toBe('email_no_valido');
    expect(ctx.state.customerId).toBeNull();
  });

  it('PA-08: una conversación identificada no pasa a ser otra con otro email', async () => {
    const { ctx } = await nuevoCtx();
    await executeTool('identificar_cliente', { email: correo(), telefono: movil(), nombre: 'Primera' }, ctx);
    const r = await executeTool('identificar_cliente', { email: correo(), telefono: movil(), nombre: 'Segunda' }, ctx);
    expect(datos(r).motivo).toBe('conversacion_ya_identificada');
  });
});

describe('ver, cancelar o mover exige el código (PA-16)', () => {
  it('sin código no enseña ni toca nada; reservar sí se puede', async () => {
    const { ctx, fecha, citaId } = await conCita(); // la reserva no pidió código
    for (const [nombre, input] of [
      ['buscar_reservas_cliente', {}],
      ['cancelar_reserva', { id_cita: citaId }],
      ['reprogramar_reserva', { id_cita: citaId, fecha: '2030-11-20', hora: '10:00' }],
      ['reservar_y_cambiar_cita_anterior', { servicio: 'Servicio 60 + 15', fecha, hora: '10:00', id_cita_anterior: citaId, accion_anterior: 'anular' }],
    ] as const) {
      const r = await executeTool(nombre, input, ctx);
      expect(datos(r).motivo, nombre).toBe('falta_codigo');
    }
    const [c] = await sql<{ estado: string }[]>`select estado from public.appointments where id = ${citaId}`;
    expect(c!.estado).toBe('confirmada');
  });

  it('sin código, la cita que choca no se describe (PR-08)', async () => {
    const { ctx, fecha } = await conCita();
    const r = datos(
      await executeTool('consultar_disponibilidad', { servicio: 'Servicio 60 + 15', fecha_desde: fecha, fecha_hasta: fecha, hora_preferida: '10:00' }, ctx),
    );
    expect(r.clienta_ya_tiene_cita).toBe(true);
    expect(r.cita_que_choca).toBeUndefined();
    const choque = datos(await executeTool('crear_reserva', { servicio: 'Servicio 60 + 15', fecha, hora: '10:00' }, ctx));
    expect(choque.motivo).toBe('clienta_ya_tiene_cita');
    expect(choque.cita_que_choca).toBeUndefined();
  });

  it('con el código correcto, ya puede ver y cancelar; en la base solo queda el hash', async () => {
    const { ctx, buzon, email, citaId } = await conCita();
    const enviado = datos(await executeTool('enviar_codigo', {}, ctx));
    expect(enviado).toEqual({ enviado: true, email, caduca_en_minutos: 10 });
    expect(buzon).toHaveLength(1);
    const codigo = buzon[0]!.codigo;
    expect(JSON.stringify(enviado)).not.toContain(codigo); // el código no vuelve al modelo
    expect(codigo).toMatch(/^\d{6}$/);

    const [fila] = await sql<{ codigo_hash: string }[]>`
      select codigo_hash from public.codigos_verificacion where conversation_id = ${ctx.conversationId}`;
    expect(fila!.codigo_hash).toBe(hashCodigo(ctx.conversationId, codigo));
    expect(fila!.codigo_hash).not.toContain(codigo);

    expect(datos(await executeTool('verificar_codigo', { codigo: `${codigo.slice(0, 3)} ${codigo.slice(3)}` }, ctx))).toEqual({ verificada: true });
    const [conv] = await sql<{ verificada_at: Date | null }[]>`select verificada_at from public.conversations where id = ${ctx.conversationId}`;
    expect(conv!.verificada_at).not.toBeNull();

    const lista = datos(await executeTool('buscar_reservas_cliente', {}, ctx));
    expect(JSON.stringify(lista)).toContain(citaId);
    expect((await executeTool('cancelar_reserva', { id_cita: citaId }, ctx)).isError).toBe(false);
  });

  it('tres fallos queman el código; uno nuevo anula el anterior', async () => {
    const { ctx, buzon } = await conCita();
    await executeTool('enviar_codigo', {}, ctx);
    const bueno = buzon[0]!.codigo;
    const malo = bueno === '000000' ? '111111' : '000000';
    expect(datos(await executeTool('verificar_codigo', { codigo: malo }, ctx))).toMatchObject({ motivo: 'codigo_incorrecto' });
    expect(datos(await executeTool('verificar_codigo', { codigo: malo }, ctx)).mensaje).toContain('Le quedan 1 intento:');
    expect(datos(await executeTool('verificar_codigo', { codigo: malo }, ctx)).motivo).toBe('codigo_agotado');
    // Aunque ahora escriba el bueno, ya no vale.
    expect(datos(await executeTool('verificar_codigo', { codigo: bueno }, ctx)).motivo).toBe('sin_codigo');
    expect(ctx.state.verificada).toBe(false);

    await executeTool('enviar_codigo', {}, ctx);
    await executeTool('enviar_codigo', {}, ctx);
    expect(datos(await executeTool('verificar_codigo', { codigo: buzon[1]!.codigo }, ctx)).verificada).not.toBe(true);
    expect(datos(await executeTool('verificar_codigo', { codigo: buzon[2]!.codigo }, ctx))).toEqual({ verificada: true });
  });

  it('caduca a los 10 minutos', async () => {
    const { ctx, buzon } = await conCita();
    await executeTool('enviar_codigo', {}, ctx);
    const tarde: ToolContext = { ...ctx, now: () => new Date(AHORA.getTime() + 11 * 60_000) };
    expect(datos(await executeTool('verificar_codigo', { codigo: buzon[0]!.codigo }, tarde)).motivo).toBe('codigo_caducado');
  });

  it('como mucho 3 códigos por hora y conversación', async () => {
    const { ctx, buzon } = await conCita();
    for (let i = 0; i < 3; i++) expect(datos(await executeTool('enviar_codigo', {}, ctx)).enviado).toBe(true);
    expect(datos(await executeTool('enviar_codigo', {}, ctx)).motivo).toBe('demasiados_codigos');
    expect(buzon).toHaveLength(3);
  });

  it('un código no vale en otra conversación', async () => {
    const a = await conCita();
    await executeTool('enviar_codigo', {}, a.ctx);
    const b = await nuevoCtx();
    await executeTool('identificar_cliente', { email: a.email, telefono: movil(), nombre: 'Clienta Código' }, b.ctx);
    expect(datos(await executeTool('verificar_codigo', { codigo: a.buzon[0]!.codigo }, b.ctx)).motivo).toBe('sin_codigo');
  });

  it('sin email no hay código: tiene que llamar al local', async () => {
    const { ctx, buzon } = await nuevoCtx();
    await executeTool('identificar_cliente', { email: null, telefono: movil(), nombre: 'Sin Email' }, ctx);
    for (const nombre of ['buscar_reservas_cliente', 'enviar_codigo']) {
      const r = datos(await executeTool(nombre, {}, ctx));
      expect(r.motivo, nombre).toBe('sin_email');
      expect(r.mensaje).toContain('910 000 777');
    }
    expect(buzon).toHaveLength(0);
  });

  it('si el canal no puede mandar emails, lo dice y da el teléfono', async () => {
    const { ctx } = await nuevoCtx({ sinEnvio: true });
    await executeTool('identificar_cliente', { email: correo(), telefono: movil(), nombre: 'X' }, ctx);
    const r = datos(await executeTool('enviar_codigo', {}, ctx));
    expect(r.motivo).toBe('email_no_disponible');
    expect(r.mensaje).toContain('910 000 777');
  });
});
