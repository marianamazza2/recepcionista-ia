// =============================================================================
// Arma la publicación de Vercel (Fase 3 · PW-08) — npm run build:vercel
// =============================================================================
// Escribe .vercel/output con la Build Output API v3 de Vercel (sin framework):
//
//   static/index.html, privacidad.html   la web de la demo, apuntando a PUBLIC_API_URL
//   static/widget.js                     el widget minificado
//   static/panel/                        el panel interno (Fase 4, PI-02), compilado con Vite
//   functions/api.func/                  src/vercel/handler.ts en un solo archivo
//   config.json                          rutas: /api/… y /cita/… → la función
//
// La demo y el servidor del widget van en el mismo proyecto, pero se abren con
// dos dominios distintos (como en la realidad): la web por el dominio de la
// demo y el widget por PUBLIC_API_URL. Así el navegador manda la cabecera
// Origin y la comprobación de dominio (PW-06) funciona igual que con un
// negocio real. Desde el dominio del servidor, la demo se ve sin widget.
//
// El panel va en el mismo proyecto (PI-02) bajo /panel/ y habla con /api/admin
// del mismo dominio. Con PANEL_HOST (el dominio propio del panel, p. ej.
// recepcionista-ia-panel.vercel.app), la raíz de ese dominio lleva a /panel/.
//
// Región fra1 (Frankfurt): la misma que la base de Supabase.
// =============================================================================

import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

import { construirPanel } from '../dev/panel-build.js';
import { construirWidget } from '../dev/widget-build.js';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));

/** maxDuration: un turno puede tardar ~3 × 60 s (D-48) y un mensaje espera hasta 200 s al anterior (LIMITES_WIDGET). 300 s es el máximo del plan Hobby. */
export const DURACION_MAXIMA_S = 300;

/** CSP del panel: solo lo suyo; el logo llega como data URL (PI-10) y React pone estilos en línea. */
export const CSP_PANEL =
  "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

export async function construirVercel(o: { apiUrl: string; outDir?: string; panelHost?: string }): Promise<string> {
  const apiUrl = new URL(o.apiUrl).origin; // valida y quita la barra final
  const out = o.outDir ?? join(RAIZ, '.vercel/output');
  rmSync(out, { recursive: true, force: true });

  // --- La web de la demo y el widget ------------------------------------------
  const estaticos = join(out, 'static');
  mkdirSync(estaticos, { recursive: true });
  const index = readFileSync(join(RAIZ, 'demo/index.html'), 'utf8');
  if (!index.includes('http://localhost:4311/widget.js')) throw new Error('demo/index.html ya no carga http://localhost:4311/widget.js');
  writeFileSync(join(estaticos, 'index.html'), index.replaceAll('http://localhost:4311', apiUrl));
  copyFileSync(join(RAIZ, 'demo/privacidad.html'), join(estaticos, 'privacidad.html'));
  writeFileSync(join(estaticos, 'widget.js'), await construirWidget({ minify: true }));
  await construirPanel({ outDir: join(estaticos, 'panel') });

  // --- La función ----------------------------------------------------------------
  const func = join(out, 'functions/api.func');
  mkdirSync(func, { recursive: true });
  await build({
    entryPoints: [join(RAIZ, 'src/vercel/handler.ts')],
    outfile: join(func, 'index.cjs'),
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    // El launcher de Node de Vercel llama a module.exports(req, res).
    footer: { js: 'module.exports = module.exports.default;' },
    legalComments: 'none',
    logLevel: 'warning',
  });
  writeFileSync(
    join(func, '.vc-config.json'),
    JSON.stringify(
      {
        runtime: 'nodejs22.x',
        handler: 'index.cjs',
        launcherType: 'Nodejs',
        shouldAddHelpers: false,
        maxDuration: DURACION_MAXIMA_S,
        regions: ['fra1'],
      },
      null,
      2,
    ),
  );

  // --- Rutas -------------------------------------------------------------------------
  writeFileSync(
    join(out, 'config.json'),
    JSON.stringify(
      {
        version: 3,
        routes: [
          // widget.js se carga desde cualquier web (lo que protege es PW-06 en la API).
          { src: '^/widget\\.js$', headers: { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=300' }, continue: true },
          ...(o.panelHost ? [{ src: '^/$', has: [{ type: 'host', value: o.panelHost }], status: 302, headers: { location: '/panel/' } }] : []),
          { src: '^/panel$', status: 308, headers: { location: '/panel/' } },
          {
            src: '^/panel/.*$',
            headers: { 'content-security-policy': CSP_PANEL, 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex' },
            continue: true,
          },
          { handle: 'filesystem' },
          { src: '^/(api|cita)/.*$', dest: '/api' },
        ],
      },
      null,
      2,
    ),
  );
  return out;
}

// npm run build:vercel (Vercel lo corre al publicar; PUBLIC_API_URL sale de las variables del proyecto)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const apiUrl = process.env.PUBLIC_API_URL?.trim();
  if (!apiUrl) {
    console.error('Falta PUBLIC_API_URL (la URL pública del servidor del widget, p. ej. https://recepcionista-api.vercel.app)');
    process.exit(2);
  }
  const panelHost = process.env.PANEL_HOST?.trim() || undefined;
  const out = await construirVercel({ apiUrl, ...(panelHost ? { panelHost } : {}) });
  console.log(`Publicación de Vercel lista en ${out} (widget en ${new URL(apiUrl).origin})`);
}
