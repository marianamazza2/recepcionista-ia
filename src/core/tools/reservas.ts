// crear_reserva · cancelar_reserva · reprogramar_reserva · buscar_reservas_cliente
//
// Reglas que se aplican AQUÍ, en el código (guardrails 2.5), y no solo en el prompt:
//   · PA-08: cancelar, mover y ver solo operan sobre citas de la clienta identificada.
//   · PR-07: en modo "bloquear", dentro del plazo no se cancela ni se mueve.
//   · PR-05: mover mantiene profesional y servicio (lo garantiza el adaptador);
//     las alternativas que se ofrecen son con ella.
//   · PD-03: sin profesional, reserva sin staffId y el motor asigna.

import type { BusinessConfig } from '../../config/business.js';
import { InvalidLocalTimeError, isFecha, isHora, localToUtc, utcToLocal } from '../time.js';
import {
  buscarProfesional,
  buscarServicio,
  citaDeLaClienta,
  describirCita,
  errorDeReserva,
  fallo,
  nombreProfesional,
  ocupadoDeLaClienta,
  ok,
  profesionalDesconocida,
  servicioDesconocido,
  sinClienta,
  texto,
} from './common.js';
import type { AgentTool, ToolContext, ToolResult } from './types.js';

/** Valida fecha y hora locales y devuelve el instante, o el error para el modelo. */
export function instantePedido(ctx: ToolContext, fecha: string | undefined, hora: string | undefined): Date | ToolResult {
  if (!fecha || !isFecha(fecha)) {
    return fallo({ motivo: 'fecha_no_valida', mensaje: 'La fecha tiene que ir en formato AAAA-MM-DD.' });
  }
  if (!hora || !isHora(hora)) {
    return fallo({ motivo: 'hora_no_valida', mensaje: 'La hora tiene que ir en formato HH:MM (24 h).' });
  }
  try {
    const t = localToUtc(fecha, hora, ctx.config.timezone);
    if (t.getTime() <= ctx.now().getTime()) {
      return fallo({ motivo: 'fecha_pasada', mensaje: 'Esa fecha y hora ya han pasado.' });
    }
    return t;
  } catch (e) {
    if (e instanceof InvalidLocalTimeError) {
      return fallo({ motivo: 'hora_no_valida', mensaje: 'Esa hora no existe ese día (cambio de hora).' });
    }
    throw e;
  }
}

/** PR-07: horas que faltan para la cita y si está dentro del plazo de la política. */
export function plazo(config: BusinessConfig, inicio: Date, ahora: Date): { horasQueFaltan: number; dentroDelPlazo: boolean } {
  const horasQueFaltan = (inicio.getTime() - ahora.getTime()) / 3_600_000;
  return { horasQueFaltan, dentroDelPlazo: horasQueFaltan < config.cancelacionPlazoHoras };
}

export function bloqueadaPorPlazo(config: BusinessConfig, accion: 'cancelar' | 'mover'): ToolResult {
  return fallo({
    motivo: 'dentro_del_plazo_bloqueado',
    mensaje:
      `La política del negocio no permite ${accion} por este chat con menos de ${config.cancelacionPlazoHoras} h de antelación. ` +
      'No se ha cambiado nada. Explícale la política y pásala con una persona con derivar_a_humano (motivo cancelacion_bloqueada).',
    politica_cancelacion: config.politicaCancelacion,
  });
}

// -----------------------------------------------------------------------------

export const crearReserva: AgentTool = {
  name: 'crear_reserva',
  escribe: true,

  definition(config) {
    return {
      name: 'crear_reserva',
      description:
        'Reserva una cita para la clienta ya identificada. Úsala SOLO después de resumirle la cita (servicio, día, hora y profesional) ' +
        'y de que ella haya dicho que sí explícitamente. Sin profesional, el sistema asigna a la que menos citas tenga ese día y la ' +
        'respuesta dice quién es. Si el horario no se puede reservar, devuelve el motivo y horarios alternativos.',
      strict: true,
      input_schema: {
        type: 'object',
        properties: {
          servicio: { type: 'string', enum: config.servicios.map((s) => s.nombre) },
          fecha: { type: 'string', description: 'AAAA-MM-DD, hora local del negocio' },
          hora: { type: 'string', description: 'HH:MM (24 h), hora local del negocio' },
          profesional: {
            type: 'string',
            enum: config.profesionales.map((p) => p.nombre),
            description: 'Omitir si a la clienta le da igual',
          },
        },
        required: ['servicio', 'fecha', 'hora'],
        additionalProperties: false,
      },
    };
  },

  async run(input, ctx) {
    const customerId = ctx.state.customerId;
    if (!customerId) return sinClienta();
    const servicio = buscarServicio(ctx.config, texto(input, 'servicio'));
    if (!servicio) return servicioDesconocido(ctx.config);
    const nombreProf = texto(input, 'profesional');
    const profesional = buscarProfesional(ctx.config, nombreProf);
    if (nombreProf && !profesional) return profesionalDesconocida(ctx.config);
    const fecha = texto(input, 'fecha');
    const hora = texto(input, 'hora');
    const inicio = instantePedido(ctx, fecha, hora);
    if (!(inicio instanceof Date)) return inicio;

    try {
      const cita = await ctx.adapter.createBooking({
        businessId: ctx.config.id,
        serviceId: servicio.id,
        ...(profesional ? { staffId: profesional.id } : {}),
        customerId,
        start: inicio,
        origin: 'agente',
      });
      return ok({ reservada: true, cita: describirCita(ctx, cita) });
    } catch (e) {
      return errorDeReserva(ctx, e, { servicioId: servicio.id, staffId: profesional?.id, fecha: fecha!, hora: hora! });
    }
  },
};

// -----------------------------------------------------------------------------

export const cancelarReserva: AgentTool = {
  name: 'cancelar_reserva',
  escribe: true,

  definition() {
    return {
      name: 'cancelar_reserva',
      description:
        'Cancela una cita de la clienta identificada (solo las suyas). Úsala SOLO después de confirmar con ella qué cita cancela ' +
        'y de que diga que sí. Aplica la política de cancelación del negocio: si devuelve dentro_del_plazo=true, recuérdale la ' +
        'política tal cual. Si la política no permite cancelar por el chat, no cancela y lo dice.',
      strict: true,
      input_schema: {
        type: 'object',
        properties: {
          id_cita: { type: 'string', description: 'id_cita tal como lo devolvió buscar_reservas_cliente o crear_reserva' },
        },
        required: ['id_cita'],
        additionalProperties: false,
      },
    };
  },

  async run(input, ctx) {
    const cita = await citaDeLaClienta(ctx, texto(input, 'id_cita'));
    if (!('id' in cita)) return cita;
    if (cita.status === 'cancelada') {
      return ok({ cancelada: true, ya_estaba_cancelada: true, cita: describirCita(ctx, cita) });
    }
    if (cita.status !== 'confirmada' || cita.start.getTime() <= ctx.now().getTime()) {
      return fallo({ motivo: 'cita_no_modificable', mensaje: 'Esa cita ya pasó o está cerrada: no se puede cancelar.' });
    }

    const { dentroDelPlazo } = plazo(ctx.config, cita.start, ctx.now());
    if (dentroDelPlazo && ctx.config.cancelacionModo === 'bloquear') {
      return bloqueadaPorPlazo(ctx.config, 'cancelar');
    }

    try {
      await ctx.adapter.cancelBooking(cita.id);
    } catch (e) {
      return errorDeReserva(ctx, e, {
        servicioId: cita.serviceId,
        staffId: cita.staffId,
        ...utcToLocal(cita.start, ctx.config.timezone),
      });
    }
    return ok({
      cancelada: true,
      cita: describirCita(ctx, cita),
      dentro_del_plazo: dentroDelPlazo,
      ...(dentroDelPlazo ? { politica_cancelacion: ctx.config.politicaCancelacion } : {}),
    });
  },
};

// -----------------------------------------------------------------------------

export const reprogramarReserva: AgentTool = {
  name: 'reprogramar_reserva',
  escribe: true,

  definition() {
    return {
      name: 'reprogramar_reserva',
      description:
        'Mueve una cita de la clienta identificada (solo las suyas) a otro día y hora, con la MISMA profesional y el mismo servicio. ' +
        'Úsala SOLO después de confirmar el cambio con ella. Si esa profesional no tiene libre la hora nueva, la cita no se mueve ' +
        'y devuelve otros horarios con ella. Si la clienta prefiere otra profesional, no uses esta herramienta: cancela y crea una ' +
        'nueva. Aplica la política de cancelación igual que cancelar_reserva.',
      strict: true,
      input_schema: {
        type: 'object',
        properties: {
          id_cita: { type: 'string' },
          fecha: { type: 'string', description: 'Nuevo día, AAAA-MM-DD' },
          hora: { type: 'string', description: 'Nueva hora, HH:MM (24 h)' },
        },
        required: ['id_cita', 'fecha', 'hora'],
        additionalProperties: false,
      },
    };
  },

  async run(input, ctx) {
    const cita = await citaDeLaClienta(ctx, texto(input, 'id_cita'));
    if (!('id' in cita)) return cita;
    if (cita.status !== 'confirmada' || cita.start.getTime() <= ctx.now().getTime()) {
      return fallo({ motivo: 'cita_no_modificable', mensaje: 'Esa cita ya pasó, está cancelada o cerrada: no se puede mover.' });
    }
    const fecha = texto(input, 'fecha');
    const hora = texto(input, 'hora');
    const inicio = instantePedido(ctx, fecha, hora);
    if (!(inicio instanceof Date)) return inicio;

    // PR-07: el plazo se cuenta desde la cita ORIGINAL (mover a último momento
    // libera el hueco igual que cancelar).
    const { dentroDelPlazo } = plazo(ctx.config, cita.start, ctx.now());
    if (dentroDelPlazo && ctx.config.cancelacionModo === 'bloquear') {
      return bloqueadaPorPlazo(ctx.config, 'mover');
    }

    try {
      const nueva = await ctx.adapter.rescheduleBooking(cita.id, inicio);
      return ok({
        reprogramada: true,
        cita_anterior: describirCita(ctx, cita),
        cita_nueva: describirCita(ctx, nueva),
        dentro_del_plazo: dentroDelPlazo,
        ...(dentroDelPlazo ? { politica_cancelacion: ctx.config.politicaCancelacion } : {}),
      });
    } catch (e) {
      const r = await errorDeReserva(ctx, e, {
        servicioId: cita.serviceId,
        staffId: cita.staffId,
        fecha: fecha!,
        hora: hora!,
        soloConEsaProfesional: true,
        excluir: await ocupadoDeLaClienta(ctx, cita.id),
      });
      if (!r.ok) {
        r.error.mensaje += ` La cita original sigue como estaba. Las alternativas son con ${nombreProfesional(ctx.config, cita.staffId)}.`;
      }
      return r;
    }
  },
};

// -----------------------------------------------------------------------------

export const buscarReservasCliente: AgentTool = {
  name: 'buscar_reservas_cliente',
  escribe: false,

  definition() {
    return {
      name: 'buscar_reservas_cliente',
      description:
        'Devuelve las próximas citas confirmadas de la clienta identificada (solo las suyas) y quién la atendió la última vez ' +
        '(ultima_profesional, solo citas ya pasadas). Úsala antes de cancelar o mover, y para saber si es habitual.',
      strict: true,
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
    };
  },

  async run(_input, ctx) {
    const customerId = ctx.state.customerId;
    if (!customerId) return sinClienta();
    const [citas, ultima] = await Promise.all([
      ctx.adapter.listBookings({ customerId }),
      ctx.adapter.getLastStaff(customerId),
    ]);
    const ahora = ctx.now().getTime();
    return ok({
      proximas: citas
        .filter((c) => c.status === 'confirmada' && c.start.getTime() > ahora)
        .map((c) => describirCita(ctx, c)),
      ultima_profesional: ultima ? nombreProfesional(ctx.config, ultima) : null,
    });
  },
};
