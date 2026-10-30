# FASE 4 — PANEL INTERNO Y ALTA DE NEGOCIOS
### Spec de ejecución · Recepcionista IA
**Depende de:** `mazzmkt-recepcionista-ia-spec.md` (maestro, sobre todo §4, §5, §8 y §11), `decisiones-producto.md` (reglas de negocio, incluidas las propuestas PI de esta fase), `fase-3-widget-web.md` (ya cerrada) y `docs/DECISIONES.md` (sobre todo la sección Fase 3: D-61 a D-75). Leer los cuatro antes de empezar.

---

## OBJETIVO DE ESTA FASE

Que puedas **dar de alta un negocio nuevo entero sin escribir SQL**: sus datos, servicios, profesionales, horarios, festivos, preguntas frecuentes y el chat de su web (dominios, color, logo, tope), y llevarte el código del widget listo para pegar. Y **ver lo que pasa**: la agenda y las conversaciones de cada negocio, las que pasaron a una persona y lo que se gasta. Desde la agenda, **cargar una cita a mano** saltándose la rejilla y la antelación, como prometía PR-04.

Es **tu** herramienta, no la del cliente (maestro §11). El panel del cliente es la Fase 9. El núcleo del agente (`src/core/`) **no cambia** salvo lo imprescindible para las preguntas frecuentes (4.7).

### Criterio de "terminada" (Definition of Done)

1. Existe el **panel** (`admin/`): una web que solo abre quien tenga cuenta (PI-01), en local con `npm run dev` y publicada en Vercel (PI-02).
2. **Alta de un negocio** desde cero, siguiendo los bloques del cuestionario de alta: datos del negocio, servicios, profesionales y qué hace cada una, horario del local y horarios propios, festivos y ausencias, reglas de reserva y cancelación, preguntas frecuentes y el chat en su web (dominios, color, logo, privacidad, tope).
3. **Editar** todo lo anterior en un negocio existente. Lo que tiene citas no se borra: se desactiva (PI-04).
4. **Listo para publicar:** el panel dice qué falta antes de activar un negocio y muestra el **código del widget** para copiar (PI-03, PI-09).
5. **Probar el chat** del negocio desde el panel antes de activarlo (PI-13).
6. **Visor de conversaciones:** por negocio, con lo que dijo cada parte, las herramientas que usó el agente, el coste y las derivaciones; las derivaciones se pueden marcar como resueltas (PI-06, PI-07).
7. **Consumo** del mes por negocio, con el % del tope y el aviso del 80 % (PI-11).
8. **Agenda:** las citas de cada negocio por día, y **cargar o cancelar una cita a mano** (PR-04, PI-14).
9. **Prueba de verdad:** das de alta un negocio inventado nuevo (no Aurora) solo con el panel, pegás su widget en una web de prueba y te da una cita.
10. Todos los tests anteriores siguen pasando: `npm run test:sql`, `npm test` y `npm run test:e2e` en verde, en local y en Supabase, y `npm run agent:eval` 12/12.

---

## DECISIONES DE PRODUCTO DEL PANEL (✅ CONFIRMADAS EL 28/10/2026)

Aparecieron al escribir este spec. Están en `decisiones-producto.md` (PI-01 a PI-14) con el detalle. **Mariana las confirmó todas el 28/10/2026.** Si alguna cambia, manda `decisiones-producto.md`.

| # | Tema | Propuesta de serie |
|---|---|---|
| PI-01 | Quién entra | Solo quien tenga cuenta (de momento, Mariana). Email y contraseña; **sin registro público**: las cuentas se crean a mano |
| PI-02 | Dónde vive | En el mismo proyecto de Vercel, con su propia dirección (por ejemplo `recepcionista-ia-panel.vercel.app`), y en local con `npm run dev` |
| PI-03 | Un negocio nuevo | Empieza **en prueba** (`trial`) y **sin dominios**: el widget no aparece en ninguna web hasta que lo actives. El panel muestra una lista de "lo que falta" y solo deja activar con lo mínimo completo |
| PI-04 | Borrar o desactivar | Servicios y profesionales **se desactivan**, no se borran (sus citas pasadas siguen ahí). Un negocio no se borra: se **pausa**. Festivos, horarios y preguntas sí se borran |
| PI-05 | Cuándo se aplican los cambios | Al guardar. El agente los usa **en el siguiente mensaje**; el widget, en unos minutos (su configuración se guarda 5 min en el navegador) |
| PI-06 | Qué se ve de una conversación | Todo: mensajes, herramientas que usó el agente y lo que le devolvieron, coste y derivación. Solo lo ve quien entra al panel |
| PI-07 | Derivaciones | Lista de pendientes por negocio, con enlace a la conversación; se marcan como **resueltas** a mano. Sin avisos por email todavía |
| PI-08 | Preguntas frecuentes | Pregunta y respuesta cortas, **dentro del prompt** del agente hasta que llegue la base de conocimiento (Fase 5). Como mucho ~20 preguntas o ~4.000 caracteres por negocio |
| PI-09 | La clave del widget | La genera la base al crear el negocio. El panel muestra el `<script>` listo para copiar. "Cambiar la clave" existe, con confirmación: la anterior deja de funcionar al momento |
| PI-10 | Subir el logo | PNG, JPG, SVG o WebP. Si pesa más de 150 KB, el panel lo **reduce solo** (a 256 × 256) antes de guardarlo. Vista previa en el círculo del chat |
| PI-11 | Consumo | Tabla del mes por negocio: mensajes, conversaciones, citas, coste y % del tope, con el aviso del 80 %. Lo mismo que `npm run consumo` |
| PI-12 | Festivos y ausencias | Del local o de una profesional, de un día entero o por horas, con motivo. Se ven los próximos; los pasados se ocultan |
| PI-13 | Probar el chat | Desde el panel se conversa con el agente del negocio aunque no esté activo. **Cuesta lo mismo** que una conversación real; se guarda marcada como **prueba** y el informe de consumo la separa |
| PI-14 | Citas a mano (PR-04) | Desde la agenda del panel: servicio, profesional, día y **cualquier hora** (fuera de la rejilla y sin antelación mínima), clienta por teléfono. Lo que **no** se salta: el horario, los festivos y que dos citas se pisen. Llega el mismo SMS de confirmación |

**Aparecieron al construir la fase (✅ decididas el 29/10/2026, en `decisiones-producto.md`):** PI-15 (las pruebas cuentan para el tope), PI-16 (el widget solo aparece con el negocio activo) y PI-17 (pausado: ni probar el chat ni citas a mano desde el panel). **Al probar el panel (29/10/2026):** PI-18 (un horario propio fuera del horario del local se permite, pero el panel avisa antes de guardar). **30/10/2026:** PI-19 (cada día de cada profesional: como el local, no trabaja u horas propias; amplía PD-01) y PI-20 ⚠️ por confirmar (si una profesional que no trabaja ningún día cuenta en "lo que falta").

**Siguen abiertas y no bloquean la fase:** PD-07 (nombre del producto), PD-08 (piloto), PD-11 (RGPD y retención) y PW-17 (qué muestra el círculo si un negocio no tiene logo). En la Fase 4 **no se borra nada** de conversaciones: la retención se decide con PD-11.

---

## CONTEXTO TÉCNICO

- **Stack del panel** (maestro §4): React + Vite + Tailwind, en `admin/` (maestro §10). Es una SPA que habla con **nuestra API** (`/api/admin/…`), no con Supabase directamente: el panel ve todos los negocios y la RLS es por negocio; las escrituras pasan por el servidor, que usa la misma conexión que el resto.
- **Cuentas** (PI-01): Supabase Auth con email y contraseña, registro público desactivado. El navegador manda el token de Supabase y el servidor lo **verifica** y comprueba que el usuario está en una lista de personas del panel (tabla nueva). Verificar la forma exacta contra la documentación de Supabase antes de escribirla. Ninguna clave de servicio llega al navegador.
- **Reutilizar, no duplicar:** las validaciones que ya están en la base (horarios, solapes, formatos de color, dominios y logo) **se quedan en la base**; el panel muestra el error con palabras. Lo que el agente lee del negocio sale de `src/config/business.ts`: si el panel guarda algo, el agente lo ve sin tocar `src/core/`.
- **Los cambios en caliente** (PI-05): el prompt se construye en cada mensaje desde la base; el primer mensaje tras un cambio "relee" las reglas (caché fría, ~5 céntimos más), así que no hace falta nada especial, pero conviene saberlo.
- **Preguntas frecuentes** (PI-08): se guardan en `knowledge_docs` con `tipo = 'faq'` (la tabla ya existe desde la Fase 0), así la Fase 5 las indexa sin migrar datos. Hasta entonces, `src/config/business.ts` las carga y `src/core/prompt.ts` las añade al prompt (el único cambio en el núcleo). Test de que ningún texto de negocio queda escrito en `src/core/` (regla de oro).
- **Probar el chat** (PI-13): reutiliza el canal web (`procesarMensajeWeb`) con una marca de prueba; no se salta límites ni tope.
- **Hosting:** el mismo proyecto de Vercel, con un tercer dominio. El build (`npm run build:vercel`) suma los estáticos del panel; la función de `/api/…` ya existe.

## TAREAS

### 4.1 — Base de datos

Una migración nueva (no se tocan las anteriores):

- **Personas del panel** (PI-01): quién puede entrar (el id de Supabase Auth y su email). Sin `business_id`: es la única tabla que no es de un negocio, con RLS sin política (solo el servidor la lee).
- `knowledge_docs`: lo que haga falta para las preguntas frecuentes (pregunta, respuesta y orden), sin romper lo que espera la Fase 5.
- `conversations`: marca de **prueba** (PI-13), y que el consumo pueda separarla.
- Lo que falte para PI-04 (desactivar) y PI-12 (festivos por horas): revisar antes, puede que ya esté.
- Tests SQL para lo nuevo.

### 4.2 — Cuentas y API del panel

`src/api/admin/` con handlers estándar, como los del widget:

- Verificar el token en **cada** petición; sin cuenta válida, 401. Ninguna ruta del panel responde a la clave del widget.
- Rutas para: listar y crear negocios; leer y guardar cada bloque (datos, reglas, chat, servicios, profesionales, horarios, festivos, preguntas); "lo que falta" y activar/pausar (PI-03); cambiar la clave (PI-09); conversaciones, derivaciones y consumo (PI-06, PI-07, PI-11); agenda y citas a mano (PI-14); probar el chat (PI-13).
- Toda consulta filtra por `business_id` aunque la conexión haga BYPASSRLS (T-03).
- Errores de la base → mensaje en palabras para el panel, nunca el error interno.
- Un script para crear la cuenta de Mariana sin tocar SQL a mano (`npm run panel:cuenta -- --email …`); la contraseña la escribe ella, nunca en el chat.

### 4.3 — El panel: negocios y alta

`admin/` (React + Vite + Tailwind):

- Entrar / salir. Lista de negocios con su estado (prueba, activo, pausado) y lo que falta.
- **Alta y edición** por bloques, en el mismo orden que el cuestionario de alta de Research Desk: negocio, servicios, profesionales, horarios, festivos, reglas, preguntas frecuentes, el chat en su web.
- Horario semanal del local y horarios propios por profesional (PD-01), con los mismos datos que hoy carga el seed.
- Logo con vista previa en el círculo y reducción automática (PI-10).
- "Lo que falta" y botón **Activar** / **Pausar** (PI-03). El código del widget para copiar (PI-09).
- Textos en español de España, de tú; usable en el portátil (el móvil no es prioridad, pero que no se rompa).
- **Una web de prueba genérica** (`demo/prueba.html?key=wk_…`): carga el widget de cualquier negocio con esa clave, para probar uno recién dado de alta con `localhost` en sus dominios. Negocio ficticio, sin marcas reales.

### 4.4 — Visor de conversaciones y derivaciones

- Por negocio: lista de conversaciones (fecha, canal, clienta si se identificó, estado, coste), con filtro por "derivadas" y "pruebas".
- Una conversación: los mensajes como en el chat y, desplegable, cada herramienta con lo que pidió y lo que devolvió (lo que hoy hace la skill `consultar-base`).
- Derivaciones pendientes, con "marcar como resuelta" (PI-07).

### 4.5 — Agenda y citas a mano (PR-04, PI-14)

- Por negocio y día: las citas con hora, servicio, profesional, clienta y estado.
- **Cargar una cita a mano**: el motor ya reserva de forma atómica; hace falta un modo "manual" que se salte la rejilla y la antelación (PR-04), **nunca** el horario, los festivos ni los solapes (los sigue impidiendo la base). Origen `manual` (ya existe).
- Cancelar una cita desde la agenda, con la misma regla de SMS que el resto (PW-10).

### 4.6 — Consumo

- La tabla del mes por negocio de PI-11, separando las pruebas (PI-13). Reutilizar lo de `npm run consumo`, no reescribirlo.

### 4.7 — Preguntas frecuentes en el agente

- `src/config/business.ts` carga las preguntas del negocio; `src/core/prompt.ts` las añade al prompt con la instrucción de usarlas tal cual y derivar si no está la respuesta (PA-10, PA-12).
- Límite de PI-08 en la base o en la API (no solo en el panel).
- Escenarios: añadir a `npm run agent:eval` uno que pregunte algo que solo está en una pregunta frecuente de Aurora.

### 4.8 — Tests

**Sin coste (`npm test`):**
- Sin token, con token inventado o de alguien que no está en la lista → 401 en todas las rutas del panel.
- Alta completa de un negocio por la API y que el agente (modelo simulado) le ofrezca huecos y reserve.
- Desactivar un servicio con citas: no se borra, el agente deja de ofrecerlo, las citas siguen.
- Activar con datos incompletos → rechazado con la lista de lo que falta.
- Cambiar la clave → la anterior deja de funcionar en el widget.
- Logo grande → se guarda reducido y dentro del límite de la base.
- Probar el chat → la conversación queda marcada como prueba y el consumo la separa.
- Cita a mano a las 10:15 (fuera de la rejilla) o dentro de la antelación → se crea; fuera de horario, en festivo o pisando otra → rechazada (PR-04).
- Visor: un negocio no ve conversaciones de otro (el filtro por `business_id` está en la API).

**Con el navegador (`npm run test:e2e`):** entrar al panel, dar de alta un negocio mínimo, activarlo, abrir una web de prueba con su widget y reservar (modelo simulado).

**Con el modelo real:** `npm run agent:eval` en verde, con el escenario nuevo de preguntas frecuentes.

### 4.9 — Documentación

- `docs/DECISIONES.md`: sección **Fase 4** (forma de la API del panel, cuentas, preguntas frecuentes en el prompt, conversaciones de prueba).
- `admin/AGENTS.md` y `README.md` nuevos; tabla del `AGENTS.md` raíz; `README.md` raíz (estado, cómo entrar al panel, cómo crear la cuenta).
- `.env.example`: variables nuevas sin valores secretos.
- Si aparece una decisión de producto nueva: a `decisiones-producto.md` como ⚠️ por confirmar, y avisar a Mariana. **Y siempre al manual "Cómo funciona el Recepcionista" de Research Desk**; el cuestionario de alta, si el panel pide algo que el cuestionario no tiene.

---

## FUERA DEL ALCANCE DE LA FASE 4

- Panel para el cliente (que cada negocio entre a lo suyo) → Fase 9.
- Subir PDFs y documentos largos, búsqueda semántica → Fase 5 (aquí solo preguntas frecuentes cortas).
- Que **recepción del negocio** cargue citas a mano: en esta fase lo hace Mariana desde su panel; el negocio, con el panel del cliente (Fase 9).
- Mover una cita a mano desde la agenda (se cancela y se carga otra).
- Avisos por email o SMS de derivaciones → más adelante.
- Varias personas con permisos distintos en el panel → cuando haya equipo.
- Importar la ficha exportada del cuestionario de alta → si el alta a mano resulta lenta.
- Retención y borrado de conversaciones → con PD-11.

---

## ORDEN DE TRABAJO SUGERIDO PARA CLAUDE CODE

1. Leer los documentos de "Depende de".
2. Migración y tests SQL (4.1). Verde.
3. Cuentas y API del panel (4.2) con tests, sin interfaz todavía. Verde.
4. Preguntas frecuentes en el agente (4.7) con tests.
5. El panel: negocios y alta (4.3). Probar un alta en el navegador.
6. Visor, derivaciones, agenda con citas a mano y consumo (4.4, 4.5, 4.6).
7. La prueba de verdad: un negocio inventado nuevo, de punta a punta, solo con el panel.
8. `npm run agent:eval` y verificación en Supabase (`./scripts/con-supabase.sh …`).
9. Documentación (4.9).
10. Publicar el panel en Vercel **solo si Mariana lo confirma**.

Trabajar contra el Postgres local (`recepcionista_dev`). No apagar ni reiniciar Postgres sin avisar. **Un solo PR para toda la fase:** se trabaja en la rama `fase-4-spec`, que ya tiene abierto el PR #2 con este spec; se hace push a esa rama y se actualiza ese PR (título y descripción en inglés), sin abrir otro. Mariana lo mergea.

---

## PROMPT DE ARRANQUE (para pegar en Claude Code, sesión fresca en el repo)

> Leé `_specs/mazzmkt-recepcionista-ia-spec.md` (maestro), `_specs/decisiones-producto.md` (reglas de negocio, incluidas las PI-01 a PI-14 del panel), `_specs/fase-4-panel-interno.md` (esta fase) y `docs/DECISIONES.md` (decisiones técnicas de las fases 0 a 3). Implementá la Fase 4 completa siguiendo el spec de fase, en el orden sugerido: migración, cuentas y API del panel, preguntas frecuentes en el agente, el panel de alta y edición de negocios, el visor de conversaciones y derivaciones, la agenda con citas a mano, el consumo y los tests. No cambies el núcleo del agente salvo lo de las preguntas frecuentes. La clave `ANTHROPIC_API_KEY` ya está en `.env`: no me la pidas ni la muestres, y tampoco la contraseña del panel. Trabajá contra el Postgres local `recepcionista_dev` y no lo apagues. Trabajá en la rama `fase-4-spec`, que ya tiene abierto el PR #2 con este spec: seguí en ella, hacé push a esa rama y al final actualizá ese PR con todo lo de la fase (título y descripción en inglés, como los commits). No abras otro PR ni mergees: lo mergeo yo. Todos los tests, los de las fases anteriores incluidos, tienen que pasar, en local y en Supabase. No publiques el panel en Vercel ni contrates nada sin preguntarme. Si aparece una decisión de producto que no está en `decisiones-producto.md`, no la inventes: anotala como propuesta por confirmar y avisame. Actualizá también el manual "Cómo funciona el Recepcionista" y la Hoja de ruta de Research Desk. Explicame al final, en lenguaje simple, qué hiciste y cómo lo verifico yo.

---

## CÓMO SABÉS QUE PODÉS PASAR A LA FASE 5

1. `npm run test:sql`, `npm test` y `npm run test:e2e` → todo en verde, en local y en Supabase.
2. `npm run agent:eval` → todo OK, con el escenario de preguntas frecuentes.
3. Entrás al panel, das de alta un negocio inventado nuevo sin tocar SQL, lo activás, pegás su widget en una web de prueba y te da una cita.
4. Ves esa conversación en el visor, con sus herramientas y su coste, y el consumo del mes la cuenta.
5. Desactivás un servicio y el agente deja de ofrecerlo; cambiás la clave y el widget viejo deja de aparecer.
6. Cargás una cita a mano a una hora fuera de la rejilla y aparece en la agenda.

Recién ahí, Mariana mergea el PR de la fase (#2) y sesión nueva para la Fase 5.
