# Recepcionista IA

Agente conversacional multi-cliente que atiende y agenda citas. Un motor, muchas
configuraciones. Spec completo en [`_specs/`](_specs/).

> **Antes de tocar la base, leé [`DECISIONES.md`](DECISIONES.md):** por qué el
> esquema está como está y las trampas conocidas (zonas horarias, buffers,
> `service_role` y RLS).
>
> **Antes de arrancar la Fase 1, leé
> [`DECISIONES-PENDIENTES.md`](DECISIONES-PENDIENTES.md):** hay cuatro reglas de
> negocio sin decidir que bloquean el cálculo de huecos.

**Estado: Fase 0 (cimientos) terminada.** Solo base de datos: esquema, RLS,
garantía anti-solapamiento, esqueleto del RPC de reserva y seeds. Nada de
agente, canal ni frontend todavía.

---

## Qué hay en la base

```
supabase/
├── migrations/          8 migraciones, versionadas y en orden de dependencias
├── seed.sql             negocio de prueba "Estética Aurora"
└── tests/               tests SQL de aserción (81 aserciones)
scripts/
└── run-sql-tests.sh     runner de los tests
```

| Migración | Qué trae |
|---|---|
| `…120000_extensions_y_contexto` | `btree_gist`, `vector` y el esquema `app` (resolución de tenant) |
| `…120100_tenant_y_configuracion` | `businesses`, `services`, `staff`, `staff_services`, `business_hours`, `time_off` |
| `…120200_operacion` | `customers`, `appointments` y **la restricción `no_overlap`** |
| `…120300_conversacion` | `conversations`, `messages`, `escalations` |
| `…120400_conocimiento` | `knowledge_docs`, `knowledge_chunks` (vacías hasta la Fase 5) |
| `…120500_integraciones_y_consumo` | `integrations`, `usage_events` |
| `…120600_rls` | RLS y políticas de aislamiento en las 15 tablas |
| `…120700_book_appointment` | esqueleto del RPC de reserva atómica |

### Las dos garantías que ya están puestas

**1. Es imposible solapar dos citas.** No es una comprobación del código ni una
promesa del LLM: es una restricción de exclusión en Postgres.

```sql
EXCLUDE USING gist (staff_id WITH =, tstzrange(start_at, end_at) WITH &&)
WHERE (estado <> 'cancelada')
```

Aunque dos reservas lleguen en el mismo milisegundo, la segunda se rechaza con
SQLSTATE `23P01`. Las canceladas no bloquean su hueco.

**2. Ningún negocio ve datos de otro.** Dos barreras independientes:

- **FK compuestas.** Cada tabla hija declara `UNIQUE (business_id, id)`, y las
  referencias van por `(business_id, …)`. Una cita del negocio A con un
  profesional del negocio B no se puede insertar ni a propósito.
- **RLS** activo en las 15 tablas, con política por `business_id`.

El tenant del contexto lo resuelve `app.current_business_id()`: primero el GUC
`app.business_id` (lo fija el backend con `app.set_business_id()` al abrir la
transacción), y si no, el claim `business_id` del JWT. Sin ninguno de los dos
devuelve `NULL` y no se ve nada — denegar por defecto.

> **Cómo encajan las capas:** el backend del MVP corre con `service_role`, que
> tiene `BYPASSRLS`, y filtra por `business_id` en cada consulta. Esa es la
> primera barrera. RLS es la segunda: cubre todo lo que no pase por el backend.

---

## Ponerla en marcha

### Con Docker (la vía canónica)

```bash
supabase start
supabase db reset      # migraciones + seed.sql desde cero
./scripts/run-sql-tests.sh
```

### Sin Docker, contra un Postgres 17 local

`supabase db reset` necesita Docker. Si no lo tenés, el mismo resultado con el
runner de migraciones de la CLI apuntando a un Postgres cualquiera:

```bash
brew install postgresql@17 pgvector
brew services start postgresql@17
createdb recepcionista_dev

URL="postgresql://postgres@127.0.0.1:5432/recepcionista_dev"

supabase db push --db-url "$URL?sslmode=disable" --include-all
psql "$URL" -f supabase/seed.sql
DATABASE_URL="$URL" ./scripts/run-sql-tests.sh
```

Requiere las extensiones `btree_gist` (viene con Postgres) y `vector`
(`brew install pgvector`).

---

## Los tests

Cada archivo de `supabase/tests/` corre en su propia transacción y termina en
`ROLLBACK`: monta sus fixtures, comprueba y no deja rastro. El único que mira
datos reales es `06_seeds.sql`.

```bash
./scripts/run-sql-tests.sh          # todos
./scripts/run-sql-tests.sh 02       # solo el de anti-solapamiento
```

| Archivo | Cubre |
|---|---|
| `01_esquema.sql` | Extensiones, las 15 tablas, tipos, índices, la restricción y el RPC |
| `02_anti_solapamiento.sql` | Solapes por delante, por detrás, contenidos, englobantes, exactos; citas pegadas; profesionales distintos; canceladas |
| `03_unicidad_cliente.sql` | `UNIQUE (business_id, telefono)` e integridad entre tenants |
| `04_rls_aislamiento.sql` | Cobertura de RLS tabla por tabla + aislamiento real con un rol sin privilegios |
| `05_book_appointment.sql` | El RPC: camino feliz, hueco ocupado y validaciones de pertenencia |
| `06_seeds.sql` | Que Estética Aurora esté cargada y sea coherente |

La aserción de cobertura de `04` es la que importa a futuro: **falla si alguien
crea una tabla nueva y se olvida de activarle RLS o de darle política.**

---

## El negocio de prueba

**Estética Aurora** (`Europe/Madrid`), con UUID fijos y legibles para poder
referirse a ellos desde los tests y las pruebas manuales:

| | |
|---|---|
| Servicios | Limpieza facial (60 min), láser (30), corporal (90), valoración (20) |
| Profesionales | Marta (facial, corporal, valoración) y Lucía (facial, láser, valoración) |
| Horario | L-M-X partido 9–14 / 16–20 · J 10–14 / 16–21 · V continuo 9–15 |
| Bloqueos | Festivo del miércoles 21/10, vacaciones de Lucía, formación de Marta |
| Citas | Dos el lunes 19/10 a las 10:00 (profesionales distintos) + una cancelada |

Marta no hace láser y Lucía no hace corporal a propósito: obliga al agente a
elegir profesional según el servicio en vez de al azar.

---

## Qué NO está hecho (y en qué fase va)

| Pendiente | Fase |
|---|---|
| Cálculo de huecos libres: horarios, festivos, buffers, multi-profesional | 1 |
| `SupabaseAdapter` y el `book_appointment` completo | 1 |
| Núcleo del agente, tools, guardrails | 2 |
| Widget web y endpoint de chat | 3 |
| Ingesta de conocimiento y embeddings | 5 |

El RPC `book_appointment` de la Fase 0 es **un esqueleto**: valida pertenencia
al negocio, calcula `end_at` desde `duracion_min` e inserta de forma atómica.
No sabe de horarios, festivos ni buffers — eso llega en la Fase 1.
