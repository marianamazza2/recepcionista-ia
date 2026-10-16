// El loop del agente con un modelo simulado (Fase 2 · 2.4 y 2.7). Sin coste de API.
//
// Contra Estética Aurora (2030), con clientas de test que se borran al final.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadBusinessConfig, type BusinessConfig } from '../src/config/business.js';
import {
  AJUSTES_DE_SERIE,
  BETA_FALLBACKS,
  buildRequest,
  runAgentTurn,
  settingsFromEnv,
  type AgentSettings,
} from '../src/core/agent.js';
import { localToUtc } from '../src/core/time.js';
import { createSql } from '../src/db/client.js';
import { createConversation, loadHistory } from '../src/db/conversations.js';
import { AURORA, deleteTestCustomers, telefonoDeTest } from './helpers/fixtures.js';
import { ModeloSimulado, herramientas, texto } from './helpers/modelo-simulado.js';

const sql = createSql(undefined, { max: 4 });
const AHORA = localToUtc('2030-10-14', '10:00', 'Europe/Madrid');
const ajustes: AgentSettings = { ...AJUSTES_DE_SERIE, limits: { maxVueltas: 3, maxTokensConversacion: 1_000_000 } };

let config: BusinessConfig;
const conversaciones: string[] = [];

async function nuevaConversacion(): Promise<string> {
  const c = await createConversation(sql, AURORA.businessId, null);
  conversaciones.push(c.id);
  return c.id;
}

function turno(modelo: ModeloSimulado, conversationId: string, mensaje: string, settings = ajustes) {
  return runAgentTurn({ sql, model: modelo, settings, now: () => AHORA }, { config, conversationId, mensaje });
}

async function limpiar() {
  await deleteTestCustomers(sql, AURORA.businessId);
  if (conversaciones.length > 0) {
    await sql`delete from public.conversations where id = any(${conversaciones}::uuid[])`;
  }
}

beforeAll(async () => {
  config = await loadBusinessConfig(sql, { slug: 'estetica-aurora' });
  await limpiar();
});

afterAll(async () => {
  await limpiar();
  await sql.end();
});

describe('la petición a la API', () => {
  it('modelo y esfuerzo de los ajustes, herramientas strict, system cacheado, fallbacks "default"', () => {
    const p = buildRequest(ajustes, config, [{ role: 'user', content: 'hola' }]);
    expect(p.model).toBe('claude-opus-5');
    expect(p.output_config).toEqual({ effort: 'low' });
    expect(p.betas).toEqual([BETA_FALLBACKS]);
    expect(p.fallbacks).toBe('default');
    expect(p.tool_choice).toBeUndefined(); // auto: así vale también para Opus 5.5, donde forzarla da 400
    expect(p.tools!.every((t) => 'strict' in t && t.strict === true)).toBe(true);
    expect(p.system).toEqual([expect.objectContaining({ cache_control: { type: 'ephemeral' } })]);
    expect(p.cache_control).toEqual({ type: 'ephemeral' });
    expect('thinking' in p).toBe(false); // sin thinking = adaptativo; se controla con effort
  });

  it('los ajustes salen de las variables de entorno, con valores de serie', () => {
    expect(settingsFromEnv({})).toEqual(AJUSTES_DE_SERIE);
    const s = settingsFromEnv({
      AGENT_MODEL: 'claude-sonnet-5-5',
      AGENT_EFFORT: 'medium',
      AGENT_MAX_VUELTAS: '5',
      AGENT_MAX_TOKENS_CONVERSACION: '200000',
    });
    expect(s).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'medium', limits: { maxVueltas: 5, maxTokensConversacion: 200_000 } });
    expect(settingsFromEnv({ AGENT_EFFORT: 'altísimo', AGENT_MAX_VUELTAS: 'x' })).toMatchObject({
      effort: 'low',
      limits: { maxVueltas: 8 },
    });
  });
});

describe('el loop', () => {
  it('ejecuta TODAS las herramientas pedidas, devuelve todos los resultados en un mensaje y para en end_turn', async () => {
    const conv = await nuevaConversacion();
    const modelo = new ModeloSimulado([
      herramientas(
        { name: 'consultar_disponibilidad', input: { servicio: 'Limpieza facial profunda', fecha_desde: '2030-10-21', hora_preferida: '10:00' } },
        { name: 'buscar_reservas_cliente', input: {} },
      ),
      texto('El lunes 21 a las 10:00 tengo a Lucía o a Marta. ¿Tienes preferencia?'),
    ]);

    const r = await turno(modelo, conv, 'Quiero una limpieza facial el lunes 21 a las 10');
    expect(r.motivoFin).toBe('respuesta');
    expect(r.texto).toContain('Lucía');
    expect(r.llamadas).toBe(2);
    expect(r.herramientas.map((h) => h.nombre)).toEqual(['consultar_disponibilidad', 'buscar_reservas_cliente']);

    const segunda = modelo.peticiones[1]!;
    const ultimo = segunda.messages.at(-1)!;
    expect(ultimo.role).toBe('user');
    const resultados = ultimo.content as Array<{ type: string; tool_use_id: string; is_error?: boolean; content: string }>;
    expect(resultados).toHaveLength(2);
    expect(resultados.every((b) => b.type === 'tool_result')).toBe(true);
    const pedidos = (segunda.messages.at(-2)!.content as Array<{ type: string; id?: string }>).filter((b) => b.type === 'tool_use');
    expect(resultados.map((b) => b.tool_use_id)).toEqual(pedidos.map((b) => b.id));
    expect(JSON.parse(resultados[0]!.content).huecos[0].hora).toBe('10:00');
    // Sin clienta identificada, buscar_reservas_cliente es un error para el modelo.
    expect(resultados[1]!.is_error).toBe(true);
  });

  it('historial solo-añadir: el turno siguiente reenvía el anterior tal cual, con los bloques thinking', async () => {
    const conv = await nuevaConversacion();
    const modelo = new ModeloSimulado([
      herramientas({ name: 'consultar_disponibilidad', input: { servicio: 'Limpieza facial profunda', fecha_desde: '2030-10-22' } }),
      texto('Tengo el martes 22 a las 9:00, 9:30 o 10:00.'),
      texto('Perfecto.'),
    ]);
    await turno(modelo, conv, 'Hola, ¿hay hueco el martes 22?');
    await turno(modelo, conv, 'Gracias');

    const enviadoAntes = modelo.peticiones[1]!.messages;
    const delTurno1 = [...enviadoAntes, { role: 'assistant', content: [{ type: 'text', text: 'Tengo el martes 22 a las 9:00, 9:30 o 10:00.', citations: null }] }];
    const tercera = modelo.peticiones[2]!.messages;
    // Prefijo idéntico en contenido. (jsonb guarda las claves de cada objeto en
    // su propio orden; la API interpreta el JSON, así que el orden de claves
    // no cambia el prompt: ver D-45.)
    expect(tercera.slice(0, delTurno1.length)).toEqual(delTurno1);
    const thinking = (tercera[2]!.content as Array<{ type: string; signature?: string }>)[0]!;
    expect(thinking).toMatchObject({ type: 'thinking', signature: expect.stringMatching(/^firma-/) });
    // Y lo que hay en la base reconstruye exactamente lo que se envió.
    const historial = await loadHistory(sql, AURORA.businessId, conv);
    expect(historial).toEqual([...tercera, { role: 'assistant', content: [{ type: 'text', text: 'Perfecto.', citations: null }] }]);
  });

  it('el system prompt es el mismo en cada llamada y la fecha va en un mensaje de sistema tras el de la clienta', async () => {
    const conv = await nuevaConversacion();
    const modelo = new ModeloSimulado([texto('Hola'), texto('Claro')]);
    await turno(modelo, conv, 'Hola');
    await turno(modelo, conv, '¿Y mañana?');
    const [p1, p2] = modelo.peticiones;
    expect(JSON.stringify(p1!.system)).toBe(JSON.stringify(p2!.system));
    expect(JSON.stringify(p1!.tools)).toBe(JSON.stringify(p2!.tools));
    expect(JSON.stringify(p1!.system)).not.toContain('2030');
    expect(p1!.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Hola' }] },
      { role: 'system', content: 'Ahora en el local: lunes 14 de octubre de 2030, 10:00. Clienta: sin identificar.' },
    ]);
  });

  it('una clienta identificada en el turno aparece así en el aviso del turno siguiente', async () => {
    const conv = await nuevaConversacion();
    const telefono = telefonoDeTest();
    const modelo = new ModeloSimulado([
      herramientas({ name: 'identificar_cliente', input: { telefono, nombre: 'Clienta de test' } }),
      texto('Gracias, ya te tengo.'),
      texto('¿Qué necesitas?'),
    ]);
    await turno(modelo, conv, `Soy Clienta de test, mi teléfono es ${telefono}`);
    await turno(modelo, conv, 'Quiero una cita');
    const aviso = modelo.peticiones[2]!.messages.at(-1)!;
    expect(aviso).toEqual({
      role: 'system',
      content: `Ahora en el local: lunes 14 de octubre de 2030, 10:00. Clienta: identificada (Clienta de test, ${telefono}). No le pidas nombre ni teléfono.`,
    });
  });

  it('guarda mensajes, llamadas a herramientas y tokens, y actualiza ultimo_mensaje_at', async () => {
    const conv = await nuevaConversacion();
    const [antes] = await sql`select ultimo_mensaje_at from public.conversations where id = ${conv}`;
    const modelo = new ModeloSimulado([
      { ...herramientas({ name: 'consultar_disponibilidad', input: { servicio: 'Limpieza facial profunda', fecha_desde: '2030-10-23' } }), usage: { input_tokens: 50, output_tokens: 30, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 } },
      { ...texto('Tengo hueco.'), usage: { input_tokens: 70, output_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 } },
    ]);
    const r = await turno(modelo, conv, '¿Hay hueco el miércoles 23?');
    expect(r.usage).toEqual({ input_tokens: 120, output_tokens: 40, cache_read_input_tokens: 2000, cache_creation_input_tokens: 200 });

    const filas = await sql`
      select rol, contenido, tool_calls, tokens_in, tokens_out
        from public.messages where conversation_id = ${conv} order by created_at`;
    expect(filas.map((f) => f.rol)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(filas[0]!.contenido).toBe('¿Hay hueco el miércoles 23?');
    expect(filas[1]).toMatchObject({ tokens_in: 1050, tokens_out: 30 });
    expect(filas[1]!.tool_calls.herramientas).toEqual(['consultar_disponibilidad']);
    expect(filas[1]!.tool_calls.mensajes[0].content.some((b: { type: string }) => b.type === 'tool_use')).toBe(true);
    expect(filas[1]!.tool_calls.usage).toEqual({ input_tokens: 50, output_tokens: 30, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 });
    expect(filas[2]!.contenido).toBe('consultar_disponibilidad: ok');
    expect(filas[3]).toMatchObject({ contenido: 'Tengo hueco.', tokens_in: 1270, tokens_out: 10 });

    const [despues] = await sql`select ultimo_mensaje_at from public.conversations where id = ${conv}`;
    expect((despues!.ultimo_mensaje_at as Date).getTime()).toBeGreaterThan((antes!.ultimo_mensaje_at as Date).getTime());
  });

  it('una conversación con clienta reserva de verdad a través del loop', async () => {
    const conv = await nuevaConversacion();
    const telefono = telefonoDeTest();
    const modelo = new ModeloSimulado([
      herramientas({ name: 'identificar_cliente', input: { telefono, nombre: 'Clienta de test' } }),
      herramientas({ name: 'crear_reserva', input: { servicio: 'Limpieza facial profunda', fecha: '2030-10-23', hora: '16:00', profesional: 'Lucía' } }),
      (p) => {
        const res = JSON.parse((p.messages.at(-1)!.content as Array<{ content: string }>)[0]!.content);
        return texto(`Hecho: ${res.cita.dia} a las ${res.cita.hora} con ${res.cita.profesional}.`);
      },
    ]);
    const r = await turno(modelo, conv, 'Sí, resérvamela');
    expect(r.texto).toBe('Hecho: miércoles 23 de octubre de 2030 a las 16:00 con Lucía.');
    const citas = await sql`
      select a.estado from public.appointments a join public.conversations v on v.customer_id = a.customer_id
       where v.id = ${conv}`;
    expect(citas).toEqual([{ estado: 'confirmada' }]);
  });
});

describe('derivar y límites', () => {
  it('tras derivar_a_humano no se reserva en el mismo turno y el siguiente mensaje no llama al modelo (PA-06)', async () => {
    const conv = await nuevaConversacion();
    const telefono = telefonoDeTest();
    const modelo = new ModeloSimulado([
      herramientas({ name: 'identificar_cliente', input: { telefono, nombre: 'Clienta de test' } }),
      herramientas({ name: 'derivar_a_humano', input: { motivo: 'la_clienta_lo_pide', resumen: 'Quiere hablar con alguien' } }),
      herramientas({ name: 'crear_reserva', input: { servicio: 'Limpieza facial profunda', fecha: '2030-10-22', hora: '12:00' } }),
      texto(`Te paso con el equipo. Puedes llamar al ${config.telefonoHumano}.`),
    ]);
    const r = await turno(modelo, conv, 'Quiero hablar con una persona', { ...ajustes, limits: { ...ajustes.limits, maxVueltas: 8 } });
    expect(r.escalada).toBe(true);
    expect(r.herramientas.at(-1)!.resultado).toMatchObject({ ok: false, error: { motivo: 'conversacion_derivada' } });

    const llamadasAntes = modelo.peticiones.length;
    const r2 = await turno(modelo, conv, 'Bueno, resérvame igual el martes');
    expect(modelo.peticiones.length).toBe(llamadasAntes);
    expect(r2).toMatchObject({ escalada: true, motivoFin: 'conversacion_derivada', llamadas: 0 });
    expect(r2.texto).toContain(config.telefonoHumano!);
    const [fila] = await sql`
      select tool_calls from public.messages
       where conversation_id = ${conv} and rol = 'assistant' order by created_at desc limit 1`;
    expect(fila!.tool_calls).toEqual({ mensajes: [], respuesta_fija: 'conversacion_derivada' });
  });

  it('el límite de vueltas de herramientas deriva con un mensaje amable', async () => {
    const conv = await nuevaConversacion();
    const siempre = () => herramientas({ name: 'consultar_disponibilidad', input: { servicio: 'Limpieza facial profunda', fecha_desde: '2030-10-21' } });
    const modelo = new ModeloSimulado([siempre, siempre, siempre, siempre]);
    const r = await turno(modelo, conv, 'Dame todos los huecos de octubre');
    expect(r).toMatchObject({ motivoFin: 'limite_vueltas', escalada: true, llamadas: 3 });
    expect(r.texto).toContain(config.telefonoHumano!);
    const [c] = await sql`select estado from public.conversations where id = ${conv}`;
    expect(c!.estado).toBe('escalada');
    const esc = await sql`select motivo from public.escalations where conversation_id = ${conv}`;
    expect(esc[0]!.motivo).toMatch(/^limite_vueltas/);
  });

  it('cuando la conversación ya gastó su límite de tokens, deriva sin volver a llamar al modelo', async () => {
    const conv = await nuevaConversacion();
    const pocos = { ...ajustes, limits: { maxVueltas: 8, maxTokensConversacion: 1000 } };
    const modelo = new ModeloSimulado([
      { ...texto('Hola'), usage: { input_tokens: 1000, output_tokens: 100 } },
      { ...texto('Claro'), usage: { input_tokens: 1000, output_tokens: 100 } },
    ]);
    expect((await turno(modelo, conv, 'Hola', pocos)).motivoFin).toBe('respuesta');
    const r = await turno(modelo, conv, '¿Y la dirección?', pocos);
    expect(r).toMatchObject({ motivoFin: 'limite_tokens', escalada: true, llamadas: 0 });
    expect(modelo.peticiones).toHaveLength(1);
  });

  it('un fallo de la API deriva (PA-05) y lo pasa al log', async () => {
    const conv = await nuevaConversacion();
    const modelo = new ModeloSimulado([new Error('sin conexión')]);
    const errores: unknown[] = [];
    const r = await runAgentTurn(
      { sql, model: modelo, settings: ajustes, now: () => AHORA, onError: (e) => errores.push(e) },
      { config, conversationId: conv, mensaje: 'Hola' },
    );
    expect(r).toMatchObject({ motivoFin: 'error', escalada: true });
    expect(errores).toHaveLength(1);
  });

  it('un rechazo (refusal) no se le muestra a la clienta: deriva', async () => {
    const conv = await nuevaConversacion();
    const modelo = new ModeloSimulado([{ content: [], stop_reason: 'refusal' }]);
    const r = await turno(modelo, conv, 'algo');
    expect(r).toMatchObject({ motivoFin: 'rechazo', escalada: true });
    expect(r.texto).toContain(config.telefonoHumano!);
  });
});

describe('texto para la clienta', () => {
  it('una respuesta que solo trae una etiqueta interna no llega a la clienta', async () => {
    const conv = await nuevaConversacion();
    const telefono = telefonoDeTest();
    const modelo = new ModeloSimulado([
      herramientas({ name: 'identificar_cliente', input: { telefono, nombre: 'Clienta de test' } }),
      herramientas({ name: 'derivar_a_humano', input: { motivo: 'la_clienta_lo_pide', resumen: 'Pide una persona' } }),
      texto('antml:handle_stop_reason'),
    ]);
    const r = await turno(modelo, conv, 'Quiero hablar con una persona');
    expect(r.texto).not.toContain('antml');
    expect(r).toMatchObject({ escalada: true, motivoFin: 'conversacion_derivada' });
    expect(r.texto).toContain(config.telefonoHumano!);
  });

  it('las etiquetas sueltas se quitan y el resto del texto se conserva', async () => {
    const conv = await nuevaConversacion();
    const modelo = new ModeloSimulado([texto('<reply>Hola, ¿en qué te ayudo?</reply> antml:x')]);
    const r = await turno(modelo, conv, 'Hola');
    expect(r).toMatchObject({ texto: 'Hola, ¿en qué te ayudo?', motivoFin: 'respuesta', escalada: false });
  });
});
