# RECEPCIONISTA IA — ALCANCE Y ESPECIFICACIÓN TÉCNICA
### Documento maestro para desarrollo · MAZZMKT
**Versión 0.2 — canal MVP: widget web (WhatsApp movido a backlog)**

> **Cómo usar este doc:** es el spec raíz. Está pensado para tu flujo habitual: leerlo, ajustarlo, y después ejecutar fase por fase en sesiones frescas de Claude Code. Cada fase tiene su prompt de arranque al final. Lo marcado con 🔲 es una decisión que todavía tenés que tomar vos.

> **Nota de la v0.2:** el canal de arranque cambió de WhatsApp a **widget web**. Razón: WhatsApp (Cloud API) exige verificación de negocio con Meta y documentación legal de empresa, dos trámites que no queremos en el camino crítico del MVP. El widget web corre 100% en nuestra infraestructura, sin trámites, y el agente que hay detrás es exactamente el mismo. WhatsApp queda en el backlog como segundo canal, listo para enchufar cuando el producto esté validado (la arquitectura de canales ya lo prevé).

---

## 1. QUÉ ESTAMOS CONSTRUYENDO

Un **producto multi-cliente (SaaS)**: un solo motor de agente conversacional que atiende, responde y agenda citas, y que se adapta a cada negocio mediante **configuración, no código**. En el MVP el canal es un **widget de chat embebible en la web del cliente**; WhatsApp se suma después.

**La regla de oro del proyecto:**
> Un motor. Muchas configuraciones. Si para un cliente nuevo hay que tocar el código del núcleo, algo se diseñó mal.

**Lo que vendemos:** acceso a una instancia configurada dentro de nuestro sistema. El agente corre en nuestra infraestructura; el cliente no recibe código ni se lleva nada. Por eso el modelo es setup inicial + cuota mensual.

**Modelo de negocio que el sistema tiene que soportar:**
- Setup inicial: 300–800 € (una vez)
- Cuota mensual: 300–500 € (cliente chico, canal texto) / 500–800 € (con CRM externo o multi-sede)
- Implica: el sistema debe **medir consumo por cliente** desde el día uno, para saber el margen real.

---

## 1.B A QUIÉN LE VENDEMOS (sector objetivo)

El canal define el cliente. Como el MVP es **widget web**, apuntamos a negocios donde la web *es* el canal natural de reserva: gente que busca en Google, investiga antes de decidir y entra a una web donde el chat vive. La regla no es "¿este negocio usa web?", es **"cuando alguien quiere turno, ¿entra a una web o manda un WhatsApp?"**.

### Clientes del MVP (canal web) — a estos les vendemos ahora

Patrón común: **ticket alto + decisión pensada + web como parte del proceso**. Coincide con los rubros de mejor pricing.

| Sector | Por qué encaja con el widget web |
|---|---|
| **Clínicas dentales** | Se busca "dentista + zona", se compara, se entra a la web. El widget capta ahí. Ticket alto. |
| **Estética / medicina estética** | Mucha investigación previa, ticket alto, web como escaparate. |
| **Fisioterapia, capilar, nutrición, psicología** | Se busca, se entra a la web, se decide. Cita formal. |
| **Inmobiliarias** | La web *es* el negocio; el visitante ya está ahí. El agente capta el lead en caliente. |
| **Abogados, gestorías, consultores** | Ticket alto, se llega por web/recomendación, se pide cita formal. |

**Sector de arranque recomendado: dental + estética.** Cuatro razones que se refuerzan: (1) la web es su canal natural, el widget les sirve completo sin el "pero" de WhatsApp; (2) es donde el ticket es más alto, la cuota se justifica sola; (3) ya hay experiencia de producto previa en salud/estética; (4) es donde conviene ir despacio igual por el RGPD, así que empezar con pocos da tiempo a atar lo legal-sanitario antes de escalar.

**Matiz RGPD dentro de "estética":** un centro de *medicina* estética (médicos, tratamientos, historiales) es dato de salud pleno → RGPD serio. Una estética de belleza (uñas, cejas, faciales) no tanto. Punto de entrada más cómodo para arrancar: **centro de estética/belleza de gama media** con web y ticket decente, sin historiales médicos. Dental y médica estética se suman cuando el RGPD esté atado.

### Clientes en backlog — se desbloquean al activar WhatsApp

Estos negocios viven en WhatsApp: casi nadie entra a su web a reservar. Con solo widget web el producto les serviría a medias, así que **no se les vende en el MVP** — no son peores clientes, están en la cola correcta.

| Sector | Por qué esperan a WhatsApp |
|---|---|
| **Peluquerías y barberías** | Reserva por WhatsApp o pasando por el local. Canal WhatsApp puro. |
| **Uñas, estética exprés** | Mismo patrón, ticket más bajo. |
| **Gimnasios de barrio, estudios pequeños** | Contacto informal, WhatsApp. |

**Disparador para desbloquear este backlog:** cuando WhatsApp Cloud API esté activo (empresa dada de alta + verificación de Meta hecha + canal integrado). Ver Fase "WhatsApp" en el plan.

---

## 2. ALCANCE DEL MVP

### 2.1 Dentro del alcance (v1)

| # | Capacidad | Detalle |
|---|---|---|
| 1 | Conversación por **widget web** | Chat embebible en la web del cliente. Entiende lenguaje natural, mantiene contexto |
| 2 | Consultar disponibilidad | Devuelve huecos reales según servicio, profesional y horario |
| 3 | Reservar cita | **Nunca solapa dos citas en el mismo hueco** (garantía a nivel base de datos) |
| 4 | Cancelar y reprogramar | El cliente final lo hace desde el chat |
| 5 | Responder preguntas frecuentes | Precios, servicios, dirección, políticas — desde la config y la base de conocimiento |
| 6 | Derivar a humano | Cuando no entiende, cuando lo piden, o ante temas delicados |
| 7 | Recordatorios | Aviso automático antes de la cita para reducir ausencias |
| 8 | Multi-cliente real | Un mismo despliegue atiende a N negocios, aislados entre sí |
| 9 | Medición de uso | Tokens, mensajes y citas por cliente, para costear el margen |

### 2.2 Fuera del alcance (v1) — explícitamente

- ❌ **WhatsApp como canal.** Movido al backlog. Exige verificación de Meta + empresa dada de alta; fuera del camino crítico del MVP. Se enchufa como segundo canal cuando el producto esté validado y lo legal resuelto. Es lo que desbloquea el sector peluquerías/barberías.
- ❌ **Voz telefónica.** Es otro producto. Se evalúa cuando haya 5 clientes de texto pagando y contentos.
- ❌ **Panel self-service para el cliente.** En v1 la config la cargás vos.
- ❌ **Cobros / pagos dentro del chat.** Stripe entra más adelante si un cliente lo exige.
- ❌ **Integraciones con CRMs externos.** Solo el backend propio en v1. Google Calendar más adelante.
- ❌ **Multi-idioma.** Español (España) únicamente. La arquitectura no lo impide, pero no se trabaja ahora.
- ❌ **Instagram.** Canal futuro; la arquitectura de canales lo deja preparado.

### 2.3 Definición de "terminado" para el MVP

El MVP está listo cuando **un negocio real** (no vos, no una demo) tiene el widget en su web, sus clientes escriben por ahí, el agente les agenda citas correctamente, y esas citas aparecen en la agenda que ese negocio consulta todos los días. Todo lo demás es secundario.

---

## 3. ARQUITECTURA

### 3.1 Las cuatro capas

```
┌─────────────────────────────────────────────┐
│  CANAL          WhatsApp · (web) · (IG)     │  ← cómo entra el mensaje
├─────────────────────────────────────────────┤
│  NÚCLEO         Loop del agente + tools     │  ← idéntico para todos
│                 Prompt · memoria · guardrails│
├─────────────────────────────────────────────┤
│  CONFIGURACIÓN  Datos del negocio (Supabase)│  ← lo que cambia por cliente
│                 + base de conocimiento (RAG) │
├─────────────────────────────────────────────┤
│  ADAPTADORES    Supabase · (Google Cal)     │  ← dónde vive la agenda real
└─────────────────────────────────────────────┘
```

### 3.2 Flujo de un mensaje (el recorrido completo)

```
1. Llega webhook de WhatsApp
2. Identificar tenant → ¿de qué negocio es este número?
3. Cargar config del negocio + historial de la conversación
4. Construir system prompt con la config (nombre, servicios, tono, políticas)
5. Loop del agente:
     LLM decide → ¿necesita una tool?
       sí → ejecutar tool (vía adaptador) → devolver resultado al LLM → repetir
       no → responder
6. Guardar mensajes en el historial
7. Registrar consumo (tokens, coste) para ese tenant
8. Enviar respuesta por WhatsApp
```

### 3.3 Principio de aislamiento

**Todo el sistema es multi-tenant desde la primera línea de código.** Nunca existe una tabla o consulta sin `business_id`. Row Level Security activo en todas las tablas. No se "añade multi-tenancy después" — es la base.

---

## 4. STACK TECNOLÓGICO

| Capa | Elección | Por qué |
|---|---|---|
| **Runtime del agente** | Node/TypeScript en Vercel Functions | Ya desplegás ahí, cero infra nueva |
| **LLM** | Claude (Anthropic API), con tool use | Tool use nativo y fiable, que es el corazón del agente |
| **Base de datos** | Supabase (Postgres) | Ya lo dominás; RLS resuelve multi-tenancy de raíz |
| **RAG / embeddings** | pgvector dentro de Supabase | No sumar otra base; vive donde ya está todo |
| **Canal** | WhatsApp Cloud API (Meta, directo) | Sin intermediario y sin coste extra por mensaje |
| **Panel interno** | React + Vite + Tailwind | Tu stack de siempre |
| **Hosting** | Vercel | Idem |
| **Jobs / recordatorios** | Supabase `pg_cron` o Vercel Cron | Para los avisos previos a la cita |

**Decisión pendiente 🔲:** WhatsApp Cloud API directo vs. un proveedor tipo 360dialog. Directo es más barato y sin intermediarios, pero la verificación de negocio de Meta es un trámite lento. Vale la pena empezar el trámite **ya**, en paralelo al desarrollo, porque es lo que más te puede frenar.

---

## 5. MODELO DE DATOS

Esquema base. Todas las tablas llevan `business_id` (salvo `businesses`) y RLS activo.

### 5.1 Tenant y configuración

**`businesses`** — un registro por cliente que te paga
```
id, nombre, slug, timezone, sector, estado (activo/pausado/trial),
plan, whatsapp_phone_number_id, tono_de_voz, mensaje_bienvenida,
politica_cancelacion, direccion, telefono_humano, created_at
```

**`services`** — qué vende cada negocio
```
id, business_id, nombre, descripcion, duracion_min, buffer_min,
precio, precio_visible (bool), activo
```

**`staff`** — profesionales o recursos (sillón, sala, box)
```
id, business_id, nombre, activo
```

**`staff_services`** — qué servicio puede dar cada profesional
```
staff_id, service_id
```

**`business_hours`** — horario de atención
```
id, business_id, staff_id (nullable = aplica a todos),
weekday (0-6), hora_apertura, hora_cierre
```

**`time_off`** — festivos, vacaciones, bloqueos puntuales
```
id, business_id, staff_id (nullable), desde, hasta, motivo
```

### 5.2 Operación

**`customers`** — clientes finales del negocio
```
id, business_id, telefono, nombre, email, notas, created_at
UNIQUE (business_id, telefono)
```

**`appointments`** — el corazón del sistema
```
id, business_id, staff_id, service_id, customer_id,
start_at (timestamptz), end_at (timestamptz),
estado (confirmada/cancelada/completada/no_show),
origen (agente/manual/externo), external_id, notas, created_at
```

**🔒 GARANTÍA ANTI-SOLAPAMIENTO** — esto es innegociable y va a nivel de base de datos, no de código:

```sql
ALTER TABLE appointments ADD CONSTRAINT no_overlap
EXCLUDE USING gist (
  staff_id WITH =,
  tstzrange(start_at, end_at) WITH &&
) WHERE (estado <> 'cancelada');
```

Con eso, aunque dos personas intenten reservar el mismo hueco en el mismo milisegundo, Postgres rechaza la segunda. **No confiamos en que el LLM "no se equivoque": lo hacemos imposible.** Encima de esa restricción va un RPC atómico `book_appointment()` que valida horario, festivos y disponibilidad antes de insertar.

### 5.3 Conversación

**`conversations`** — un hilo por cliente final
```
id, business_id, customer_id, canal, estado (activa/escalada/cerrada),
ultimo_mensaje_at
```

**`messages`**
```
id, conversation_id, rol (user/assistant/tool), contenido,
tool_calls (jsonb), tokens_in, tokens_out, created_at
```

**`escalations`** — cuando pasa a un humano
```
id, business_id, conversation_id, motivo, resuelta, created_at
```

### 5.4 Conocimiento (RAG)

**`knowledge_docs`**
```
id, business_id, titulo, tipo (pdf/texto/faq), contenido_raw, created_at
```

**`knowledge_chunks`**
```
id, business_id, doc_id, contenido, embedding vector(1024)
```

### 5.5 Integraciones y consumo

**`integrations`**
```
id, business_id, tipo (supabase/google_calendar/calcom),
credenciales (cifradas), config (jsonb), activa
```

**`usage_events`** — para saber tu margen real
```
id, business_id, tipo (mensaje/token/cita), cantidad, coste_estimado, created_at
```

---

## 6. LAS HERRAMIENTAS DEL AGENTE (tool use)

El agente **solo** puede actuar a través de estas funciones. No inventa, no improvisa acciones.

| Tool | Qué hace |
|---|---|
| `consultar_disponibilidad` | Devuelve huecos libres para un servicio en un rango de fechas |
| `crear_reserva` | Agenda la cita (pasa por el RPC atómico) |
| `cancelar_reserva` | Cancela una cita existente |
| `reprogramar_reserva` | Mueve una cita a otro hueco |
| `buscar_reservas_cliente` | Encuentra las citas de ese teléfono |
| `buscar_en_conocimiento` | Búsqueda semántica en los documentos del negocio |
| `derivar_a_humano` | Marca escalación y avisa al negocio |

**Regla dura:** el agente **nunca** afirma un precio, horario o disponibilidad que no venga de una tool o de la config. Si no lo encuentra, lo dice y ofrece derivar. Esto va en el system prompt y se verifica en los tests.

---

## 7. LA INTERFAZ DE ADAPTADORES

El núcleo habla contra este contrato y nunca sabe qué hay detrás.

```typescript
interface BookingAdapter {
  getAvailability(params: {
    businessId: string;
    serviceId: string;
    staffId?: string;
    from: Date;
    to: Date;
  }): Promise<TimeSlot[]>;

  createBooking(params: CreateBookingParams): Promise<Booking>;

  cancelBooking(bookingId: string): Promise<void>;

  rescheduleBooking(bookingId: string, newStart: Date): Promise<Booking>;

  listBookings(params: { customerId: string }): Promise<Booking[]>;
}
```

**Implementaciones:**
- `SupabaseAdapter` — **v1**. La agenda vive en nuestra base. Para clientes sin sistema propio (la mayoría).
- `GoogleCalendarAdapter` — Fase 5. Para el primero que lo exija.
- `CalComAdapter` / `CRMxAdapter` — solo cuando un cliente que ya paga lo pida.

**Criterio comercial derivado de esto:** si un cliente potencial tiene un software de agenda cerrado y sin API, la respuesta es *"migramos tu agenda a nuestro sistema"* o *"no es para vos"*. No se rompe la arquitectura por un cliente.

---

## 8. LO QUE VA EN EL PROMPT vs. LO QUE VA EN RAG

Separación que evita prompts gigantes y caros:

**Al system prompt (siempre, es corto):** nombre del negocio, sector, tono, horarios, lista de servicios con duración y precio, política de cancelación, dirección, cuándo derivar.

**A RAG (se busca solo si preguntan):** descripciones largas de tratamientos, procesos y postoperatorios, FAQs extensas, catálogos, condiciones detalladas.

**Criterio simple:** si el dato lo necesita en *toda* conversación → prompt. Si lo necesita *a veces* y es largo → RAG.

---

## 9. REQUISITOS NO FUNCIONALES

**Zonas horarias.** Todo en `timestamptz`, guardado en UTC, mostrado en el timezone del negocio. Es la fuente número uno de bugs en sistemas de citas.

**Idempotencia.** Los canales pueden reenviar el mismo mensaje. Guardar el ID de mensaje y descartar duplicados, o vas a agendar la misma cita dos veces. (Crítico sobre todo con WhatsApp/Meta en la Fase 8, pero se diseña desde el widget web.)

**Control de coste.** Límite de tokens por conversación y tope mensual por tenant. Sin esto, un cliente con un bucle raro te funde el margen.

**Guardrails.** El agente no da consejo médico, no negocia precios, no promete lo que no está en la config. Ante duda, deriva.

**Logs.** Toda conversación y toda tool call quedan registradas. Cuando un cliente diga "el agente dijo una barbaridad", necesitás poder mirarlo.

**⚠️ RGPD — atención especial.** Estás en España y tus mejores clientes son clínicas: eso significa **datos de salud, que son categoría especial** bajo el RGPD. Implica, como mínimo: contrato de encargado de tratamiento (DPA) firmado con cada cliente, base legal y consentimiento claros, política de retención con borrado real, cifrado, y saber exactamente qué datos salen hacia la API del LLM. No es un detalle legal para el final: **es parte del producto y un argumento de venta**, porque tus competidores improvisados no lo tienen. Conviene resolverlo con asesoría antes del primer cliente sanitario.

---

## 10. ESTRUCTURA DEL REPO (propuesta)

```
/
├── _specs/                     ← specs por fase (tu flujo habitual)
├── src/
│   ├── core/                   ← EL NÚCLEO. No se toca por cliente.
│   │   ├── agent.ts            ← loop del agente
│   │   ├── prompt.ts           ← constructor del system prompt
│   │   ├── tools/              ← definición y ejecución de tools
│   │   └── guardrails.ts
│   ├── adapters/
│   │   ├── booking/
│   │   │   ├── types.ts        ← la interfaz
│   │   │   ├── supabase.ts
│   │   │   └── google-calendar.ts   (fase 5)
│   │   └── channels/
│   │       ├── types.ts
│   │       ├── web-widget.ts       ← canal del MVP
│   │       └── whatsapp.ts         (backlog)
│   ├── config/                 ← carga de config del tenant
│   ├── knowledge/              ← ingesta y búsqueda RAG
│   └── api/
│       ├── chat/index.ts       ← endpoint del widget web (MVP)
│       ├── webhook/whatsapp.ts (backlog)
│       └── cron/reminders.ts
├── widget/                     ← el chat embebible (JS que va en la web del cliente)
├── supabase/
│   ├── migrations/
│   └── functions/              ← RPCs (book_appointment, etc.)
└── admin/                      ← panel interno (fase 4)
```

---

## 11. PLAN DE FASES

Orden pensado para que **cada fase se pueda probar sola** y para llegar lo antes posible a algo demostrable.

### Fase 0 — Cimientos
Repo, Supabase, migraciones del esquema completo, RLS, la restricción anti-solapamiento, seeds de un negocio ficticio de prueba.
*Terminada cuando:* podés insertar citas por SQL y la base **rechaza** una superpuesta.

### Fase 1 — Motor de reservas
`SupabaseAdapter` completo + RPC `book_appointment` atómico + cálculo de huecos libres (horarios, festivos, duración, buffers, multi-profesional).
*Terminada cuando:* tests que piden disponibilidad y reservan, con casos límite (festivo, fuera de horario, dos reservas simultáneas al mismo hueco).

### Fase 2 — Núcleo del agente
Loop con tool use, constructor de system prompt desde la config, memoria de conversación, guardrails. Probado por consola, sin canal todavía.
*Terminada cuando:* podés conversar por terminal con el agente de un negocio ficticio y agendar una cita real en la base.

### Fase 3 — Canal widget web  ⭐ HITO DEMOSTRABLE
Endpoint de chat + widget embebible (un `<script>` que el cliente pega en su web y aparece la burbuja de chat). Sesión de conversación, resolución de tenant por la clave pública del widget, envío/recepción de mensajes, registro de consumo en `usage_events`.
*Terminada cuando:* pegás el widget en una web de prueba, escribís desde el navegador y te agenda una cita. **Con esto ya se puede demostrar y vender.** Cero trámites externos.

### Fase 4 — Panel interno + onboarding
Formulario para dar de alta un negocio, cargar servicios, horarios, profesionales y FAQs, y generar la clave del widget. Visor de conversaciones. Es *tu* herramienta, no la del cliente.
*Terminada cuando:* podés dar de alta un cliente nuevo entero sin escribir SQL.

### Fase 5 — Base de conocimiento (RAG)
Subida de documentos, chunking, embeddings, tool de búsqueda semántica.
*Terminada cuando:* preguntás por un tratamiento que está solo en un PDF y responde bien.

### Fase 6 — Recordatorios y reducción de ausencias
Cron, avisos previos a la cita, confirmación/cancelación desde el recordatorio. (Por web/email en el MVP; por WhatsApp cuando ese canal esté activo.)

### Fase 7 — Adaptador Google Calendar
Solo cuando un cliente que ya paga lo pida.

### Fase 8 — Canal WhatsApp  🔓 DESBLOQUEA EL BACKLOG DE CLIENTES
Segundo canal. Requiere, en paralelo y **antes**: empresa dada de alta (para facturar/verificar) + verificación de negocio con Meta + número dedicado. Después: webhook, verificación, idempotencia por `message_id`, plantillas de Meta, resolución de tenant por número.
*Desbloquea:* peluquerías, barberías, uñas, gimnasios de barrio — todo el sector "WhatsApp-first" que quedó en backlog.
*Terminada cuando:* un negocio recibe reservas por su WhatsApp atendidas por el agente.

### Fase 9 — Panel del cliente (self-service)
Solo cuando el trabajo manual de onboarding se vuelva un cuello de botella real.

---

## 12. DECISIONES PENDIENTES 🔲

1. **Nombre del producto.** Necesita uno propio, separado de MAZZMKT (que es el estudio "soluciones digitales"). El recepcionista es un producto bajo ese paraguas, con su propia página.
2. **Negocio piloto real.** ¿Hay algún cliente actual o conocido del sector dental/estética que sirva de primer caso? Un piloto real (aunque sea gratis o a mitad de precio) vale más que cualquier demo, y da el testimonio para vender al resto.
3. **Precio de lanzamiento definitivo.** Cerrar el número final del setup y la cuota, sabiendo que no negociás precios.
4. **Alta de empresa (para facturar).** Aunque hoy factura tu pareja, conviene confirmar con un gestor cómo se factura este producto de forma limpia y sostenible. No bloquea el desarrollo ni la demo, pero sí el cobro al primer cliente. Nota: esto es también prerequisito de la Fase 8 (WhatsApp exige empresa verificable ante Meta).

**Decisiones ya cerradas (v0.2):**
- ✅ Canal del MVP: **widget web**. WhatsApp a la Fase 8.
- ✅ Sector del MVP: **dental + estética/belleza** (y por extensión, rubros "web-first": fisio, capilar, nutrición, psicología, inmobiliarias, abogados).
- ✅ Sector en backlog: **peluquerías, barberías, uñas, gimnasios** — se desbloquean con la Fase 8 (WhatsApp).

---

## 13. PROMPTS DE ARRANQUE PARA CLAUDE CODE

Un prompt por fase, sesión fresca cada uno. Todos asumen que este documento está en `_specs/`.

**Fase 0**
> Leé `_specs/recepcionista-ia-spec.md`. Implementá la Fase 0: proyecto Supabase con todas las migraciones del modelo de datos de la sección 5, RLS en todas las tablas por `business_id`, la restricción de exclusión anti-solapamiento, y seeds de un negocio ficticio (una peluquería con 3 servicios, 2 profesionales y horario de L-V). Escribí tests SQL que verifiquen que una cita superpuesta es rechazada.

**Fase 1**
> Leé `_specs/recepcionista-ia-spec.md`. Implementá la Fase 1: la interfaz `BookingAdapter` de la sección 7 y su implementación `SupabaseAdapter`, más el RPC atómico `book_appointment`. Incluí el cálculo de huecos libres teniendo en cuenta horarios, festivos, duración del servicio, buffers y disponibilidad por profesional. Tests para todos los casos límite.

**Fase 2**
> Leé `_specs/recepcionista-ia-spec.md`. Implementá la Fase 2: el núcleo del agente en `src/core/`. Loop con tool use contra la API de Claude, las 7 tools de la sección 6, el constructor de system prompt desde la config del tenant, memoria de conversación y los guardrails de la sección 9. Dejalo probable por terminal contra el negocio ficticio.

**Fase 3**
> Leé `_specs/recepcionista-ia-spec.md`. Implementá la Fase 3: canal widget web. Un endpoint de chat que recibe mensajes del widget, resuelve el tenant por la clave pública del widget, corre el núcleo del agente y devuelve la respuesta. Más el widget embebible: un script que el cliente pega en su web y muestra una burbuja de chat. Registrá consumo en `usage_events`. Sin dependencias externas ni trámites.

**Fase 8 (backlog — cuando se active WhatsApp)**
> Leé `_specs/recepcionista-ia-spec.md`. Implementá la Fase 8: canal WhatsApp Cloud API como segundo canal, reusando el mismo núcleo. Webhook con verificación e idempotencia por `message_id`, resolución de tenant por número, envío de respuestas con plantillas de Meta y registro de consumo. Requiere empresa verificada ante Meta y número dedicado ya aprovisionados.

---

## 14. RIESGOS

| Riesgo | Impacto | Cómo lo manejamos |
|---|---|---|
| Coste de tokens mayor al previsto | Se come el margen | `usage_events` desde el día uno + topes por tenant |
| Cliente con agenda cerrada sin API | Imposible de integrar | Criterio comercial: se migra o no es cliente |
| El agente responde algo incorrecto | Pérdida de confianza | Guardrails + solo datos de tools/config + logs completos |
| RGPD con datos de salud | Legal serio | Resolverlo antes del primer cliente sanitario |
| Construir de más antes de vender | Meses perdidos | **Fase 3 (widget web) es el corte**: con eso ya se demuestra y se vende |
| Verificación de Meta / alta de empresa | Bloquea WhatsApp | Sacado del camino crítico: es Fase 8, no MVP. Se tramita cuando el producto ya esté validado |
| Apuntar al sector equivocado en el MVP | Producto que sirve a medias | Solo sectores "web-first" ahora; peluquerías esperan a la Fase 8 |
