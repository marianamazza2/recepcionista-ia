// =============================================================================
// Las rutas de la Fase 3 en un solo punto de entrada
// =============================================================================
// (Request, contexto) => Promise<Response>. El servidor local la usa tal cual;
// en Vercel, cada ruta será una función que llama al handler correspondiente
// (ver docs/DECISIONES.md, Fase 3).
// =============================================================================

import type { WebChatDeps } from '../adapters/channels/web-widget.js';
import { paginaCita } from './cita.js';
import { ipDeCabeceras, json, preflight } from './http.js';
import { chat, historial, widgetConfig, type Contexto } from './widget.js';

export type ApiDeps = WebChatDeps;

export function createApi(deps: ApiDeps): (req: Request, ctx?: Partial<Contexto>) => Promise<Response> {
  return async (req, ctx = {}) => {
    const { pathname } = new URL(req.url);
    const ip = ctx.ip !== undefined ? ctx.ip : ipDeCabeceras(req);

    if (pathname === '/api/widget/config' || pathname === '/api/chat' || pathname === '/api/chat/historial') {
      if (req.method === 'OPTIONS') return preflight(req);
      if (pathname === '/api/widget/config' && req.method === 'GET') return widgetConfig(deps, req);
      if (pathname === '/api/chat' && req.method === 'POST') return chat(deps, req, { ip });
      if (pathname === '/api/chat/historial' && req.method === 'GET') return historial(deps, req);
      return json({ error: 'metodo_no_permitido' }, 405);
    }

    const cita = /^\/cita\/([^/]+)\/?$/.exec(pathname);
    if (cita) {
      return paginaCita({ sql: deps.sql, ...(deps.now ? { now: deps.now } : {}), ...(deps.onError ? { onError: deps.onError } : {}) }, req, decodeURIComponent(cita[1]!));
    }

    return json({ error: 'no_encontrado' }, 404);
  };
}
