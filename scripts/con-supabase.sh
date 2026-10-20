#!/usr/bin/env bash
# =============================================================================
# Corre un comando contra el proyecto Supabase en la nube (PD-06)
# =============================================================================
# Arma DATABASE_URL con los datos de .env (SUPABASE_PROJECT_REF y
# SUPABASE_DB_PASSWORD) y el host del pooler que guardó `supabase link`, y
# ejecuta el comando que se le pase con esa variable puesta. La contraseña no
# se escribe en ningún archivo ni se muestra.
#
# Uso:
#   ./scripts/con-supabase.sh npm test
#   ./scripts/con-supabase.sh npm run test:sql
#   ./scripts/con-supabase.sh psql -f supabase/seed.sql
#   SUPABASE_POOLER_MODO=transaccion ./scripts/con-supabase.sh npm test
#
# De serie usa el pooler en modo sesión (5432). Con
# SUPABASE_POOLER_MODO=transaccion usa el modo transacción (6543), el que
# usarían las funciones de Vercel (Fase 3): sirve para comprobar que los locks
# de transacción y el resto funcionan igual ahí.
#
# Requiere haber hecho `supabase link --project-ref <ref>` una vez.
# =============================================================================
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

leer_env() {
  sed -n "s/^$1=//p" "$RAIZ/.env" | tail -n 1
}

[ -f "$RAIZ/.env" ] || { echo "Falta .env (ver .env.example)" >&2; exit 1; }

REF="$(leer_env SUPABASE_PROJECT_REF)"
PW="$(leer_env SUPABASE_DB_PASSWORD)"
[ -n "$REF" ] || { echo "Falta SUPABASE_PROJECT_REF en .env" >&2; exit 1; }
[ -n "$PW" ]  || { echo "Falta SUPABASE_DB_PASSWORD en .env" >&2; exit 1; }

POOLER_FILE="$RAIZ/supabase/.temp/pooler-url"
[ -f "$POOLER_FILE" ] || { echo "Falta $POOLER_FILE: corré 'supabase link --project-ref $REF'" >&2; exit 1; }

# Pooler en modo sesión (puerto 5432): IPv4, y admite transacciones y
# advisory locks igual que una conexión directa.
HOST_Y_RESTO="$(sed -E 's#^postgres(ql)?://[^@]*@##' "$POOLER_FILE")"
MODO="sesión"
if [ "${SUPABASE_POOLER_MODO:-}" = "transaccion" ]; then
  HOST_Y_RESTO="$(printf '%s' "$HOST_Y_RESTO" | sed -E 's#:5432/#:6543/#')"
  MODO="transacción"
fi
PW_URL="$(PW="$PW" node -e 'process.stdout.write(encodeURIComponent(process.env.PW))')"

export DATABASE_URL="postgresql://postgres.${REF}:${PW_URL}@${HOST_Y_RESTO}?sslmode=require"
export SUPABASE_DB_PASSWORD="$PW"
export PGSSLMODE=require

echo "→ Supabase ($REF, pooler en modo $MODO)" >&2

# psql no lee DATABASE_URL: se le pasa como primer argumento.
if [ "${1:-}" = "psql" ]; then
  shift
  exec psql "$DATABASE_URL" "$@"
fi
exec "$@"
