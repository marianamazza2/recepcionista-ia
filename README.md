# Recepcionista IA

Agente conversacional multi-cliente que atiende y agenda citas. Un motor, muchas
configuraciones. Spec completo en [`_specs/`](_specs/).

> **Reglas de negocio:** [`_specs/decisiones-producto.md`](_specs/decisiones-producto.md)
> — cómo se calculan los huecos, márgenes, antelación, quién atiende, qué pasa al
> cancelar o mover una cita. Todas decididas el 16/10/2026.
>
> **Decisiones técnicas:** `docs/DECISIONES.md` (local, no se sube): por qué el
> esquema está como está y las trampas conocidas (zonas horarias, buffers,
> `service_role` y RLS).

**Estado: Fase 2 (núcleo del agente) terminada.** Encima del motor de reservas
de la Fase 1 ya hay **quien conversa**: un agente que entiende lo que pide una
clienta, usa el motor a través de herramientas (tool use contra la API de
Claude) y responde en el tono del negocio, aplicando las reglas de
`decisiones-producto.md`. Se prueba por la Terminal (`npm run chat`); el widget
web es la Fase 3.

---

## Qué hay en la base

```
supabase/
├── migrations/          15 migraciones, versionadas y en orden de dependencias
├── seed.sql             negocio de prueba "Estética Aurora"
└── tests/               tests SQL de aserción (8 archivos, 149 aserciones)
scripts/
└── run-sql-tests.sh     runner de los tests SQL
src/
├── adapters/booking/
│   ├── types.ts         la interfaz BookingAdapter (maestro §7)
│   ├── supabase.ts      SupabaseAdapter: conexión directa a Postgres
│   └── errors.ts        errores tipados (SlotTakenError, OutsideHoursError…)
├── config/business.ts   lo que el agente sabe de un negocio, leído de la base
├── core/                EL NÚCLEO (Fase 2). No se toca por cliente
│   ├── agent.ts         el loop: tool use, historial, límites, derivar
│   ├── prompt.ts        system prompt desde la configuración
│   ├── tools/           las 8 herramientas (definición strict + ejecución)
│   ├── guardrails.ts    límites del loop y respuestas fijas
│   ├── time.ts          hora local del negocio ↔ UTC (cambio de hora incluido)
│   ├── phone.ts         teléfonos a formato +34…
│   └── costes.ts        coste aproximado de las llamadas
├── db/                  cliente, tenant, clientas y conversaciones
└── cli/
    ├── chat.ts          npm run chat: conversar por la Terminal
    └── eval.ts          npm run agent:eval: los 12 escenarios con el modelo real
tests/                   tests TypeScript (motor, herramientas, prompt, loop…)
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
| `…120700_book_appointment` | esqueleto del RPC de reserva atómica (Fase 0) |
| `20261016120000_ajustes_por_negocio` | antelación, intervalo de huecos, margen al cierre y modo de asignación por negocio |
| `20261016120100_motor_disponibilidad` | `app.slot_es_valido` (la única fuente de verdad) y `available_slots` |
| `20261016120200_book_appointment_completo` | `book_appointment` completo, asignación automática, advisory lock y `ultima_profesional` |
| `20261016120300_ultima_profesional_pasada` | PR-06: `ultima_profesional` solo cuenta citas ya pasadas y atendidas |
| `20261016120400_cancelacion_por_negocio` | PR-07: modo de cancelación (solo informar / bloquear) y plazo en horas, por negocio |
| `20261016120500_cliente_sin_solape` | PR-08: una clienta no puede tener dos citas que se pisen (`no_overlap_cliente`, `RA006`) |
| `20261016120600_lock_por_clienta` | PR-08: lock por clienta en `book_appointment`, para dos reservas simultáneas de la misma clienta |

### Las dos garantías que ya están puestas

**1. Es imposible solapar dos citas.** No es una comprobación del código ni una
promesa del LLM: es una restricción de exclusión en Postgres.

```sql
EXCLUDE USING gist (staff_id WITH =, tstzrange(start_at, end_at) WITH &&)
WHERE (estado <> 'cancelada')
```

Aunque dos reservas lleguen en el mismo milisegundo, la segunda se rechaza con
SQLSTATE `23P01`. Las canceladas no bloquean su hueco.

Y lo mismo **por clienta** (PR-08): una clienta no puede tener dos citas que
se pisen (`no_overlap_cliente`, y `RA006` desde `book_appointment`).

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

### El motor de reservas (Fase 1)

**Una sola regla de "hueco válido".** `app.slot_es_valido(negocio, servicio,
profesional, inicio)` decide si un inicio es reservable y, si no, por qué. La
usan las dos caras del motor, así que nunca se ofrece un hueco que después no
deja reservar:

- `available_slots(negocio, servicio, desde, hasta, [profesional])` → los huecos
  libres, uno por profesional y hora, ordenados. Máximo 31 días por consulta.
- `book_appointment(…)` → reserva. Con `p_staff_id` NULL asigna sola a la
  profesional con menos citas ese día (PD-03).
- `ultima_profesional(negocio, clienta)` → para *"la última vez te atendió
  Marta"*: la última cita ya pasada y atendida (PR-06).

Qué comprueba, en este orden: horario (el propio de la profesional reemplaza al
del local), rejilla del intervalo, que el servicio quepa antes del cierre,
festivos y ausencias, antelación mínima, solape con otra cita y margen.

**Dos reservas a la vez.** `book_appointment` serializa por profesional con un
advisory lock, porque `no_overlap` no protege el margen. Probado con
conexiones simultáneas en `tests/concurrency.test.ts`.

### Errores

Cada rechazo tiene su código, y el adaptador lo convierte en una clase para que
el agente no tenga que conocer Postgres:

| SQLSTATE | Error TypeScript | Significa | Qué hace el agente |
|---|---|---|---|
| `23P01` | `SlotTakenError` | Hueco ocupado | Ofrecer otro hueco |
| `RA001` | `OutsideHoursError` | Fuera del horario de esa profesional o del local | Decir que no abre y ofrecer los más cercanos (PD-04) |
| `RA002` | `TimeOffError` | Festivo o ausencia | Igual que RA001 |
| `RA003` | `TooSoonError` | No respeta la antelación mínima | Explicarla y ofrecer el primer hueco válido |
| `RA004` | `BufferConflictError` | Pisa el margen de otra cita | Ofrecer otro hueco |
| `RA005` | `NoStaffAvailableError` | Asignación automática sin nadie libre | Ofrecer otros huecos |
| `RA006` | `CustomerBusyError` | La clienta ya tiene una cita que se pisa (PR-08) | Decir qué cita tiene; si quiere, mover o anular la anterior |
| `23514` | `StaffDoesNotProvideServiceError` | La profesional no hace ese servicio | Proponer otra profesional |
| `23503` | `InvalidReferenceError` | Algo no es de ese negocio o está inactivo | Error de programación: log y derivar |
| `22023` | `InvalidRangeError` | Rango de fechas inválido o de más de 31 días | Error de programación |

Además, sin código de Postgres: `BookingNotFoundError`,
`BookingNotCancellableError` y `TenantMismatchError`.

---

## El agente (Fase 2)

### Conversar por la Terminal

Hace falta `ANTHROPIC_API_KEY` en `.env` (nunca en el código ni en el chat).

```bash
npm run chat -- --negocio estetica-aurora                         # clienta nueva, sin identificar
npm run chat -- --negocio estetica-aurora --telefono +34600111222 # Ana Torres, ya identificada
npm run chat -- --negocio estetica-aurora --debug                 # ver herramientas y tokens
npm run chat -- --negocio estetica-aurora --telefono +34600111222 --nueva   # no retomar la anterior
```

Muestra la bienvenida del negocio y espera tus mensajes. `salir` o Ctrl+D para
terminar; al salir imprime los tokens y el coste aproximado. Con `--telefono`
de una clienta que existe, retoma su última conversación activa.

Para ver la cita en la base:

```bash
psql "$DATABASE_URL" -c "select c.nombre, s.nombre as profesional,
  a.start_at at time zone 'Europe/Madrid' as cuando, a.estado
  from appointments a join customers c on c.id = a.customer_id
  join staff s on s.id = a.staff_id order by a.created_at desc limit 5;"
```

### Los escenarios con el modelo real

```bash
npm run agent:eval                # los 12 escenarios (≈ 0,36 US$ con Opus 5)
npm run agent:eval -- --solo 3    # solo uno
npm run agent:eval -- --ver       # con la conversación entera
```

Cada uno imprime OK o FALLA y al final el coste total. Usan clientas de prueba
(`+34999…`) que se borran al empezar y al terminar.

### Cómo funciona por dentro

- **Solo actúa con herramientas** (`consultar_disponibilidad`, `crear_reserva`,
  `cancelar_reserva`, `reprogramar_reserva`, `buscar_reservas_cliente`,
  `identificar_cliente`, `derivar_a_humano`, `reservar_y_cambiar_cita_anterior`). Hablan en hora local del negocio;
  la conversión a UTC vive solo en `core/time.ts`.
- **Lo que no se puede saltar está en el código**, no en el prompt: solo sus
  citas (PA-08), cancelación bloqueada dentro del plazo (PR-07), nada de agenda
  tras derivar (PA-06), precios ocultos que nunca llegan al modelo, límites de
  vueltas y de tokens.
- **Cada conversación queda guardada** en `conversations` y `messages`
  (mensajes, llamadas a herramientas y tokens) y las derivaciones en
  `escalations`.
- **Modelo y esfuerzo por variable de entorno** (`AGENT_MODEL`, de serie
  `claude-opus-5`; `AGENT_EFFORT`, de serie `low`). Ver `.env.example`.

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

En esta máquina el usuario de Postgres es el de macOS, no `postgres`:
`postgresql://marianamazzariello@127.0.0.1:5432/recepcionista_dev`.

Requiere las extensiones `btree_gist` (viene con Postgres) y `vector`
(`brew install pgvector`).

---

### En el proyecto Supabase (la nube)

Cada fase se cierra verificando ahí (PD-06). El proyecto es
`recepcionista-ia-dev`. En `.env` van `SUPABASE_PROJECT_REF`,
`SUPABASE_DB_PASSWORD` y `SUPABASE_ANON_KEY` (nunca en el código).

```bash
supabase login                                   # una vez, en una terminal normal
supabase link --project-ref eksixnahjjwrpdaqcosa # una vez
SUPABASE_DB_PASSWORD=… supabase db push          # o con la variable exportada
./scripts/con-supabase.sh psql -f supabase/seed.sql
./scripts/con-supabase.sh npm run test:sql
./scripts/con-supabase.sh npm test
```

`con-supabase.sh` arma la cadena de conexión con los datos de `.env` y ejecuta
el comando contra la nube, sin escribir ni mostrar la contraseña.

---

## Los tests

Primera vez: `npm install` y copiar `.env.example` a `.env` con tu
`DATABASE_URL`. Los dos comandos la leen de ahí.

```bash
npm run test:sql                    # tests SQL (8 archivos)
./scripts/run-sql-tests.sh 07       # solo uno
npm test                            # tests TypeScript, el de concurrencia incluido
npm run typecheck                   # comprobación de tipos

# Contra otra base, sin tocar .env:
DATABASE_URL="postgresql://…" npm test
```

### Tests SQL

Cada archivo de `supabase/tests/` corre en su propia transacción y termina en
`ROLLBACK`: monta sus fixtures, comprueba y no deja rastro. El único que mira
datos reales es `06_seeds.sql`. Usan fechas fijas de 2030 para no depender del
día en que se corren; la antelación se mide contra `now()`.

| Archivo | Cubre |
|---|---|
| `01_esquema.sql` | Extensiones, las 15 tablas, tipos, índices, la restricción y el RPC |
| `02_anti_solapamiento.sql` | Solapes por delante, por detrás, contenidos, englobantes, exactos; citas pegadas; profesionales distintos; canceladas |
| `03_unicidad_cliente.sql` | `UNIQUE (business_id, telefono)` e integridad entre tenants |
| `04_rls_aislamiento.sql` | Cobertura de RLS tabla por tabla + aislamiento real con un rol sin privilegios |
| `05_book_appointment.sql` | El RPC: camino feliz, hueco ocupado y validaciones de pertenencia |
| `06_seeds.sql` | Que Estética Aurora esté cargada y sea coherente |
| `07_disponibilidad.sql` | `available_slots`: tramo partido, cierre (PR-02 en sus dos modos), intervalo, festivo, ausencia, filtro por servicio, horario propio, margen, canceladas, antelación, cambio de hora, rango máximo |
| `08_reserva_completa.sql` | `book_appointment`: cada motivo de rechazo con su código, asignación automática, `ultima_profesional`, que reserva y disponibilidad coincidan, y RLS |

La aserción de cobertura de `04` es la que importa a futuro: **falla si alguien
crea una tabla nueva y se olvida de activarle RLS o de darle política.**

### Tests TypeScript

| Archivo | Cubre |
|---|---|
| `tests/booking-adapter.test.ts` | Disponibilidad de Estética Aurora, reserva con y sin profesional, cancelación, reprogramación (y que si falla la original queda intacta), errores tipados, aislamiento entre negocios |
| `tests/concurrency.test.ts` | Seis conexiones al mismo hueco → entra una. Dos huecos que solo chocan por el margen → entra una. Una reserva sin confirmar hace esperar a la otra |
| `tests/time.test.ts` | Hora local ↔ UTC, con los dos cambios de hora (la hora que no existe y la que ocurre dos veces) |
| `tests/tools.test.ts` | Cada herramienta contra Aurora: consultar, identificar, crear, cancelar, mover, buscar, derivar; errores con alternativas; PA-08, PR-07 en sus dos modos, PR-05, PR-06, PD-04, PD-05; precio oculto |
| `tests/prompt.test.ts` | System prompt determinista, con los datos de Aurora, sin precios ocultos, sin fecha, que cambia con los modos PD-03 y PR-07, y sin datos de ningún negocio en el código |
| `tests/agent.test.ts` | El loop con un **modelo simulado** (sin coste): todas las herramientas y todos los resultados juntos, historial solo-añadir, mensajes y tokens guardados, derivar, límites, fallos y rechazos |

Estos sí confirman en la base (la concurrencia no se puede probar de otra
forma). Limpian lo suyo al terminar: crean negocios de prueba que se borran, y
en Estética Aurora solo escriben con una clienta de prueba en fechas de 2030.

---

## El negocio de prueba

**Estética Aurora** (`Europe/Madrid`), con UUID fijos y legibles para poder
referirse a ellos desde los tests y las pruebas manuales:

| | |
|---|---|
| Servicios | Limpieza facial (60 min), láser (30), corporal (90), valoración (20) |
| Profesionales | Marta (facial, corporal, valoración) y Lucía (facial, láser, valoración) |
| Horario | L-M-X partido 9–14 / 16–20 · J 10–14 / 16–21 · V continuo 9–15 |
| Horario propio | Lucía los jueves solo 16–21 (PD-01) |
| Ajustes | Antelación 2 h · huecos cada 30 min · margen fuera del cierre · el agente pregunta con quién · cancelación: solo informa, plazo 24 h |
| Bloqueos | Festivo del miércoles 21/10, vacaciones de Lucía, formación de Marta |
| Bienvenida | *"Soy la asistente virtual de Estética Aurora…"* (PA-04) |
| Citas | Dos el lunes 19/10 a las 10:00 (profesionales distintos) + una cancelada |

Marta no hace láser y Lucía no hace corporal a propósito: obliga al agente a
elegir profesional según el servicio en vez de al azar.

---

## Qué NO está hecho (y en qué fase va)

| Pendiente | Fase |
|---|---|
| Widget web y endpoint de chat, idempotencia por mensaje, `usage_events` y topes mensuales | 3 |
| Panel para cargar la configuración | 4 |
| Ingesta de conocimiento y embeddings | 5 |
| Recordatorios | 6 |
| `GoogleCalendarAdapter` | 7 |
