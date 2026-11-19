// =============================================================================
// Las definiciones de las herramientas son válidas para la API (Fase 9 · 9.7)
// =============================================================================
// Los tests con el modelo simulado nunca mandan las definiciones a Anthropic,
// así que un esquema que la API rechaza pasaba desapercibido: el 19/11/2026,
// `cerrar_dia` llevaba un enum con tipo ['string', 'null'] y el chat del portal
// dejaba de responder a cualquier mensaje después del alta (lo destapó
// `npm run alta:eval`). Aquí se revisan, sin coste, las reglas que la API
// aplica con `strict: true` a TODAS las herramientas de los dos agentes.
// =============================================================================

import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';

import { definiciones } from '../src/alta/herramientas.js';
import { loadBusinessConfig } from '../src/config/business.js';
import { toolDefinitions } from '../src/core/tools/index.js';
import { createSql } from '../src/db/client.js';
import { AURORA } from './helpers/fixtures.js';

type Esquema = Record<string, unknown>;

/** Los problemas de un esquema (y de sus hijos), con la ruta donde está cada uno. */
function problemas(e: Esquema, ruta: string): string[] {
  const out: string[] = [];
  const tipo = e.type;
  // Un enum solo con un tipo simple: la API no acepta enum con un tipo lista.
  if (Array.isArray(e.enum) && Array.isArray(tipo)) out.push(`${ruta}: enum con tipo ${JSON.stringify(tipo)}`);
  if (Array.isArray(e.enum) && e.enum.some((v) => v === null)) out.push(`${ruta}: null dentro de un enum`);
  if (tipo === 'object' || (Array.isArray(tipo) && tipo.includes('object'))) {
    if (e.additionalProperties !== false) out.push(`${ruta}: objeto sin additionalProperties: false`);
    const props = (e.properties ?? {}) as Record<string, Esquema>;
    for (const r of (e.required ?? []) as string[]) if (!(r in props)) out.push(`${ruta}: required "${r}" que no existe`);
    for (const [k, v] of Object.entries(props)) out.push(...problemas(v, `${ruta}.${k}`));
  }
  if (e.items) out.push(...problemas(e.items as Esquema, `${ruta}[]`));
  return out;
}

function revisar(tools: Anthropic.Beta.BetaTool[]): string[] {
  return tools.flatMap((t) => problemas(t.input_schema as unknown as Esquema, t.name));
}

describe('esquemas de las herramientas', () => {
  it('el chat del alta y el del portal (src/alta)', () => {
    expect(revisar(definiciones('alta'))).toEqual([]);
    expect(revisar(definiciones('portal'))).toEqual([]);
  });

  it('el agente de las clientas (src/core)', async () => {
    const sql = createSql(undefined, { max: 1 });
    try {
      const config = await loadBusinessConfig(sql, { id: AURORA.businessId });
      expect(revisar(toolDefinitions(config))).toEqual([]);
    } finally {
      await sql.end();
    }
  });
});
