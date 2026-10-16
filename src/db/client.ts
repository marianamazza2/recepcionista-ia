// =============================================================================
// Cliente de Postgres
// =============================================================================
// Una sola forma de abrir la conexión, para el backend y para los tests. La
// cadena sale de DATABASE_URL: el Postgres local o el de Supabase.
// =============================================================================

import postgres, { type Options, type Sql } from 'postgres';

export function createSql(
  url: string | undefined = process.env.DATABASE_URL,
  options: Options<{}> = {},
): Sql {
  if (!url) {
    throw new Error('Falta DATABASE_URL (ver .env.example)');
  }
  return postgres(url, {
    // El pooler de Supabase en modo transacción no admite sentencias
    // preparadas con nombre; sin ellas funciona igual en todos los modos.
    prepare: false,
    // Los NOTICE de Postgres no le interesan a la aplicación.
    onnotice: () => {},
    ...options,
  });
}
