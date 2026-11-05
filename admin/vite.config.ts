// =============================================================================
// Build del panel interno (Fase 4 · 4.3) — React + Vite + Tailwind (maestro §4)
// =============================================================================
// Se sirve bajo /panel/ desde el mismo origen que la API (/api/admin/…): en
// local lo sirve `npm run dev` (src/dev/server.ts) y en Vercel van como
// estáticos del mismo proyecto (src/vercel/build.ts). Sin CORS ni proxy.
// =============================================================================

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: import.meta.dirname,
  base: '/panel/',
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', emptyOutDir: true },
  logLevel: 'warn',
});
