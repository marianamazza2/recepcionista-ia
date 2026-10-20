// Empaqueta widget/src/widget.ts en UN solo archivo (widget.js) con esbuild
// (Fase 3 · 3.4). Lo usan el servidor local (en memoria, en cada petición, así
// un cambio se ve al recargar) y `npm run build:widget` (a widget/dist/).

import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

export const ENTRADA_WIDGET = fileURLToPath(new URL('../../widget/src/widget.ts', import.meta.url));

export async function construirWidget(opts: { minify?: boolean } = {}): Promise<string> {
  const r = await build({
    entryPoints: [ENTRADA_WIDGET],
    bundle: true,
    format: 'iife',
    target: ['es2020'],
    minify: opts.minify ?? true,
    legalComments: 'none',
    write: false,
  });
  return r.outputFiles[0]!.text;
}
