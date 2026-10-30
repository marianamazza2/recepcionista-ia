// consultar_disponibilidad — huecos libres de un servicio (maestro §6, PA-03, PD-04)
//
// Sin huecos, dice por qué cuando se sabe (PD-04): el local no abre ese día de
// la semana, el local cierra todo el rango (festivo, vacaciones: time_off sin
// profesional) o la profesional pedida no está. Nunca el motivo escrito en el
// festivo: puede ser interno ("vacaciones de Lucía").

import { CustomerBusyError } from '../../adapters/booking/errors.js';
import type { BusinessConfig } from '../../config/business.js';
import { diasEntre, isFecha, isHora, localToUtc, sumarDias, weekdayDe } from '../time.js';
import {
  HUECOS_POR_RESPUESTA,
  alternativas,
  buscarProfesional,
  buscarServicio,
  fallo,
  hoyLocal,
  citaQueChoca,
  describirCita,
  huecos,
  motivoYMensaje,
  ocupadoDeLaClienta,
  ok,
  profesionalDesconocida,
  servicioDesconocido,
  texto,
} from './common.js';
import type { AgentTool } from './types.js';

/** Rango máximo de una consulta. El motor admite 31 días; al chat le sobra con dos semanas. */
const MAX_DIAS = 14;

export const consultarDisponibilidad: AgentTool = {
  name: 'consultar_disponibilidad',
  escribe: false,

  definition(config: BusinessConfig) {
    return {
      name: 'consultar_disponibilidad',
      description:
        'Busca los horarios libres de un servicio entre dos fechas (como mucho 14 días), opcionalmente con una profesional. ' +
        `Devuelve como mucho ${HUECOS_POR_RESPUESTA} horarios: si das hora_preferida, los más cercanos a esa hora; si no, los primeros. ` +
        'Cada horario trae día, hora y qué profesionales están libres. Si no hay ninguno, devuelve los más cercanos fuera del rango. ' +
        'Es la ÚNICA fuente de horarios: nunca ofrezcas una hora que no venga de aquí. Fechas y horas en hora local del negocio.',
      strict: true,
      input_schema: {
        type: 'object',
        properties: {
          servicio: { type: 'string', enum: config.servicios.map((s) => s.nombre), description: 'Nombre exacto del servicio' },
          fecha_desde: { type: 'string', description: 'Primer día, formato AAAA-MM-DD' },
          fecha_hasta: { type: 'string', description: 'Último día, incluido, formato AAAA-MM-DD. Si se omite, solo fecha_desde' },
          hora_preferida: { type: 'string', description: 'Hora que pidió la clienta, formato HH:MM (24 h), si pidió una' },
          profesional: {
            type: 'string',
            enum: config.profesionales.map((p) => p.nombre),
            description: 'Solo si la clienta quiere a una profesional concreta',
          },
        },
        required: ['servicio', 'fecha_desde'],
        additionalProperties: false,
      },
    };
  },

  async run(input, ctx) {
    const servicio = buscarServicio(ctx.config, texto(input, 'servicio'));
    if (!servicio) return servicioDesconocido(ctx.config);
    const nombreProf = texto(input, 'profesional');
    const profesional = buscarProfesional(ctx.config, nombreProf);
    if (nombreProf && !profesional) return profesionalDesconocida(ctx.config);

    let desde = texto(input, 'fecha_desde') ?? '';
    const hasta = texto(input, 'fecha_hasta') ?? desde;
    const hora = texto(input, 'hora_preferida');
    if (!isFecha(desde) || !isFecha(hasta)) {
      return fallo({ motivo: 'fecha_no_valida', mensaje: 'Las fechas tienen que ir en formato AAAA-MM-DD.' });
    }
    if (hora && !isHora(hora)) {
      return fallo({ motivo: 'hora_no_valida', mensaje: 'La hora tiene que ir en formato HH:MM (24 h).' });
    }
    if (hasta < desde) {
      return fallo({ motivo: 'rango_no_valido', mensaje: 'fecha_hasta no puede ser anterior a fecha_desde.' });
    }
    const hoy = hoyLocal(ctx);
    if (hasta < hoy) {
      return fallo({ motivo: 'fecha_pasada', mensaje: `Esas fechas ya han pasado. Hoy es ${hoy}.` });
    }
    if (desde < hoy) desde = hoy;
    if (diasEntre(desde, hasta) + 1 > MAX_DIAS) {
      return fallo({ motivo: 'rango_demasiado_grande', mensaje: `Consulta como mucho ${MAX_DIAS} días de una vez.` });
    }
    if (profesional && !profesional.servicioIds.includes(servicio.id)) {
      return fallo({
        motivo: 'profesional_no_hace_servicio',
        mensaje: `${profesional.nombre} no hace ${servicio.nombre}.`,
        profesionales_que_lo_hacen: ctx.config.profesionales
          .filter((p) => p.servicioIds.includes(servicio.id))
          .map((p) => p.nombre),
      });
    }

    let cerca: Date | undefined;
    if (hora) {
      try {
        cerca = localToUtc(desde, hora, ctx.config.timezone);
      } catch {
        cerca = undefined;
      }
    }
    // PR-08: no se le ofrecen horarios en que ya tiene otra cita. Y si la hora
    // que pidió choca con una cita suya, se le dice eso (no "no está libre").
    const excluir = await ocupadoDeLaClienta(ctx);
    if (cerca) {
      const choca = await citaQueChoca(ctx, servicio.id, desde, hora!);
      if (choca) {
        return ok({
          servicio: servicio.nombre,
          clienta_ya_tiene_cita: true,
          cita_que_choca: describirCita(ctx, choca),
          indicacion: motivoYMensaje(ctx.config, new CustomerBusyError('')).mensaje,
        });
      }
    }
    const todos = await huecos(ctx, { servicioId: servicio.id, staffId: profesional?.id, desde, hasta, cerca, excluir });

    const base = {
      servicio: servicio.nombre,
      duracion_min: servicio.duracionMin,
      ...(profesional ? { profesional: profesional.nombre } : {}),
      desde,
      hasta,
    };

    if (todos.length > 0) {
      return ok({
        ...base,
        huecos: todos.slice(0, HUECOS_POR_RESPUESTA),
        hay_mas: todos.length > HUECOS_POR_RESPUESTA,
      });
    }

    // Nada en el rango: se dice por qué, si es evidente, y se buscan los más
    // cercanos (PD-04).
    const unSoloDia = desde === hasta;
    const cerradoEseDia =
      unSoloDia && !profesional && !ctx.config.horario.some((t) => t.weekday === weekdayDe(desde));
    const motivo = cerradoEseDia ? 'el_local_no_abre_ese_dia' : await cierreQueCubre(ctx, desde, hasta, profesional?.id ?? null);
    return ok({
      ...base,
      huecos: [],
      motivo_sin_huecos: motivo,
      alternativas: await alternativas(ctx, {
        servicioId: servicio.id,
        staffId: profesional?.id,
        fecha: desde,
        hora,
        excluir,
      }),
    });
  },
};

/**
 * Sin huecos en el rango: ¿es porque el local cierra todo el rango (festivo,
 * vacaciones) o la profesional pedida no está? Solo cuentan los cierres que
 * cubren los días enteros; uno de unas horas no explica que no haya nada.
 */
async function cierreQueCubre(
  ctx: Parameters<AgentTool['run']>[1],
  desde: string,
  hasta: string,
  staffId: string | null,
): Promise<'el_local_cierra_esos_dias' | 'la_profesional_no_esta_esos_dias' | 'no_quedan_huecos_libres'> {
  const inicio = localToUtc(desde, '00:00', ctx.config.timezone);
  const fin = localToUtc(sumarDias(hasta, 1), '00:00', ctx.config.timezone);
  const local = await ctx.sql`
    select 1 from public.time_off
     where business_id = ${ctx.config.id} and staff_id is null and desde <= ${inicio} and hasta >= ${fin}
     limit 1`;
  if (local.length > 0) return 'el_local_cierra_esos_dias';
  if (staffId) {
    const suya = await ctx.sql`
      select 1 from public.time_off
       where business_id = ${ctx.config.id} and staff_id = ${staffId} and desde <= ${inicio} and hasta >= ${fin}
       limit 1`;
    if (suya.length > 0) return 'la_profesional_no_esta_esos_dias';
  }
  return 'no_quedan_huecos_libres';
}

