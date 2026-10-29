// La publicación de Vercel (Fase 3 · PW-08). Sin coste de API: ninguna
// petición llega al modelo.
//
// Arma .vercel/output en una carpeta temporal y prueba la función tal como la
// ejecutaría Vercel: el archivo empaquetado, cargado con require y servido
// con un servidor HTTP de Node, contra la base de DATABASE_URL.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { construirVercel, DURACION_MAXIMA_S } from '../src/vercel/build.js';

const API = 'https://api-demo.example';
const CLAVE_AURORA = 'wk_demo_estetica_aurora_0001';
let out: string;
let servidor: Server;
let url: string;

beforeAll(async () => {
  out = await construirVercel({ apiUrl: `${API}/`, outDir: join(mkdtempSync(join(tmpdir(), 'vercel-')), 'output') });
  process.env.PUBLIC_API_URL = API;
  process.env.ANTHROPIC_API_KEY ??= 'sin-uso-en-este-test';
  const handler = createRequire(import.meta.url)(join(out, 'functions/api.func/index.cjs')) as Parameters<typeof createServer>[1];
  servidor = createServer(handler);
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
  servidor?.closeAllConnections();
  await new Promise((ok) => servidor?.close(ok));
  rmSync(join(out, '..'), { recursive: true, force: true });
});

describe('lo que se publica', () => {
  it('la demo carga el widget desde PUBLIC_API_URL, y están widget.js y la privacidad', () => {
    const index = readFileSync(join(out, 'static/index.html'), 'utf8');
    expect(index).toContain(`<script src="${API}/widget.js" data-key="${CLAVE_AURORA}" async></script>`);
    expect(index).not.toContain('localhost:4311');
    expect(readFileSync(join(out, 'static/widget.js'), 'utf8').length).toBeGreaterThan(1000);
    expect(readFileSync(join(out, 'static/privacidad.html'), 'utf8')).toContain('Política de privacidad');
  });

  it('el panel (Fase 4) va en /panel/ con su CSP, y PANEL_HOST lleva su raíz al panel', async () => {
    expect(readFileSync(join(out, 'static/panel/index.html'), 'utf8')).toContain('/panel/assets/');
    const config = JSON.parse(readFileSync(join(out, 'config.json'), 'utf8')) as { routes: { src?: string; headers?: Record<string, string>; has?: unknown }[] };
    const cabeceras = config.routes.find((r) => r.src === '^/panel/.*$')!.headers!;
    expect(cabeceras['content-security-policy']).toContain("default-src 'self'");
    expect(cabeceras['x-frame-options']).toBe('DENY');
    expect(config.routes.some((r) => r.has)).toBe(false);
    const conHost = await construirVercel({ apiUrl: API, panelHost: 'panel.example', outDir: join(out, '..', 'con-host') });
    const r = (JSON.parse(readFileSync(join(conHost, 'config.json'), 'utf8')) as { routes: { has?: { value: string }[]; headers?: Record<string, string> }[] }).routes.find((x) => x.has)!;
    expect(r).toMatchObject({ has: [{ type: 'host', value: 'panel.example' }], headers: { location: '/panel/' } });
  }, 60_000);

  it('la función: Node 22, Frankfurt, 300 s; y las rutas /api y /cita van a ella', () => {
    expect(JSON.parse(readFileSync(join(out, 'functions/api.func/.vc-config.json'), 'utf8'))).toEqual({
      runtime: 'nodejs22.x',
      handler: 'index.cjs',
      launcherType: 'Nodejs',
      shouldAddHelpers: false,
      maxDuration: DURACION_MAXIMA_S,
      regions: ['fra1'],
    });
    const config = JSON.parse(readFileSync(join(out, 'config.json'), 'utf8')) as { version: number; routes: { src?: string; dest?: string }[] };
    expect(config.version).toBe(3);
    const aLaFuncion = config.routes.find((r) => r.dest === '/api')!;
    const re = new RegExp(aLaFuncion.src!);
    for (const p of ['/api/chat', '/api/widget/config', '/api/chat/historial', '/cita/abc']) expect(re.test(p)).toBe(true);
    for (const p of ['/', '/index.html', '/widget.js', '/apis']) expect(re.test(p)).toBe(false);
  });
});

describe('la función empaquetada', () => {
  it('da la configuración del widget al dominio del negocio, y a otro no (PW-06)', async () => {
    const ok = await fetch(`${url}/api/widget/config?key=${CLAVE_AURORA}`, { headers: { origin: 'http://localhost:4310' } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:4310');
    expect(((await ok.json()) as { nombre: string }).nombre).toBe('Estética Aurora');

    const ajeno = await fetch(`${url}/api/widget/config?key=${CLAVE_AURORA}`, { headers: { origin: 'https://otra-web.example' } });
    expect(ajeno.status).toBe(403);
  });

  it('un enlace de cita inventado da 404, y una ruta desconocida también', async () => {
    expect((await fetch(`${url}/cita/${'a'.repeat(22)}`)).status).toBe(404);
    expect((await fetch(`${url}/api/no-existe`)).status).toBe(404);
  });

  it('la API del panel está en la función y sin cuenta responde 401 (o 503 si no hay cuentas configuradas)', async () => {
    const r = await fetch(`${url}/api/admin/negocios`);
    expect([401, 503]).toContain(r.status);
  });
});
