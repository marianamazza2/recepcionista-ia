// =============================================================================
// Servidor local de la demo (Fase 3 · 3.6) — npm run dev
// =============================================================================
// Dos orígenes, como en la realidad:
//   · http://localhost:4311 — "nuestro" servidor: widget.js, /api/… y /cita/…
//   · http://localhost:4310 — "la web del negocio": demo/ (Estética Aurora)
// Puertos poco habituales a propósito: el 3000 lo suelen ocupar otros
// proyectos, y si otro programa escucha en el mismo puerto por IPv6, el
// navegador (que prueba primero ::1 para "localhost") acaba en él.
// Así el navegador aplica CORS y la comprobación de dominio (PW-06) igual que
// con un negocio de verdad.
//
// Contra la base de DATABASE_URL (.env), con el modelo real (ANTHROPIC_API_KEY
// de .env, nunca se muestra) y el proveedor de SMS de prueba: los SMS salen en
// esta consola.
//
//   npm run dev
//   API_PORT=5001 DEMO_PORT=5000 npm run dev
// =============================================================================

import { existsSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Sql } from 'postgres';

import type { SmsProvider } from '../adapters/sms/types.js';
import { createApi } from '../api/app.js';
import { aRequest, enviar } from '../api/node.js';
import type { AgentSettings, ModelClient } from '../core/agent.js';
import { construirWidget } from './widget-build.js';

const DEMO_DIR = fileURLToPath(new URL('../../demo/', import.meta.url));
const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export interface OpcionesServidores {
  sql: Sql;
  model: ModelClient;
  settings: AgentSettings;
  sms: SmsProvider;
  apiPort: number;
  demoPort: number;
  /** Reloj del agente (solo los tests lo cambian). */
  now?: () => Date;
  onError?: (e: unknown) => void;
  /** Una línea por petición en la consola. */
  log?: boolean;
}

/** Escucha en el puerto en IPv4 y en IPv6 locales ("localhost" puede ser cualquiera de los dos). */
async function escuchar(crear: () => Server, port: number): Promise<Server[]> {
  const servidores: Server[] = [];
  for (const host of ['127.0.0.1', '::1']) {
    const s = crear();
    try {
      await new Promise<void>((ok, mal) => {
        s.once('error', mal);
        s.listen(port, host, () => ok());
      });
      servidores.push(s);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      // Sin IPv6 en la máquina: basta con IPv4.
      if (host === '::1' && (err.code === 'EADDRNOTAVAIL' || err.code === 'EAFNOSUPPORT')) continue;
      await Promise.all(servidores.map((x) => new Promise((ok) => x.close(ok))));
      if (err.code === 'EADDRINUSE') {
        throw new Error(`El puerto ${port} está ocupado por otro programa (${host}). Elegí otro: API_PORT=… DEMO_PORT=… npm run dev`);
      }
      throw e;
    }
  }
  return servidores;
}

export async function iniciarServidores(o: OpcionesServidores): Promise<{ apiUrl: string; demoUrl: string; cerrar: () => Promise<void> }> {
  const apiUrl = `http://localhost:${o.apiPort}`;
  const demoUrl = `http://localhost:${o.demoPort}`;
  const api = createApi({
    sql: o.sql,
    model: o.model,
    settings: o.settings,
    sms: o.sms,
    baseUrl: apiUrl,
    ...(o.now ? { now: o.now } : {}),
    ...(o.onError ? { onError: o.onError } : {}),
  });
  const log = (inicio: number, req: IncomingMessage, status: number) => {
    if (o.log) {
      // Sin la query ni el token de /cita/…: no se escriben secretos en la consola.
      const ruta = (req.url ?? '').split('?')[0]!.replace(/^\/cita\/.+$/, '/cita/…');
      console.log(`${new Date().toISOString().slice(11, 19)} ${req.method} ${ruta} → ${status} (${Date.now() - inicio} ms)`);
    }
  };

  const manejarApi = async (req: IncomingMessage, res: ServerResponse) => {
    const inicio = Date.now();
    try {
      if (req.method === 'GET' && (req.url ?? '').split('?')[0] === '/widget.js') {
        const js = await construirWidget({ minify: false });
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
        res.end(js);
        log(inicio, req, 200);
        return;
      }
      const r = await api(aRequest(req, apiUrl), { ip: req.socket.remoteAddress ?? null });
      await enviar(res, r);
      log(inicio, req, r.status);
    } catch (e) {
      o.onError?.(e);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end('{"error":"no_disponible"}');
      log(inicio, req, 500);
    }
  };

  const manejarDemo = (req: IncomingMessage, res: ServerResponse) => {
    const inicio = Date.now();
    const ruta = decodeURIComponent((req.url ?? '/').split('?')[0]!);
    const archivo = normalize(join(DEMO_DIR, ruta === '/' ? 'index.html' : ruta));
    if (!archivo.startsWith(DEMO_DIR) || !existsSync(archivo) || !TIPOS[extname(archivo)]) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('No encontrado');
      log(inicio, req, 404);
      return;
    }
    // La demo apunta al widget de este mismo arranque, aunque cambien los puertos.
    let cuerpo: string | Buffer = readFileSync(archivo);
    if (extname(archivo) === '.html') cuerpo = cuerpo.toString('utf8').replaceAll('http://localhost:4311', apiUrl);
    res.writeHead(200, { 'content-type': TIPOS[extname(archivo)]!, 'cache-control': 'no-store' });
    res.end(cuerpo);
    log(inicio, req, 200);
  };

  const servidores = await escuchar(() => createServer(manejarApi), o.apiPort);
  try {
    servidores.push(...(await escuchar(() => createServer(manejarDemo), o.demoPort)));
  } catch (e) {
    await Promise.all(servidores.map((s) => new Promise((ok) => s.close(ok))));
    throw e;
  }
  return {
    apiUrl,
    demoUrl,
    cerrar: async () => {
      await Promise.all(
        servidores.map((s) => {
          s.closeAllConnections();
          return new Promise<void>((ok) => s.close(() => ok()));
        }),
      );
    },
  };
}

// -----------------------------------------------------------------------------
// npm run dev
// -----------------------------------------------------------------------------

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { createSql } = await import('../db/client.js');
  const { anthropicModelClient, settingsFromEnv } = await import('../core/agent.js');
  const { SmsDePrueba } = await import('../adapters/sms/prueba.js');
  if (existsSync('.env')) process.loadEnvFile('.env');
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Falta ANTHROPIC_API_KEY en .env');
    process.exit(2);
  }
  const settings = settingsFromEnv();
  const sql = createSql();
  const s = await iniciarServidores({
    sql,
    model: anthropicModelClient(settings),
    settings,
    sms: new SmsDePrueba(),
    apiPort: Number(process.env.API_PORT) || 4311,
    demoPort: Number(process.env.DEMO_PORT) || 4310,
    log: true,
    onError: (e) => console.error(`[error] ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`),
  });
  console.log(`\nDemo de Estética Aurora: ${s.demoUrl}`);
  console.log(`Servidor del widget:     ${s.apiUrl}  (modelo ${settings.model}, esfuerzo ${settings.effort})`);
  console.log('Los SMS de confirmación salen aquí (proveedor de prueba). Ctrl+C para parar.\n');
  const parar = async () => {
    await s.cerrar();
    await sql.end();
    process.exit(0);
  };
  process.on('SIGINT', parar);
  process.on('SIGTERM', parar);
}
