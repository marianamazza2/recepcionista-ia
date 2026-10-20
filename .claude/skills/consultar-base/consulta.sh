#!/usr/bin/env bash
# Ejecuta una consulta de consultas.sql (solo lectura).
#   consulta.sh <nombre> [var=valor …]          contra DATABASE_URL de .env
#   NUBE=1 consulta.sh <nombre> [var=valor …]   contra Supabase (con-supabase.sh)
# Ejemplo: consulta.sh conversacion conv=630282a3-…
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$DIR/../../.." && pwd)"
NOMBRE="${1:?Uso: consulta.sh <nombre> [var=valor …]}"; shift
SQL="$(awk -v n="-- @$NOMBRE " 'index($0,n)==1{p=1;next} /^-- @/{p=0} p' "$DIR/consultas.sql")"
[ -n "$SQL" ] || { echo "No existe la consulta '$NOMBRE'. Hay: $(grep -o '^-- @[a-z_]*' "$DIR/consultas.sql" | sed 's/-- @//' | tr '\n' ' ')" >&2; exit 1; }
VARS=(-v negocio=estetica-aurora)
for a in "$@"; do VARS+=(-v "$a"); done
# psql solo sustituye :variables leyendo de un archivo o de stdin, no con -c.
# Solo lectura: la sesión no puede escribir aunque la consulta lo intentara.
SQL="set default_transaction_read_only = on;
$SQL"
if [ "${NUBE:-}" = "1" ]; then
  printf "%s\n" "$SQL" | "$RAIZ/scripts/con-supabase.sh" psql -X -q -v ON_ERROR_STOP=1 "${VARS[@]}" -f -
  exit $?
fi
URL="${DATABASE_URL:-$(sed -n 's/^DATABASE_URL=//p' "$RAIZ/.env" | tail -n 1)}"
printf "%s\n" "$SQL" | exec psql "$URL" -X -q -v ON_ERROR_STOP=1 "${VARS[@]}" -f -
