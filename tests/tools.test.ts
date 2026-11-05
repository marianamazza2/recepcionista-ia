// Herramientas del agente contra la base (Fase 2 · 2.3 y 2.5)
//
// Como en la Fase 1: Estética Aurora en fechas de 2030, con clientas propias
// del test (+34999…) que se borran al terminar (D-37). El reloj de las
// herramientas se fija en el lunes 14/10/2030 a las 10:00 de Madrid; el motor
// mide la antelación contra el now() real de la base, que queda muy lejos.
//
// Semana usada (horario de Aurora): lunes 21/10/2030 a domingo 27/10/2030.
//   L-X 9–14 y 16–20 · J 10–14 y 16–21 (Lucía solo 16–21) · V 9–15 · S-D cerrado

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { SupabaseAdapter } from '../src/adapters/booking/supabase.js';
import type { BookingAdapter } from '../src/adapters/booking/types.js';
import { loadBusinessConfig, type BusinessConfig } from '../src/config/business.js';
import { normalizarTelefono } from '../src/core/phone.js';
import { executeTool, toolDefinitions } from '../src/core/tools/index.js';
import type { ToolContext } from '../src/core/tools/types.js';
import { localToUtc } from '../src/core/time.js';
import { createSql } from '../src/db/client.js';
import { createConversation } from '../src/db/conversations.js';
import {
  AURORA,
  createTestBusiness,
  deleteTestBusiness,
  deleteTestCustomers,
  telefonoDeTest,
  type TestBusiness,
} from './helpers/fixtures.js';

const sql = createSql(undefined, { max: 4 });
const TZ = 'Europe/Madrid';
const AHORA = localToUtc('2030-10-14', '10:00', TZ);

let config: BusinessConfig;
let adapter: SupabaseAdapter;
const conversacionesSinClienta: string[] = [];

async function nuevoCtx(opts: { now?: Date; config?: BusinessConfig; adapter?: BookingAdapter } = {}): Promise<ToolContext> {
  const conv = await createConversation(sql, AURORA.businessId, null);
  conversacionesSinClienta.push(conv.id);
  return {
    sql,
    adapter: opts.adapter ?? adapter,
    config: opts.config ?? config,
    conversationId: conv.id,
    state: { customerId: null, estado: 'activa' },
    now: () => opts.now ?? AHORA,
  };
}

async function identificada(opts: Parameters<typeof nuevoCtx>[0] = {}): Promise<ToolContext & { telefono: string }> {
  const ctx = await nuevoCtx(opts);
  const telefono = telefonoDeTest();
  const r = await executeTool('identificar_cliente', { telefono, nombre: 'Clienta de test' }, ctx);
  expect(r.isError).toBe(false);
  return Object.assign(ctx, { telefono });
}

function datos(r: { resultado: { ok: boolean } }): Record<string, any> {
  const res = r.resultado as { ok: true; data: Record<string, any> } | { ok: false; error: Record<string, any> };
  return res.ok ? res.data : res.error;
}

async function limpiar(): Promise<void> {
  await sql`delete from public.time_off where business_id = ${AURORA.businessId} and motivo = 'test fase 2'`;
  await deleteTestCustomers(sql, AURORA.businessId);
  if (conversacionesSinClienta.length > 0) {
    await sql`delete from public.conversations where id = any(${conversacionesSinClienta}::uuid[])`;
  }
}

beforeAll(async () => {
  config = await loadBusinessConfig(sql, { slug: 'estetica-aurora' });
  adapter = new SupabaseAdapter({ sql, businessId: config.id });
  await limpiar();
});

afterAll(async () => {
  await limpiar();
  await sql.end();
});

// -----------------------------------------------------------------------------

describe('configuración del negocio (2.1)', () => {
  it('carga Aurora con servicios, profesionales, quién hace qué y horario', () => {
    expect(config.id).toBe(AURORA.businessId);
    expect(config.timezone).toBe(TZ);
    expect(config.servicios.map((s) => s.nombre)).toContain('Limpieza facial profunda');
    const marta = config.profesionales.find((p) => p.nombre === 'Marta')!;
    expect(marta.servicioIds).not.toContain(AURORA.services.laser);
    expect(config.horario.filter((t) => t.weekday === 1)).toEqual([
      { weekday: 1, apertura: '09:00', cierre: '14:00' },
      { weekday: 1, apertura: '16:00', cierre: '20:00' },
    ]);
    expect(config.horariosPropios).toEqual([
      { staffId: AURORA.staff.lucia, weekday: 4, apertura: '16:00', cierre: '21:00' },
    ]);
    expect(config.cancelacionModo).toBe('informar');
    expect(config.cancelacionPlazoHoras).toBe(24);
  });

  describe('guardrail: un precio no visible no sale de la configuración', () => {
    let negocio: TestBusiness;
    beforeAll(async () => {
      negocio = await createTestBusiness(sql, 'test-fase2-precio');
      await sql`update public.services set precio = 987.65, precio_visible = false where id = ${negocio.serviceId}`;
    });
    afterAll(async () => {
      await deleteTestBusiness(sql, negocio.businessId);
    });

    it('el precio se descarta al cargar y no aparece en las herramientas', async () => {
      const c = await loadBusinessConfig(sql, { id: negocio.businessId });
      expect(c.servicios[0]).toMatchObject({ precio: null, precioVisible: false });
      // El importe exacto (un "987" suelto puede salir dentro de un UUID al azar).
      expect(JSON.stringify(c)).not.toMatch(/987[.,]65/);
      expect(JSON.stringify(toolDefinitions(c))).not.toMatch(/987[.,]65/);
    });
  });
});

describe('teléfonos', () => {
  it('normaliza a formato internacional', () => {
    expect(normalizarTelefono('600 11 12 22')).toBe('+34600111222');
    expect(normalizarTelefono('+34 600-111-222')).toBe('+34600111222');
    expect(normalizarTelefono('0034600111222')).toBe('+34600111222');
    expect(normalizarTelefono('(+33) 6 12 34 56 78')).toBe('+33612345678');
    expect(normalizarTelefono('12345')).toBeNull();
    expect(normalizarTelefono('+34 12345')).toBeNull();
    expect(normalizarTelefono('hola')).toBeNull();
  });
});

describe('definiciones', () => {
  it('ocho herramientas, ordenadas, todas strict, sin buscar_en_conocimiento', () => {
    const defs = toolDefinitions(config);
    expect(defs.map((d) => d.name)).toEqual([
      'buscar_reservas_cliente',
      'cancelar_reserva',
      'consultar_disponibilidad',
      'crear_reserva',
      'derivar_a_humano',
      'identificar_cliente',
      'reprogramar_reserva',
      'reservar_y_cambiar_cita_anterior',
    ]);
    for (const d of defs) {
      expect(d.strict).toBe(true);
      expect(d.input_schema).toMatchObject({ type: 'object', additionalProperties: false });
    }
    // Deterministas: dos llamadas, mismos bytes.
    expect(JSON.stringify(toolDefinitions(config))).toBe(JSON.stringify(defs));
  });
});

// -----------------------------------------------------------------------------

describe('consultar_disponibilidad', () => {
  it('con hora preferida (10:15, fuera de la rejilla) ofrece primero 10:00 y 10:30, como mucho 3', async () => {
    const ctx = await nuevoCtx();
    const r = await executeTool(
      'consultar_disponibilidad',
      { servicio: 'Limpieza facial profunda', fecha_desde: '2030-10-21', hora_preferida: '10:15' },
      ctx,
    );
    expect(r.isError).toBe(false);
    const d = datos(r);
    expect(d.huecos).toHaveLength(3);
    expect(d.huecos.slice(0, 2).map((h: any) => h.hora)).toEqual(['10:00', '10:30']);
    expect(d.huecos[0]).toMatchObject({
      fecha: '2030-10-21',
      dia: 'lunes 21 de octubre de 2030',
      hora_fin: '11:00',
      profesionales: ['Lucía', 'Marta'],
    });
    expect(d.hay_mas).toBe(true);
  });

  it('un sábado: no hay huecos, dice que no abre y ofrece los más cercanos (PD-04)', async () => {
    const ctx = await nuevoCtx();
    const r = await executeTool(
      'consultar_disponibilidad',
      { servicio: 'Limpieza facial profunda', fecha_desde: '2030-10-26' },
      ctx,
    );
    const d = datos(r);
    expect(d.huecos).toEqual([]);
    expect(d.motivo_sin_huecos).toBe('el_local_no_abre_ese_dia');
    expect(d.alternativas.length).toBeGreaterThan(0);
    expect(d.alternativas[0]).toMatchObject({ fecha: '2030-10-28', hora: '09:00' });
  });

  it('un día que el local cierra (festivo, vacaciones): lo dice, sin el motivo escrito (PD-04)', async () => {
    await sql`
      insert into public.time_off (business_id, desde, hasta, motivo)
      values (${AURORA.businessId}, ${localToUtc('2030-10-29', '00:00', TZ)}, ${localToUtc('2030-11-01', '00:00', TZ)}, 'test fase 2')`;
    const ctx = await nuevoCtx();
    const unDia = datos(await executeTool('consultar_disponibilidad', { servicio: 'Limpieza facial profunda', fecha_desde: '2030-10-30' }, ctx));
    expect(unDia.huecos).toEqual([]);
    expect(unDia.motivo_sin_huecos).toBe('el_local_cierra_esos_dias');
    expect(JSON.stringify(unDia)).not.toContain('test fase 2');
    expect(unDia.alternativas.every((h: any) => !['2030-10-29', '2030-10-30', '2030-10-31'].includes(h.fecha))).toBe(true);
    const variosDias = datos(
      await executeTool('consultar_disponibilidad', { servicio: 'Limpieza facial profunda', fecha_desde: '2030-10-29', fecha_hasta: '2030-10-31' }, ctx),
    );
    expect(variosDias.motivo_sin_huecos).toBe('el_local_cierra_esos_dias');
    // Esos días los usan otros tests de este archivo para reservar.
    await sql`delete from public.time_off where business_id = ${AURORA.businessId} and motivo = 'test fase 2'`;
  });

  it('la profesional pedida no está ese día: lo dice (PD-04)', async () => {
    await sql`
      insert into public.time_off (business_id, staff_id, desde, hasta, motivo)
      values (${AURORA.businessId}, ${AURORA.staff.marta}, ${localToUtc('2030-10-24', '00:00', TZ)}, ${localToUtc('2030-10-25', '00:00', TZ)}, 'test fase 2')`;
    const ctx = await nuevoCtx();
    const d = datos(await executeTool('consultar_disponibilidad', { servicio: 'Limpieza facial profunda', fecha_desde: '2030-10-24', profesional: 'Marta' }, ctx));
    expect(d.motivo_sin_huecos).toBe('la_profesional_no_esta_esos_dias');
    await sql`delete from public.time_off where business_id = ${AURORA.businessId} and motivo = 'test fase 2'`;
  });

  it('con profesional, solo sus huecos; si no hace el servicio, lo dice y nombra a quien sí', async () => {
    const ctx = await nuevoCtx();
    const conMarta = datos(
      await executeTool(
        'consultar_disponibilidad',
        { servicio: 'Limpieza facial profunda', fecha_desde: '2030-10-24', profesional: 'Marta' },
        ctx,
      ),
    );
    expect(conMarta.huecos.every((h: any) => h.profesionales.join() === 'Marta')).toBe(true);

    const r = await executeTool(
      'consultar_disponibilidad',
      { servicio: 'Depilación láser (zona pequeña)', fecha_desde: '2030-10-21', profesional: 'Marta' },
      ctx,
    );
    expect(r.isError).toBe(true);
    expect(datos(r)).toMatchObject({ motivo: 'profesional_no_hace_servicio', profesionales_que_lo_hacen: ['Lucía'] });
  });

  it('rechaza fechas pasadas, mal escritas y rangos de más de 14 días', async () => {
    const ctx = await nuevoCtx();
    const pasada = await executeTool('consultar_disponibilidad', { servicio: 'Limpieza facial profunda', fecha_desde: '2030-10-01' }, ctx);
    expect(datos(pasada).motivo).toBe('fecha_pasada');
    const mal = await executeTool('consultar_disponibilidad', { servicio: 'Limpieza facial profunda', fecha_desde: '21/10/2030' }, ctx);
    expect(datos(mal).motivo).toBe('fecha_no_valida');
    const largo = await executeTool(
      'consultar_disponibilidad',
      { servicio: 'Limpieza facial profunda', fecha_desde: '2030-10-21', fecha_hasta: '2030-11-21' },
      ctx,
    );
    expect(datos(largo).motivo).toBe('rango_demasiado_grande');
  });
});

// -----------------------------------------------------------------------------

describe('identificar_cliente', () => {
  it('crea la clienta nueva, la reconoce después y liga la conversación', async () => {
    const ctx = await nuevoCtx();
    const telefono = telefonoDeTest();
    const nacional = telefono.slice(3).replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
    const r1 = await executeTool('identificar_cliente', { telefono: nacional, nombre: 'Nueva' }, ctx);
    expect(datos(r1)).toMatchObject({ identificada: true, telefono, clienta_nueva: true, ultima_profesional: null });
    expect(ctx.state.customerId).not.toBeNull();
    const [conv] = await sql`select customer_id from public.conversations where id = ${ctx.conversationId}`;
    expect(conv!.customer_id).toBe(ctx.state.customerId);

    const ctx2 = await nuevoCtx();
    const r2 = await executeTool('identificar_cliente', { telefono, nombre: 'Otro nombre' }, ctx2);
    expect(datos(r2).clienta_nueva).toBe(false);
    expect(ctx2.state.customerId).toBe(ctx.state.customerId);
    // No se sobrescribe el nombre que ya tenía.
    const [c] = await sql`select nombre from public.customers where id = ${ctx.state.customerId}`;
    expect(c!.nombre).toBe('Nueva');
  });

  it('PA-08: una conversación identificada no cambia de clienta, y no registra a la otra', async () => {
    const ctx = await identificada();
    const antes = ctx.state.customerId;
    const otro = telefonoDeTest();
    const r = await executeTool('identificar_cliente', { telefono: otro, nombre: 'Otra' }, ctx);
    expect(r.isError).toBe(true);
    expect(datos(r).motivo).toBe('conversacion_ya_identificada');
    expect(ctx.state.customerId).toBe(antes);
    const existe = await sql`select 1 from public.customers where business_id = ${AURORA.businessId} and telefono = ${otro}`;
    expect(existe).toHaveLength(0);
  });

  it('rechaza un teléfono que no lo es', async () => {
    const ctx = await nuevoCtx();
    const r = await executeTool('identificar_cliente', { telefono: '123', nombre: 'X' }, ctx);
    expect(datos(r).motivo).toBe('telefono_no_valido');
  });
});

// -----------------------------------------------------------------------------

describe('crear_reserva', () => {
  it('sin identificar no reserva', async () => {
    const ctx = await nuevoCtx();
    const r = await executeTool('crear_reserva', { servicio: 'Limpieza facial profunda', fecha: '2030-10-22', hora: '10:00' }, ctx);
    expect(datos(r).motivo).toBe('clienta_no_identificada');
  });

  it('sin profesional reserva y dice quién la atiende (PD-03); el mismo hueco con la misma profesional da ocupado + alternativas', async () => {
    const ctx = await identificada();
    const r = await executeTool('crear_reserva', { servicio: 'Limpieza facial profunda', fecha: '2030-10-22', hora: '10:00' }, ctx);
    expect(r.isError).toBe(false);
    const cita = datos(r).cita;
    expect(cita).toMatchObject({ fecha: '2030-10-22', hora: '10:00', hora_fin: '11:00', servicio: 'Limpieza facial profunda' });
    expect(['Marta', 'Lucía']).toContain(cita.profesional);

    const [fila] = await sql`select customer_id, estado, origen from public.appointments where id = ${cita.id_cita}`;
    expect(fila).toMatchObject({ customer_id: ctx.state.customerId, estado: 'confirmada', origen: 'agente' });

    const otra = await identificada();
    const r2 = await executeTool(
      'crear_reserva',
      { servicio: 'Limpieza facial profunda', fecha: '2030-10-22', hora: '10:00', profesional: cita.profesional },
      otra,
    );
    expect(r2.isError).toBe(true);
    const e = datos(r2);
    expect(e.motivo).toBe('hueco_ocupado');
    expect(e.alternativas.length).toBeGreaterThan(0);
    expect(e.alternativas.length).toBeLessThanOrEqual(3);
    expect(e.alternativas.every((h: any) => h.profesionales.includes(cita.profesional))).toBe(true);
  });

  it('PR-04: a las 10:15 no reserva y ofrece 10:00 y 10:30', async () => {
    const ctx = await identificada();
    const r = await executeTool('crear_reserva', { servicio: 'Limpieza facial profunda', fecha: '2030-10-23', hora: '10:15' }, ctx);
    const e = datos(r);
    expect(e.motivo).toBe('fuera_de_horario');
    expect(e.alternativas.slice(0, 2).map((h: any) => h.hora)).toEqual(['10:00', '10:30']);
  });

  it('PD-04: un domingo no reserva y ofrece huecos cercanos', async () => {
    const ctx = await identificada();
    const r = await executeTool('crear_reserva', { servicio: 'Limpieza facial profunda', fecha: '2030-10-27', hora: '11:00' }, ctx);
    const e = datos(r);
    expect(e.motivo).toBe('fuera_de_horario');
    expect(e.alternativas.length).toBe(3);
    expect(e.alternativas.every((h: any) => h.fecha !== '2030-10-27')).toBe(true);
  });

  it('un festivo da festivo_o_ausencia con alternativas en otros días', async () => {
    await sql`
      insert into public.time_off (business_id, desde, hasta, motivo)
      values (${AURORA.businessId}, ${localToUtc('2030-10-30', '00:00', TZ)}, ${localToUtc('2030-10-31', '00:00', TZ)}, 'test fase 2')`;
    const ctx = await identificada();
    const r = await executeTool('crear_reserva', { servicio: 'Limpieza facial profunda', fecha: '2030-10-30', hora: '10:00' }, ctx);
    const e = datos(r);
    expect(e.motivo).toBe('festivo_o_ausencia');
    expect(e.alternativas.length).toBeGreaterThan(0);
    expect(e.alternativas.every((h: any) => h.fecha !== '2030-10-30')).toBe(true);
  });

  it('una fecha pasada (según el reloj del agente) no se intenta', async () => {
    const ctx = await identificada();
    const r = await executeTool('crear_reserva', { servicio: 'Limpieza facial profunda', fecha: '2030-10-14', hora: '09:00' }, ctx);
    expect(datos(r).motivo).toBe('fecha_pasada');
  });

  describe('PD-05: antelación mínima (contra el reloj real de la base)', () => {
    let negocio: TestBusiness;
    beforeAll(async () => {
      negocio = await createTestBusiness(sql, 'test-fase2-antelacion');
    });
    afterAll(async () => {
      await deleteTestBusiness(sql, negocio.businessId);
    });

    it('a menos de 2 h da antelacion_insuficiente y alternativas que sí la cumplen', async () => {
      const c = await loadBusinessConfig(sql, { id: negocio.businessId });
      const ad = new SupabaseAdapter({ sql, businessId: negocio.businessId });
      const conv = await createConversation(sql, negocio.businessId, negocio.customerId);
      const ahora = new Date();
      const ctx: ToolContext = {
        sql,
        adapter: ad,
        config: c,
        conversationId: conv.id,
        state: { customerId: negocio.customerId, estado: 'activa' },
        now: () => ahora,
      };
      // El siguiente inicio de la rejilla a más de 30 min: está entre 30 y 60 min.
      const media = 30 * 60_000;
      const inicio = new Date(Math.ceil((ahora.getTime() + media) / media) * media);
      const { fecha, hora } = (await import('../src/core/time.js')).utcToLocal(inicio, TZ);
      const r = await executeTool('crear_reserva', { servicio: 'Servicio 60 + 15', fecha, hora }, ctx);
      const e = datos(r);
      expect(e.motivo).toBe('antelacion_insuficiente');
      expect(e.mensaje).toContain('2 h');
      expect(e.alternativas.length).toBeGreaterThan(0);
      for (const h of e.alternativas) {
        expect(localToUtc(h.fecha, h.hora, TZ).getTime() - ahora.getTime()).toBeGreaterThanOrEqual(2 * 3600_000);
      }
    });
  });
});

// -----------------------------------------------------------------------------

describe('cancelar_reserva y reprogramar_reserva', () => {
  async function reservar(ctx: ToolContext, fecha: string, hora: string, profesional?: string) {
    const r = await executeTool(
      'crear_reserva',
      { servicio: 'Limpieza facial profunda', fecha, hora, ...(profesional ? { profesional } : {}) },
      ctx,
    );
    expect(r.isError).toBe(false);
    return datos(r).cita as { id_cita: string; profesional: string };
  }

  it('PA-08: no se puede cancelar ni mover una cita de otra clienta', async () => {
    const duena = await identificada();
    const cita = await reservar(duena, '2030-10-21', '17:00');
    const intrusa = await identificada();

    const c = await executeTool('cancelar_reserva', { id_cita: cita.id_cita }, intrusa);
    expect(datos(c).motivo).toBe('cita_no_encontrada');
    const m = await executeTool('reprogramar_reserva', { id_cita: cita.id_cita, fecha: '2030-10-21', hora: '18:00' }, intrusa);
    expect(datos(m).motivo).toBe('cita_no_encontrada');
    const v = await executeTool('buscar_reservas_cliente', {}, intrusa);
    expect(datos(v).proximas).toEqual([]);

    const [fila] = await sql`select estado, start_at from public.appointments where id = ${cita.id_cita}`;
    expect(fila!.estado).toBe('confirmada');
    expect((fila!.start_at as Date).toISOString()).toBe(localToUtc('2030-10-21', '17:00', TZ).toISOString());
  });

  it('cancela una cita propia lejos del plazo sin recordar la política', async () => {
    const ctx = await identificada();
    const cita = await reservar(ctx, '2030-10-22', '17:00');
    const r = await executeTool('cancelar_reserva', { id_cita: cita.id_cita }, ctx);
    expect(datos(r)).toMatchObject({ cancelada: true, dentro_del_plazo: false });
    expect(datos(r).politica_cancelacion).toBeUndefined();
    const [fila] = await sql`select estado from public.appointments where id = ${cita.id_cita}`;
    expect(fila!.estado).toBe('cancelada');
  });

  it('PR-07 informar: dentro del plazo cancela y devuelve la política del negocio', async () => {
    const reserva = await identificada();
    const cita = await reservar(reserva, '2030-10-23', '17:00');
    // Tres horas antes de la cita.
    const ctx = Object.assign(await nuevoCtx({ now: localToUtc('2030-10-23', '14:00', TZ) }), {
      state: { customerId: reserva.state.customerId, estado: 'activa' as const },
    });
    const r = await executeTool('cancelar_reserva', { id_cita: cita.id_cita }, ctx);
    expect(datos(r)).toMatchObject({ cancelada: true, dentro_del_plazo: true, politica_cancelacion: config.politicaCancelacion });
  });

  it('PR-07 bloquear: dentro del plazo NO cancela ni mueve (lo comprueba el código)', async () => {
    const reserva = await identificada();
    const cita = await reservar(reserva, '2030-10-24', '17:00');
    const bloquear: BusinessConfig = { ...config, cancelacionModo: 'bloquear' };
    const ctx = Object.assign(await nuevoCtx({ now: localToUtc('2030-10-24', '14:00', TZ), config: bloquear }), {
      state: { customerId: reserva.state.customerId, estado: 'activa' as const },
    });

    const c = await executeTool('cancelar_reserva', { id_cita: cita.id_cita }, ctx);
    expect(c.isError).toBe(true);
    expect(datos(c)).toMatchObject({ motivo: 'dentro_del_plazo_bloqueado', politica_cancelacion: config.politicaCancelacion });
    const m = await executeTool('reprogramar_reserva', { id_cita: cita.id_cita, fecha: '2030-10-24', hora: '18:00' }, ctx);
    expect(datos(m).motivo).toBe('dentro_del_plazo_bloqueado');
    const [fila] = await sql`select estado, start_at from public.appointments where id = ${cita.id_cita}`;
    expect(fila!.estado).toBe('confirmada');

    // Fuera del plazo, el mismo modo sí cancela.
    const lejos = Object.assign(await nuevoCtx({ config: bloquear }), {
      state: { customerId: reserva.state.customerId, estado: 'activa' as const },
    });
    expect(datos(await executeTool('cancelar_reserva', { id_cita: cita.id_cita }, lejos)).cancelada).toBe(true);
  });

  it('PR-05: mover mantiene profesional; si ella no tiene el hueco, no se mueve y ofrece otros con ella', async () => {
    const ctx = await identificada();
    const cita = await reservar(ctx, '2030-10-21', '09:00', 'Marta');
    // Otra clienta ocupa a Marta a las 12:00.
    const otra = await identificada();
    await reservar(otra, '2030-10-21', '12:00', 'Marta');

    const r = await executeTool('reprogramar_reserva', { id_cita: cita.id_cita, fecha: '2030-10-21', hora: '12:00' }, ctx);
    expect(r.isError).toBe(true);
    const e = datos(r);
    expect(e.motivo).toBe('hueco_ocupado');
    expect(e.alternativas.length).toBeGreaterThan(0);
    expect(e.alternativas.every((h: any) => h.profesionales.join() === 'Marta')).toBe(true);
    const [orig] = await sql`select estado from public.appointments where id = ${cita.id_cita}`;
    expect(orig!.estado).toBe('confirmada');

    const ok = await executeTool('reprogramar_reserva', { id_cita: cita.id_cita, fecha: '2030-10-21', hora: '16:00' }, ctx);
    expect(ok.isError).toBe(false);
    expect(datos(ok).cita_nueva).toMatchObject({ hora: '16:00', profesional: 'Marta' });
    expect(datos(ok).dentro_del_plazo).toBe(false);
  });
});

// -----------------------------------------------------------------------------

describe('buscar_reservas_cliente', () => {
  it('devuelve sus próximas citas y la última profesional de una cita ya pasada (PR-06)', async () => {
    const ctx = await identificada();
    // Una cita pasada con Lucía, escrita a mano (el motor no reserva en el pasado).
    await sql`
      insert into public.appointments (business_id, staff_id, service_id, customer_id, start_at, end_at, estado, origen)
      values (${AURORA.businessId}, ${AURORA.staff.lucia}, ${AURORA.services.facial}, ${ctx.state.customerId},
              '2025-03-10 10:00+01', '2025-03-10 11:00+01', 'confirmada', 'manual')`;
    const r1 = await executeTool('crear_reserva', { servicio: 'Limpieza facial profunda', fecha: '2030-10-25', hora: '09:00' }, ctx);
    expect(r1.isError).toBe(false);

    const r = datos(await executeTool('buscar_reservas_cliente', {}, ctx));
    expect(r.ultima_profesional).toBe('Lucía');
    expect(r.proximas).toHaveLength(1);
    expect(r.proximas[0]).toMatchObject({ fecha: '2030-10-25', hora: '09:00' });

    // Y al volver a identificarse, ya sale como habitual.
    const otra = await nuevoCtx();
    const id = datos(await executeTool('identificar_cliente', { telefono: ctx.telefono, nombre: 'X' }, otra));
    expect(id).toMatchObject({ clienta_nueva: false, ultima_profesional: 'Lucía' });
  });
});

// -----------------------------------------------------------------------------

describe('PR-08: una clienta no puede tener dos citas a la vez', () => {
  // Cada test en su propio día de lunes a miércoles (9–14 y 16–20), para no
  // pisarse entre ellos a Lucía a las 17:00.
  const DIAS = ['2030-11-05', '2030-11-06', '2030-11-11', '2030-11-12', '2030-11-13', '2030-11-18', '2030-11-19'];
  let D = DIAS[0]!;
  let n = 0;
  beforeEach(() => {
    D = DIAS[n++]!;
  });
  const facial = 'Limpieza facial profunda';

  async function conCitaALas17(): Promise<ToolContext & { telefono: string; idAnterior: string }> {
    const ctx = await identificada();
    const r = await executeTool('crear_reserva', { servicio: facial, fecha: D, hora: '17:00', profesional: 'Lucía' }, ctx);
    expect(r.isError).toBe(false);
    return Object.assign(ctx, { idAnterior: datos(r).cita.id_cita as string });
  }

  it('crear_reserva a una hora en que ya tiene cita: no reserva y dice qué cita choca, sin ofrecer opciones', async () => {
    const ctx = await conCitaALas17();
    const r = await executeTool('crear_reserva', { servicio: facial, fecha: D, hora: '17:30' }, ctx);
    expect(r.isError).toBe(true);
    const e = datos(r);
    expect(e.motivo).toBe('clienta_ya_tiene_cita');
    expect(e.cita_que_choca).toMatchObject({ id_cita: ctx.idAnterior, hora: '17:00', profesional: 'Lucía' });
    expect(e.alternativas).toBeUndefined();
  });

  it('consultar_disponibilidad a la hora de una cita suya: lo dice y no ofrece horarios', async () => {
    const ctx = await conCitaALas17();
    const d = datos(await executeTool('consultar_disponibilidad', { servicio: facial, fecha_desde: D, hora_preferida: '17:30' }, ctx));
    expect(d.clienta_ya_tiene_cita).toBe(true);
    expect(d.cita_que_choca).toMatchObject({ id_cita: ctx.idAnterior, hora: '17:00' });
    expect(d.huecos).toBeUndefined();
  });

  it('consultar_disponibilidad no le ofrece horarios en que ya tiene cita', async () => {
    const ctx = await conCitaALas17();
    const d = datos(await executeTool('consultar_disponibilidad', { servicio: facial, fecha_desde: D, hora_preferida: '16:00' }, ctx));
    const horas = d.huecos.map((h: any) => h.hora);
    // 16:30, 17:00 y 17:30 se pisarían con su cita de 17:00 a 18:00.
    for (const h of ['16:30', '17:00', '17:30']) expect(horas).not.toContain(h);
    expect(horas).toContain('16:00');
  });

  it('mover la anterior: primero opciones (misma profesional, sin pisar la nueva) y luego todo junto', async () => {
    const ctx = await conCitaALas17();
    const base = { servicio: facial, fecha: D, hora: '17:00', id_cita_anterior: ctx.idAnterior, accion_anterior: 'mover' };

    const op = datos(await executeTool('reservar_y_cambiar_cita_anterior', base, ctx));
    expect(op.sin_cambios_todavia).toBe(true);
    expect(op.opciones_para_mover_la_anterior.length).toBeGreaterThan(0);
    for (const h of op.opciones_para_mover_la_anterior) {
      expect(h.profesionales).toEqual(['Lucía']);
      if (h.fecha === D) expect(['16:30', '17:00', '17:30']).not.toContain(h.hora);
    }
    // Nada ha cambiado todavía.
    let citas = await sql`select start_at from public.appointments where customer_id = ${ctx.state.customerId} and estado = 'confirmada'`;
    expect(citas).toHaveLength(1);

    const r = await executeTool('reservar_y_cambiar_cita_anterior', { ...base, mover_a_fecha: D, mover_a_hora: '18:30' }, ctx);
    expect(r.isError).toBe(false);
    const d = datos(r);
    expect(d.cita_nueva).toMatchObject({ fecha: D, hora: '17:00' });
    expect(d.cita_anterior_movida.antes).toMatchObject({ hora: '17:00', profesional: 'Lucía' });
    expect(d.cita_anterior_movida.ahora).toMatchObject({ hora: '18:30', profesional: 'Lucía' });
    citas = await sql`select start_at from public.appointments where customer_id = ${ctx.state.customerId} and estado = 'confirmada' order by start_at`;
    expect(citas.map((c) => (c.start_at as Date).getTime())).toEqual([
      localToUtc(D, '17:00', TZ).getTime(),
      localToUtc(D, '18:30', TZ).getTime(),
    ]);
  });

  it('si mover la anterior no se puede, no cambia nada y ofrece otras horas con su profesional', async () => {
    const ctx = await conCitaALas17();
    const base = { servicio: facial, fecha: D, hora: '17:00', id_cita_anterior: ctx.idAnterior, accion_anterior: 'mover' };
    // 17:30 se pisa con la nueva (17:00–18:00).
    const r = await executeTool('reservar_y_cambiar_cita_anterior', { ...base, mover_a_fecha: D, mover_a_hora: '17:30' }, ctx);
    expect(r.isError).toBe(true);
    const e = datos(r);
    expect(e.paso_que_fallo).toBe('mover_la_anterior');
    expect(e.mensaje).toContain('No se ha cambiado nada');
    expect(e.alternativas.every((h: any) => h.profesionales.join() === 'Lucía')).toBe(true);
    const citas = await sql`select id from public.appointments where customer_id = ${ctx.state.customerId} and estado = 'confirmada'`;
    expect(citas.map((c) => c.id)).toEqual([ctx.idAnterior]);
  });

  it('anular la anterior y reservar la nueva', async () => {
    const ctx = await conCitaALas17();
    const r = await executeTool(
      'reservar_y_cambiar_cita_anterior',
      { servicio: 'Consulta de valoración', fecha: D, hora: '17:00', id_cita_anterior: ctx.idAnterior, accion_anterior: 'anular' },
      ctx,
    );
    expect(r.isError).toBe(false);
    expect(datos(r).cita_anterior_anulada).toMatchObject({ id_cita: ctx.idAnterior });
    const [ant] = await sql`select estado from public.appointments where id = ${ctx.idAnterior}`;
    expect(ant!.estado).toBe('cancelada');
  });

  it('PA-08 y PR-07 también valen aquí', async () => {
    const duena = await conCitaALas17();
    const intrusa = await identificada();
    const r = await executeTool(
      'reservar_y_cambiar_cita_anterior',
      { servicio: facial, fecha: D, hora: '17:00', id_cita_anterior: duena.idAnterior, accion_anterior: 'anular' },
      intrusa,
    );
    expect(datos(r).motivo).toBe('cita_no_encontrada');

    const bloquear = Object.assign(
      await nuevoCtx({ now: localToUtc(D, '12:00', TZ), config: { ...config, cancelacionModo: 'bloquear' } }),
      { state: { customerId: duena.state.customerId, estado: 'activa' as const } },
    );
    const b = await executeTool(
      'reservar_y_cambiar_cita_anterior',
      { servicio: facial, fecha: D, hora: '17:00', id_cita_anterior: duena.idAnterior, accion_anterior: 'mover' },
      bloquear,
    );
    expect(datos(b).motivo).toBe('dentro_del_plazo_bloqueado');
  });
});

describe('derivar_a_humano (PA-06)', () => {
  it('crea la escalación, marca la conversación y bloquea las herramientas que escriben', async () => {
    const ctx = await identificada();
    const r = await executeTool('derivar_a_humano', { motivo: 'la_clienta_lo_pide', resumen: 'Quiere hablar con alguien' }, ctx);
    expect(datos(r)).toMatchObject({ derivada: true, telefono_local: config.telefonoHumano });
    expect(ctx.state.estado).toBe('escalada');

    const [conv] = await sql`select estado from public.conversations where id = ${ctx.conversationId}`;
    expect(conv!.estado).toBe('escalada');
    const esc = await sql`select motivo, resuelta from public.escalations where conversation_id = ${ctx.conversationId}`;
    expect(esc).toHaveLength(1);
    expect(esc[0]).toMatchObject({ motivo: 'la_clienta_lo_pide: Quiere hablar con alguien', resuelta: false });

    const c = await executeTool('crear_reserva', { servicio: 'Limpieza facial profunda', fecha: '2030-10-22', hora: '12:00' }, ctx);
    expect(datos(c).motivo).toBe('conversacion_derivada');
    // Derivar otra vez no duplica la escalación.
    await executeTool('derivar_a_humano', { motivo: 'otro', resumen: 'Insiste' }, ctx);
    expect(await sql`select 1 from public.escalations where conversation_id = ${ctx.conversationId}`).toHaveLength(1);
  });
});

describe('derivar una pregunta sin cerrar la conversación (PA-12)', () => {
  it('dato_desconocido y salud registran la consulta para el equipo y se puede seguir reservando', async () => {
    const ctx = await identificada();
    const r = await executeTool('derivar_a_humano', { motivo: 'dato_desconocido', resumen: 'Pregunta si hay parking' }, ctx);
    expect(datos(r)).toMatchObject({ consulta_pasada_al_equipo: true, conversacion_sigue_abierta: true, telefono_local: config.telefonoHumano });
    expect(ctx.state.estado).toBe('activa');
    await executeTool('derivar_a_humano', { motivo: 'salud', resumen: 'Pregunta por rosácea' }, ctx);

    const [conv] = await sql`select estado from public.conversations where id = ${ctx.conversationId}`;
    expect(conv!.estado).toBe('activa');
    const esc = await sql`select motivo from public.escalations where conversation_id = ${ctx.conversationId} order by created_at`;
    expect(esc.map((e) => e.motivo)).toEqual(['dato_desconocido: Pregunta si hay parking', 'salud: Pregunta por rosácea']);

    const c = await executeTool('crear_reserva', { servicio: 'Limpieza facial profunda', fecha: '2030-10-29', hora: '10:00' }, ctx);
    expect(c.isError).toBe(false);
  });
});

describe('fallos inesperados', () => {
  it('se devuelven como error_interno (para derivar) y no rompen el loop', async () => {
    const roto: BookingAdapter = Object.assign(Object.create(adapter) as BookingAdapter, {
      getAvailability: async () => {
        throw new Error('se cayó la base');
      },
    });
    const ctx = await nuevoCtx({ adapter: roto });
    const vistos: unknown[] = [];
    const r = await executeTool(
      'consultar_disponibilidad',
      { servicio: 'Limpieza facial profunda', fecha_desde: '2030-10-21' },
      ctx,
      (e) => vistos.push(e),
    );
    expect(r.isError).toBe(true);
    expect(datos(r).motivo).toBe('error_interno');
    expect(vistos).toHaveLength(1);
    const desconocida = await executeTool('borrar_todo', {}, ctx);
    expect(datos(desconocida).motivo).toBe('herramienta_desconocida');
  });
});
