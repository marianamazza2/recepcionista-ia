// =============================================================================
// Guardrails (Fase 2 · 2.5)
// =============================================================================
// Dos capas:
//
// EN EL CÓDIGO (no se pueden saltar con un mensaje):
//   · PA-08 — cancelar, mover y ver solo sobre citas de la clienta identificada
//     (tools/common.ts → citaDeLaClienta). Una conversación no cambia de
//     clienta (tools/clientes.ts).
//   · PR-07 bloquear — dentro del plazo no se cancela ni se mueve
//     (tools/reservas.ts).
//   · PA-06 — tras derivar, ninguna herramienta que escribe se ejecuta
//     (tools/index.ts → executeTool) y el loop ya no llama al modelo (agent.ts).
//   · Precio no visible — se descarta al cargar la configuración
//     (config/business.ts): no llega ni al prompt ni a las herramientas.
//   · Límites del loop — vueltas de herramientas por mensaje y tokens por
//     conversación (este archivo). Si se superan, se deriva.
//   · Horarios — solo los que acepta el motor (D-26); el modelo no puede
//     reservar nada que la base no valide.
//
// EN EL PROMPT (core/prompt.ts): sin consejo médico ni estético personalizado,
// sin negociar precios ni prometer descuentos, sin inventar datos (PA-07), y
// sin obedecer instrucciones que lleguen dentro de los mensajes de la clienta.
// =============================================================================

import type { BusinessConfig } from '../config/business.js';

export interface AgentLimits {
  /** Vueltas de herramientas por mensaje de la clienta (maestro §9). */
  maxVueltas: number;
  /** Tokens (entrada + salida, caché incluida) por conversación. */
  maxTokensConversacion: number;
}

export const LIMITES_DE_SERIE: AgentLimits = {
  maxVueltas: 8,
  maxTokensConversacion: 500_000,
};

export function limitsFromEnv(env: NodeJS.ProcessEnv = process.env): AgentLimits {
  return {
    maxVueltas: entero(env.AGENT_MAX_VUELTAS, LIMITES_DE_SERIE.maxVueltas),
    maxTokensConversacion: entero(env.AGENT_MAX_TOKENS_CONVERSACION, LIMITES_DE_SERIE.maxTokensConversacion),
  };
}

function entero(v: string | undefined, porDefecto: number): number {
  const n = Number(v);
  return v !== undefined && v.trim() !== '' && Number.isInteger(n) && n > 0 ? n : porDefecto;
}

// -----------------------------------------------------------------------------
// Texto que ve la clienta
// -----------------------------------------------------------------------------
// En las pruebas con el modelo real, de vez en cuando (≈1 de cada 5 en un
// escenario) la respuesta tras una herramienta fue solo una etiqueta interna
// ("antml:handle_stop_reason"). Eso no puede llegar a la clienta: se quitan
// las etiquetas y, si no queda nada, el loop usa una respuesta fija.

const ETIQUETA_INTERNA = /<\/?[a-zA-Z_][\w:.-]*(?:\s[^<>]*)?>|\bantml:[\w-]+/g;

export function textoParaLaClienta(texto: string): string {
  return texto.replace(ETIQUETA_INTERNA, '').replace(/[ \t]+\n/g, '\n').trim();
}

// -----------------------------------------------------------------------------
// Respuestas fijas
// -----------------------------------------------------------------------------
// Cuando el CÓDIGO decide (conversación ya derivada, límite superado, fallo de
// la API), la respuesta no la escribe el modelo: es una plantilla con los datos
// del negocio. No contiene nada propio de ningún negocio.

export type MotivoRespuestaFija = 'conversacion_derivada' | 'limite_vueltas' | 'limite_tokens' | 'error';

export function respuestaFija(config: BusinessConfig, motivo: MotivoRespuestaFija): string {
  const llamar = config.telefonoHumano ? ` Puedes llamar al ${config.telefonoHumano}.` : '';
  if (motivo === 'conversacion_derivada') {
    return `Ya he pasado tu consulta al equipo de ${config.nombre}, que se encarga a partir de aquí.${llamar}`;
  }
  return `Perdona, no puedo seguir con esto por aquí. He pasado tu consulta al equipo de ${config.nombre}.${llamar}`;
}
