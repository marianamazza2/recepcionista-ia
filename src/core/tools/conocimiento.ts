// buscar_en_conocimiento — lo que sabe el negocio, en sus documentos (Fase 5 · 5.3)
//
// Maestro §6 y PB-01/PB-05/PB-09. El agente la usa cuando la respuesta NO está
// en "Datos del negocio" ni en las preguntas frecuentes: cómo es un
// tratamiento, los cuidados de antes y después, qué incluye un bono.
//
// Lo que garantiza el código, no el prompt:
//   · el negocio sale del turno (ctx.config.id): la herramienta no recibe
//     ningún negocio y no hay forma de buscar en los documentos de otro;
//   · solo documentos activos (un borrador del chat del portal no existe);
//   · PB-01: si un trozo dice un precio, una duración o un horario distinto
//     del de la configuración, llega ya con el de la configuración
//     (src/conocimiento/buscar.ts), y `datos_que_mandan` lo repite si no se
//     pudo cambiar en el texto.
// Lo que dice la indicación (PB-05): contestar con lo que dice el documento,
// en sus palabras, sin inventar ni completar, sin consejo médico ni promesas.
//
// Solo se declara si el negocio tiene documentos (no se declara una
// herramienta que no hace nada).

import { buscadorDeTexto, buscarParaElAgente } from '../../conocimiento/buscar.js';
import { ok, texto } from './common.js';
import type { AgentTool } from './types.js';

export const buscarEnConocimiento: AgentTool = {
  name: 'buscar_en_conocimiento',
  escribe: false,

  definition() {
    return {
      name: 'buscar_en_conocimiento',
      description:
        'Busca en los documentos del negocio (su carta de tratamientos, hojas de cuidados, folletos). Úsala cuando la respuesta ' +
        'no esté en "Datos del negocio" ni en las preguntas frecuentes: cómo es un tratamiento, cuánto dura la recuperación, ' +
        'cuidados antes y después, qué incluye algo. Devuelve los trozos que mejor responden, con el título de su documento.',
      strict: true,
      input_schema: {
        type: 'object',
        properties: {
          consulta: {
            type: 'string',
            description:
              'Qué buscar, en pocas palabras y con los términos que podría usar el documento: el nombre del tratamiento y, si se te ocurren, sus sinónimos ("toxina botulínica bótox arrugas", "peeling químico cuidados después").',
          },
        },
        required: ['consulta'],
        additionalProperties: false,
      },
    };
  },

  async run(input, ctx) {
    const consulta = (texto(input, 'consulta') ?? '').slice(0, 300);
    if (!consulta) return ok({ encontrado: false, indicacion: 'Dime qué buscar.' });
    const r = await buscarParaElAgente(ctx.sql, ctx.config, consulta, ctx.buscador ?? buscadorDeTexto);
    if (r.trozos.length === 0) {
      return ok({
        encontrado: false,
        indicacion:
          'Los documentos del negocio no dicen nada de esto. Si tampoco está en "Datos del negocio", no lo sabes: dilo con naturalidad y pasa la pregunta al equipo con derivar_a_humano (dato_desconocido). Nunca digas "probablemente".',
      });
    }
    return ok({
      encontrado: true,
      trozos: r.trozos,
      ...(r.datos_que_mandan.length ? { datos_que_mandan: r.datos_que_mandan } : {}),
      indicacion:
        'Contesta solo con lo que dicen estos trozos, con tus palabras y corto, como recepcionista: no inventes ni completes (si dice "unos días", no digas "tres días"), no digas de qué documento ni de qué página sale, y no prometas resultados aunque el texto los prometa. ' +
        'Los precios, duraciones y horarios son siempre los de "Datos del negocio". Si la clienta pregunta si le conviene a ella (su piel, un embarazo, una enfermedad, una medicación), no lo valores: ofrécele pasar la consulta al equipo (salud). ' +
        'Si los trozos no responden a lo que pregunta, dilo y pásalo al equipo.',
    });
  },
};
