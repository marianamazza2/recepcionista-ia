// =============================================================================
// Piezas HTTP compartidas por los handlers (Fase 3 · 3.2)
// =============================================================================
// Los handlers son funciones estándar (Request) => Promise<Response>, las de la
// API Fetch: corren igual en el servidor local (src/dev/server.ts) y en Vercel
// Functions con el runtime de Node.
// =============================================================================

/** Tamaño máximo del cuerpo de una petición del widget (un mensaje cabe de sobra). */
export const MAX_CUERPO_BYTES = 16 * 1024;

export class PeticionNoValida extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
  ) {
    super(codigo);
    this.name = 'PeticionNoValida';
  }
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  const h = new Headers(headers);
  h.set('content-type', 'application/json; charset=utf-8');
  if (!h.has('cache-control')) h.set('cache-control', 'no-store');
  h.set('x-content-type-options', 'nosniff');
  return new Response(JSON.stringify(body), { status, headers: h });
}

/** Lee el cuerpo JSON con un tope de tamaño. Lanza PeticionNoValida. */
export async function leerJson(req: Request, maxBytes = MAX_CUERPO_BYTES): Promise<Record<string, unknown>> {
  const declarado = Number(req.headers.get('content-length'));
  if (Number.isFinite(declarado) && declarado > maxBytes) throw new PeticionNoValida(413, 'demasiado_grande');
  const buf = await req.arrayBuffer();
  if (buf.byteLength > maxBytes) throw new PeticionNoValida(413, 'demasiado_grande');
  try {
    const v: unknown = JSON.parse(new TextDecoder().decode(buf));
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new PeticionNoValida(400, 'peticion_no_valida');
  }
}

// -----------------------------------------------------------------------------
// Origen (PW-06) y CORS
// -----------------------------------------------------------------------------

/** El host de la cabecera Origin, o null si no hay o no se entiende. */
export function hostDeOrigen(origin: string | null): string | null {
  if (!origin || origin === 'null') return null;
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * PW-06: el widget solo funciona en los dominios del negocio. Se compara el
 * host exacto (sin puerto ni esquema): `esteticaaurora.es` no incluye
 * `www.esteticaaurora.es`; si el negocio usa los dos, van los dos en la lista.
 * Sin cabecera Origin no se acepta (un navegador siempre la manda en estas
 * peticiones; un script fuera del navegador puede inventarla, y para eso
 * están los límites, no esta comprobación).
 */
export function origenPermitido(origin: string | null, dominios: readonly string[]): boolean {
  const host = hostDeOrigen(origin);
  return host !== null && dominios.includes(host);
}

/** Cabeceras CORS para un origen ya comprobado: solo ese origen, nunca `*`. */
export function cors(origin: string): Record<string, string> {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'false',
    vary: 'Origin',
  };
}

/**
 * Respuesta al preflight. El preflight de POST /api/chat no trae la clave (va
 * en el cuerpo), así que aquí no se puede saber de qué negocio es: se responde
 * al origen que pregunta, y la comprobación de dominio se hace en la petición
 * de verdad, antes de procesar nada.
 */
export function preflight(req: Request): Response {
  const origin = req.headers.get('origin');
  if (!hostDeOrigen(origin)) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: {
      ...cors(origin!),
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type, authorization',
      'access-control-max-age': '600',
    },
  });
}

/** La IP de quien llama, según la cabecera que pone la plataforma (Vercel: x-forwarded-for). */
export function ipDeCabeceras(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for');
  const ip = xff?.split(',')[0]?.trim() || req.headers.get('x-real-ip')?.trim();
  return ip || null;
}

export function escaparHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
