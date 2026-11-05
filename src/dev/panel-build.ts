// Compila el panel interno (admin/, React + Vite + Tailwind; Fase 4 · 4.3) en
// estáticos bajo /panel/. Lo usan `npm run dev` (a admin/dist, y vuelve a
// compilar al cambiar un archivo) y `npm run build:vercel` (a la carpeta de la
// publicación). Vite es dependencia de desarrollo: el panel publicado son
// archivos estáticos.

import { fileURLToPath } from 'node:url';

import { build, type Rollup } from 'vite';

export const RAIZ_PANEL = fileURLToPath(new URL('../../admin/', import.meta.url));

export async function construirPanel(o: { outDir?: string; watch?: boolean } = {}): Promise<Rollup.RollupWatcher | void> {
  const r = await build({
    configFile: `${RAIZ_PANEL}vite.config.ts`,
    build: { ...(o.outDir ? { outDir: o.outDir } : {}), ...(o.watch ? { watch: {} } : {}) },
  });
  if (o.watch) return r as Rollup.RollupWatcher;
}
