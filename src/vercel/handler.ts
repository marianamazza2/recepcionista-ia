// =============================================================================
// La función de Vercel (Fase 3 · PW-08): la demo publicada
// =============================================================================
// Una sola función atiende todas las rutas del servidor del widget
// (/api/widget/config, /api/chat, /api/chat/historial, /cita/:token) con el
// mismo createApi que `npm run dev`. widget.js y la web de la demo son
// archivos estáticos (los arma src/cli/build-vercel.ts).
//
// Variables (en el proyecto de Vercel, nunca en el repo):
//   DATABASE_URL       Supabase por el pooler en modo transacción (6543)
//   ANTHROPIC_API_KEY  la clave de la API (nunca se muestra)
//   PUBLIC_API_URL     la URL pública de esta función, para el enlace del SMS
//   AGENT_*            opcionales, como en local
//
// SMS: el proveedor de prueba (PW-07). El SMS sale en los logs de la función
// en Vercel; no se envía a nadie.
//
// La IP sale de x-forwarded-for, que en Vercel pone la plataforma.
// La conexión y el cliente se crean en la primera petición y se reutilizan
// mientras la instancia siga viva.
// =============================================================================

import type { IncomingMessage, ServerResponse } from 'node:http';

import { SmsDePrueba } from '../adapters/sms/prueba.js';
import { createApi } from '../api/app.js';
import { aRequest, enviar } from '../api/node.js';
import { anthropicModelClient, settingsFromEnv } from '../core/agent.js';
import { createSql } from '../db/client.js';

let api: ReturnType<typeof createApi> | null = null;

function publicUrl(): string {
  const url = process.env.PUBLIC_API_URL?.trim().replace(/\/+$/, '');
  if (!url) throw new Error('Falta PUBLIC_API_URL en las variables del proyecto de Vercel');
  return url;
}

function crearApi(): ReturnType<typeof createApi> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Falta ANTHROPIC_API_KEY en las variables del proyecto de Vercel');
  const settings = settingsFromEnv();
  return createApi({
    // Pocas conexiones: el pooler de Supabase reparte; varias peticiones
    // pueden compartir instancia (Fluid Compute).
    sql: createSql(undefined, { max: 5, idle_timeout: 20 }),
    model: anthropicModelClient(settings),
    settings,
    sms: new SmsDePrueba(),
    baseUrl: publicUrl(),
    onError: (e) => console.error(`[error] ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`),
  });
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    api ??= crearApi();
    await enviar(res, await api(aRequest(req, publicUrl())));
  } catch (e) {
    console.error(`[error] ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
    res.end('{"error":"no_disponible"}');
  }
}
