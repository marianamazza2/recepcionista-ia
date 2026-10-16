// reservar_y_cambiar_cita_anterior — PR-08: la clienta ya tiene una cita que
// choca con la que pide y quiere quedarse con la NUEVA hora, moviendo o
// anulando la anterior (decidido por Mariana el 16/10/2026).
//
// Dos usos:
//   · Mover sin hora todavía (mover_a_hora vacío): no cambia nada; devuelve
//     hasta 3 horarios para la anterior, con su misma profesional (PR-05) y sin
//     pisar la cita nueva ni otras suyas.
//   · Con todo decidido (y confirmado, PA-01): mueve o anula la anterior y
//     reserva la nueva en una sola transacción (changeExistingAndBook). Si algo
//     falla, nada cambia.
// PR-07 se aplica a la cita anterior, como en cualquier cancelación o cambio.

import type { Booking } from '../../adapters/booking/types.js';
import { isFecha, isHora, utcToLocal } from '../time.js';
import {
  alternativas,
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
  type Intervalo,
} from './common.js';
import { bloqueadaPorPlazo, instantePedido, plazo } from './reservas.js';
import type { AgentTool } from './types.js';

export const reservarYCambiarCitaAnterior: AgentTool = {
  name: 'reservar_y_cambiar_cita_anterior',
  escribe: true,

  definition(config) {
    return {
      name: 'reservar_y_cambiar_cita_anterior',
      description:
        'Úsala SOLO cuando crear_reserva devolvió clienta_ya_tiene_cita y la clienta pide quedarse con la cita NUEVA, ' +
        'moviendo o anulando la anterior (id_cita_anterior = cita_que_choca.id_cita). Para mover: llámala primero sin ' +
        'mover_a_hora y devuelve horarios para la anterior (con su misma profesional) sin cambiar nada; si la clienta pidió ' +
        'un día, pásalo en mover_a_fecha. Cuando ella elija y confirme las dos cosas, llámala con mover_a_fecha y ' +
        'mover_a_hora: mueve la anterior y reserva la nueva a la vez. Para anular: con accion_anterior=anular, tras su ' +
        'confirmación. Si algo falla, nada cambia.',
      strict: true,
      input_schema: {
        type: 'object',
        properties: {
          servicio: { type: 'string', enum: config.servicios.map((s) => s.nombre), description: 'Servicio de la cita NUEVA' },
          fecha: { type: 'string', description: 'Día de la cita nueva, AAAA-MM-DD' },
          hora: { type: 'string', description: 'Hora de la cita nueva, HH:MM (24 h)' },
          profesional: {
            type: 'string',
            enum: config.profesionales.map((p) => p.nombre),
            description: 'Para la cita nueva; omitir si le da igual',
          },
          id_cita_anterior: { type: 'string', description: 'id_cita de la cita que ya tenía y choca' },
          accion_anterior: { type: 'string', enum: ['mover', 'anular'] },
          mover_a_fecha: { type: 'string', description: 'Nuevo día para la anterior, AAAA-MM-DD' },
          mover_a_hora: { type: 'string', description: 'Nueva hora para la anterior, HH:MM. Vacío = pedir opciones' },
        },
        required: ['servicio', 'fecha', 'hora', 'id_cita_anterior', 'accion_anterior'],
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

    const anterior = await citaDeLaClienta(ctx, texto(input, 'id_cita_anterior'));
    if (!('id' in anterior)) return anterior;
    if (anterior.status !== 'confirmada' || anterior.start.getTime() <= ctx.now().getTime()) {
      return fallo({ motivo: 'cita_no_modificable', mensaje: 'Esa cita ya pasó, está cancelada o cerrada: no se puede cambiar.' });
    }
    const accion = texto(input, 'accion_anterior') === 'anular' ? 'anular' : 'mover';

    // PR-07: mover o anular la anterior cuenta como cambiarla.
    const { dentroDelPlazo } = plazo(ctx.config, anterior.start, ctx.now());
    if (dentroDelPlazo && ctx.config.cancelacionModo === 'bloquear') {
      return bloqueadaPorPlazo(ctx.config, accion === 'anular' ? 'cancelar' : 'mover');
    }

    // Lo que la anterior no puede pisar al moverla: la cita nueva y las demás suyas.
    const nueva: Intervalo = { desde: inicio, hasta: new Date(inicio.getTime() + servicio.duracionMin * 60_000) };
    const excluir = [nueva, ...(await ocupadoDeLaClienta(ctx, anterior.id))];

    const moverAFecha = texto(input, 'mover_a_fecha');
    const moverAHora = texto(input, 'mover_a_hora');
    if (accion === 'mover' && !moverAHora) {
      if (moverAFecha && !isFecha(moverAFecha)) {
        return fallo({ motivo: 'fecha_no_valida', mensaje: 'mover_a_fecha tiene que ir en formato AAAA-MM-DD.' });
      }
      const l = utcToLocal(anterior.start, ctx.config.timezone);
      const opciones = await alternativas(ctx, {
        servicioId: anterior.serviceId,
        staffId: anterior.staffId,
        fecha: moverAFecha ?? l.fecha,
        hora: moverAFecha ? undefined : l.hora,
        excluir,
      });
      return ok({
        sin_cambios_todavia: true,
        cita_anterior: describirCita(ctx, anterior),
        opciones_para_mover_la_anterior: opciones,
        profesional_de_la_anterior: nombreProfesional(ctx.config, anterior.staffId),
        indicacion:
          'No se ha cambiado nada. Ofrécele estas opciones para su cita anterior. Cuando elija, confirma las dos cosas en ' +
          'una sola pregunta y, con el sí, vuelve a llamar con mover_a_fecha y mover_a_hora.',
      });
    }

    let nuevoInicioAnterior: Date | undefined;
    if (accion === 'mover') {
      if (!moverAFecha || !isFecha(moverAFecha) || !isHora(moverAHora!)) {
        return fallo({ motivo: 'fecha_no_valida', mensaje: 'Para mover hacen falta mover_a_fecha (AAAA-MM-DD) y mover_a_hora (HH:MM).' });
      }
      const t = instantePedido(ctx, moverAFecha, moverAHora);
      if (!(t instanceof Date)) return t;
      nuevoInicioAnterior = t;
    }

    let r: { created: Booking; changed: Booking };
    try {
      r = await ctx.adapter.changeExistingAndBook({
        existingBookingId: anterior.id,
        existing: nuevoInicioAnterior ? { action: 'reschedule', newStart: nuevoInicioAnterior } : { action: 'cancel' },
        booking: {
          businessId: ctx.config.id,
          serviceId: servicio.id,
          ...(profesional ? { staffId: profesional.id } : {}),
          customerId,
          start: inicio,
          origin: 'agente',
        },
      });
    } catch (e) {
      const step = (e as { step?: string }).step;
      const res =
        step === 'existing' && nuevoInicioAnterior
          ? await errorDeReserva(ctx, e, {
              servicioId: anterior.serviceId,
              staffId: anterior.staffId,
              ...utcToLocal(nuevoInicioAnterior, ctx.config.timezone),
              soloConEsaProfesional: true,
              excluir,
            })
          : await errorDeReserva(ctx, e, {
              servicioId: servicio.id,
              staffId: profesional?.id,
              fecha: fecha!,
              hora: hora!,
              excluir: await ocupadoDeLaClienta(ctx, anterior.id),
            });
      if (!res.ok && step === 'existing' && !res.error.alternativas) {
        // Si la anterior choca con la nueva (u otra suya), también hay que
        // ofrecerle otras horas para moverla.
        const l = utcToLocal(nuevoInicioAnterior!, ctx.config.timezone);
        res.error.alternativas = await alternativas(ctx, {
          servicioId: anterior.serviceId,
          staffId: anterior.staffId,
          fecha: l.fecha,
          hora: l.hora,
          excluir,
        });
        delete res.error.cita_que_choca;
      }
      if (!res.ok) {
        res.error.mensaje =
          `${step === 'existing' ? 'No se pudo mover la cita anterior a ese horario' : 'No se pudo reservar la cita nueva'}. ` +
          `${res.error.mensaje} No se ha cambiado nada: las dos siguen como estaban.`;
        res.error.paso_que_fallo = step === 'existing' ? 'mover_la_anterior' : 'la_nueva';
      }
      return res;
    }

    return ok({
      reservada: true,
      cita_nueva: describirCita(ctx, r.created),
      ...(accion === 'mover'
        ? { cita_anterior_movida: { antes: describirCita(ctx, anterior), ahora: describirCita(ctx, r.changed) } }
        : { cita_anterior_anulada: describirCita(ctx, anterior) }),
      dentro_del_plazo: dentroDelPlazo,
      ...(dentroDelPlazo ? { politica_cancelacion: ctx.config.politicaCancelacion } : {}),
    });
  },
};
