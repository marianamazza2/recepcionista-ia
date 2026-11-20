// Compila el panel interno (admin/, React + Vite + Tailwind; Fase 4 · 4.3) en
// estáticos bajo /panel/ y, desde la Fase 9, el portal del cliente bajo
// /portal/: es otra entrada del MISMO proyecto de React (D-81), así que
// comparte las pantallas y los estilos y solo cambia el HTML de entrada y la
// base. Los usan `npm run dev` (a admin/dist y admin/dist-portal, y vuelven a
// compilar al cambiar un archivo) y `npm run build:vercel` (a la carpeta de la
// publicación). Vite es dependencia de desarrollo: lo publicado son archivos
// estáticos.

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

/** Fase 9: el portal del cliente (la otra entrada de admin/), bajo /portal/. */
export async function construirPortal(o: { outDir?: string; watch?: boolean } = {}): Promise<Rollup.RollupWatcher | void> {
  const r = await build({
    configFile: `${RAIZ_PANEL}vite.portal.config.ts`,
    build: { ...(o.outDir ? { outDir: o.outDir } : {}), ...(o.watch ? { watch: {} } : {}) },
  });
  if (o.watch) return r as Rollup.RollupWatcher;
}
