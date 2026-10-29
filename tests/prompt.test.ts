// System prompt desde la configuración (Fase 2 · 2.2)

import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadBusinessConfig, type BusinessConfig } from '../src/config/business.js';
import { buildSystemPrompt, contextoDelTurno } from '../src/core/prompt.js';
import { createSql } from '../src/db/client.js';

const sql = createSql(undefined, { max: 2 });
let aurora: BusinessConfig;

beforeAll(async () => {
  aurora = await loadBusinessConfig(sql, { slug: 'estetica-aurora' });
});

afterAll(async () => {
  await sql.end();
});

describe('buildSystemPrompt', () => {
  it('es determinista: la misma configuración da exactamente el mismo texto', async () => {
    const otraCarga = await loadBusinessConfig(sql, { slug: 'estetica-aurora' });
    expect(buildSystemPrompt(otraCarga)).toBe(buildSystemPrompt(aurora));
  });

  it('con Aurora contiene sus datos, servicios, quién hace qué y precios visibles', () => {
    const p = buildSystemPrompt(aurora);
    expect(p).toContain('Eres la asistente virtual de Estética Aurora');
    expect(p).toContain('Calle Mayor 14');
    expect(p).toContain('+34910000000');
    expect(p).toContain('- Limpieza facial profunda: 60 min, 55 €. Lo hacen: Lucía y Marta.');
    expect(p).toContain('- Depilación láser (zona pequeña): 30 min, 40 €. Lo hace: Lucía.');
    expect(p).toContain('- Consulta de valoración: 20 min, sin coste.');
    expect(p).toContain('- lunes: de 09:00 a 14:00 y de 16:00 a 20:00');
    expect(p).toContain('- sábado: cerrado');
    expect(p).toContain('- Lucía, los jueves: de 16:00 a 21:00');
    expect(p).toContain(aurora.politicaCancelacion!);
    expect(p).toContain(aurora.mensajeBienvenida!);
    expect(p).toContain('cada 30 minutos');
    expect(p).toContain('2 horas de antelación');
  });

  it('sigue el orden del spec: identidad, qué hace, reglas, datos, derivar', () => {
    const p = buildSystemPrompt(aurora);
    const pos = ['# Quién eres', '# Qué haces y qué no', '# Cómo das cita', '# Datos del negocio', '# Cuándo pasar con una persona'].map(
      (h) => p.indexOf(h),
    );
    expect(pos.every((x) => x >= 0)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
  });

  it('no contiene un precio no visible', () => {
    // El precio se descarta al cargar la configuración; aquí se simula un
    // servicio oculto como lo dejaría loadBusinessConfig.
    const oculto: BusinessConfig = {
      ...aurora,
      servicios: aurora.servicios.map((s) =>
        s.nombre.startsWith('Tratamiento corporal') ? { ...s, precio: null, precioVisible: false } : s,
      ),
    };
    const p = buildSystemPrompt(oculto);
    expect(p).toContain('- Tratamiento corporal reafirmante: 90 min, precio: se lo confirman en el local.');
    expect(p).not.toContain('85');
  });

  it('cambia al cambiar el modo de asignación (PD-03)', () => {
    const preguntar = buildSystemPrompt(aurora);
    const automatica = buildSystemPrompt({ ...aurora, asignacionProfesional: 'automatica' });
    expect(preguntar).not.toBe(automatica);
    expect(preguntar).toContain('La última vez te atendió [nombre]');
    expect(automatica).toContain('el negocio asigna automáticamente');
    expect(automatica).not.toContain('La última vez te atendió');
  });

  it('cambia al cambiar el modo de cancelación (PR-07)', () => {
    const informar = buildSystemPrompt(aurora);
    const bloquear = buildSystemPrompt({ ...aurora, cancelacionModo: 'bloquear', cancelacionPlazoHoras: 48 });
    expect(informar).toContain('dentro_del_plazo=true');
    expect(bloquear).toContain('con menos de 48 horas de antelación, este chat no puede cancelar ni mover');
    expect(bloquear).not.toContain('dentro_del_plazo=true');
  });

  it('PA-10 y PA-11: salud solo con la información del negocio, lo que no sabe lo deriva, la cita es del titular del teléfono', () => {
    const p = buildSystemPrompt(aurora);
    expect(p).toContain('Solo puedes responder con lo que diga la información del negocio');
    expect(p).toContain('siempre lo pasas al equipo');
    expect(p).toContain('el nombre es el de quien viene y el teléfono tiene que ser el suyo');
    expect(p).toContain('nunca reserves para alguien con el teléfono de otra');
    expect(p).not.toContain('ofrécele pasarla con el equipo (deriva si acepta');
  });

  it('una sola confirmación, horarios agrupados por día y cierre con quién la atiende (16/10/2026)', () => {
    const p = buildSystemPrompt(aurora);
    expect(p).toContain('Confirmación, UNA sola vez');
    expect(p).toContain('¿me confirmas si es correcto?');
    expect(p).toContain('no vuelvas a resumir ni a preguntar si la reservas');
    expect(p).toContain('- 16:00');
    expect(p).toContain('Te la dejo con [profesional].');
    expect(p).toContain('No le ofrezcas cambiar de profesional');
    expect(p).not.toContain('pregunta si la reservas. Llama a crear_reserva solo después');
  });

  it('PI-08: las preguntas frecuentes van en los datos del negocio, en su orden y tal cual', () => {
    const p = buildSystemPrompt(aurora);
    expect(p).toContain('responde con su respuesta tal cual');
    const a = p.indexOf('- P: ¿Hay aparcamiento cerca?');
    const b = p.indexOf('- P: ¿Cómo se puede pagar?');
    const c = p.indexOf('- P: ¿Tenéis bonos regalo?\n  R: Sí. Se compran en recepción y valen para cualquier servicio durante un año.');
    expect(a).toBeGreaterThan(p.indexOf('# Datos del negocio'));
    expect(a < b && b < c && c < p.indexOf('# Cuándo pasar con una persona')).toBe(true);
    const sinPreguntas = buildSystemPrompt({ ...aurora, preguntasFrecuentes: [] });
    expect(sinPreguntas).not.toContain('Preguntas frecuentes del negocio');
  });

  it('no lleva fecha ni hora (rompería la caché)', () => {
    expect(buildSystemPrompt(aurora)).not.toMatch(/\b20\d\d\b/);
  });

  it('regla de oro: el código del núcleo no tiene datos de ningún negocio', () => {
    for (const f of ['src/core/prompt.ts', 'src/core/agent.ts', 'src/core/guardrails.ts', 'src/core/tools/common.ts', 'src/config/business.ts']) {
      const codigo = readFileSync(f, 'utf8');
      for (const dato of ['Aurora', 'Marta', 'Lucía', 'Calle Mayor', '+3491', 'aparcamiento', 'Plaza de la Fuente', 'bonos regalo']) {
        expect(codigo, `${f} contiene "${dato}"`).not.toContain(dato);
      }
    }
  });
});

describe('contextoDelTurno', () => {
  it('da la fecha y la hora local del negocio y si la clienta está identificada', () => {
    const t = new Date('2030-10-27T09:05:00Z'); // domingo, ya en horario de invierno: 10:05 en Madrid
    expect(contextoDelTurno(aurora, t, null)).toBe('Ahora en el local: domingo 27 de octubre de 2030, 10:05. Clienta: sin identificar.');
    expect(contextoDelTurno(aurora, t, { nombre: 'Ana', telefono: '+34600111222' })).toContain(
      'Clienta: identificada (Ana, +34600111222).',
    );
  });
});
