// =============================================================================
// Registro de herramientas y ejecución
// =============================================================================
// `buscar_en_conocimiento` (maestro §6, Fase 5) solo se le da al modelo si el
// negocio tiene documentos: no se declara una herramienta que no hace nada, y
// un negocio sin documentos sigue con el mismo prefijo de siempre.
//
// Las definiciones salen ordenadas por nombre y construidas solo con la
// configuración: el mismo negocio produce siempre la misma lista, byte a byte
// (las herramientas van al principio del prefijo cacheado).
// =============================================================================

import type Anthropic from '@anthropic-ai/sdk';

import type { BusinessConfig } from '../../config/business.js';
import { telefonoLegible } from '../phone.js';
import { reservarYCambiarCitaAnterior } from './cambiar.js';
import { identificarCliente } from './clientes.js';
import { enviarCodigo, verificarCodigo } from './codigo.js';
import { buscarEnConocimiento } from './conocimiento.js';
import { derivarAHumano } from './derivar.js';
import { consultarDisponibilidad } from './disponibilidad.js';
import { buscarReservasCliente, cancelarReserva, crearReserva, reprogramarReserva } from './reservas.js';
import type { AgentTool, ToolContext, ToolResult } from './types.js';

export const TOOLS: readonly AgentTool[] = [
  buscarEnConocimiento,
  buscarReservasCliente,
  cancelarReserva,
  consultarDisponibilidad,
  crearReserva,
  derivarAHumano,
  enviarCodigo,
  identificarCliente,
  reprogramarReserva,
  reservarYCambiarCitaAnterior,
  verificarCodigo,
].sort((a, b) => a.name.localeCompare(b.name));

/** Las herramientas que tiene este negocio (sin documentos, no hay nada que buscar). */
export function toolsDe(config: BusinessConfig): readonly AgentTool[] {
  return config.documentos.length > 0 ? TOOLS : TOOLS.filter((t) => t !== buscarEnConocimiento);
}

export function toolDefinitions(config: BusinessConfig): Anthropic.Beta.BetaTool[] {
  return toolsDe(config).map((t) => t.definition(config));
}

export interface ToolExecution {
  nombre: string;
  input: Record<string, unknown>;
  resultado: ToolResult;
  /** Lo que se devuelve al modelo como contenido del tool_result. */
  content: string;
  isError: boolean;
}

/**
 * Ejecuta una herramienta pedida por el modelo. Nunca lanza: cualquier fallo
 * inesperado se devuelve como error para que el modelo pueda derivar (PA-05,
 * "si algo falla"). El error original va al log del llamador.
 */
export async function executeTool(
  nombre: string,
  input: unknown,
  ctx: ToolContext,
  onUnexpectedError: (e: unknown) => void = () => {},
): Promise<ToolExecution> {
  const args = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  const tool = toolsDe(ctx.config).find((t) => t.name === nombre);
  let resultado: ToolResult;
  if (!tool) {
    resultado = { ok: false, error: { motivo: 'herramienta_desconocida', mensaje: `No existe la herramienta ${nombre}.` } };
  } else if (tool.escribe && ctx.state.estado !== 'activa') {
    // PA-06: tras derivar, esta conversación ya no agenda.
    resultado = {
      ok: false,
      error: {
        motivo: 'conversacion_derivada',
        mensaje: `Esta conversación ya se pasó al equipo: no se puede reservar, cancelar ni mover citas aquí. Da el teléfono del local: ${ctx.config.telefonoHumano ? telefonoLegible(ctx.config.telefonoHumano) : 'el del local'}.`,
      },
    };
  } else {
    try {
      resultado = await tool.run(args, ctx);
    } catch (e) {
      onUnexpectedError(e);
      resultado = {
        ok: false,
        error: {
          motivo: 'error_interno',
          mensaje: 'Algo ha fallado en el sistema. No lo intentes de nuevo: pasa la conversación a una persona con derivar_a_humano (motivo error).',
        },
      };
    }
  }
  return {
    nombre,
    input: args,
    resultado,
    content: JSON.stringify(resultado.ok ? resultado.data : resultado.error),
    isError: !resultado.ok,
  };
}
