#!/usr/bin/env bash
# =============================================================================
# Runner de los tests SQL de la Fase 0
# =============================================================================
# Cada archivo de supabase/tests/ corre en su propia sesión de psql, dentro de
# una transacción que termina en ROLLBACK. Una aserción fallida lanza una
# excepción; con ON_ERROR_STOP=1 psql aborta y devuelve un código != 0.
#
# Uso:
#   ./scripts/run-sql-tests.sh                  # contra la base local de Supabase
#   DATABASE_URL=postgres://… ./scripts/run-sql-tests.sh
#   ./scripts/run-sql-tests.sh 02               # solo los tests que empiecen por 02
# =============================================================================
set -euo pipefail

DB_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR_TESTS="$RAIZ/supabase/tests"
FILTRO="${1:-}"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql no está en el PATH. Instalalo con: brew install postgresql@17" >&2
  exit 127
fi

if ! psql "$DB_URL" -Atc 'select 1' >/dev/null 2>&1; then
  echo "No se puede conectar a $DB_URL" >&2
  echo "¿Está levantada la base? Probá: supabase start" >&2
  exit 1
fi

echo "Base: $DB_URL"
echo

fallos=0
total=0

for archivo in "$DIR_TESTS"/${FILTRO}[0-9]*.sql; do
  [ -e "$archivo" ] || continue
  nombre="$(basename "$archivo")"
  total=$((total + 1))

  # cd al directorio de tests para que \ir _helpers.sql resuelva siempre igual.
  if salida="$(cd "$DIR_TESTS" && psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$nombre" 2>&1)"; then
    echo "PASA  $nombre"
    # Las aserciones salen como NOTICE, que psql prefija con "archivo:línea:".
    echo "$salida" | sed -n 's/^psql:[^ ]*: NOTICE:  //p' | sed 's/^/      /'
  else
    echo "FALLA $nombre"
    echo "$salida" | sed 's/^/      /'
    fallos=$((fallos + 1))
  fi
  echo
done

if [ "$total" -eq 0 ]; then
  echo "No se encontró ningún test en $DIR_TESTS" >&2
  exit 1
fi

if [ "$fallos" -gt 0 ]; then
  echo "RESULTADO: $fallos de $total archivos con fallos"
  exit 1
fi

echo "RESULTADO: $total/$total archivos OK"
