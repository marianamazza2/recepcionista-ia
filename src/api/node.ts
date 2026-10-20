// =============================================================================
// Puente entre el servidor HTTP de Node y los handlers estándar (Fase 3)
// =============================================================================
// Los handlers de src/api/ trabajan con Request/Response (API Fetch). Node
// entrega IncomingMessage/ServerResponse: aquí se traduce en los dos sentidos.
// Lo usan el servidor local (src/dev/server.ts) y la función de Vercel
// (src/vercel/handler.ts), así las dos corren exactamente el mismo código.
// =============================================================================

import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

/** IncomingMessage de Node → Request estándar. `base` da el esquema y el host. */
export function aRequest(req: IncomingMessage, base: string): Request {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    for (const x of Array.isArray(v) ? v : [v]) headers.append(k, x);
  }
  const conCuerpo = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(new URL(req.url ?? '/', base), {
    method: req.method ?? 'GET',
    headers,
    ...(conCuerpo ? { body: Readable.toWeb(req) as ReadableStream, duplex: 'half' } : {}),
  } as RequestInit);
}

/** Response estándar → ServerResponse de Node. */
export async function enviar(res: ServerResponse, r: Response): Promise<void> {
  const headers: Record<string, string> = {};
  r.headers.forEach((v, k) => (headers[k] = v));
  res.writeHead(r.status, headers);
  res.end(Buffer.from(await r.arrayBuffer()));
}
