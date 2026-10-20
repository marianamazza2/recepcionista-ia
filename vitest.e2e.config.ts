import { existsSync } from 'node:fs';

import { defineConfig } from 'vitest/config';

// La prueba de punta a punta con el navegador (Fase 3 · 3.7): aparte de
// `npm test` porque necesita Google Chrome instalado. `npm run test:e2e`.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.e2e.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
