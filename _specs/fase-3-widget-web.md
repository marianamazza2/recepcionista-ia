# FASE 3 — CANAL WIDGET WEB  ⭐ HITO DEMOSTRABLE
### Spec de ejecución · Recepcionista IA
**Depende de:** `mazzmkt-recepcionista-ia-spec.md` (maestro, sobre todo §3.2, §9 y §10), `decisiones-producto.md` (reglas de negocio, incluidas PA-01 a PA-12 y las propuestas PW de esta fase), `fase-2-nucleo-agente.md` (ya cerrada) y `docs/DECISIONES.md` (sobre todo la sección Fase 2: D-44 a D-60). Leer los cuatro antes de empezar.

---

## OBJETIVO DE ESTA FASE

Poner el agente de la Fase 2 **en una web**: una burbuja de chat que el negocio pega en su página con una línea de código, un endpoint que recibe los mensajes y llama al mismo núcleo, y el registro de lo que consume cada negocio para saber el margen.

Con esto ya se puede **enseñar y vender**. El núcleo del agente (`src/core/`) **no cambia** salvo lo imprescindible: esta fase es un canal más (maestro §3.1).

### Criterio de "terminada" (Definition of Done)

1. Existe un **endpoint de chat** que resuelve el negocio por la **clave pública del widget**, abre o retoma la conversación del navegador y responde con el núcleo de la Fase 2.
2. Existe el **widget embebible**: un `<script>` que se pega en cualquier web y muestra la burbuja con la marca del negocio (PW-01), el aviso de privacidad (PW-02) y el indicador "escribiendo…".
3. **Idempotencia:** si el navegador reenvía el mismo mensaje (red lenta, doble clic), no se procesa dos veces ni se reserva dos veces (maestro §9, `messages.external_id`).
4. **Consumo:** cada mensaje deja su registro en `usage_events` (mensajes, tokens y coste) y hay un **tope mensual por negocio** (PW-04).
5. **Protección de un endpoint público:** solo responde desde los dominios del negocio (PW-06), con límites de tamaño y de ritmo (PW-05); una conversación solo la puede leer y escribir el navegador que la empezó.
6. **Confirmación de la reserva (PA-09, PW-07):** al reservar se genera el SMS con el enlace a la página de la cita; la página permite ver y cancelar la cita.
7. **Demo:** una web de prueba de Estética Aurora con el widget pegado (`npm run dev`), donde Mariana escribe desde el navegador y **acaba con una cita real en la base**.
8. Todos los tests anteriores siguen pasando: `npm run test:sql` y `npm test` en verde, en local y en Supabase, y `npm run agent:eval` 9/9.

---

## DECISIONES DE PRODUCTO DEL WIDGET (⚠️ POR CONFIRMAR)

Aparecieron al escribir este spec. Están en `decisiones-producto.md` (PW-01 a PW-08) con el detalle. **Mariana tiene que confirmarlas o cambiarlas antes de lanzar la fase.** Si alguna cambia, manda `decisiones-producto.md`.

| # | Tema | Propuesta de serie |
|---|---|---|
| PW-01 | Marca del widget | Solo la del negocio (nombre y color). El nombre del producto (PD-07) no aparece hasta que exista; entonces, como mucho, un "Funciona con …" pequeño |
| PW-02 | Aviso de privacidad | Antes del primer mensaje, una línea fija: "Asistente virtual. Al escribir aceptas la política de privacidad de {negocio}", con enlace si el negocio tiene URL de privacidad |
| PW-03 | Cuánto dura la conversación en el navegador | Si vuelve antes de **24 h**, la retoma y ve los mensajes; después empieza una nueva |
| PW-04 | Tope mensual por negocio | **100 US$/mes** de coste del agente (≈ 2.000 conversaciones con Opus 5), ajustable por negocio. Al 100 %, el widget responde con un mensaje fijo con el teléfono del local. Al 80 %, aviso en el informe de consumo |
| PW-05 | Límites anti-abuso | Mensajes de hasta **1.000 caracteres**; como mucho **20 mensajes por conversación y hora** y **10 conversaciones nuevas por hora** desde la misma IP. Al pasarse: mensaje fijo amable |
| PW-06 | Dónde puede ir el widget | Solo en los **dominios que indique el negocio** (lista por negocio). En otra web no carga. En la demo local, `localhost` |
| PW-07 | SMS de confirmación (PA-09) | Se construye todo **menos el envío real**: el texto y el enlace se generan y se guardan, y un proveedor de prueba los muestra en la consola. El proveedor real se elige y se conecta cuando Mariana lo decida. La página del enlace muestra la cita y permite **cancelarla** (con PR-07); para cambiarla, remite al chat o al teléfono |
| PW-08 | La demo pública | Primero en local. Después, con el visto bueno de Mariana, en **Vercel** contra el Supabase de la nube, para enseñarla con un enlace |

**Siguen abiertas y no bloquean la fase:** PD-07 (nombre del producto), PD-08 (piloto) y **PD-11 (RGPD y retención)**. En la Fase 3 **no se borra nada**: la retención se decide con PD-11 antes del primer cliente sanitario y se implementa entonces.

---

## CONTEXTO TÉCNICO

- El núcleo existe: `runAgentTurn(deps, { config, conversationId, mensaje })` en `src/core/agent.ts` devuelve `{ texto, escalada, motivoFin, usage, … }` y ya guarda los mensajes. El endpoint **lo llama**, no lo reimplementa.
- La conversación ya admite clienta anónima (`conversations.customer_id` NULL hasta `identificar_cliente`).
- `messages.external_id` con `UNIQUE (business_id, external_id)` ya existe para la idempotencia (D-13).
- `usage_events` existe (Fase 0) y está vacía. Su `coste_estimado` dice EUR en el comentario, pero los precios de la API están en US$ (`src/core/costes.ts`): **guardar en US$ y corregir el comentario** en una migración (anotarlo en DECISIONES).
- Hosting: **Vercel Functions** (maestro §4), Node 22, handlers con `Request`/`Response` estándar para que el mismo código corra en local con un servidor mínimo. Verificar la forma exacta contra la documentación de Vercel antes de escribirla.
- Base desde Vercel: el pooler de Supabase. Los locks son `pg_advisory_xact_lock` (de transacción) y el cliente usa `prepare: false`, así que el modo transacción (puerto 6543) sirve; verificarlo con el test de concurrencia contra ese puerto.
- Una llamada al agente tarda 4–15 s, y como mucho ~3 × 60 s con reintentos (D-48). La función necesita un `maxDuration` suficiente y el widget un indicador "escribiendo…".
- Las claves (`ANTHROPIC_API_KEY`, base) solo en el servidor. **Al navegador no llega nada secreto**: la clave del widget es pública por diseño; lo que protege es el dominio, los límites y el token de sesión.

## TAREAS

### 3.1 — Base de datos

Una migración nueva (no se tocan las anteriores):

- `businesses`: `widget_key` (pública, única, aleatoria), `widget_dominios text[]` (PW-06), `widget_color`, `privacidad_url` (PW-02) y `tope_mensual_usd` (PW-04, de serie 100).
- `conversations`: `session_token_hash` (el navegador guarda el token; la base, solo su hash) y lo que haga falta para PW-03.
- `usage_events`: comentario de `coste_estimado` en US$; enlazar cada evento con su conversación si sirve para el informe.
- Tabla para los **SMS** (PW-07): negocio, cita, teléfono, texto, estado (`pendiente`/`enviado`/`fallido`/`prueba`), proveedor, fechas. Y el **token del enlace** de la cita (aleatorio, solo su hash en la base, con caducidad al pasar la cita).
- RLS en todo lo nuevo, como el resto (maestro §3.3). Seed: Aurora con su `widget_key` fija y `localhost` en sus dominios.
- Tests SQL para lo nuevo.

### 3.2 — Endpoint de chat

`src/api/` (maestro §10) con handlers estándar:

| Ruta | Qué hace |
|---|---|
| `GET /api/widget/config?key=…` | Lo público del negocio para pintar el widget: nombre, color, bienvenida, aviso de privacidad. Nada más |
| `POST /api/chat` | `{ key, sessionToken?, clientMessageId, texto }` → `{ sessionToken, respuesta, escalada }`. Resuelve el negocio, comprueba dominio y límites, abre o retoma la conversación, llama a `runAgentTurn` y registra el consumo |
| `GET /api/chat/historial` | Con el token de sesión, los mensajes visibles de la conversación (para retomarla al recargar, PW-03) |
| `GET/POST /cita/:token` | La página del enlace del SMS (3.5) |

- **Origen:** se comprueba la cabecera `Origin` contra `widget_dominios` y se responde con CORS solo para ese origen.
- **Sesión:** el primer mensaje crea la conversación y devuelve un token aleatorio; los siguientes lo traen. Sin token válido no se lee ni se escribe una conversación (el id de conversación nunca viaja solo).
- **Idempotencia:** `clientMessageId` (uuid del navegador) va a `messages.external_id`. Si ya existe, se devuelve la respuesta ya dada, sin llamar al modelo. Dos peticiones simultáneas con el mismo id: entra una (lo garantiza el `UNIQUE`); test de concurrencia.
- **Mensajes en orden:** dos mensajes distintos a la vez de la misma conversación se procesan de uno en uno (lock por conversación), para no romper el historial solo-añadir (D-45).
- **Errores:** nunca se devuelve un error interno al navegador. Si el agente falla, el texto fijo de la Fase 2 con el teléfono del local.

### 3.3 — Consumo y tope mensual

`src/core/consumo.ts` (o `src/db/usage.ts`):

- Tras cada turno: un evento `mensaje` (1), uno `token` (total) y el coste en US$ con `costes.ts`. Al crear una cita, un evento `cita`.
- Antes de llamar al modelo: si el coste del mes del negocio llegó a `tope_mensual_usd`, respuesta fija con el teléfono (PW-04), sin llamar a la API.
- `npm run consumo -- --negocio estetica-aurora [--mes 2026-10]`: mensajes, conversaciones, citas, tokens, coste y % del tope.

### 3.4 — El widget

`widget/` (maestro §10): TypeScript sin framework, empaquetado en **un solo archivo** `widget.js` (esbuild) que se carga así:

```html
<script src="https://…/widget.js" data-key="CLAVE_PUBLICA" async></script>
```

- Botón flotante → panel de chat. **Shadow DOM** para que los estilos de la web del negocio no lo rompan ni al revés.
- Cabecera con el nombre y el color del negocio (PW-01), bienvenida, aviso de privacidad (PW-02).
- "Escribiendo…" mientras espera; si tarda más de 60 s, mensaje amable y opción de reintentar (mismo `clientMessageId`).
- Guarda el token de sesión en `localStorage` (PW-03); si no hay `localStorage`, funciona igual sin retomar.
- Accesible y usable en el móvil (pantalla completa en pantallas pequeñas). Sin cookies de terceros, sin analítica.
- Ligero: sin dependencias de ejecución.

### 3.5 — Confirmación por SMS (PA-09, PW-07)

- Interfaz `SmsProvider` (`src/adapters/sms/types.ts`) y un **proveedor de prueba** que imprime el SMS en la consola y lo marca `prueba`. Ningún proveedor real en esta fase (no se elige ni se contrata nada).
- Al crear una cita (la herramienta `crear_reserva` o justo después del turno): se genera el token del enlace, el texto y se "envía". Si el envío falla, **la reserva sigue valiendo** y queda el SMS `fallido` para reintentar.
- Texto propuesto: "{negocio}: cita confirmada el {día} a las {hora} con {profesional}. Para verla o cancelarla: {enlace}". Español, sin datos de salud.
- Página `/cita/:token`: muestra la cita y un botón **Cancelar** que aplica PR-07 igual que el agente (si el modo es `bloquear` y está dentro del plazo, no cancela y da el teléfono). Para cambiar la cita: "escríbenos en el chat de la web o llama al {teléfono}".

### 3.6 — La demo

- `demo/index.html`: una página sencilla de "Estética Aurora" (inventada, sin marcas reales) con el widget pegado.
- `npm run dev`: un servidor local que sirve la demo, el `widget.js` y las rutas de `src/api/` contra el Postgres local.
- Al final, y **solo con el visto bueno de Mariana** (PW-08): despliegue en Vercel contra Supabase en la nube. Las variables se ponen en Vercel, nunca en el repo ni en el chat.

### 3.7 — Tests

**Sin coste (`npm test`, con el modelo simulado de la Fase 2):**
- `widget/config`: devuelve solo lo público; clave inexistente → 404.
- `chat`: dominio no permitido → rechazado; sin token no se puede leer otra conversación; token de otro negocio → rechazado.
- Idempotencia: el mismo `clientMessageId` dos veces (y dos a la vez) → un solo turno, la misma respuesta, una sola cita.
- Orden: dos mensajes simultáneos de la misma conversación → el historial queda bien.
- Límites PW-05 y tope PW-04 → respuesta fija sin llamar al modelo.
- `usage_events`: cada turno deja sus eventos con el coste esperado.
- PW-03: después de 24 h empieza una conversación nueva.
- SMS: reservar genera un SMS `prueba` con enlace; la página del enlace cancela; PR-07 `bloquear` no cancela; un token caducado o inventado no muestra nada.

**Con el navegador:** una prueba de punta a punta que abra la demo, escriba y compruebe que aparece la respuesta (Playwright o similar, con el modelo simulado). Si añade demasiada complejidad, se deja como comprobación manual y se anota.

**Con el modelo real:** los 9 escenarios de la Fase 2 siguen en 9/9 (no deberían cambiar).

### 3.8 — Documentación

- `docs/DECISIONES.md`: sección **Fase 3** (forma de los handlers, sesión, idempotencia, lock por conversación, moneda de `usage_events`, SMS).
- `README.md`: estado "Fase 3 terminada", cómo arrancar la demo, cómo pegar el widget, cómo ver el consumo.
- `.env.example`: variables nuevas sin valores secretos.
- Si aparece una decisión de producto nueva: a `decisiones-producto.md` como ⚠️ por confirmar, y avisar a Mariana. **Y siempre al manual "Cómo funciona el Recepcionista" de Research Desk** (y al cuestionario si hay un ajuste nuevo por negocio: dominios, color, URL de privacidad, tope).

---

## FUERA DEL ALCANCE DE LA FASE 3

- Proveedor real de SMS → cuando Mariana lo elija (PW-07).
- Panel interno, alta de negocios, generar la clave del widget desde una pantalla, ver conversaciones → Fase 4 (en esta fase, por SQL o seed).
- Retención y borrado de conversaciones → con PD-11.
- Respuestas en streaming (palabra a palabra) → solo si la espera molesta en la demo.
- Base de conocimiento → Fase 5. Recordatorios → Fase 6. WhatsApp → Fase 8.

---

## ORDEN DE TRABAJO SUGERIDO PARA CLAUDE CODE

1. Leer los documentos de "Depende de".
2. Migración y tests SQL (3.1). Verde.
3. Consumo y tope (3.3) con tests.
4. Endpoint (3.2) con el modelo simulado: sesión, dominio, idempotencia, orden, límites. Verde.
5. SMS de prueba y página de la cita (3.5). Verde.
6. Widget (3.4) y demo local (3.6). Probar una conversación real en el navegador con la clave de Mariana.
7. `npm run agent:eval` 9/9 y verificación en Supabase (`./scripts/con-supabase.sh npm test`), incluido el pooler en modo transacción.
8. Documentación (3.8).
9. Despliegue en Vercel **solo si Mariana lo confirma**.

Trabajar contra el Postgres local (`recepcionista_dev`). No apagar ni reiniciar Postgres sin avisar.

---

## PROMPT DE ARRANQUE (para pegar en Claude Code, sesión fresca en el repo)

> Leé `_specs/mazzmkt-recepcionista-ia-spec.md` (maestro), `_specs/decisiones-producto.md` (reglas de negocio, incluidas las PW-01 a PW-08 del widget), `_specs/fase-3-widget-web.md` (esta fase) y `docs/DECISIONES.md` (decisiones técnicas de las fases 0 a 2). Implementá la Fase 3 completa siguiendo el spec de fase, en el orden sugerido: migración, consumo y tope mensual, el endpoint de chat con sesión, dominio, idempotencia y límites, el SMS de confirmación con proveedor de prueba y la página de la cita, el widget embebible y la demo local de Estética Aurora, y los tests. No cambies el núcleo del agente salvo lo imprescindible. La clave `ANTHROPIC_API_KEY` ya está en `.env`: no me la pidas ni la muestres. Trabajá contra el Postgres local `recepcionista_dev` y no lo apagues. Todos los tests, los de las fases anteriores incluidos, tienen que pasar, en local y en Supabase. No despliegues en Vercel ni contrates nada sin preguntarme. Si aparece una decisión de producto que no está en `decisiones-producto.md`, no la inventes: anotala como propuesta por confirmar y avisame. Actualizá también el manual "Cómo funciona el Recepcionista" y el cuestionario de alta de Research Desk. Explicame al final, en lenguaje simple, qué hiciste y cómo lo verifico yo.

---

## CÓMO SABÉS QUE PODÉS PASAR A LA FASE 4

1. `npm run test:sql` y `npm test` → todo en verde, en local y en Supabase.
2. `npm run agent:eval` → 9/9.
3. Abrís la demo en el navegador, escribís y te da una cita que ves en la base. Ves el SMS de prueba en la consola, abrís su enlace y la podés cancelar.
4. Recargás la página y la conversación sigue; desde otro navegador no la ves.
5. `npm run consumo` muestra lo que costó tu prueba.

Recién ahí, commit y sesión nueva para la Fase 4.
