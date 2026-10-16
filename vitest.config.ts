import { existsSync } from 'node:fs';

import { defineConfig } from 'vitest/config';

// DATABASE_URL puede venir del entorno (p. ej. para apuntar a Supabase) o de
// .env. Lo que ya esté en el entorno manda.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Los archivos de test escriben en la misma base: en serie, para que los
    // conteos de uno no vean las filas del otro.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
