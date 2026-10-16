// =============================================================================
// Contrato de las herramientas del agente (maestro §6, Fase 2 · 2.3)
// =============================================================================
// Cada herramienta tiene una definición (lo que ve el modelo: nombre,
// descripción y esquema `strict`) y una ejecución (lo que hace el código).
// Todas reciben y devuelven HORA LOCAL del negocio; la conversión a UTC vive en
// src/core/time.ts.
//
// Las reglas que no se pueden dejar al prompt (PA-08, PR-07 bloquear, PA-06)
// se comprueban dentro de la ejecución: el modelo puede pedir lo que quiera,
// la herramienta decide.
// =============================================================================

import type Anthropic from '@anthropic-ai/sdk';
import type { Sql } from 'postgres';

import type { BookingAdapter } from '../../adapters/booking/types.js';
import type { BusinessConfig } from '../../config/business.js';
import type { ConversationEstado } from '../../db/conversations.js';

/** Lo que una herramienta necesita para ejecutarse. */
export interface ToolContext {
  sql: Sql;
  adapter: BookingAdapter;
  config: BusinessConfig;
  conversationId: string;
  /**
   * Estado de la conversación que las herramientas leen y cambian dentro de
   * un turno: identificar_cliente fija la clienta, derivar_a_humano la escala.
   */
  state: {
    customerId: string | null;
    estado: ConversationEstado;
  };
  /** Reloj inyectable para los tests. */
  now: () => Date;
}

/** Error para el modelo: un motivo estable, una explicación y, si aplica, huecos alternativos. */
export interface ToolError {
  motivo: string;
  mensaje: string;
  alternativas?: HuecoOfrecido[];
  [k: string]: unknown;
}

export type ToolResult = { ok: true; data: Record<string, unknown> } | { ok: false; error: ToolError };

/** Un horario que se le puede ofrecer a la clienta, en hora local. */
export interface HuecoOfrecido {
  fecha: string; // 'YYYY-MM-DD'
  dia: string; // 'martes 20 de octubre de 2026'
  hora: string; // 'HH:MM'
  hora_fin: string; // fin del servicio, sin el margen
  /** Quién puede atender a esa hora (PD-03: el agente dice el nombre). */
  profesionales: string[];
}

export interface AgentTool {
  name: string;
  /** Si es una acción que cambia la agenda o la clienta (bloqueada tras derivar, PA-06). */
  escribe: boolean;
  definition(config: BusinessConfig): Anthropic.Beta.BetaTool;
  run(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}
