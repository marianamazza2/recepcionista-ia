---
name: migracion-nueva
description: Crea y aplica un cambio en la base de datos del Recepcionista IA — una migración nueva con su cabecera, RLS y test SQL, aplicada al Postgres local sin Docker. Usala siempre que haya que cambiar el esquema o las funciones de la base, aunque Mariana lo diga en lenguaje de producto: "agregá un campo para…", "que cada negocio pueda configurar…", "guardá también…", "una tabla nueva para…", "cambiá cómo se calcula la disponibilidad", un ajuste por negocio nuevo o un código de error nuevo del motor.
---

# Migración nueva

Antes de empezar, leé [`supabase/AGENTS.md`](../../../supabase/AGENTS.md): las
reglas completas están ahí. Esta skill es el procedimiento.

## 0. ¿Es una decisión de producto?

Si el cambio nace de una regla de negocio nueva (un ajuste por negocio, un
comportamiento nuevo) y no está en `_specs/decisiones-producto.md`, **pará**:
se anota como ⚠️ por confirmar y se le pregunta a Mariana antes de migrar.

## 1. Nombre

```bash
ls supabase/migrations | tail -3
ls supabase/tests | tail -3
```

- Migración: `YYYYMMDDHHMMSS_descripcion_en_snake_case.sql`, con timestamp
  **posterior al último**. Dentro de la misma tanda, de 100 en 100
  (`…130000` → `…130100`). Para una tanda nueva, la fecha de hoy.
- **Nunca se edita una migración existente**, aunque sea "solo un
  comentario": siempre una nueva.

## 2. Esqueleto

```sql
-- =============================================================================
-- Fase N · N.M — <Qué trae, en una línea>
-- =============================================================================
-- <Por qué existe: la regla que implementa (PR-…, PW-…) y qué decide.>
--
--   · <cambio 1>
--   · <cambio 2>
--
-- No se toca ninguna migración anterior.
-- =============================================================================

set search_path = public;

-- -----------------------------------------------------------------------------
-- <tabla o función>
-- -----------------------------------------------------------------------------
create table public.<tabla> (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  -- …
  created_at  timestamptz not null default now()
  -- FK a otra tabla de negocio: compuesta (business_id, …) (D-02)
);

comment on table public.<tabla> is '<regla y por qué>';

-- -----------------------------------------------------------------------------
-- RLS en lo nuevo (maestro §3.3), igual que en …120600_rls.sql
-- -----------------------------------------------------------------------------
do $do$
declare
  v_tabla text;
begin
  foreach v_tabla in array array['<tabla>'] loop
    execute format('alter table public.%I enable row level security', v_tabla);
    execute format(
      'create policy tenant_isolation on public.%I
         for all
         using      (business_id = app.current_business_id())
         with check (business_id = app.current_business_id())',
      v_tabla
    );
    execute format(
      'comment on policy tenant_isolation on public.%I is %L',
      v_tabla,
      'Aislamiento por tenant. El backend (service_role) hace BYPASSRLS; esta política cubre el resto de accesos.'
    );
  end loop;
end
$do$;
```

Según el caso:

- **Ajuste por negocio:** `alter table public.businesses add column … not null
  default <valor de serie de decisiones-producto.md>` con su `comment on column`.
- **Valor nuevo en un enum:** en su **propia** migración (T-04).
- **Extensión** (`gist_uuid_ops`, `vector`): `set search_path = public,
  extensions;` solo para esa parte y volver a `public` (T-05).
- **Funciones del motor:** `create or replace`, `SECURITY INVOKER`, misma
  firma si se puede (D-32). Lo que decide si un hueco vale va en
  `app.slot_es_valido` (D-26), nunca duplicado.
- **Código de error nuevo:** el siguiente `RA0NN` libre (lo dice
  `supabase/AGENTS.md`), con `hint`. Después, la clase en
  `src/adapters/booking/errors.ts` (ver `src/adapters/AGENTS.md`).

## 3. Test SQL

`supabase/tests/NN_nombre.sql` con el siguiente número libre (o ampliar el
test de la misma fase si ya existe):

```sql
-- =============================================================================
-- Test NN — <qué cubre> (spec de fase N.M)
-- =============================================================================
-- <Qué se comprueba y con qué fixtures. Fechas fijas de 2030.>
-- =============================================================================

\set ON_ERROR_STOP on

begin;
\ir _helpers.sql

\echo 'NN — <nombre>'

-- --- Fixture -----------------------------------------------------------------
insert into public.businesses (id, nombre, slug, timezone) values
  ('NNNNNNNN-NNNN-4NNN-8NNN-000000000001', 'Test <nombre>', 'test-<nombre>', 'Europe/Madrid');

-- --- Aserciones --------------------------------------------------------------
select test.ok(<condición>, '<qué tiene que pasar>');
select test.throws($q$<sql>$q$, '<SQLSTATE>', '<qué se rechaza>');
select test.succeeds($q$<sql>$q$, '<qué se acepta>');

select test.resumen();
rollback;
```

- UUID con un patrón propio del archivo, para no chocar con otros tests.
- Todo `count(*)` filtra por el `business_id` del fixture (el seed está
  cargado, D-22).
- RLS: bajar a un rol sin privilegios con `set local role` (D-23).

## 4. Aplicar en local (sin Docker)

```bash
URL="$(sed -n 's/^DATABASE_URL=//p' .env | tail -n 1)"
supabase db push --db-url "$URL?sslmode=disable" --include-all
```

Los avisos de "failed to connect to the docker API" se ignoran; tiene que
terminar con `Finished supabase db push.` Si la migración falla a mitad, se
deshace sola (va en una transacción): corregí el archivo y repetí.

Si cambió el seed: `psql "$URL" -f supabase/seed.sql` y actualizá
`supabase/tests/06_seeds.sql`.

## 5. El código y la documentación

- Lectura y escritura desde TypeScript en `src/db/` (con `inTenant` y filtro
  por `business_id`); los ajustes por negocio entran en
  `src/config/business.ts`.
- `README.md` raíz: fila en la tabla de migraciones, en la de tests SQL y, si
  aplica, en la de errores y la cuenta de tablas.
- `supabase/AGENTS.md`: el "siguiente RA libre", si usaste uno.
- Ajuste por negocio nuevo → el cuestionario de alta de Research Desk (skill
  `sync-research-desk`).

## 6. Verificar

Terminá con la skill `verificar`. **No empujes a la nube** (`supabase db
push` sin `--db-url`) sin preguntarle a Mariana: es la base compartida.
