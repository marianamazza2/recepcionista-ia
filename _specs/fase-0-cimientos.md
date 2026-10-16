# FASE 0 — CIMIENTOS
### Spec de ejecución · Recepcionista IA
**Depende de:** `mazzmkt-recepcionista-ia-spec.md` (maestro). Leer el maestro primero para el contexto general; este documento es el detalle de ejecución de la Fase 0.

---

## OBJETIVO DE ESTA FASE

Dejar la base de datos completa, segura y probada. Al terminar, la base tiene todas las tablas del modelo de datos, aislamiento multi-tenant activo, la garantía de que **es físicamente imposible** solapar dos citas, y un negocio de prueba cargado para trabajar en las fases siguientes.

**No se escribe nada de agente, canal ni frontend en esta fase.** Solo esquema de datos, seguridad y seeds.

### Criterio de "terminada" (Definition of Done)

La fase está terminada cuando **todos** estos puntos se cumplen:

1. Todas las tablas de la sección 5 del maestro existen, con sus tipos, claves y relaciones.
2. Row Level Security (RLS) está activo en todas las tablas con `business_id`.
3. La restricción de exclusión anti-solapamiento existe y **funciona**: un intento de insertar una cita que se pisa con otra (mismo profesional, horario solapado, no cancelada) es rechazado por la base.
4. Hay seeds de un negocio ficticio completo (una clínica estética de prueba) con servicios, profesionales, horarios y un par de citas.
5. Existe un set de tests SQL que verifican los puntos 3 y 2, y todos pasan.
6. Las migraciones corren limpias desde cero (`supabase db reset`) sin errores.

---

## CONTEXTO TÉCNICO

- **Base de datos:** Supabase (Postgres). Se trabaja con la CLI de Supabase y migraciones versionadas.
- **Todo timestamp** se guarda como `timestamptz` en UTC. El timezone del negocio vive en `businesses.timezone` y se usa para mostrar, nunca para guardar.
- **Multi-tenancy:** toda tabla operativa lleva `business_id` y RLS. No existe una fila sin dueño.
- **Extensiones necesarias:** `btree_gist` (para la restricción de exclusión que combina `=` con rangos), y `vector` (pgvector, para las tablas de conocimiento — se crean acá aunque el RAG se implemente en la Fase 5).

---

## TAREAS

### 0.1 — Inicializar el proyecto Supabase
- Inicializar la estructura de Supabase en el repo (`supabase init`) → crea la carpeta `supabase/` con `migrations/`.
- Configurar el proyecto para desarrollo local.
- Habilitar las extensiones `btree_gist` y `vector` en la primera migración.

### 0.2 — Migraciones del esquema
Crear las tablas del modelo de datos del maestro (sección 5), en orden de dependencias. Una migración por grupo lógico o una sola migración inicial bien ordenada, a criterio, pero **versionada y reproducible**.

Tablas, agrupadas:

**Tenant y configuración**
- `businesses` (con `timezone`, `sector`, `estado`, `plan`, etc. — ver maestro 5.1)
- `services`
- `staff`
- `staff_services` (tabla puente)
- `business_hours`
- `time_off`

**Operación**
- `customers` (con `UNIQUE (business_id, telefono)`)
- `appointments` (el corazón — ver restricción abajo)

**Conversación**
- `conversations`
- `messages`
- `escalations`

**Conocimiento (se crean ahora, se usan en Fase 5)**
- `knowledge_docs`
- `knowledge_chunks` (con columna `embedding vector(1024)`)

**Integraciones y consumo**
- `integrations`
- `usage_events`

Notas de implementación:
- Claves primarias `uuid` con `gen_random_uuid()` por defecto.
- `created_at timestamptz default now()` en todas.
- Claves foráneas con `on delete` pensado (ej: borrar un negocio no debe dejar huérfanos; borrar un servicio con citas históricas no debe romper — evaluar `restrict` vs `cascade` según la tabla).
- Índices en las FK que se van a consultar seguido (`business_id`, `appointments.staff_id`, `appointments.start_at`, `customers.telefono`).

### 0.3 — La restricción anti-solapamiento (lo crítico de la fase)

Sobre `appointments`, crear la restricción de exclusión que impide dos citas del mismo profesional en horarios que se pisan, ignorando las canceladas:

```sql
ALTER TABLE appointments ADD CONSTRAINT no_overlap
EXCLUDE USING gist (
  staff_id WITH =,
  tstzrange(start_at, end_at) WITH &&
) WHERE (estado <> 'cancelada');
```

Requiere la extensión `btree_gist` (por el `staff_id WITH =`). Esta restricción es **la garantía comercial del producto** y no se delega al código de aplicación: la base la impone siempre.

### 0.4 — Row Level Security
- Activar RLS en todas las tablas con `business_id`.
- Definir las políticas de aislamiento por tenant. El criterio: cada fila solo es accesible en el contexto de su `business_id`.
- Documentar en un comentario cómo se resuelve el `business_id` del contexto (según se use `service_role` desde el backend con filtrado explícito, o claims de sesión). Para el MVP el backend corre con rol de servicio y filtra por `business_id` en cada consulta; las políticas RLS son la segunda barrera, no la única.

### 0.5 — Función de reserva (esqueleto)
Crear el stub del RPC `book_appointment` con su firma y validaciones mínimas (que exista, reciba los parámetros correctos e inserte respetando la restricción). La lógica completa de disponibilidad (huecos, buffers, festivos) es de la **Fase 1** — acá solo dejamos la función creada y que inserte de forma atómica, apoyándose en la restricción para el anti-solapamiento.

### 0.6 — Seeds: negocio de prueba
Cargar un negocio ficticio realista para poder trabajar en las fases siguientes:

- **Negocio:** una clínica de estética/belleza ficticia (ej. "Estética Aurora"), `timezone` `Europe/Madrid`, sector estética, estado activo.
- **Servicios:** 3–4 con duraciones distintas (ej. limpieza facial 60 min, depilación láser 30 min, tratamiento corporal 90 min), con precios y buffers.
- **Profesionales:** 2 (ej. "Marta" y "Lucía"), con la relación `staff_services` de quién hace qué.
- **Horarios:** `business_hours` de lunes a viernes (ej. 9–14 y 16–20), con algún día distinto para que no sea trivial.
- **Time off:** un festivo o bloqueo puntual, para tener el caso.
- **Un par de citas** ya cargadas, para probar contra ellas.

### 0.7 — Tests SQL
Escribir tests (pueden ser scripts SQL de aserción, o con el framework de testing de Supabase/pgTAP si se prefiere) que verifiquen:

1. **Anti-solapamiento (el test estrella):** intentar insertar una cita que se pisa con una existente del mismo profesional → debe fallar. Insertar una en un hueco libre → debe pasar. Insertar una que se pisa pero con la existente **cancelada** → debe pasar (porque la cancelada no cuenta).
2. **Solape entre profesionales distintos:** dos citas al mismo horario pero de distinto profesional → deben convivir (no es solape).
3. **Unicidad de cliente:** dos `customers` con el mismo `telefono` en el mismo negocio → debe fallar. Mismo teléfono en negocios distintos → debe pasar.
4. **Aislamiento básico:** una consulta con un `business_id` no ve filas de otro.

---

## FUERA DEL ALCANCE DE LA FASE 0
- Lógica de cálculo de huecos disponibles → Fase 1.
- Cualquier código de agente, tools o LLM → Fase 2.
- Canal / widget → Fase 3.
- Panel de onboarding → Fase 4.
- Ingesta real de conocimiento / embeddings → Fase 5 (las tablas se crean ahora, vacías).

---

## ORDEN DE TRABAJO SUGERIDO PARA CLAUDE CODE
1. `supabase init` + extensiones.
2. Migración de tablas de configuración.
3. Migración de tablas de operación (incluida la restricción anti-solapamiento).
4. Migración de tablas de conversación y conocimiento.
5. Migración de integraciones y consumo.
6. Políticas RLS.
7. Stub de `book_appointment`.
8. Seeds.
9. Tests + correr todo desde cero (`supabase db reset`) y verificar que pasa.

---

## PROMPT DE ARRANQUE (para pegar en Claude Code, sesión fresca)

> Leé `_specs/mazzmkt-recepcionista-ia-spec.md` (maestro) y `_specs/fase-0-cimientos.md` (esta fase). Implementá la Fase 0 completa siguiendo el spec de fase: inicializá Supabase con las extensiones `btree_gist` y `vector`, creá todas las migraciones del modelo de datos de la sección 5 del maestro (versionadas y reproducibles), activá RLS por `business_id` en todas las tablas que lo llevan, creá la restricción de exclusión anti-solapamiento sobre `appointments`, dejá el stub del RPC `book_appointment`, y cargá los seeds del negocio de prueba "Estética Aurora" descrito en el spec de fase. Escribí los tests SQL de la sección 0.7 y asegurate de que `supabase db reset` corre limpio y todos los tests pasan. No implementes lógica de disponibilidad, agente, canal ni frontend: eso es de fases posteriores.

---

## CÓMO SABÉS QUE PODÉS PASAR A LA FASE 1
Corré `supabase db reset` en limpio y después los tests. Si la base se levanta sin errores, el test de anti-solapamiento pasa (rechaza la superpuesta, acepta la del hueco libre, ignora la cancelada) y el negocio de prueba está cargado, la Fase 0 está cerrada. Recién ahí abrís sesión nueva para la Fase 1.
