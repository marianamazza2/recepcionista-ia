# scripts/

Scripts de shell (`bash`, `set -euo pipefail`) para lo que no es código de la
aplicación.

| Script | Qué hace |
|---|---|
| `run-sql-tests.sh` | Corre cada `supabase/tests/NN_*.sql` en su propia sesión de `psql` y resume PASA/FALLA. Es `npm run test:sql`. Con un argumento filtra: `./scripts/run-sql-tests.sh 07` |
| `con-supabase.sh` | Ejecuta un comando contra el proyecto Supabase de la nube: arma `DATABASE_URL` desde `.env` y el pooler que guardó `supabase link`. `./scripts/con-supabase.sh npm test` · `… psql -f supabase/seed.sql`. De serie, pooler en modo sesión (5432); con `SUPABASE_POOLER_MODO=transaccion`, modo transacción (6543), el de Vercel |

## Reglas

- **Nunca muestran ni escriben una contraseña** (D-38, D-40). Si hay que
  imprimir una URL de base, va con la contraseña tapada.
- Leen de `.env` **solo la línea que necesitan** (`sed -n 's/^VAR=//p'`), sin
  hacer `source`: el archivo puede tener caracteres que el shell no traga.
- Lo que ya esté en el entorno manda sobre `.env`.
- Mensajes de error que dicen cómo arreglarlo ("Falta X en .env", "corré
  supabase link…").
- Se ejecutan desde cualquier carpeta: resuelven la raíz con
  `$(dirname "${BASH_SOURCE[0]}")/..`.
- Cabecera con qué hacen y ejemplos de uso, como los existentes.

Un script nuevo → su fila en esta tabla y, si tiene alias en `package.json`,
en el `AGENTS.md` raíz.
