// =============================================================================
// Las herramientas del chat del portal (Fase 9 · 9.3 y 9.5)
// =============================================================================
// Lo que el chat del alta (y el del portal, después) puede HACER. Todas
// escriben llamando a las MISMAS funciones que el panel de Mariana
// (src/db/negocios.ts) con el business_id de la sesión: ni una regla de
// negocio se reimplementa aquí (PC-05).
//
// Lo que el código garantiza, pase lo que pase en el chat:
//   · el negocio es SIEMPRE el de la sesión (ctx.businessId). No hay ninguna
//     herramienta que acepte un negocio como parámetro (PC-02);
//   · nada se guarda sin que el cliente haya visto el resumen y haya
//     contestado después (PC-03, db/portal.hayConfirmacion);
//   · no existe herramienta para activar o pausar el negocio, cambiar el tope
//     ni la clave del widget: eso es de Mariana (PC-09);
//   · lo que la base rechaza (horarios que se pisan, un teléfono raro, un
//     festivo encima de citas) vuelve al modelo con palabras, para que lo
//     explique y lo vuelva a pedir.
//
// Las profesionales y los servicios se nombran POR NOMBRE (el cliente no ve
// ids); aquí se traducen a ids de su propio negocio.
// =============================================================================

import type Anthropic from '@anthropic-ai/sdk';
import type { Sql } from 'postgres';

import { cancelarCitaManual } from '../citas/manual.js';
import type { EmailProvider } from '../adapters/email/types.js';
import { normalizarTelefono } from '../core/phone.js';
import { fechaLarga, inicioDelDia, localToUtc, sumarDias, utcToLocal } from '../core/time.js';
import {
  CitasAfectadas,
  crearFestivo,
  crearProfesional,
  crearServicio,
  crearTurnoSuelto,
  guardarDatos,
  guardarHorario,
  guardarProfesional,
  guardarReglas,
  guardarServicio,
  leerNegocio,
  type NegocioPanel,
} from '../db/negocios.js';
import { guardarEstadoDelAlta, hayConfirmacion } from '../db/portal.js';

export interface ContextoPortal {
  sql: Sql;
  email: EmailProvider;
  baseUrl: string;
  /** SIEMPRE el de la sesión. Ninguna herramienta lo recibe del modelo. */
  businessId: string;
  conversationId: string;
  /** La ficha de ahora; se recarga tras cada herramienta que escribe. */
  ficha: NegocioPanel;
  modo: 'alta' | 'portal';
  now: () => Date;
  onError?: (e: unknown) => void;
  /** Lo que la última llamada a proponer_resumen dejó para que lo dibuje el portal. */
  resumen?: Resumen | undefined;
  /** Cambia a true cuando el alta se da por terminada en este turno (PC-13). */
  altaTerminada?: boolean;
}

/** El bloque que el portal dibuja: el modelo pone los datos, no el formato. */
export interface Resumen {
  seccion: Seccion;
  titulo: string;
  lineas: { etiqueta: string; valor: string }[];
  tabla?: { columnas: string[]; filas: string[][] };
}

export type Seccion = 'negocio' | 'servicios' | 'profesionales' | 'horario' | 'reglas' | 'cambio';
const SECCIONES: Seccion[] = ['negocio', 'servicios', 'profesionales', 'horario', 'reglas', 'cambio'];

export type ResultadoHerramienta = { ok: true; data: Record<string, unknown> } | { ok: false; error: { motivo: string; mensaje: string; [k: string]: unknown } };

export interface HerramientaPortal {
  name: string;
  /** Si guarda algo (y por tanto necesita el resumen confirmado). */
  seccion?: Seccion;
  definicion: Anthropic.Beta.BetaTool;
  run(input: Record<string, unknown>, ctx: ContextoPortal): Promise<ResultadoHerramienta>;
}

// -----------------------------------------------------------------------------
// Ayudas
// -----------------------------------------------------------------------------

const DIAS: Record<string, number> = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, miércoles: 3, jueves: 4, viernes: 5, sabado: 6, sábado: 6,
};

function mal(motivo: string, mensaje: string, extra: Record<string, unknown> = {}): ResultadoHerramienta {
  return { ok: false, error: { motivo, mensaje, ...extra } };
}

function texto(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function lista(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null) : [];
}

/** Busca por nombre, sin tildes ni mayúsculas; null si no hay una sola coincidencia clara. */
function porNombre<T extends { nombre: string }>(cosas: T[], nombre: string): T | null {
  const limpio = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const n = limpio(nombre);
  if (!n) return null;
  const exactas = cosas.filter((c) => limpio(c.nombre) === n);
  if (exactas.length === 1) return exactas[0]!;
  const parciales = cosas.filter((c) => limpio(c.nombre).includes(n) || n.includes(limpio(c.nombre)));
  return parciales.length === 1 ? parciales[0]! : null;
}

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
function hora(v: unknown): string | null {
  const s = texto(v);
  if (s === '24:00') return '24:00';
  return HORA.test(s) ? s : null;
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

async function recargar(ctx: ContextoPortal): Promise<void> {
  const n = await leerNegocio(ctx.sql, ctx.businessId);
  if (n) ctx.ficha = n;
}

/** PC-03: sin resumen enseñado y contestado, no se guarda. */
async function faltaConfirmacion(ctx: ContextoPortal, seccion: Seccion): Promise<ResultadoHerramienta | null> {
  if (await hayConfirmacion(ctx.sql, ctx.businessId, ctx.conversationId, seccion)) return null;
  return mal(
    'falta_confirmacion',
    'Todavía no has enseñado el resumen de esta sección (o el cliente no ha contestado). Llama primero a proponer_resumen, enséñalo y pregunta «¿Está todo bien?». Cuando te conteste, vuelve a intentarlo.',
  );
}

/** PI-21 / PC-10: las citas que un festivo deja fuera, para que el agente pregunte. */
function citasAfectadasComoError(e: unknown): ResultadoHerramienta | null {
  if (!(e instanceof CitasAfectadas)) return null;
  return mal(
    'citas_afectadas',
    'Ese día ya tiene citas y no se ha guardado nada. Dile cuáles son y pregunta, tal cual: «¿Las dejamos programadas o las cancelo?». Después vuelve a llamarme con citas = "dejar" o "cancelar".',
    { citas: e.citas.map((c) => ({ fecha: c.fecha, hora: c.hora, clienta: c.clienta, servicio: c.servicio, profesional: c.profesional })) },
  );
}

function comoCitas(v: unknown): 'preguntar' | 'dejar' | 'cancelar' {
  return v === 'dejar' || v === 'cancelar' ? v : 'preguntar';
}

// -----------------------------------------------------------------------------
// Las herramientas
// -----------------------------------------------------------------------------

const verConfiguracion: HerramientaPortal = {
  name: 'ver_configuracion',
  definicion: {
    name: 'ver_configuracion',
    description: 'Vuelve a leer la configuración del negocio tal como está guardada ahora. Úsala si dudas de qué hay cargado o después de guardar algo.',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  async run(_i, ctx) {
    await recargar(ctx);
    const n = ctx.ficha;
    return {
      ok: true,
      data: {
        nombre: n.nombre,
        sector: n.sector,
        direccion: n.direccion,
        telefono: n.telefonoHumano,
        servicios: n.servicios.filter((s) => s.activo).map((s) => ({ nombre: s.nombre, duracion_min: s.duracionMin, margen_min: s.bufferMin, precio: s.precio, descripcion: s.descripcion })),
        profesionales: n.profesionales.filter((p) => p.activo).map((p) => ({ nombre: p.nombre, servicios: p.servicioIds.map((id) => n.servicios.find((s) => s.id === id)?.nombre).filter(Boolean) })),
        horario_local: n.horario.filter((t) => t.staffId === null),
        reglas: n.reglas,
        falta_para_activar: n.loQueFalta,
      },
    };
  },
};

const proponerResumen: HerramientaPortal = {
  name: 'proponer_resumen',
  definicion: {
    name: 'proponer_resumen',
    description:
      'Enseña el resumen de lo que vas a guardar y deja constancia de que lo has enseñado. OBLIGATORIO antes de cualquier herramienta que guarde. Tú pones los datos; el portal pone el formato. Después de llamarla, escribe el resumen también con tus palabras y pregunta «¿Está todo bien?».',
    input_schema: {
      type: 'object',
      properties: {
        seccion: { type: 'string', enum: SECCIONES, description: 'Qué se va a guardar.' },
        titulo: { type: 'string', description: 'Por ejemplo: "Así queda tu semana".' },
        lineas: {
          type: 'array',
          description: 'Pares etiqueta/valor, por ejemplo {"etiqueta":"Dirección","valor":"Calle Mayor 12, 28013 Madrid"}.',
          items: {
            type: 'object',
            properties: { etiqueta: { type: 'string' }, valor: { type: 'string' } },
            required: ['etiqueta', 'valor'],
            additionalProperties: false,
          },
        },
        tabla: {
          type: 'object',
          description: 'Opcional, para la semana o la lista de servicios.',
          properties: {
            columnas: { type: 'array', items: { type: 'string' } },
            filas: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
          },
          required: ['columnas', 'filas'],
          additionalProperties: false,
        },
      },
      required: ['seccion', 'titulo', 'lineas'],
      additionalProperties: false,
    },
    strict: true,
  },
  async run(i, ctx) {
    const seccion = SECCIONES.includes(i.seccion as Seccion) ? (i.seccion as Seccion) : 'cambio';
    const tabla = i.tabla as { columnas?: unknown; filas?: unknown } | undefined;
    ctx.resumen = {
      seccion,
      titulo: texto(i.titulo) || 'Esto es lo que voy a guardar',
      lineas: lista(i.lineas).map((l) => ({ etiqueta: texto(l.etiqueta), valor: texto(l.valor) })).filter((l) => l.etiqueta || l.valor),
      ...(tabla && Array.isArray(tabla.columnas) && Array.isArray(tabla.filas)
        ? {
            tabla: {
              columnas: (tabla.columnas as unknown[]).map((c) => texto(c)),
              filas: (tabla.filas as unknown[]).filter(Array.isArray).map((f) => (f as unknown[]).map((c) => texto(c))),
            },
          }
        : {}),
    };
    return { ok: true, data: { enseñado: true, siguiente: 'Pregunta «¿Está todo bien?» y espera su respuesta antes de guardar.' } };
  },
};

const guardarNegocio: HerramientaPortal = {
  name: 'guardar_negocio',
  seccion: 'negocio',
  definicion: {
    name: 'guardar_negocio',
    description: 'Guarda el sector, la dirección y el teléfono del local (sección 1). El nombre y la zona horaria no se tocan.',
    input_schema: {
      type: 'object',
      properties: {
        sector: { type: 'string', description: 'Por ejemplo "medicina estética" o "peluquería".' },
        direccion: { type: 'string', description: 'Completa: calle, número, código postal y ciudad.' },
        telefono: { type: 'string', description: 'El teléfono del local, como lo diga el cliente.' },
      },
      required: ['sector', 'direccion', 'telefono'],
      additionalProperties: false,
    },
    strict: true,
  },
  async run(i, ctx) {
    const falta = await faltaConfirmacion(ctx, 'negocio');
    if (falta) return falta;
    const telefono = normalizarTelefono(texto(i.telefono));
    if (!telefono) return mal('telefono_no_valido', 'Ese teléfono no se entiende. Pídeselo otra vez con un ejemplo, como 910 000 000.');
    const direccion = texto(i.direccion);
    if (direccion.length < 8) return mal('direccion_incompleta', 'La dirección está incompleta: pídele lo que falte (calle, número, código postal y ciudad).');
    const n = ctx.ficha;
    await guardarDatos(ctx.sql, ctx.businessId, {
      nombre: n.nombre,
      sector: texto(i.sector) || n.sector,
      timezone: n.timezone,
      direccion,
      telefonoHumano: telefono,
      tonoDeVoz: n.tonoDeVoz,
      mensajeBienvenida: n.mensajeBienvenida,
    });
    await recargar(ctx);
    return { ok: true, data: { guardado: true, direccion, telefono } };
  },
};

const guardarServicios: HerramientaPortal = {
  name: 'guardar_servicios',
  seccion: 'servicios',
  definicion: {
    name: 'guardar_servicios',
    description:
      'Guarda TODOS los servicios del negocio de una vez (sección 2), tal como quedaron en el resumen. Un servicio que ya existe con ese nombre se actualiza; los que no estén en la lista se quedan como están.',
    input_schema: {
      type: 'object',
      properties: {
        servicios: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              nombre: { type: 'string' },
              duracion_min: { type: 'integer', description: 'Minutos enteros ("una hora y media" = 90).' },
              margen_min: { type: 'integer', description: 'Minutos que necesita la profesional después, 0 si ninguno.' },
              precio: { type: ['number', 'null'], description: 'En euros. null si "depende" o se dice en consulta.' },
              descripcion: { type: ['string', 'null'] },
            },
            required: ['nombre', 'duracion_min', 'margen_min', 'precio', 'descripcion'],
            additionalProperties: false,
          },
        },
      },
      required: ['servicios'],
      additionalProperties: false,
    },
    strict: true,
  },
  async run(i, ctx) {
    const falta = await faltaConfirmacion(ctx, 'servicios');
    if (falta) return falta;
    const servicios = lista(i.servicios);
    if (servicios.length === 0) return mal('sin_servicios', 'No me has pasado ningún servicio.');
    const guardados: string[] = [];
    for (const s of servicios) {
      const nombre = texto(s.nombre);
      if (!nombre) return mal('servicio_sin_nombre', 'Un servicio ha llegado sin nombre.');
      const duracion = Number(s.duracion_min);
      if (!Number.isInteger(duracion) || duracion < 1 || duracion > 720) {
        return mal('duracion_no_valida', `La duración de "${nombre}" no vale: tiene que ser un número de minutos entre 1 y 720. Pregúntasela otra vez.`);
      }
      const margen = Number.isInteger(Number(s.margen_min)) ? Math.max(0, Math.min(240, Number(s.margen_min))) : 0;
      const precio = s.precio === null || s.precio === undefined || !Number.isFinite(Number(s.precio)) ? null : Number(s.precio);
      const datos = {
        nombre,
        descripcion: texto(s.descripcion) || null,
        duracionMin: duracion,
        bufferMin: margen,
        precio,
        precioVisible: precio !== null,
        activo: true,
      };
      const existe = porNombre(ctx.ficha.servicios, nombre);
      if (existe) await guardarServicio(ctx.sql, ctx.businessId, existe.id, datos);
      else await crearServicio(ctx.sql, ctx.businessId, datos);
      guardados.push(nombre);
      await recargar(ctx);
    }
    return { ok: true, data: { guardados } };
  },
};

const guardarProfesionales: HerramientaPortal = {
  name: 'guardar_profesionales',
  seccion: 'profesionales',
  definicion: {
    name: 'guardar_profesionales',
    description:
      'Guarda el equipo (sección 3) con los servicios que hace cada una, por su nombre. Una profesional que ya existe se actualiza. Sin servicios asignados el negocio no se puede activar.',
    input_schema: {
      type: 'object',
      properties: {
        profesionales: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              nombre: { type: 'string', description: 'Nombre y apellido.' },
              servicios: { type: 'array', items: { type: 'string' }, description: 'Nombres de los servicios que hace.' },
            },
            required: ['nombre', 'servicios'],
            additionalProperties: false,
          },
        },
      },
      required: ['profesionales'],
      additionalProperties: false,
    },
    strict: true,
  },
  async run(i, ctx) {
    const falta = await faltaConfirmacion(ctx, 'profesionales');
    if (falta) return falta;
    const equipo = lista(i.profesionales);
    if (equipo.length === 0) return mal('sin_profesionales', 'No me has pasado ninguna profesional.');
    const guardados: string[] = [];
    for (const p of equipo) {
      const nombre = texto(p.nombre);
      if (!nombre) return mal('profesional_sin_nombre', 'Una profesional ha llegado sin nombre.');
      const nombres = Array.isArray(p.servicios) ? (p.servicios as unknown[]).map((x) => texto(x)).filter(Boolean) : [];
      const ids: string[] = [];
      for (const ns of nombres) {
        const s = porNombre(ctx.ficha.servicios.filter((x) => x.activo), ns);
        if (!s) return mal('servicio_desconocido', `"${ns}" no es uno de los servicios cargados (${ctx.ficha.servicios.filter((x) => x.activo).map((x) => x.nombre).join(', ') || 'ninguno'}). Dale a elegir entre esos o carga antes el servicio.`);
        if (!ids.includes(s.id)) ids.push(s.id);
      }
      const datos = { nombre, activo: true, servicioIds: ids };
      const existe = porNombre(ctx.ficha.profesionales, nombre);
      if (existe) await guardarProfesional(ctx.sql, ctx.businessId, existe.id, datos);
      else await crearProfesional(ctx.sql, ctx.businessId, datos);
      guardados.push(nombre);
      await recargar(ctx);
    }
    return { ok: true, data: { guardados } };
  },
};

const guardarHorarios: HerramientaPortal = {
  name: 'guardar_horarios',
  seccion: 'horario',
  definicion: {
    name: 'guardar_horarios',
    description:
      'Guarda el horario del local y, si alguna profesional no trabaja como el local, el suyo (sección 4). El horario del local sustituye al anterior entero. Un día sin tramos es un día cerrado.',
    input_schema: {
      type: 'object',
      properties: {
        local: {
          type: 'array',
          description: 'Los tramos del local. Un día puede tener dos (mañana y tarde).',
          items: {
            type: 'object',
            properties: {
              dia: { type: 'string', enum: ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'] },
              desde: { type: 'string', description: 'HH:MM' },
              hasta: { type: 'string', description: 'HH:MM (24:00 = medianoche)' },
            },
            required: ['dia', 'desde', 'hasta'],
            additionalProperties: false,
          },
        },
        profesionales: {
          type: 'array',
          description: 'Solo las que NO trabajan como el local. Las demás no hace falta nombrarlas.',
          items: {
            type: 'object',
            properties: {
              nombre: { type: 'string' },
              tramos: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    dia: { type: 'string', enum: ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'] },
                    desde: { type: 'string' },
                    hasta: { type: 'string' },
                  },
                  required: ['dia', 'desde', 'hasta'],
                  additionalProperties: false,
                },
              },
              dias_que_no_trabaja: {
                type: 'array',
                items: { type: 'string', enum: ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'] },
                description: 'Días de la semana que libra aunque el local abra.',
              },
            },
            required: ['nombre', 'tramos', 'dias_que_no_trabaja'],
            additionalProperties: false,
          },
        },
      },
      required: ['local', 'profesionales'],
      additionalProperties: false,
    },
    strict: true,
  },
  async run(i, ctx) {
    const falta = await faltaConfirmacion(ctx, 'horario');
    if (falta) return falta;
    const leerTramos = (v: unknown): { weekday: number; apertura: string; cierre: string }[] | string => {
      const out: { weekday: number; apertura: string; cierre: string }[] = [];
      for (const t of lista(v)) {
        const weekday = DIAS[texto(t.dia).toLowerCase()];
        const desde = hora(t.desde);
        const hasta = hora(t.hasta);
        if (weekday === undefined) return `"${texto(t.dia)}" no es un día de la semana.`;
        if (!desde || !hasta) return 'Las horas tienen que ser como 09:00 o 18:30.';
        if (hasta <= desde) return `El ${texto(t.dia)}, la hora de cierre (${hasta}) tiene que ser posterior a la de apertura (${desde}).`;
        out.push({ weekday, apertura: desde, cierre: hasta });
      }
      return out;
    };

    const local = leerTramos(i.local);
    if (typeof local === 'string') return mal('horario_no_valido', `${local} Vuelve a preguntárselo.`);
    if (local.length === 0) return mal('horario_vacio', 'No me has pasado ningún tramo del local: sin horario, la recepcionista no puede dar ninguna cita.');
    try {
      await guardarHorario(ctx.sql, ctx.businessId, null, local, [], 'dejar');
    } catch (e) {
      return errorDeLaBase(e, 'el horario del local');
    }
    await recargar(ctx);

    const propios: string[] = [];
    for (const p of lista(i.profesionales)) {
      const nombre = texto(p.nombre);
      const quien = porNombre(ctx.ficha.profesionales.filter((x) => x.activo), nombre);
      if (!quien) return mal('profesional_desconocida', `No tengo a nadie que se llame "${nombre}". Las que hay son: ${ctx.ficha.profesionales.filter((x) => x.activo).map((x) => x.nombre).join(', ') || 'ninguna'}.`);
      const tramos = leerTramos(p.tramos);
      if (typeof tramos === 'string') return mal('horario_no_valido', `En el horario de ${quien.nombre}: ${tramos} Vuelve a preguntárselo.`);
      const libres = (Array.isArray(p.dias_que_no_trabaja) ? (p.dias_que_no_trabaja as unknown[]) : [])
        .map((d) => DIAS[texto(d).toLowerCase()])
        .filter((d): d is number => d !== undefined);
      const choca = libres.find((w) => tramos.some((t) => t.weekday === w));
      if (choca !== undefined) return mal('dia_contradictorio', `${quien.nombre} no puede tener horas propias y "no trabaja" el mismo día.`);
      try {
        await guardarHorario(ctx.sql, ctx.businessId, quien.id, tramos, [...new Set(libres)], 'dejar');
      } catch (e) {
        return errorDeLaBase(e, `el horario de ${quien.nombre}`);
      }
      propios.push(quien.nombre);
      await recargar(ctx);
    }
    return { ok: true, data: { local: local.length, con_horario_propio: propios } };
  },
};

const guardarReglasTool: HerramientaPortal = {
  name: 'guardar_reglas',
  seccion: 'reglas',
  definicion: {
    name: 'guardar_reglas',
    description: 'Guarda las reglas de reserva y cancelación (sección 6). Cada cuánto se ofrecen horarios no se pregunta: se queda como está.',
    input_schema: {
      type: 'object',
      properties: {
        antelacion_min_horas: { type: 'integer', description: 'Horas de antelación mínima para reservar. 0 si se puede reservar en cuanto haya hueco.' },
        cancelacion_plazo_horas: { type: 'integer', description: 'Hasta cuántas horas antes se puede cancelar por el chat.' },
        quien_elige_profesional: { type: 'string', enum: ['preguntar', 'automatica'], description: '"preguntar" = se le pregunta a la clienta; "automatica" = la asigna el sistema.' },
        dentro_del_plazo: { type: 'string', enum: ['informar', 'bloquear'], description: '"informar" = se cancela igual recordando la política; "bloquear" = se le dice que llame al local.' },
        politica_cancelacion: { type: 'string', description: 'El texto tal como quiere que se le explique a las clientas.' },
      },
      required: ['antelacion_min_horas', 'cancelacion_plazo_horas', 'quien_elige_profesional', 'dentro_del_plazo', 'politica_cancelacion'],
      additionalProperties: false,
    },
    strict: true,
  },
  async run(i, ctx) {
    const falta = await faltaConfirmacion(ctx, 'reglas');
    if (falta) return falta;
    const antelacion = Number(i.antelacion_min_horas);
    const plazo = Number(i.cancelacion_plazo_horas);
    if (!Number.isInteger(antelacion) || antelacion < 0 || antelacion > 720) return mal('antelacion_no_valida', 'La antelación mínima tiene que ser un número de horas entre 0 y 720.');
    if (!Number.isInteger(plazo) || plazo < 0 || plazo > 720) return mal('plazo_no_valido', 'El plazo de cancelación tiene que ser un número de horas entre 0 y 720.');
    await guardarReglas(ctx.sql, ctx.businessId, {
      antelacionMinHoras: antelacion,
      intervaloHuecosMin: ctx.ficha.reglas.intervaloHuecosMin,
      margenDentroHorario: ctx.ficha.reglas.margenDentroHorario,
      asignacionProfesional: i.quien_elige_profesional === 'automatica' ? 'automatica' : 'preguntar',
      politicaCancelacion: texto(i.politica_cancelacion) || null,
      cancelacionModo: i.dentro_del_plazo === 'bloquear' ? 'bloquear' : 'informar',
      cancelacionPlazoHoras: plazo,
    });
    await recargar(ctx);
    return { ok: true, data: { guardado: true } };
  },
};

const cambiarServicio: HerramientaPortal = {
  name: 'cambiar_servicio',
  seccion: 'cambio',
  definicion: {
    name: 'cambiar_servicio',
    description: 'Cambia un servicio que ya existe (duración, margen, precio, descripción) o lo desactiva. Lo que no mandes no se toca.',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'El servicio tal como se llama ahora.' },
        duracion_min: { type: ['integer', 'null'] },
        margen_min: { type: ['integer', 'null'] },
        precio: { type: ['number', 'null'], description: 'El precio nuevo; no lo mandes si no cambia.' },
        quitar_precio: { type: ['boolean', 'null'], description: 'true si pasa a no tener precio ("depende").' },
        descripcion: { type: ['string', 'null'] },
        activo: { type: ['boolean', 'null'], description: 'false para dejar de ofrecerlo.' },
      },
      required: ['nombre'],
      additionalProperties: false,
    },
    strict: true,
  },
  async run(i, ctx) {
    const falta = await faltaConfirmacion(ctx, 'cambio');
    if (falta) return falta;
    const s = porNombre(ctx.ficha.servicios, texto(i.nombre));
    if (!s) return mal('servicio_desconocido', `No tengo ningún servicio que se llame "${texto(i.nombre)}". Los que hay son: ${ctx.ficha.servicios.map((x) => x.nombre).join(', ') || 'ninguno'}.`);
    const duracion = i.duracion_min === null || i.duracion_min === undefined ? s.duracionMin : Number(i.duracion_min);
    if (!Number.isInteger(duracion) || duracion < 1 || duracion > 720) return mal('duracion_no_valida', 'La duración tiene que ser un número de minutos entre 1 y 720.');
    const margen = i.margen_min === null || i.margen_min === undefined ? s.bufferMin : Number(i.margen_min);
    const precio = i.quitar_precio === true ? null : i.precio === null || i.precio === undefined ? s.precio : Number(i.precio);
    await guardarServicio(ctx.sql, ctx.businessId, s.id, {
      nombre: s.nombre,
      descripcion: i.descripcion === null || i.descripcion === undefined ? s.descripcion : texto(i.descripcion) || null,
      duracionMin: duracion,
      bufferMin: Number.isInteger(margen) ? Math.max(0, Math.min(240, margen)) : s.bufferMin,
      precio,
      precioVisible: precio !== null,
      activo: typeof i.activo === 'boolean' ? i.activo : s.activo,
    });
    await recargar(ctx);
    return { ok: true, data: { servicio: s.nombre, duracion_min: duracion, precio, citas_futuras: s.citasFuturas } };
  },
};

const cerrarDia: HerramientaPortal = {
  name: 'cerrar_dia',
  seccion: 'cambio',
  definicion: {
    name: 'cerrar_dia',
    description:
      'Cierra un día (o unas horas de un día): festivo del local si no dices profesional, o ausencia de esa profesional si la dices. Si ese día ya hay citas, NO guarda nada y te las devuelve para que preguntes.',
    input_schema: {
      type: 'object',
      properties: {
        fecha: { type: 'string', description: 'AAAA-MM-DD.' },
        hasta_fecha: { type: ['string', 'null'], description: 'AAAA-MM-DD si son varios días seguidos (vacaciones).' },
        profesional: { type: ['string', 'null'], description: 'Su nombre si es solo ella; null si cierra el local entero.' },
        desde_hora: { type: ['string', 'null'], description: 'HH:MM si son solo unas horas.' },
        hasta_hora: { type: ['string', 'null'] },
        motivo: { type: ['string', 'null'] },
        // Sin null: la API rechaza un enum con tipo ['string', 'null'] y el chat
        // entero dejaba de responder (alta:eval, 19/11/2026). Omitirlo = "preguntar".
        citas: { type: 'string', enum: ['preguntar', 'dejar', 'cancelar'], description: 'Qué hacer con las citas de ese día. La primera vez, "preguntar" (o no lo pongas).' },
      },
      required: ['fecha'],
      additionalProperties: false,
    },
    strict: true,
  },
  async run(i, ctx) {
    const falta = await faltaConfirmacion(ctx, 'cambio');
    if (falta) return falta;
    const fecha = texto(i.fecha);
    if (!FECHA.test(fecha)) return mal('fecha_no_valida', 'La fecha tiene que ser AAAA-MM-DD. Si te han dicho "el lunes 16", mira el día de hoy que te doy en cada mensaje y calcula la fecha.');
    const tz = ctx.ficha.timezone;
    let staffId: string | null = null;
    if (texto(i.profesional)) {
      const quien = porNombre(ctx.ficha.profesionales.filter((x) => x.activo), texto(i.profesional));
      if (!quien) return mal('profesional_desconocida', `No tengo a nadie que se llame "${texto(i.profesional)}".`);
      staffId = quien.id;
    }
    const desdeHora = hora(i.desde_hora);
    const hastaHora = hora(i.hasta_hora);
    let desde: Date;
    let hasta: Date;
    if (desdeHora && hastaHora) {
      if (hastaHora <= desdeHora) return mal('horas_no_validas', 'La hora de fin tiene que ser posterior a la de inicio.');
      desde = localToUtc(fecha, desdeHora, tz);
      hasta = hastaHora === '24:00' ? inicioDelDia(sumarDias(fecha, 1), tz) : localToUtc(fecha, hastaHora, tz);
    } else if (desdeHora || hastaHora) {
      return mal('horas_incompletas', 'Para unas horas me hacen falta las dos: de qué hora a qué hora.');
    } else {
      const ultima = texto(i.hasta_fecha) && FECHA.test(texto(i.hasta_fecha)) ? texto(i.hasta_fecha) : fecha;
      if (ultima < fecha) return mal('fechas_al_reves', 'El último día tiene que ser igual o posterior al primero.');
      desde = inicioDelDia(fecha, tz);
      hasta = inicioDelDia(sumarDias(ultima, 1), tz);
    }
    try {
      const { cancelar } = await crearFestivo(ctx.sql, ctx.businessId, { staffId, desde, hasta, motivo: texto(i.motivo) || null }, comoCitas(i.citas));
      for (const id of cancelar) {
        await cancelarCitaManual({ sql: ctx.sql, email: ctx.email, baseUrl: ctx.baseUrl, ...(ctx.onError ? { onError: ctx.onError } : {}) }, ctx.businessId, id);
      }
      await recargar(ctx);
      return { ok: true, data: { cerrado: fechaLarga(fecha), canceladas: cancelar.length } };
    } catch (e) {
      const afectadas = citasAfectadasComoError(e);
      if (afectadas) return afectadas;
      return errorDeLaBase(e, 'ese cierre');
    }
  },
};

const quitarDiaDeLaSemana: HerramientaPortal = {
  name: 'quitar_dia_de_la_semana',
  seccion: 'cambio',
  definicion: {
    name: 'quitar_dia_de_la_semana',
    description:
      'Hace que una profesional deje de trabajar TODOS los días de la semana que le digas (o que vuelva a trabajarlos). Para un día concreto, usa cerrar_dia.',
    input_schema: {
      type: 'object',
      properties: {
        profesional: { type: 'string' },
        dias: { type: 'array', items: { type: 'string', enum: ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'] } },
        vuelve_a_trabajar: { type: ['boolean', 'null'], description: 'true para quitarle esos días de "no trabaja".' },
      },
      required: ['profesional', 'dias'],
      additionalProperties: false,
    },
    strict: true,
  },
  async run(i, ctx) {
    const falta = await faltaConfirmacion(ctx, 'cambio');
    if (falta) return falta;
    const quien = porNombre(ctx.ficha.profesionales.filter((x) => x.activo), texto(i.profesional));
    if (!quien) return mal('profesional_desconocida', `No tengo a nadie que se llame "${texto(i.profesional)}".`);
    const dias = (Array.isArray(i.dias) ? (i.dias as unknown[]) : []).map((d) => DIAS[texto(d).toLowerCase()]).filter((d): d is number => d !== undefined);
    if (dias.length === 0) return mal('dias_no_validos', 'No he entendido qué días. Pregúntaselo otra vez.');
    const actuales = new Set(ctx.ficha.diasLibres.filter((d) => d.staffId === quien.id).map((d) => d.weekday));
    for (const d of dias) {
      if (i.vuelve_a_trabajar === true) actuales.delete(d);
      else actuales.add(d);
    }
    const tramos = ctx.ficha.horario.filter((t) => t.staffId === quien.id).filter((t) => !actuales.has(t.weekday));
    try {
      const cancelar = await guardarHorario(ctx.sql, ctx.businessId, quien.id, tramos, [...actuales].sort(), comoCitas(i.vuelve_a_trabajar === true ? 'dejar' : undefined));
      for (const id of cancelar) {
        await cancelarCitaManual({ sql: ctx.sql, email: ctx.email, baseUrl: ctx.baseUrl, ...(ctx.onError ? { onError: ctx.onError } : {}) }, ctx.businessId, id);
      }
      await recargar(ctx);
      return { ok: true, data: { profesional: quien.nombre, no_trabaja: [...actuales].sort().map((d) => ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][d]) } };
    } catch (e) {
      const afectadas = citasAfectadasComoError(e);
      if (afectadas) return afectadas;
      return errorDeLaBase(e, 'ese cambio de horario');
    }
  },
};

const turnoSuelto: HerramientaPortal = {
  name: 'turno_suelto',
  seccion: 'cambio',
  definicion: {
    name: 'turno_suelto',
    description:
      'PC-06: una profesional trabaja un día concreto fuera de su horario de siempre. Si ese día es festivo del local, la agenda se abre solo para ella y solo esas horas.',
    input_schema: {
      type: 'object',
      properties: {
        profesional: { type: 'string' },
        fecha: { type: 'string', description: 'AAAA-MM-DD.' },
        desde: { type: 'string', description: 'HH:MM' },
        hasta: { type: 'string', description: 'HH:MM' },
        motivo: { type: ['string', 'null'] },
      },
      required: ['profesional', 'fecha', 'desde', 'hasta'],
      additionalProperties: false,
    },
    strict: true,
  },
  async run(i, ctx) {
    const falta = await faltaConfirmacion(ctx, 'cambio');
    if (falta) return falta;
    const quien = porNombre(ctx.ficha.profesionales.filter((x) => x.activo), texto(i.profesional));
    if (!quien) return mal('profesional_desconocida', `No tengo a nadie que se llame "${texto(i.profesional)}".`);
    const fecha = texto(i.fecha);
    const desde = hora(i.desde);
    const hasta = hora(i.hasta);
    if (!FECHA.test(fecha)) return mal('fecha_no_valida', 'La fecha tiene que ser AAAA-MM-DD.');
    if (!desde || !hasta || hasta <= desde) return mal('horas_no_validas', 'Las horas tienen que ser como 10:00 y 14:00, y la de salida posterior a la de entrada.');
    try {
      await crearTurnoSuelto(ctx.sql, ctx.businessId, { staffId: quien.id, fecha, apertura: desde, cierre: hasta, motivo: texto(i.motivo) || null });
      await recargar(ctx);
      return { ok: true, data: { profesional: quien.nombre, dia: fechaLarga(fecha), desde, hasta } };
    } catch (e) {
      return errorDeLaBase(e, 'ese turno suelto');
    }
  },
};

const avanzarSeccion: HerramientaPortal = {
  name: 'avanzar_seccion',
  definicion: {
    name: 'avanzar_seccion',
    description: 'Deja anotado por qué sección del alta vas, para recibirle por ahí si se va y vuelve. Llámala cada vez que termines una sección.',
    input_schema: {
      type: 'object',
      properties: { seccion: { type: 'integer', description: '0 bienvenida, 1 el negocio, 2 servicios, 3 profesionales, 4 horarios, 6 reservas, 9 cierre.' } },
      required: ['seccion'],
      additionalProperties: false,
    },
    strict: true,
  },
  async run(i, ctx) {
    const seccion = Math.max(0, Math.min(9, Number(i.seccion) || 0));
    await guardarEstadoDelAlta(ctx.sql, ctx.businessId, { seccion }, ctx.now());
    return { ok: true, data: { seccion } };
  },
};

const terminarAlta: HerramientaPortal = {
  name: 'terminar_alta',
  definicion: {
    name: 'terminar_alta',
    description:
      'Da el alta por terminada (sección 9). A partir de ese momento el cliente ve su portal y a MAZZMKT le llega el aviso para revisarlo y activarlo. Llámala solo cuando hayas terminado las secciones 1, 2, 3, 4 y 6.',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  async run(_i, ctx) {
    await recargar(ctx);
    const n = ctx.ficha;
    const falta: string[] = [];
    if (!n.direccion || !n.telefonoHumano) falta.push('los datos del local (sección 1)');
    if (n.servicios.filter((s) => s.activo).length === 0) falta.push('los servicios (sección 2)');
    if (n.profesionales.filter((p) => p.activo).length === 0) falta.push('las profesionales (sección 3)');
    if (n.horario.filter((t) => t.staffId === null).length === 0) falta.push('el horario del local (sección 4)');
    if (falta.length > 0) {
      return mal('alta_incompleta', `Todavía falta ${falta.join(', ')}. Sigue con esa sección antes de cerrar el alta.`);
    }
    await guardarEstadoDelAlta(ctx.sql, ctx.businessId, { seccion: 9, terminada: true }, ctx.now());
    ctx.altaTerminada = true;
    return { ok: true, data: { terminada: true, recuerdale: 'preguntas frecuentes, el color y el logo del chat, los dominios de su web y los festivos' } };
  },
};

/** Un error de la base en palabras para el modelo (la frase la pone errores.ts del panel). */
function errorDeLaBase(e: unknown, que: string): ResultadoHerramienta {
  const pg = e as { constraint_name?: string; code?: string; message?: string };
  if (pg?.constraint_name?.includes('sin_solape') || pg?.code === '23P01') {
    return mal('se_pisan', `No he podido guardar ${que}: hay tramos que se pisan el mismo día. Dile que las horas se solapan y pregúntaselas otra vez.`);
  }
  if (pg?.code === '23514' || pg?.code === '23505' || pg?.code === '23503') {
    return mal('no_valido', `La base no acepta ${que}. Revisa los datos con el cliente y vuelve a intentarlo.`);
  }
  return mal('error_interno', `Algo ha fallado al guardar ${que}. Díselo y pídele que lo intente de nuevo en un momento.`);
}

export const HERRAMIENTAS_ALTA: readonly HerramientaPortal[] = [
  avanzarSeccion,
  guardarHorarios,
  guardarNegocio,
  guardarProfesionales,
  guardarReglasTool,
  guardarServicios,
  proponerResumen,
  terminarAlta,
  verConfiguracion,
].sort((a, b) => a.name.localeCompare(b.name));

export const HERRAMIENTAS_PORTAL: readonly HerramientaPortal[] = [
  cambiarServicio,
  cerrarDia,
  guardarHorarios,
  guardarNegocio,
  guardarProfesionales,
  guardarReglasTool,
  guardarServicios,
  proponerResumen,
  quitarDiaDeLaSemana,
  turnoSuelto,
  verConfiguracion,
].sort((a, b) => a.name.localeCompare(b.name));

export function herramientasDe(modo: 'alta' | 'portal'): readonly HerramientaPortal[] {
  return modo === 'alta' ? HERRAMIENTAS_ALTA : HERRAMIENTAS_PORTAL;
}

export function definiciones(modo: 'alta' | 'portal'): Anthropic.Beta.BetaTool[] {
  const defs = herramientasDe(modo).map((h) => h.definicion);
  // Después del alta van casi todas las herramientas juntas y, en modo
  // estricto, la API las rechaza: «the compiled grammar is too large»
  // (alta:eval, 19/11/2026). Ahí van sin `strict`: cada herramienta ya
  // comprueba en el código lo que recibe (fechas, horas, nombres), que es lo
  // que de verdad protege los datos (§1 del AGENTS.md raíz).
  return modo === 'portal' ? defs.map(({ strict: _strict, ...d }) => d) : defs;
}

export interface EjecucionHerramienta {
  nombre: string;
  input: Record<string, unknown>;
  resultado: ResultadoHerramienta;
  content: string;
  isError: boolean;
}

/**
 * Ejecuta una herramienta. Nunca lanza: lo inesperado vuelve como error para
 * que el agente lo explique con palabras y no se quede callado.
 */
export async function ejecutar(
  nombre: string,
  input: unknown,
  ctx: ContextoPortal,
  onError: (e: unknown) => void = () => {},
): Promise<EjecucionHerramienta> {
  const args = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  const h = herramientasDe(ctx.modo).find((x) => x.name === nombre);
  let resultado: ResultadoHerramienta;
  if (!h) {
    resultado = { ok: false, error: { motivo: 'herramienta_desconocida', mensaje: `No existe la herramienta ${nombre}.` } };
  } else {
    try {
      resultado = await h.run(args, ctx);
    } catch (e) {
      onError(e);
      resultado = { ok: false, error: { motivo: 'error_interno', mensaje: 'Algo ha fallado en el sistema. Díselo con naturalidad y pídele que lo intente de nuevo en un momento.' } };
    }
  }
  return { nombre, input: args, resultado, content: JSON.stringify(resultado.ok ? resultado.data : resultado.error), isError: !resultado.ok };
}

/** El día de hoy del negocio, para que el agente entienda "el lunes 16". */
export function contextoDelDia(ficha: NegocioPanel, ahora: Date): string {
  const { fecha, hora: h } = utcToLocal(ahora, ficha.timezone);
  return `Hoy es ${fechaLarga(fecha)} y son las ${h} (hora de ${ficha.timezone}).`;
}
