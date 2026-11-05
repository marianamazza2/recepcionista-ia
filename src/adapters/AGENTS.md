# src/adapters/ — lo que hay detrás de una interfaz

El núcleo y los canales hablan contra **contratos**; las implementaciones se
cambian sin tocar a quien las usa (maestro §7).

```
adapters/
├── booking/   la agenda      types.ts (BookingAdapter) · supabase.ts · errors.ts
├── channels/  los canales    web-widget.ts (Fase 3) · whatsapp.ts (Fase 8, no existe aún)
└── sms/       el envío SMS   types.ts (SmsProvider) · prueba.ts
```

## booking/ — `BookingAdapter`

- **Un adaptador por negocio** (D-35). Se construye con su `businessId`; si un
  método recibe otro, lanza `TenantMismatchError`. Cada consulta filtra además
  por `business_id`.
- **Fechas como `Date` (UTC)** en la interfaz. Presentarlas en hora local es
  cosa del núcleo (`core/time.ts`).
- **La regla de "hueco válido" no se duplica aquí**: vive en la base
  (`app.slot_es_valido`, D-26). El adaptador llama a `available_slots` y
  `book_appointment`, no recalcula horarios.
- **Errores tipados**: cada SQLSTATE del motor se traduce a una clase de
  `errors.ts` (tabla en el `README.md` raíz). Nadie fuera de este archivo mira
  códigos de Postgres.
- **Operaciones de varios pasos en una transacción** (reprogramar = cancelar +
  crear, D-36): si la nueva falla, la original queda intacta.
- `CreateBookingParams.manual` (Fase 4, PR-04, PI-14): la cita a mano del
  panel, que pasa `p_manual` a `book_appointment` (sin rejilla ni antelación;
  horario, festivos, solapes y margen siguen). **El núcleo nunca lo pone**, y
  mover una cita (`rescheduleBooking`, `changeExistingAndBook`) no lo hereda:
  el agente que mueve una cita cargada a mano sigue en la rejilla.
- Las **clientas no son del adaptador** (D-51): viven en `db/customers.ts`,
  porque son nuestras aunque la agenda esté en Google Calendar (Fase 7).

**Error nuevo del motor:** código `RA0NN` siguiente libre en la migración →
clase en `errors.ts` (con su `reason`) → traducción en `supabase.ts` → qué
dice el agente en `core/tools/common.ts → motivoYMensaje` → tabla de errores
del `README.md` raíz y de `docs/DECISIONES.md` (D-33).

**Adaptador nuevo** (Google Calendar, Fase 7): implementa la misma interfaz y
pasa los mismos tests que `tests/booking-adapter.test.ts`. Si la interfaz se
queda corta, se amplía `types.ts` para todos, no se hace un caso especial.

## channels/ — cada canal

Un canal convierte "llegó un mensaje por X" en una llamada a `runAgentTurn` y
devuelve la respuesta. Es donde viven las reglas **del canal**: sesión,
idempotencia, límites anti-abuso, tope mensual, registro de consumo y efectos
posteriores (SMS). Ver la cabecera de `web-widget.ts` para el orden exacto.

- Nunca reimplementa el loop del agente: lo llama.
- **Idempotencia por id del mensaje en el canal** → `messages.external_id`
  (maestro §9). Un reenvío devuelve la respuesta ya dada, sin llamar al modelo.
- **Un mensaje a la vez por conversación** (lock), por el historial
  solo-añadir (D-45).
- Los límites y el tope responden con texto fijo **sin llamar al modelo**.
- Nunca lanza por un fallo del turno: texto fijo con el teléfono del local.
- Un canal nuevo (WhatsApp) va en su propio archivo con la misma forma y
  reutiliza `db/usage.ts` y `citas/`.

## sms/ — `SmsProvider`

- Solo existe el proveedor de **prueba**, que imprime en la consola y marca el
  SMS como `prueba` (PW-07). **No se conecta ni se contrata un proveedor real
  sin que Mariana lo decida**; cuando pase, es otra implementación de la
  interfaz.
- `enviar` lanza si falla; quien llama marca el SMS `fallido` y **la cita
  sigue valiendo**.
- El texto del SMS no lleva datos de salud (solo negocio, día, hora y
  profesional) y en la base el enlace se guarda tapado.
- Hay dos SMS: el de **confirmación** al reservar o mover (PW-07, PW-09, con
  enlace) y el de **cancelación** al cancelar por el chat (PW-10, sin enlace;
  desde la página del enlace no se manda). Los textos están en
  `src/citas/confirmacion.ts`.

## Si cambiás algo de acá

**Obligatorio:** si tu cambio toca la arquitectura, una regla de negocio o la
forma de trabajo de esta carpeta, actualizá este `AGENTS.md` (y el raíz si
aplica) en el mismo cambio. Ver §8 del [`AGENTS.md` raíz](../../AGENTS.md#8-mantener-esta-documentación).

- La interfaz `BookingAdapter` o `SmsProvider` → todas sus implementaciones,
  sus tests y la cabecera de `types.ts`.
- Un canal nuevo → este archivo, el árbol de `src/AGENTS.md` y el spec de su
  fase.
