# FASE 1 — MOTOR DE RESERVAS
### Spec de ejecución · Recepcionista IA
**Depende de:** `mazzmkt-recepcionista-ia-spec.md` (maestro), `fase-0-cimientos.md` (ya cerrada) y `decisiones-producto.md` (reglas de negocio). Leer los tres antes de empezar. Las decisiones técnicas de la Fase 0 están en `docs/DECISIONES.md` (local): leerlas también, sobre todo D-05, D-06, D-09, D-10, D-17, D-20 y las trampas T-01 a T-05.

---

## OBJETIVO DE ESTA FASE

Construir el **cerebro de la agenda**: dado un negocio, un servicio y un rango de fechas, saber qué huecos están libres y reservar uno de forma atómica, respetando horarios, festivos, ausencias, márgenes, antelación mínima y la elección de profesional.

Encima de eso, la primera capa de código TypeScript del proyecto: la interfaz `BookingAdapter` (maestro §7) y su implementación `SupabaseAdapter`, que es lo que usará el agente en la Fase 2.

**No se escribe nada de agente, LLM, canal ni frontend en esta fase.**

### Criterio de "terminada" (Definition of Done)

1. Existe una función SQL de disponibilidad que devuelve los huecos libres aplicando **todas** las reglas de `decisiones-producto.md` (PD-01, PD-02, PD-03, PD-05, PR-01, PR-02).
2. `book_appointment` está completo: rechaza cualquier reserva que no sea un hueco válido según esas mismas reglas, y sabe asignar profesional cuando no se indica.
3. La lógica de "qué es un hueco válido" vive en **un solo sitio** y la usan tanto la disponibilidad como la reserva.
4. Hay tests SQL nuevos para cada regla y para los casos límite (festivo, fuera de horario, antelación, margen, horario propio, cambio de hora, asignación automática), y **todos los tests pasan, los de la Fase 0 incluidos**.
5. Existe el test de concurrencia que quedó como deuda (DT-01): dos reservas simultáneas al mismo hueco → una entra y la otra se rechaza.
6. `BookingAdapter` y `SupabaseAdapter` existen en TypeScript, con tests que corren contra la base.
7. Todo se verifica también en el **proyecto Supabase en la nube** (PD-06), cerrando la deuda DT-02.

---

## REGLAS DE NEGOCIO QUE IMPLEMENTA

Resumen operativo de `decisiones-producto.md`. Si hay contradicción, manda ese documento.

| Regla | Qué significa para el cálculo |
|---|---|
| **PD-01** Horario propio reemplaza | Para una profesional y un día: si tiene tramos propios en `business_hours` (con su `staff_id`) ese weekday, se usan solo esos. Si no, se usan los tramos del negocio (`staff_id` NULL) |
| **Filtro por servicio** | Solo cuentan profesionales activas que tengan la relación en `staff_services` con ese servicio |
| **PD-02** Margen obligatorio | Una cita ocupa `[start_at, end_at + buffer_min del servicio)` a efectos de disponibilidad. El hueco nuevo también necesita su propio margen libre después |
| **PR-02** Margen al cierre | El servicio (`start + duración`) tiene que caber en el tramo. Si `margen_dentro_horario` es `false` (de serie), su margen puede quedar fuera del tramo; si es `true`, servicio + margen tienen que caber |
| **PR-01** Intervalo | Los inicios candidatos van cada `intervalo_huecos_min` minutos desde la apertura de cada tramo |
| **PD-05** Antelación | Se descarta todo hueco con `start < now() + antelacion_min_horas` |
| **time_off** | Un bloqueo con `staff_id` NULL cierra el negocio entero; con `staff_id`, solo a esa profesional. Un hueco no puede pisar ningún bloqueo que le aplique |
| **PD-03** Asignación | Ver tarea 1.4 |

---

## CONTEXTO TÉCNICO

- Los horarios (`business_hours`) están en **hora local** del negocio; citas y bloqueos en `timestamptz` (D-09). La conversión se hace **siempre** con `(fecha + hora) AT TIME ZONE b.timezone`. Nada de offsets a mano ni `+02` fijo (T-01).
- `weekday` es 0 = domingo … 6 = sábado, como `EXTRACT(dow …)`. Si aparece `isodow`, está mal (D-10).
- El rango de una cita es `[)`: citas pegadas conviven (D-06).
- `end_at` **no** incluye el margen (D-05). El margen lo aplica esta fase.
- `no_overlap` sigue siendo la última barrera, pero **no protege el margen** (T-02). Ver 1.3 para la concurrencia.
- El tenant lo declara el llamador con `app.set_business_id()`; las funciones nuevas son `SECURITY INVOKER` y no lo fijan (D-17).
- Toda migración nueva fija `set search_path = public, extensions` si usa algo de las extensiones (T-05).
- Entorno: Postgres 17 local para iterar (D-24) y proyecto Supabase en la nube para cerrar (PD-06).

---

## TAREAS

### 1.1 — Migración: ajustes por negocio

Añadir a `businesses`:

| Columna | Tipo | Por defecto | Regla |
|---|---|---|---|
| `antelacion_min_horas` | `integer not null`, `check (>= 0)` | `2` | PD-05 |
| `intervalo_huecos_min` | `integer not null`, `check (> 0 and <= 240)` | `30` | PR-01 |
| `margen_dentro_horario` | `boolean not null` | `false` | PR-02 |
| `asignacion_profesional` | enum nuevo `asignacion_profesional`: `preguntar` \| `automatica` | `preguntar` | PD-03 |

Con comentario (`comment on column`) que explique cada una en una línea. El enum va en su propia sentencia (D-04).

`asignacion_profesional` no cambia el cálculo de huecos: le dice al agente (Fase 2) si debe preguntar antes de asignar. Se crea ahora para que la configuración quede completa.

### 1.2 — Función de disponibilidad

```
public.available_slots(
  p_business_id uuid,
  p_service_id  uuid,
  p_from        timestamptz,
  p_to          timestamptz,
  p_staff_id    uuid default null
) returns table (staff_id uuid, start_at timestamptz, end_at timestamptz)
```

- Devuelve **un registro por profesional y hueco**, ordenado por `start_at` y luego por profesional (orden estable).
- Con `p_staff_id`, solo los huecos de esa profesional.
- `end_at` es el fin del **servicio** (sin margen), igual que se guardaría la cita.
- Recorre los **días locales** del negocio que tocan el rango `[p_from, p_to)` y aplica la tabla de reglas de arriba.
- Rango máximo razonable (por ejemplo 31 días) para que nadie pida un año entero: si se excede, error claro.
- Una cita existente bloquea `[a.start_at, a.end_at + buffer_min de SU servicio)`. Un hueco candidato necesita libre `[start, start + duración + buffer_min del servicio pedido)`. Las canceladas no bloquean.

Implementación libre (SQL o PL/pgSQL), pero con **`generate_series` sobre días locales y sobre inicios dentro de cada tramo**, legible y comentada. Nada de bucles de minuto en minuto.

### 1.3 — `book_appointment` completo

Ampliar el RPC existente (nueva migración con `create or replace`, sin reescribir la de la Fase 0):

1. **`p_staff_id` pasa a ser opcional.** Si viene `NULL`, se asigna según 1.4.
2. **Valida que el hueco pedido sea válido** usando la misma lógica que `available_slots` (tarea 1.5): horario, festivos, ausencias, margen, antelación. No basta con que no se solape.
3. **Concurrencia:** el margen no lo protege `no_overlap`, así que dos reservas simultáneas podrían dejar dos citas sin margen entre ellas. Serializar por profesional con `pg_advisory_xact_lock` (clave derivada del `staff_id`) **antes** de validar e insertar. `no_overlap` se mantiene como última barrera.
4. **Errores distinguibles** (amplía la tabla de D-20). Usar SQLSTATE propios para que la capa TypeScript no tenga que leer mensajes:

| SQLSTATE | Significa | Qué hará el agente (Fase 2) |
|---|---|---|
| `23P01` | Hueco ocupado (ya existía) | Ofrecer otro hueco |
| `RA001` | Fuera del horario de esa profesional o del local | PD-04: decir que no abre y ofrecer los más cercanos |
| `RA002` | Cae en un festivo o ausencia | Igual que RA001 |
| `RA003` | No respeta la antelación mínima | Explicar la antelación y ofrecer el primer hueco válido |
| `RA004` | No respeta el margen con otra cita | Ofrecer otro hueco |
| `RA005` | Ninguna profesional disponible a esa hora (asignación automática) | Ofrecer otros huecos |
| `23514` | La profesional no hace ese servicio | Proponer otra profesional |
| `23503` | Algo no es de ese negocio o está inactivo | Error de programación: log y derivar |

### 1.4 — Asignación automática de profesional (PD-03)

Cuando `book_appointment` recibe `p_staff_id = NULL` para una hora concreta:

1. Candidatas: las profesionales que tienen **ese hueco exacto** en `available_slots`.
2. Se elige la que tenga **menos citas no canceladas ese día local**.
3. Empate → orden estable (por nombre y luego por id).
4. Ninguna → `RA005`.

Además, una función de apoyo para el agente:

```
public.ultima_profesional(p_business_id uuid, p_customer_id uuid) returns uuid
```

Devuelve la profesional de la **última cita no cancelada** de esa clienta (o `NULL`). La usará el agente para *"la última vez te atendió Marta"*.

El caso *"lo antes posible, con quien sea"* no necesita función propia: es el primer registro de `available_slots` sin `p_staff_id`.

### 1.5 — Una sola fuente de verdad

La comprobación "¿este inicio es un hueco válido para esta profesional y este servicio?" se escribe **una vez** (por ejemplo, una función interna `app.slot_es_valido(...)` que devuelva el motivo si no lo es) y la usan `available_slots` y `book_appointment`. Si mañana cambia una regla, se cambia en un solo sitio.

### 1.6 — Seeds

Ampliar Estética Aurora para que el seed cubra las reglas nuevas:

- Valores explícitos de `antelacion_min_horas` (2), `intervalo_huecos_min` (30), `margen_dentro_horario` (`false`) y `asignacion_profesional` (`preguntar`).
- **Un horario propio** de Lucía (por ejemplo, los jueves solo 16:00–21:00), para tener el caso PD-01.
- Mantener lo que ya hay (festivo el 21/10, citas el 19/10 y el 20/10). Actualizar `06_seeds.sql` si cambian los conteos.

### 1.7 — Tests SQL nuevos

Mismo estilo que la Fase 0: `NN_nombre.sql`, transacción con `ROLLBACK`, fixtures propios (D-21, D-22), conteos acotados por `business_id`.

**Sobre el tiempo:** los tests no pueden depender de la fecha de hoy. Usar fechas fijas lejanas en el futuro para todo lo que no sea antelación, y para la antelación construir los fixtures relativos a `now()`.

`07_disponibilidad.sql`
- Tramo partido: no hay huecos en el descanso del mediodía.
- Servicio que no cabe al final del tramo: no se ofrece. PR-02 en sus dos modos: con `margen_dentro_horario = false` el margen puede quedar fuera del cierre; con `true`, no.
- Intervalo: con el valor de serie (30) los inicios caen en :00 y :30; con un fixture a 15, en :00, :15, :30 y :45.
- Festivo del negocio: ningún hueco ese día.
- Ausencia de una profesional: la otra sigue teniendo huecos.
- Filtro por servicio: quien no hace el servicio no aparece aunque esté libre.
- PD-01: con horario propio, la profesional solo aparece en su tramo; sin horario propio ese día, hereda el del local.
- Margen: con intervalo de 15, después de una cita de 60 + 15 el siguiente hueco de esa profesional empieza a los 75 min; con intervalo de 30, a los 90.
- Canceladas no bloquean.
- Antelación: no aparece nada antes de `now() + antelación`.
- **Cambio de hora:** el domingo 25/10/2026 España pasa a horario de invierno. Un tramo de 9:00 local el lunes 19/10 empieza a las 07:00 UTC y el lunes 26/10 a las 08:00 UTC.
- Rango demasiado grande → error.

`08_reserva_completa.sql`
- Reserva válida → se crea.
- Fuera de horario → `RA001`. En festivo → `RA002`. Sin antelación → `RA003`. Pisando el margen → `RA004`.
- `p_staff_id` NULL → asigna a la que menos citas tiene ese día; con empate, orden estable; sin nadie libre → `RA005`.
- `ultima_profesional` devuelve la de la última cita no cancelada y `NULL` para una clienta nueva.
- Los casos de la Fase 0 en `05_book_appointment.sql` **siguen pasando**. Si alguno ya no tiene sentido con las reglas nuevas (por ejemplo, porque reservaba fuera de horario), se ajusta el fixture, no la regla, y se explica en un comentario.

### 1.8 — Proyecto TypeScript y `SupabaseAdapter`

Primera vez que el repo tiene código de aplicación. Estructura del maestro §10.

- `package.json`, `tsconfig.json` (estricto), y **Vitest** para tests.
- `src/adapters/booking/types.ts`: la interfaz `BookingAdapter` del maestro §7, con `staffId` opcional en `createBooking` (asignación automática), más `getLastStaff(customerId)` para PD-03.
- `src/adapters/booking/supabase.ts`: implementación.
  - **Conexión directa a Postgres** (librería `postgres` o `pg`) con la cadena de conexión de Supabase, no `supabase-js`. *Por qué:* cada operación tiene que abrir una transacción, declarar el tenant con `app.set_business_id()` y llamar a la función, todo junto (D-15, D-16). Por PostgREST no se puede, y además así los tests corren igual contra el Postgres local y contra Supabase.
  - Traduce los SQLSTATE de 1.3 a **errores tipados** (`SlotTakenError`, `OutsideHoursError`, `TooSoonError`…), para que el agente no tenga que conocer códigos de Postgres.
  - `rescheduleBooking` = cancelar + crear **en la misma transacción**: si la nueva falla, la original queda intacta.
  - Las fechas entran y salen como `Date` (UTC). Presentarlas en la hora del negocio es cosa del agente.
- `DATABASE_URL` por variable de entorno. Añadir `.env.example` (sin secretos). `.env` ya está en `.gitignore`.
- **Tests de integración** (`tests/booking-adapter.test.ts`) contra la base local con los seeds: disponibilidad de Estética Aurora, reserva, cancelación, reprogramación, errores tipados.
- **Test de concurrencia (DT-01)**: dos conexiones reservan el mismo hueco a la vez → exactamente una entra. Y otro con dos huecos distintos que solo chocan por el margen → exactamente una entra.
- Scripts en `package.json`: `npm test` (Vitest) y `npm run test:sql` (el runner existente).

### 1.9 — Verificación en Supabase (PD-06)

Requiere que Mariana haya creado el proyecto en supabase.com (gratuito). **Pedirle el *project ref*.** La contraseña de la base **no se pide por el chat**: crear `.env` con la variable vacía y pedirle que la rellene ella (`open -e .env`). No continuar hasta que confirme.

1. `supabase link --project-ref <ref>`.
2. `supabase db push` (aplica las migraciones de la Fase 0 y 1).
3. Cargar el seed y correr `npm run test:sql` y `npm test` con `DATABASE_URL` apuntando al proyecto.
4. Comprobar los roles reales: con la clave `anon` y sin tenant, una consulta por la API de Supabase devuelve cero filas. Documentar el resultado y cerrar DT-02.
5. La contraseña y las claves van **solo** en `.env` (ignorado por git). Nunca en el código ni en los specs.

### 1.10 — Documentación

- `docs/DECISIONES.md`: sección **Fase 1** con las decisiones técnicas tomadas (por qué el advisory lock, por qué conexión directa, cómo se resolvió el cambio de hora, etc.) y cerrar DT-01 y DT-02.
- `README.md`: estado "Fase 1 terminada", cómo correr los tests TypeScript y la tabla de errores.
- Si al implementar aparece **una decisión de producto nueva**, no se inventa: se anota en `_specs/decisiones-producto.md` como propuesta *"⚠️ por confirmar"* con un valor de serie razonable, y se avisa a Mariana.

---

## FUERA DEL ALCANCE DE LA FASE 1

- El agente, sus tools y el system prompt → Fase 2. (Lo que el agente *dice* en PD-03 y PD-04 es de la Fase 2; esta fase le da los datos.)
- Canal / widget → Fase 3.
- Panel para editar la configuración → Fase 4.
- Recordatorios → Fase 6.
- `GoogleCalendarAdapter` → Fase 7.

---

## ORDEN DE TRABAJO SUGERIDO PARA CLAUDE CODE

1. Leer los documentos de "Depende de" y `docs/DECISIONES.md`.
2. Migración 1.1 (ajustes por negocio).
3. Función interna de validez del hueco (1.5) + `available_slots` (1.2) + `07_disponibilidad.sql`. Iterar hasta verde.
4. `book_appointment` completo (1.3) + asignación (1.4) + `08_reserva_completa.sql`. Verde, incluidos los de la Fase 0.
5. Seeds (1.6) y `06_seeds.sql`.
6. Proyecto TypeScript y `SupabaseAdapter` (1.8) + tests de integración + concurrencia.
7. Verificación en Supabase (1.9), pidiéndole a Mariana los datos del proyecto.
8. Documentación (1.10).

Trabajar contra el Postgres local (`recepcionista_dev`) con el mismo método de la guía: `supabase db push --db-url …` y el runner de tests. **No apagar ni reiniciar Postgres sin avisar:** Mariana puede estar usándolo.

---

## PROMPT DE ARRANQUE (para pegar en Claude Code, sesión fresca en el repo)

> Leé `_specs/mazzmkt-recepcionista-ia-spec.md` (maestro), `_specs/decisiones-producto.md` (reglas de negocio), `_specs/fase-1-motor-reservas.md` (esta fase) y `docs/DECISIONES.md` (decisiones técnicas de la Fase 0). Implementá la Fase 1 completa siguiendo el spec de fase, en el orden sugerido: migración de ajustes por negocio, función de validez del hueco como única fuente de verdad, `available_slots`, `book_appointment` completo con asignación automática y advisory lock, `ultima_profesional`, seeds y tests SQL 07 y 08, y después el proyecto TypeScript con `BookingAdapter`, `SupabaseAdapter` (conexión directa a Postgres), tests de integración y el test de concurrencia. Trabajá contra el Postgres local `recepcionista_dev` y no lo apagues. Todos los tests, los de la Fase 0 incluidos, tienen que pasar. Antes del paso de Supabase en la nube, pedime el project ref; la contraseña no me la pidas por el chat: creá el archivo .env con un hueco y la relleno yo. Si aparece una decisión de producto que no está en `decisiones-producto.md`, no la inventes: anotala como propuesta por confirmar y avisame. Explicame al final, en lenguaje simple, qué hiciste y cómo lo verifico yo.

---

## CÓMO SABÉS QUE PODÉS PASAR A LA FASE 2

1. `./scripts/run-sql-tests.sh` → **8/8 archivos OK** (los 6 de la Fase 0 + 07 y 08).
2. `npm test` → todos los tests TypeScript en verde, el de concurrencia incluido.
3. Lo mismo contra el proyecto Supabase en la nube.
4. Pedís disponibilidad de una limpieza facial en Estética Aurora para una semana y lo que sale tiene sentido mirando el horario, el festivo del 21/10 y las citas del 19/10.

Recién ahí, commit y sesión nueva para la Fase 2.
