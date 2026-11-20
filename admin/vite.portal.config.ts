// =============================================================================
// Build del portal del cliente (Fase 9 · 9.4) — la otra entrada de admin/
// =============================================================================
// El portal es otra entrada del MISMO proyecto de React (D-81): así reutiliza
// tal cual la ficha, la agenda, los estilos y las piezas comunes del panel,
// sin duplicar ni una pantalla (PC-05). Solo cambian el HTML de entrada, la
// base (/portal/ en vez de /panel/) y la carpeta de salida.
//
// Se sirve bajo /portal/ desde el mismo origen que la API (/api/portal/…): en
// local lo sirve `npm run dev` (src/dev/server.ts) y en Vercel van como
// estáticos del mismo proyecto (src/vercel/build.ts). Sin CORS ni proxy.
// =============================================================================

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: import.meta.dirname,
  base: '/portal/',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist-portal',
    emptyOutDir: true,
    rollupOptions: { input: 'portal.html' },
  },
  logLevel: 'warn',
});
