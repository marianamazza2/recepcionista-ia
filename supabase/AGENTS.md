# supabase/ — la base de datos

Postgres 17 (el de Supabase), con `btree_gist` y `vector`. Aquí viven las dos
garantías que no dependen del código: **no se solapan citas** y **ningún
negocio ve datos de otro**. El detalle de cada migración y test está en el
`README.md` raíz.

```
supabase/
├── config.toml     config de la CLI (el seed se carga en db reset)
├── migrations/     YYYYMMDDHHMMSS_nombre_en_español.sql, en orden de dependencias
├── seed.sql        Estética Aurora, el negocio de prueba
└── tests/          NN_nombre.sql + _helpers.sql (SQL de aserción, no pgTAP)
```

## Migraciones

1. **Nunca se edita una migración ya aplicada.** Todo cambio es una migración
   nueva (aunque sea `create or replace function` de algo que ya existe).
2. **Nombre:** `YYYYMMDDHHMMSS_descripcion_en_snake_case.sql`, con timestamp
   posterior al último. Las de una misma fase comparten prefijo y avanzan de
   100 en 100 (`…120000`, `…120100`).
3. **Cabecera obligatoria** `-- ====`: fase y tarea, qué trae, qué regla
   implementa (PR-08, PW-07…) y por qué. Es la documentación del esquema.
4. **`set search_path = public;`** al empezar. Si usa una extensión
   (`gist_uuid_ops`, `vector`), `set search_path = public, extensions;` solo
   para esa parte (D-01, T-05).
5. **Multi-tenant siempre:**
   - toda tabla nueva lleva `business_id uuid not null references
     businesses(id) on delete cascade` y, si otra tabla la va a referenciar,
     `UNIQUE (business_id, id)`;
   - las FK van compuestas por `(business_id, …)` (D-02), así es imposible
     cruzar datos de dos negocios aunque sea a propósito;
   - **RLS + política `tenant_isolation`** en la misma migración, con el bucle
     de `…130000_widget_web.sql`. `tests/04` falla si una tabla queda sin RLS
     o sin política.
   - La única tabla que no es de un negocio, `panel.personas` (Fase 4, PI-01),
     vive en su propio esquema `panel` (no expuesto por PostgREST), con RLS y
     **sin** política. Lo que no sea de un negocio va ahí, nunca en `public`.
6. **`comment on`** en tablas, columnas no obvias, restricciones y funciones.
7. **Enums:** valores nuevos en su propia migración (T-04).
8. **Ajustes por negocio** = columnas en `businesses` con su valor de serie
   (el de `decisiones-producto.md`), nunca constantes en el código.
9. **Funciones del motor** (`book_appointment`, `available_slots`…):
   `SECURITY INVOKER`, no declaran el tenant (lo hace quien llama, D-17).
   Todo lo que decide si un hueco es válido pasa por `app.slot_es_valido`
   (D-26): nunca se duplica esa lógica. Desde la Fase 4 tiene un quinto
   argumento, `p_manual` (PR-04, PI-14: sin rejilla ni antelación), igual que
   `book_appointment`. Al añadir un argumento con valor de serie a una
   función, se **borra** la firma anterior en la misma migración: si no, las
   dos casan con las llamadas de siempre y Postgres no sabe cuál usar.
10. **Errores propios con SQLSTATE `RA0NN`** (el siguiente libre: hoy
    **RA009**), con `hint`/mensaje legible. Cada código nuevo se traduce:
    los del motor de reservas en `src/adapters/booking/errors.ts` (ver
    [`src/adapters/AGENTS.md`](../src/adapters/AGENTS.md)); los del panel
    (RA007 preguntas frecuentes, RA008 activar incompleto) en
    `src/api/admin/errores.ts`.
11. **Horas:** `timestamptz` en UTC para instantes; horarios en hora local
    del negocio (D-09) y se cruzan con `AT TIME ZONE b.timezone`, nunca con
    offsets a mano (T-01).

## Seed

- Solo **Estética Aurora**, con UUID fijos y legibles (`a0…` negocio, `b0…`
  servicios, `c0…` profesionales, `d0…` clientas, `e0…` citas; D-25).
- Re-ejecutable: empieza con un `DELETE` del negocio que arrastra todo.
- Asimétrico a propósito (Marta no hace láser, Lucía no hace corporal…): no
  lo "simplifiques".
- Si cambia, `tests/06_seeds.sql` se actualiza en el mismo cambio, y hay que
  recargarlo en local y en la nube (`psql -f supabase/seed.sql`).

## Tests SQL (`tests/`)

- Archivos `NN_nombre.sql` (no `*.test.sql`: ese sufijo lo agarra
  `supabase test db`, que espera pgTAP; D-21). El siguiente número libre es
  el posterior al último.
- Cada archivo: cabecera, `\set ON_ERROR_STOP on`, `begin;`,
  `\ir _helpers.sql`, sus fixtures, aserciones, `select test.resumen();` y
  **`rollback;`**. No deja rastro.
- Aserciones: `test.ok(cond, 'etiqueta')`,
  `test.throws($$sql$$, 'SQLSTATE', 'etiqueta')`,
  `test.succeeds($$sql$$, 'etiqueta')`.
- Fixtures propios con UUID con patrón propio del archivo (`88888888-…` en el
  08) y **fechas fijas de 2030**. La antelación mínima se mide contra `now()`.
- **Todo conteo filtra por el `business_id` del fixture**: la base tiene el
  seed cargado (D-22).
- Para probar RLS hay que bajar a un rol sin privilegios (`SET LOCAL ROLE`):
  como `postgres`/`service_role` todo pasa (D-23).
- Lo que necesita dos conexiones (concurrencia) va en `tests/*.test.ts`, no
  aquí.

## Cómo se aplica (sin Docker)

```bash
URL="postgresql://<usuario>@127.0.0.1:5432/recepcionista_dev"
supabase db push --db-url "$URL?sslmode=disable" --include-all
psql "$URL" -f supabase/seed.sql
npm run test:sql
```

En la nube: `supabase db push` (con el proyecto enlazado) y
`./scripts/con-supabase.sh npm run test:sql`. Los avisos de "failed to connect
to the docker API" de `db push` se pueden ignorar.

## Si cambiás algo de acá

**Obligatorio:** si tu cambio toca la arquitectura, una regla de negocio o la
forma de trabajo de esta carpeta, actualizá este `AGENTS.md` (y el raíz si
aplica) en el mismo cambio. Ver §8 del [`AGENTS.md` raíz](../AGENTS.md#8-mantener-esta-documentación).

- Migración nueva → su fila en la tabla de migraciones del `README.md` raíz.
- Test SQL nuevo → su fila en la tabla de tests SQL del `README.md` raíz.
- Código de error nuevo → la tabla de errores del `README.md` raíz y el
  "siguiente libre" de este archivo.
- Tabla nueva → que exista se comprueba en el test SQL de su migración (como
  `09_widget.sql`); `01_esquema.sql` solo comprueba las 15 de la Fase 0.
  Actualizá la cuenta de tablas del `README.md` raíz.
