# Recepcionista IA

Agente conversacional multi-cliente que atiende y agenda citas. Un motor, muchas
configuraciones. Spec completo en [`_specs/`](_specs/).

> **Reglas de negocio:** [`_specs/decisiones-producto.md`](_specs/decisiones-producto.md)
> — cómo se calculan los huecos, márgenes, antelación, quién atiende, qué pasa al
> cancelar o mover una cita. Las de las fases 0 a 2, decididas el 16/10/2026;
> las del widget (PW-01 a PW-17) y las del panel (PI-01 a PI-14), decididas el
> 28/10/2026. Las que aparecieron al construir el panel (PI-15 a PI-17), ⚠️ por
> confirmar.
>
> **Decisiones técnicas:** `docs/DECISIONES.md` (local, no se sube): por qué el
> esquema está como está y las trampas conocidas (zonas horarias, buffers,
> `service_role` y RLS).

**Estado: Fase 4 (panel interno) construida, a falta de que Mariana la
revise y la publique.** Hay un **panel** (`admin/`, `npm run dev` →
http://localhost:4312/panel/) donde se da de alta un negocio entero sin SQL
(datos, servicios, profesionales, horarios, festivos, reglas, preguntas
frecuentes y el chat en su web), se activa o se pausa, se copia el código del
widget, se prueba el chat, se ven las conversaciones (con las herramientas que
usó el agente), las derivaciones, la agenda (con citas a mano fuera de la
rejilla, PR-04) y el consumo. Ver [Panel interno (Fase 4)](#panel-interno-fase-4).

Fase 3 (canal widget web): el agente de la Fase 2 ya
atiende **desde una web**: una burbuja de chat que el negocio pega con una
línea, un endpoint que resuelve el negocio por la clave pública del widget, el
registro de lo que consume cada negocio (con tope mensual) y el SMS de
confirmación con la página de la cita (con un proveedor de prueba: no se envía
nada de verdad). Se prueba con la demo de Estética Aurora (`npm run dev`).

Debajo siguen el núcleo del agente (Fase 2: entiende lo que pide la clienta,
usa el motor con herramientas y responde en el tono del negocio) y el motor de
reservas (Fase 1).

> **Para trabajar en el repo** (personas o agentes): empezá por
> [`AGENTS.md`](AGENTS.md) — la forma de trabajo, las reglas que no se rompen y
> qué documentación hay que actualizar con cada cambio. Cada carpeta
> importante tiene además su propio `AGENTS.md` (y `README.md` donde hace
> falta).

---

## Qué hay en la base

```
supabase/
├── migrations/          17 migraciones, versionadas y en orden de dependencias
├── seed.sql             negocio de prueba "Estética Aurora"
└── tests/               tests SQL de aserción (10 archivos, 224 aserciones)
scripts/
├── run-sql-tests.sh     runner de los tests SQL
└── con-supabase.sh      ejecutar un comando contra la nube
src/
├── api/                 las rutas HTTP: widget, chat, página de la cita (Fase 3) y el panel en admin/ (Fase 4)
├── adapters/
│   ├── booking/         BookingAdapter (maestro §7), SupabaseAdapter y errores tipados
│   ├── channels/        web-widget.ts: sesión, idempotencia, límites, tope, consumo, SMS
│   └── sms/             SmsProvider y el proveedor de prueba
├── citas/               SMS de confirmación y de cancelación, página del enlace, agenda y citas a mano (PI-14)
├── config/business.ts   lo que el agente sabe de un negocio, leído de la base
├── core/                EL NÚCLEO (Fase 2). No se toca por cliente
│   ├── agent.ts         el loop: tool use, historial, límites, derivar
│   ├── prompt.ts        system prompt desde la configuración
│   ├── tools/           las 8 herramientas (definición strict + ejecución)
│   ├── guardrails.ts    límites del loop y respuestas fijas
│   ├── time.ts          hora local del negocio ↔ UTC (cambio de hora incluido)
│   ├── phone.ts         teléfonos a formato +34…
│   └── costes.ts        coste aproximado de las llamadas
├── db/                  cliente, tenant, clientas, conversaciones, consumo, widget, negocios, visor, personas del panel
├── dev/                 npm run dev: la demo y el panel en local
└── cli/
    ├── chat.ts          npm run chat: conversar por la Terminal
    ├── eval.ts          npm run agent:eval: los 13 escenarios con el modelo real
    ├── consumo.ts       npm run consumo: el informe de consumo de un negocio
    ├── panel-cuenta.ts  npm run panel:cuenta: crear una cuenta del panel
    └── build-widget.ts  npm run build:widget: genera widget/dist/widget.js
widget/                  el chat embebible (TypeScript sin dependencias)
admin/                   el panel interno (React + Vite + Tailwind, Fase 4)
demo/                    la web inventada de Estética Aurora, con el widget pegado, y prueba.html (cualquier negocio)
tests/                   tests TypeScript (motor, herramientas, prompt, loop, widget…)
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
| `20261016130000_widget_web` | Fase 3: clave, dominios, color, privacidad y tope del widget en `businesses`; token de sesión (hash) e IP (hash) en `conversations`; `usage_events` en US$ y con su conversación; `appointment_links` y `sms_messages` |
| `20261028100000_widget_logo` | Fase 3: `businesses.widget_logo`, el logo del círculo de la cabecera del widget como data URL (PW-17) |
| `20261028120000_panel_interno` | Fase 4: `panel.personas` (quién entra al panel, PI-01), preguntas frecuentes en `knowledge_docs` con su límite (PI-08, `RA007`), `conversations.prueba` (PI-13), `escalations.resuelta_at` (PI-07), `negocio_lo_que_falta()` y no activar sin lo mínimo (PI-03, `RA008`), y el modo manual de `slot_es_valido`/`book_appointment` (PR-04, PI-14) |

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
- **RLS** activo en las 17 tablas, con política por `business_id`.

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
| `RA007` | — (panel) | Más de 20 preguntas frecuentes o de 4.000 caracteres (PI-08) | El panel lo dice con palabras |
| `RA008` | — (panel) | Activar un negocio al que le falta lo mínimo (PI-03) | El panel dice qué falta |
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
npm run agent:eval                # los 13 escenarios (≈ 0,40 US$ con Opus 5)
npm run agent:eval -- --solo 3    # solo uno
npm run agent:eval -- --ver       # con la conversación entera
```

Cada uno imprime OK o FALLA y al final el coste total. Usan clientas de prueba
(`+34998…`, otro prefijo que el de los tests, para poder correrlos a la vez)
que se borran al empezar y al terminar.

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

## El widget web (Fase 3)

### Probar la demo

Hace falta `ANTHROPIC_API_KEY` en `.env` y el Postgres local en marcha.

```bash
npm run dev
```

- Abrí **http://localhost:4310**: la web inventada de Estética Aurora con la
  burbuja abajo a la derecha. Escribí como una clienta; al reservar, el **SMS de
  prueba** sale en la consola de `npm run dev`, con su enlace.
- El enlace (`http://localhost:4311/cita/…`) abre la página de la cita: la
  muestra y deja cancelarla (con PR-07, igual que el agente).
- Recargá la página: la conversación sigue (2 h desde el último mensaje, PW-03
  y PW-12; pasado ese tiempo, avisa y empieza otra). En otro navegador (o en
  una ventana privada) no se ve.
- `http://127.0.0.1:4310` es "otra web" para el widget (solo admite
  `localhost`): ahí no aparece (PW-06).

Son dos servidores a propósito, como en la realidad: la web del negocio
(`:4310`) y el nuestro, que sirve `widget.js` y la API (`:4311`). Si algún
puerto está ocupado: `API_PORT=5001 DEMO_PORT=5000 npm run dev`.

### La demo publicada (Vercel, PW-08)

Un proyecto de Vercel conectado al repo de GitHub: cada `git push` a `main`
publica. `vercel.json` le dice que corra `npm run build:vercel`, que arma
`.vercel/output` (la web de la demo, `widget.js` y una función para `/api/…` y
`/cita/…`, en Frankfurt). Detalle en D-73.

- **Dos dominios** en el proyecto: el de la demo (el que se enseña) y el del
  servidor del widget (`PUBLIC_API_URL`). El widget solo aparece en el de la
  demo, que tiene que estar en los `widget_dominios` de Aurora en la nube.
- **Variables del proyecto** (Settings → Environment Variables):
  `DATABASE_URL` (Supabase, pooler en modo transacción, puerto 6543),
  `ANTHROPIC_API_KEY` y `PUBLIC_API_URL`.
- El SMS de prueba sale en los logs de la función (Vercel → Logs).
- Probar el build en local: `PUBLIC_API_URL=https://ejemplo.vercel.app npm run build:vercel`.

### Pegar el widget en una web

```html
<script src="https://<nuestro-servidor>/widget.js" data-key="wk_CLAVE_DEL_NEGOCIO" async></script>
```

Desde la Fase 4, todo esto se configura en el panel (bloque "El chat en su
web" y "Publicar", que da el código listo para copiar). En la base, por
negocio, en `businesses`: `widget_key` (la
genera la base), `widget_dominios` (los hosts exactos de su web: con y sin
`www.` son dos), `widget_color`, `widget_logo` (data URL de su logo, PW-17),
`privacidad_url` y `tope_mensual_usd` (de
serie 100). Detalle en [`widget/README.md`](widget/README.md) y el contrato de
las rutas en [`src/api/README.md`](src/api/README.md).

### Lo que protege un endpoint público

- **Dominio** (PW-06): solo responde, con CORS, a los dominios del negocio.
- **Sesión:** el navegador guarda un token; la base, solo su hash. Sin token
  válido no se lee ni se escribe ninguna conversación.
- **Idempotencia:** cada mensaje lleva un `clientMessageId`; si llega dos veces
  (red lenta, doble clic, reintento), se devuelve la misma respuesta y no se
  reserva dos veces. Los mensajes de una conversación van de uno en uno.
- **Límites** (PW-05): 1.000 caracteres, 20 mensajes por conversación y hora,
  10 conversaciones nuevas por hora desde la misma conexión. Al pasarse, texto
  fijo con el teléfono del local, sin llamar a la IA.
- **Tope mensual** (PW-04): al llegar al tope del negocio, texto fijo con el
  teléfono, sin llamar a la IA.
- **Errores:** nunca llega un error interno al navegador.

### Ver el consumo

```bash
npm run consumo -- --negocio estetica-aurora               # el mes en curso
npm run consumo -- --negocio estetica-aurora --mes 2026-10
```

Mensajes, conversaciones, citas, tokens y coste (US$) del mes, y el % del tope;
avisa desde el 80 %. Cuenta lo que pasa por el widget (no las pruebas por la
Terminal); las de "Probar el chat" del panel, aparte. Lo mismo, para todos los
negocios a la vez, en el panel → Consumo.

---

## Panel interno (Fase 4)

La herramienta de Mariana (no la del cliente, que es la Fase 9). Spec:
[`_specs/fase-4-panel-interno.md`](_specs/fase-4-panel-interno.md); reglas
PI-01 a PI-17 en `decisiones-producto.md`; cómo está hecho en
[`admin/README.md`](admin/README.md).

### Crear tu cuenta (una vez)

Las cuentas son de **Supabase Auth** del proyecto en la nube (sin Docker no hay
Auth local) y, además, hay que estar en la lista `panel.personas` de la base
(PI-01). No hay registro público.

1. En `.env`: `SUPABASE_PROJECT_REF` y `SUPABASE_ANON_KEY` (ya estaban) y
   `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Project Settings → API; solo la usa
   este comando, nunca sale de tu máquina).
2. En Supabase → Authentication → Sign In / Providers, desactivá **"Allow new
   users to sign up"** (sin registro público).
3. Crear la cuenta y darte acceso en la base local; la contraseña la pide la
   Terminal sin mostrarla:

   ```bash
   npm run panel:cuenta -- --email tu@email
   ```

4. Para el panel publicado, lo mismo contra la nube (la cuenta ya existe: solo
   comprueba la contraseña y te añade a la lista de esa base):

   ```bash
   ./scripts/con-supabase.sh npm run panel:cuenta -- --email tu@email
   ```

### Usarlo en local

`npm run dev` y abrí **http://localhost:4312/panel/**. Además de la demo de
Aurora, `http://localhost:4310/prueba.html?key=wk_…` es una web de prueba que
carga el widget de **cualquier** negocio (con `localhost` en sus dominios).

### Publicarlo (solo con el visto bueno de Mariana, PI-02)

Va en el mismo proyecto de Vercel, bajo `/panel/`: el build ya lo incluye.
Falta: añadir en Vercel las variables `SUPABASE_PROJECT_REF` y
`SUPABASE_ANON_KEY` (sin ellas el panel responde "no configurado") y, si se
quiere una dirección propia, un tercer dominio y `PANEL_HOST` con ese dominio
(su raíz lleva al panel).

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
SUPABASE_POOLER_MODO=transaccion ./scripts/con-supabase.sh npm test   # pooler en modo transacción (6543)
./scripts/con-supabase.sh npm run test:e2e
```

`con-supabase.sh` arma la cadena de conexión con los datos de `.env` y ejecuta
el comando contra la nube, sin escribir ni mostrar la contraseña.

---

## Los tests

Primera vez: `npm install` y copiar `.env.example` a `.env` con tu
`DATABASE_URL`. Los dos comandos la leen de ahí.

```bash
npm run test:sql                    # tests SQL (10 archivos)
./scripts/run-sql-tests.sh 07       # solo uno
npm test                            # tests TypeScript (160), el de concurrencia incluido
npm run test:e2e                    # la demo y el panel en Google Chrome, con el modelo simulado
npm run typecheck                   # comprobación de tipos (también la del widget y la del panel)

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
| `01_esquema.sql` | Extensiones, las 15 tablas de la Fase 0, tipos, índices, la restricción y el RPC |
| `02_anti_solapamiento.sql` | Solapes por delante, por detrás, contenidos, englobantes, exactos; citas pegadas; profesionales distintos; canceladas |
| `03_unicidad_cliente.sql` | `UNIQUE (business_id, telefono)` e integridad entre tenants |
| `04_rls_aislamiento.sql` | Cobertura de RLS tabla por tabla + aislamiento real con un rol sin privilegios |
| `05_book_appointment.sql` | El RPC: camino feliz, hueco ocupado y validaciones de pertenencia |
| `06_seeds.sql` | Que Estética Aurora esté cargada y sea coherente |
| `07_disponibilidad.sql` | `available_slots`: tramo partido, cierre (PR-02 en sus dos modos), intervalo, festivo, ausencia, filtro por servicio, horario propio, margen, canceladas, antelación, cambio de hora, rango máximo |
| `08_reserva_completa.sql` | `book_appointment`: cada motivo de rechazo con su código, asignación automática, `ultima_profesional`, que reserva y disponibilidad coincidan, y RLS |
| `09_widget.sql` | Fase 3: valores de serie y restricciones del widget, el token de sesión solo como hash, consumo enlazado a su conversación, enlaces y SMS (sin cruzar negocios) y su RLS; el formato y el tamaño del logo (PW-17) |
| `10_panel.sql` | Fase 4: `panel.personas` fuera de `public`, con RLS y sin política; preguntas frecuentes y su límite (RA007); conversación de prueba; derivación resuelta; lo que falta y no activar sin ello (RA008); citas a mano: sin rejilla ni antelación, pero nunca fuera de horario, en festivo, en una ausencia por horas, pisando otra cita o el margen |

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
| `tests/widget-saludo.test.ts` | El saludo según la hora de la bienvenida del widget (PW-02) |
| `tests/widget-api.test.ts` | El endpoint del widget: solo lo público en la config, dominio no permitido, sesión y token de otro negocio, PW-03 (2 h), idempotencia (también simultánea, con una sola cita y un solo SMS), orden de dos mensajes a la vez, límites PW-05, tope PW-04, consumo y errores |
| `tests/cita-sms.test.ts` | El SMS de prueba al reservar (texto, enlace, sin token en la base), SMS fallido sin perder la cita, el SMS de cancelación por el chat (PW-10), la página del enlace (ver, cancelar en dos pasos, PR-07 en sus dos modos, enlace inventado o caducado) |
| `tests/consumo.test.ts` | Eventos de consumo por turno y modelo, mes natural del tope, informe y aviso del 80 % |
| `tests/vercel-build.test.ts` | La publicación de Vercel: la demo apunta a `PUBLIC_API_URL`, la función (Node 22, Frankfurt, 300 s) y sus rutas, y el archivo empaquetado respondiendo de verdad (dominio permitido y no permitido, 404) |
| `tests/admin-api.test.ts` | La API del panel con cuentas falsas: 401 en todas las rutas sin cuenta válida, entrar y renovar, alta completa y que el agente reserve, activar incompleto, desactivar un servicio con citas, preguntas frecuentes en el prompt y su límite, cambiar la clave, logo, festivos, horario, citas a mano (y que el agente al moverlas respeta la rejilla), probar el chat, visor, derivaciones, consumo separado, negocio pausado y aislamiento entre negocios |
| `tests/e2e/panel.e2e.ts` | `npm run test:e2e`: el panel en Chrome — entrar, alta mínima solo con el panel (logo grande reducido solo), activar, reservar con su widget en la web de prueba, verlo en el visor, cita a mano en la agenda y consumo |
| `tests/e2e/widget.e2e.ts` | `npm run test:e2e`: la demo en Chrome, de escribir a reservar, el SMS, recargar, otro navegador, cancelar por el enlace, un dominio no permitido y la conversación caducada (PW-12) |

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
| Widget | Clave fija `wk_demo_estetica_aurora_0001`, solo en `localhost`, color `#8a5a63`, isotipo inventado (`demo/aurora-isotipo.svg`), tope 100 US$ |
| Preguntas frecuentes | Aparcamiento, formas de pago y bonos regalo (PI-08) |
| Citas | Dos el lunes 19/10 a las 10:00 (profesionales distintos) + una cancelada |

Marta no hace láser y Lucía no hace corporal a propósito: obliga al agente a
elegir profesional según el servicio en vez de al azar.

---

## Qué NO está hecho (y en qué fase va)

| Pendiente | Fase |
|---|---|
| Proveedor real de SMS (hoy, uno de prueba que escribe en la consola) | cuando Mariana lo elija (PW-07) |
| Retención y borrado de conversaciones | con PD-11 |
| Publicar el panel en Vercel | cuando Mariana lo confirme (PI-02) |
| Ingesta de conocimiento y embeddings | 5 |
| Recordatorios | 6 |
| `GoogleCalendarAdapter` | 7 |
