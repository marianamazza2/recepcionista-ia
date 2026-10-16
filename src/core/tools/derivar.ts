// derivar_a_humano — pasa una consulta o la conversación al equipo (PA-05, PA-06, PA-12)
//
// Dos casos, según el motivo (lo decide el código, no el modelo):
//   · Una PREGUNTA que no sabe responder (dato_desconocido, salud): se registra
//     para el equipo y la conversación SIGUE ACTIVA; el agente pregunta si puede
//     ayudar en algo más y puede seguir dando citas (PA-12, 16/10/2026).
//   · El resto (pide una persona, queja, cancelación bloqueada, insiste, no
//     entiende, error…): se crea la escalación, la conversación queda
//     `escalada` y ya no se agenda en ella (PA-06).
// En la Fase 2 (sin panel) el equipo ve las derivaciones en `escalations`.

import { escalateConversation } from '../../db/conversations.js';
import { ok, texto } from './common.js';
import type { AgentTool } from './types.js';

export const MOTIVOS_DERIVACION = [
  'dato_desconocido',
  'la_clienta_lo_pide',
  'insiste_en_hora_no_disponible',
  'salud',
  'queja',
  'cancelacion_bloqueada',
  'no_entiendo',
  'error',
  'otro',
] as const;

/** PA-12: motivos que solo pasan la pregunta al equipo, sin cerrar la conversación. */
export const MOTIVOS_SIN_CERRAR: ReadonlySet<string> = new Set(['dato_desconocido', 'salud']);

export const derivarAHumano: AgentTool = {
  name: 'derivar_a_humano',
  // No escribe en la agenda: se puede derivar aunque la conversación ya lo esté.
  escribe: false,

  definition() {
    return {
      name: 'derivar_a_humano',
      description:
        'Pasa al equipo una consulta o la conversación. Con motivo dato_desconocido o salud solo registra la pregunta para el ' +
        'equipo y la conversación sigue: puedes seguir atendiendo y dando citas. Con cualquier otro motivo la conversación pasa ' +
        'al equipo y ya no se pueden reservar, cancelar ni mover citas en ella. Devuelve el teléfono del local. Úsala en los ' +
        'casos de "Cuándo pasar con una persona".',
      strict: true,
      input_schema: {
        type: 'object',
        properties: {
          motivo: { type: 'string', enum: [...MOTIVOS_DERIVACION] },
          resumen: { type: 'string', description: 'Una o dos frases para el equipo: qué quiere la clienta y qué pasó' },
        },
        required: ['motivo', 'resumen'],
        additionalProperties: false,
      },
    };
  },

  async run(input, ctx) {
    const motivo = texto(input, 'motivo') ?? 'otro';
    const resumen = texto(input, 'resumen') ?? '';
    const cerrar = !MOTIVOS_SIN_CERRAR.has(motivo);
    await escalateConversation(ctx.sql, ctx.config.id, ctx.conversationId, `${motivo}: ${resumen}`, { cerrar });
    if (!cerrar) {
      return ok({
        consulta_pasada_al_equipo: true,
        conversacion_sigue_abierta: true,
        telefono_local: ctx.config.telefonoHumano,
        indicacion:
          'Dile que esa información no la tienes y que se la pasas al equipo, y pregúntale si puedes ayudarla en algo más. ' +
          'Sigues pudiendo dar, cambiar y cancelar citas. No prometas que la llamarán ni cuándo.',
      });
    }
    ctx.state.estado = 'escalada';
    return ok({
      derivada: true,
      telefono_local: ctx.config.telefonoHumano,
      indicacion:
        'Dile que has pasado su consulta al equipo y dale el teléfono del local. No prometas que la llamarán ni cuándo. ' +
        'En esta conversación ya no puedes reservar, cancelar ni mover citas.',
    });
  },
};
