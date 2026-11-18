# FASE 9 — PORTAL DEL CLIENTE Y ALTA POR CHAT
### Spec de ejecución · Recepcionista IA
**Depende de:** `mazzmkt-recepcionista-ia-spec.md` (maestro, sobre todo §11, Fase 9), `decisiones-producto.md` (reglas de negocio, en especial **PC-01 a PC-13**, y las del panel PI-03, PI-18, PI-19 y PI-21, que valen igual en el portal), `fase-4-panel-interno.md` (ya cerrada: el portal reutiliza su API y sus validaciones), la nota **«Guion del alta por chat»** de Research Desk (el guion dictado por Mariana el 18/11/2026) y `docs/DECISIONES.md`. Leer todos antes de empezar.

---

## OBJETIVO DE ESTA FASE

Que un negocio nuevo **se dé de alta solo, hablando con un chat**, en vez de rellenar un formulario. Vos le generás un enlace de invitación; el cliente crea su cuenta, el chat le pregunta una cosa cada vez (su negocio, sus servicios, su equipo, su horario y sus reglas de reserva) y, al terminar, **aparece su portal** con todo lo que contestó. Desde ahí lo ve y lo cambia a mano o pidiéndoselo al mismo chat («Núria no viene el jueves»). Vos lo ves todo desde tu panel, tal como lo ve él, y te enterás cuando termina.

Los datos están en **un solo sitio** (PC-05): el portal, el chat del cliente y tu panel cambian lo mismo, con las mismas reglas.

### Criterio de "terminada" (Definition of Done)

1. **Enlace de invitación** desde tu panel interno: ligado a un negocio y a un email, de un solo uso, caduca a los 7 días, anulable y regenerable (PC-02). Es la única puerta: no hay registro abierto (PC-11).
2. **Crear la cuenta** con el enlace: confirma su email con un código (el email de PW-18) y elige su contraseña. Después entra con email y contraseña (PC-11).
3. **El chat del alta** sigue el guion de la nota, sección por sección, con un resumen para confirmar al final de cada una (PC-03). Si se va a mitad, al volver sigue donde lo dejó.
4. **Lo que el chat no pregunta** se carga en el portal y el cierre lo recuerda: preguntas frecuentes, el chat en su web (color, logo, dominios, privacidad), horarios que cambian cada semana y festivos (PC-12). Lo que va de serie no se pregunta: zona horaria (PC-08), tono y bienvenida, cada cuánto se ofrecen horarios.
5. **Al terminar, aparece el portal** con lo cargado (PC-11) y a vos te llega un aviso en tu panel (PC-13).
6. **El portal**: el cliente ve y edita su configuración a mano, con las mismas secciones y reglas que tu panel (lo que falta para activar, el aviso de horario fuera del local, citas afectadas por un festivo…). No ve ni cambia el tope (PC-09), ni activa su negocio: eso lo hacés vos.
7. **El chat del portal, después del alta**: cambia la configuración pidiéndolo («Núria no viene el jueves», «el lunes 16 cerramos»), y si un festivo cae encima de citas, avisa y pregunta (PC-10).
8. **Turnos sueltos** (PC-06): una profesional trabaja un día concreto fuera de su horario; en un festivo del local, abre la agenda solo para ella y esas horas. Desde el portal y desde tu panel.
9. **La agenda visual** (PC-16): en el portal, el día con una columna por profesional y la semana; pinchar un hueco carga una cita a mano y pinchar una cita la muestra y la cancela. La agenda de tu panel interno pasa a ser igual de visual.
10. **Tu vista** (PC-05): desde tu panel abrís el portal de cada cliente tal como lo ve él, y lo podés editar.
11. **Aislamiento**: una cuenta no puede ver ni tocar otro negocio, aunque lo pida en el chat o cambie la dirección a mano. Lo decide el código.
12. **Prueba de verdad**: un negocio inventado nuevo entra con su enlace, se da de alta entero por el chat, su portal muestra lo mismo que tu panel, lo activás, su widget le da una cita a una clienta, **la ve en su agenda** y carga otra a mano, y después cambia algo por el chat y el agente de las clientas lo aplica.
13. Todos los tests anteriores siguen pasando, en local y en Supabase, y `npm run agent:eval` en verde.

---

## DECISIONES DE PRODUCTO DEL PORTAL

Todas en `decisiones-producto.md`, con el detalle. Si alguna cambia, manda `decisiones-producto.md`.

| # | Tema | Decisión |
|---|---|---|
| PC-01 | Dos altas | La administrativa y legal la hacés vos en tu panel de clientes MAZZMKT (otro proyecto); la del agente, el cliente |
| PC-02 | Enlace de invitación | Un negocio y un email; un solo uso; 7 días; anulable; hay que confirmar el email. Mientras no exista el panel de clientes, se genera desde tu panel interno |
| PC-03 | El alta por chat | Una cosa cada vez, por secciones, con un resumen para confirmar al final de cada una |
| PC-04 | El portal | Después del alta es suyo: lo cambia a mano o pidiéndoselo al chat |
| PC-05 | Tu vista | Ves y editás su portal tal como lo ve él; un solo sitio para los datos |
| PC-06 | Turnos sueltos | Un día concreto fuera de su horario; en un festivo del local, solo esa profesional y esas horas |
| PC-07 | Leer su web | No, más adelante |
| PC-08 | Zona horaria | No se pregunta: Madrid de serie |
| PC-09 | El tope | No lo ve ni lo cambia |
| PC-10 | Festivo encima de citas, por el chat | Avisa y pregunta si se dejan o se cancelan, como el panel |
| PC-11 | Lo primero que ve | Solo el chat; el portal aparece **al terminar**. Después entra con email y contraseña |
| PC-12 | Lo que el chat no pregunta | Preguntas frecuentes, el chat en su web, horarios que cambian cada semana y festivos, en el portal; tono, bienvenida e intervalo de horarios, de serie |
| PC-13 | Aviso al terminar | Te llega un aviso en tu panel interno |
| PC-14 | La IA del alta | No cuenta para el tope del negocio; se ve aparte en el consumo |
| PC-15 | Email de verdad | El proveedor real se conecta antes de mandar el primer enlace a un cliente real |
| PC-16 | La agenda | Agenda visual en el portal (día por profesional y semana; cargar y cancelar) y la de tu panel igual de visual |

**Aparecieron al escribir este spec, ✅ decididas el 18/11/2026** (en `decisiones-producto.md` con el detalle):

- **PC-14 · Quién paga la IA del chat del alta.** ✅ Decidida el 18/11/2026: no cuenta para el tope mensual del negocio (el tope es para atender clientas, PW-04); se registra aparte, como coste de alta, y lo ves en el consumo.
- **PC-16 · Dónde ve el negocio sus citas.** ✅ Decidida el 18/11/2026: una agenda visual en el portal (el día con una columna por profesional y la semana; pinchar un hueco para cargar una cita y una cita para verla o cancelarla), y la de tu panel igual de visual. Su Google Calendar, en la Fase 7.
- **PC-15 · Antes del primer cliente real, un proveedor de email de verdad.** ✅ Decidida el 18/11/2026. Para crear la cuenta hay que confirmar el email con un código (PC-02), y hoy los emails son de prueba (PW-18). En local y en los tests vale el de prueba; con un cliente real, no: se elige antes de mandar el primer enlace a un cliente.

---

## CONTEXTO TÉCNICO

- **Reutilizar el panel, no duplicarlo.** Las escrituras de configuración ya existen en `src/db/negocios.ts` (datos, servicios, profesionales, horarios, festivos, reglas, preguntas, chat) con sus validaciones en la base y en la API del panel (`src/api/admin/`). El portal y el chat del alta **llaman a esas mismas funciones** con el `business_id` de la cuenta; nada de reimplementar reglas. Así PC-05 se cumple solo: un solo sitio.
- **Cuentas del portal.** Distintas de las del panel interno: una cuenta del portal **pertenece a un negocio** y solo ve el suyo. ⚠️ **Decisión técnica a tomar al empezar (D-):** la `SUPABASE_SERVICE_ROLE_KEY` no puede ir a Vercel (§6 del `AGENTS.md` raíz), y crear usuarios de Supabase Auth desde el servidor la necesita. *Propuesta:* cuentas propias en nuestra base (contraseña con `scrypt`, sesión con token del que se guarda solo el hash, como el widget), con el email confirmado por un código (el mecanismo de PA-16). Verificarlo contra la documentación de Supabase antes de decidir; si hay una forma segura sin la clave de servicio, se compara.
- **El chat del alta es otro agente**, no el de las clientas. Tiene su propio prompt (el guion) y sus propias herramientas, que escriben configuración llamando a las funciones del panel: `guardar_negocio`, `guardar_servicio`, `guardar_profesional`, `guardar_horario`, `guardar_reglas`, `terminar_alta`… El agente de las clientas (`src/core/`) **no cambia** salvo lo de los turnos sueltos en el motor. Vive en su propia carpeta (por ejemplo `src/alta/`), con su `AGENTS.md`.
- **Lo que no se puede romper, en el código:** que una cuenta solo toque su negocio (el `business_id` sale de la sesión, nunca del chat ni de la URL); que una sección no se guarde sin que el cliente confirme el resumen; las validaciones de la base (horarios sin solape, formatos, lo que falta para activar).
- **El resumen para confirmar** es un bloque visual (tabla de la semana, lista de servicios) que el chat devuelve junto al texto, con «¿está todo bien?». El portal lo dibuja; el modelo no inventa el formato.
- **Turnos sueltos** (PC-06): un cambio en el motor (`app.tramos_efectivos` / `app.slot_es_valido`) con su migración y sus tests SQL: en un festivo del local, el turno suelto abre solo esa profesional y esas horas. Es la única parte que toca la regla de "hueco válido".
- **La agenda visual** (PC-16): una vista de día con una columna por profesional y otra de semana, compartida por el portal y tu panel. ⚠️ **Decisión técnica a tomar al empezar (D-):** las librerías de calendario conocidas cobran la vista "por profesional" (por ejemplo, FullCalendar la tiene en su versión de pago) y las dependencias se mantienen mínimas (`src/AGENTS.md`). *Propuesta:* una rejilla propia con CSS (horas en filas, profesionales en columnas, la cita como un bloque), que es lo que hace falta sin arrastrar. Cargar y cancelar reutilizan `src/citas/manual.ts` (PI-14) y su email (PW-10).
- **La web del portal**: React + Vite + Tailwind como el panel, en su propia carpeta (`portal/`) o como otra entrada del mismo proyecto de `admin/`, reutilizando sus componentes. Se decide al empezar (D-) con lo que menos duplique.
- **Hosting**: el mismo proyecto de Vercel (como el panel, PI-02). Publicarlo, **solo con tu visto bueno**.

## TAREAS

### 9.1 — Base de datos
- Cuentas del portal ligadas a un negocio, invitaciones (hash del token, email, caducidad, uso, anulada) y estado del alta (en qué sección va, terminada y cuándo, para el aviso de PC-13).
- Turnos sueltos (PC-06) y su efecto en el motor.
- RLS en todo lo nuevo; tests SQL.

### 9.2 — Invitación y cuenta
- En tu panel: generar, ver, anular y regenerar el enlace de cada negocio (PC-02).
- Abrir el enlace: si es válido, mandar el código al email invitado; con el código y una contraseña, crear la cuenta; el enlace queda usado.
- Entrar con email y contraseña; salir; sesión que caduca.

### 9.3 — El chat del alta
- El guion de la nota, sección por sección (0, 1, 2, 3, 4, 6 y 9; la 5, 7 y 8 van al portal, PC-12).
- Herramientas que guardan cada sección tras el «¿está todo bien?»; si algo no vale (un horario solapado, un teléfono raro), lo dice con palabras y lo vuelve a pedir.
- Si se va a mitad, al volver le recibe por donde lo dejó.
- Al terminar: el cierre del guion, el portal aparece y el aviso a tu panel (PC-13).
- Su consumo se registra aparte (PC-14, si se confirma).

### 9.4 — El portal
- Las secciones de su configuración, como en tu panel pero solo su negocio: datos, servicios, profesionales (con sus horarios y turnos sueltos), horario, festivos y ausencias, reglas, preguntas frecuentes y el chat en su web.
- Lo que falta para activar y el aviso de horario, igual que en tu panel. No ve el tope ni el botón de activar.
- El chat a la vista, para pedir cambios después del alta (9.5).

### 9.4b — La agenda visual (PC-16)
- Vista de **día**: una columna por profesional, las horas del horario del negocio hacia abajo, cada cita como un bloque con hora, servicio y clienta; los huecos fuera de horario y los festivos, sombreados.
- Vista de **semana**, y pasar de un día a otro.
- **Pinchar un hueco** → cargar una cita a mano (servicio, profesional, hora, email opcional, teléfono y nombre), con las reglas de PI-14.
- **Pinchar una cita** → ver el detalle y cancelarla (con su email de aviso, PW-10).
- La **misma agenda** en tu panel interno, sustituyendo la lista de hoy.
- Se ve bien en el móvil (en la recepción a veces se mira desde el teléfono).

### 9.5 — El chat del portal después del alta
- Pedir cambios con palabras («Núria no viene el jueves», «el lunes 16 cerramos», «la limpieza ahora dura 75 minutos»), con resumen y confirmación antes de guardar.
- Un festivo encima de citas: avisa y pregunta (PC-10, PI-21).

### 9.6 — Tu vista y el aviso
- Desde tu panel: abrir el portal de un cliente tal como lo ve él, editable (PC-05).
- Altas terminadas pendientes de revisar, a la vista (PC-13).
- Turnos sueltos también desde tu panel (PC-06).

### 9.7 — Tests
**Sin coste (`npm test`, `npm run test:sql`):**
- Invitación: válida, usada, caducada, anulada, inventada; el código del email; la cuenta queda ligada a su negocio.
- Aislamiento: una cuenta no lee ni escribe otro negocio por la API, cambiando ids en la URL o pidiéndolo en el chat (modelo simulado).
- El chat del alta (modelo simulado): cada sección guarda lo mismo que guardaría tu panel; sin confirmar no se guarda; un dato inválido no se guarda.
- Turnos sueltos en el motor: festivo del local con turno suelto → solo esa profesional y esas horas.
- La agenda del portal: solo las citas de su negocio; cargar a mano con las reglas de PI-14; cancelar manda el aviso; una cuenta no ve ni cancela citas de otro negocio.
- Tu panel ve lo mismo que el portal.

**Con el navegador (`npm run test:e2e`):** abrir el enlace, crear la cuenta, hacer el alta entera con el modelo simulado, ver aparecer el portal, editar algo a mano y verlo en tu panel; en la agenda, pinchar un hueco y cargar una cita, verla como bloque en su columna y cancelarla.

**Con el modelo real:** escenarios nuevos del chat del alta (clientes que contestan raro: «abrimos por las mañanas», «una hora y pico», precios «según el caso») y del chat del portal («Núria no viene el jueves»), más los de siempre.

### 9.8 — Documentación
- `docs/DECISIONES.md`: sección Fase 9 (cuentas del portal, el agente del alta, turnos sueltos).
- `AGENTS.md` de las carpetas nuevas, la tabla del `AGENTS.md` raíz y el `README.md` raíz.
- `decisiones-producto.md` y el manual «Cómo funciona el Recepcionista» con lo que se decida o cambie, en el mismo turno (§8 del `AGENTS.md` raíz). Los turnos sueltos, explicados con las demás excepciones del horario (PC-06).

---

## FUERA DEL ALCANCE DE LA FASE 9

- El panel de clientes MAZZMKT (alta legal y administrativa, contratos, facturación) → otro proyecto (PC-01).
- Leer la web del negocio para proponer servicios → más adelante (PC-07).
- Un servicio que necesita otro antes (la revisión antes de la toxina) → cuando un negocio real lo pida (PA-13).
- Varias personas del mismo negocio con su propia cuenta y permisos → cuando un cliente lo pida.
- Ver las citas en su propio Google Calendar → Fase 7 (PC-16).
- Mover una cita arrastrándola en la agenda → más adelante (se cancela y se carga otra).
- Conectar el programa de gestión que ya tenga el cliente (Flowww, Koibox…) → cuando un cliente lo traiga (PC-16).
- Conectar el proveedor de email real → es tuyo (PC-15), pero va antes del primer cliente real.

---

## ORDEN DE TRABAJO SUGERIDO PARA CLAUDE CODE

1. Leer los documentos de "Depende de". Tomar y anotar las tres decisiones técnicas (cuentas del portal, dónde vive la web del portal y cómo se dibuja la agenda).
2. Migración, turnos sueltos en el motor y tests SQL (9.1). Verde.
3. Invitación y cuenta, con tests, sin interfaz (9.2).
4. El chat del alta con el modelo simulado y sus tests (9.3).
5. La web del portal, la agenda visual y el chat de después del alta (9.4, 9.4b, 9.5).
6. Tu vista y el aviso en tu panel (9.6).
7. La prueba de verdad: un negocio inventado, de la invitación a la cita.
8. `npm run agent:eval` con los escenarios nuevos y la verificación en Supabase (`./scripts/con-supabase.sh …`).
9. Ejecutar el plan de pruebas y publicar el informe.
10. Documentación (9.8). Publicar el portal en Vercel **solo si Mariana lo confirma**.

Trabajar contra el Postgres local (`recepcionista_dev`). No apagar ni reiniciar Postgres sin avisar. **Un solo PR para toda la fase:** la rama `fase-9-spec`, con este spec; se hace push a esa rama y se actualiza ese PR (título y descripción en inglés), sin abrir otro. Mariana lo mergea.

---

## PROMPT DE ARRANQUE (para pegar en Claude Code, sesión fresca en el repo)

> Leé `_specs/mazzmkt-recepcionista-ia-spec.md` (maestro), `_specs/decisiones-producto.md` (reglas de negocio, sobre todo PC-01 a PC-16), `_specs/fase-9-portal-cliente.md` (esta fase), `_specs/fase-4-panel-interno.md` y `docs/DECISIONES.md`. El guion del alta está en la nota «Guion del alta por chat» del space «mm - agente recepcionista» de Research Desk: leelo con la skill `research-desk`. Implementá la Fase 9 completa siguiendo el spec, en el orden sugerido. Antes de programar, anotá las tres decisiones técnicas que pide el spec y contámelas en una línea cada una. Reutilizá las funciones y validaciones del panel: no las dupliques. El agente de las clientas no cambia salvo los turnos sueltos en el motor. Las claves están en `.env`: no me las pidas ni las muestres. Trabajá contra el Postgres local `recepcionista_dev` y no lo apagues. Trabajá en la rama `fase-9-spec`: hacé push a esa rama y actualizá su PR al final (título y descripción en inglés, como los commits). No mergees ni publiques en Vercel sin preguntarme, y no toques la base de la nube sin mi visto bueno. Si aparece una decisión de producto que no está en `decisiones-producto.md`, no la inventes: anotala como propuesta por confirmar y avisame. Actualizá el manual «Cómo funciona el Recepcionista» y el Mapa de avance de Research Desk en cada paso. Las pruebas las hacés vos: ejecutá el plan de pruebas de la fase y publicá el informe. Explicame al final, en lenguaje simple, qué hiciste.

---

## PLAN DE PRUEBAS DE ACEPTACIÓN

Las pruebas las hace Claude Code, no Mariana (§3b del `AGENTS.md` raíz). El plan está en la nota **«Plan de pruebas · Fase 9»** de Research Desk, con la regla de cada bloque explicada en palabras. Mariana lo revisa y añade sus casos en «Tus pruebas»; Claude Code lo ejecuta y publica el **«Informe de pruebas · Fase 9»**.

## CÓMO SABÉS QUE PODÉS PASAR A LA FASE SIGUIENTE

Lo comprueba Claude Code y lo resume en el informe:

1. `npm run test:sql`, `npm test` y `npm run test:e2e` → todo en verde, en local y en Supabase.
2. `npm run agent:eval` → todo OK, con los escenarios nuevos del alta y del portal.
3. El plan de pruebas, revisado por Mariana, ejecutado: todo en OK o con su arreglo y su test, y las decisiones que salieron, decididas.
4. La prueba de verdad (punto 11 del criterio de terminada), de punta a punta.
5. Ninguna cuenta del portal ve ni toca otro negocio, ni por la API, ni por la dirección, ni por el chat.

Recién ahí, Mariana mergea el PR de la fase y sesión nueva para la Fase 5.
