// =============================================================================
// Coste aproximado de las llamadas a la API
// =============================================================================
// Solo para informar (Terminal y escenarios). El registro de consumo por
// negocio en `usage_events` es de la Fase 3.
//
// Precios de lista por millón de tokens, en dólares (octubre 2026). La
// escritura en caché de 5 minutos cuesta 1,25 × la entrada.
// =============================================================================

import type { UsageDetalle } from '../db/conversations.js';

interface Precio {
  entrada: number;
  salida: number;
  lecturaCache: number;
}

const PRECIOS: Record<string, Precio> = {
  'claude-opus-5': { entrada: 5, salida: 25, lecturaCache: 0.5 },
  'claude-opus-5-5': { entrada: 4, salida: 20, lecturaCache: 0.2 },
  'claude-sonnet-5-5': { entrada: 2, salida: 10, lecturaCache: 0.2 },
  'claude-haiku-5-5': { entrada: 0.1, salida: 0.5, lecturaCache: 0.01 },
  'claude-fable-5-1': { entrada: 10, salida: 50, lecturaCache: 0.25 },
  // Destino posible de los fallbacks del servidor.
  'claude-opus-4-8': { entrada: 5, salida: 25, lecturaCache: 0.5 },
};

/** Coste en dólares, o null si el modelo no está en la tabla. */
export function costeUsd(modelo: string, u: UsageDetalle): number | null {
  const p = PRECIOS[modelo];
  if (!p) return null;
  return (
    (u.input_tokens * p.entrada +
      u.cache_creation_input_tokens * p.entrada * 1.25 +
      u.cache_read_input_tokens * p.lecturaCache +
      u.output_tokens * p.salida) /
    1_000_000
  );
}

/** Suma el coste de varios modelos; los desconocidos se cuentan aparte. */
export function costeTotal(porModelo: Record<string, UsageDetalle>): { usd: number; sinPrecio: string[] } {
  let usd = 0;
  const sinPrecio: string[] = [];
  for (const [modelo, u] of Object.entries(porModelo)) {
    const c = costeUsd(modelo, u);
    if (c === null) sinPrecio.push(modelo);
    else usd += c;
  }
  return { usd, sinPrecio };
}

export function formatoUsd(usd: number): string {
  return `${usd.toFixed(4).replace('.', ',')} US$`;
}
