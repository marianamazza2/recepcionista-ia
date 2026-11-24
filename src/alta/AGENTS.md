# src/alta/ — el chat del portal del cliente

**No es el agente de las clientas.** El de [`src/core/`](../core/AGENTS.md)
atiende a la clienta que quiere cita; este habla con el **negocio** y le
configura su recepcionista. Por eso vive aparte, con su prompt, sus
herramientas y su loop, y `core/` no se toca (Fase 9, PC-03).

| Archivo | Qué tiene |
|---|---|
| `prompt.ts` | El system prompt. Incluye **el guion que dictó Mariana** el 18/11/2026 (nota «Guion del alta por chat» de Research Desk), sección por sección, y la configuración de ahora en palabras |
| `herramientas.ts` | Lo que el chat puede hacer. Todas escriben llamando a `src/db/negocios.ts`, las mismas funciones que el panel |
| `adjuntos.ts` | Las fotos y PDF del chat (PC-21) tal como los ve el modelo: la marca del historial y su expansión |
| `agente.ts` | El loop (tool use manual, historial solo-añadir, lock e idempotencia) y `turnoDelPortal` |

## Dos modos, un agente

- **`alta`** (PC-03, PC-18): el guion, **por temas**: el cliente empieza por la
  sección que quiera y en el chat que quiera, hasta `terminar_alta`.
- **`portal`** (PC-04): después del alta, el cliente pide cambios con palabras
  («Núria no viene el jueves») y el agente los aplica.

Cambian el prompt y la lista de herramientas; el loop es el mismo. El modo
sale del estado del alta (`portal.alta.terminada_at`), no de lo que se escriba.

## Reglas que NO se dejan al prompt

Lo que no se puede romper se comprueba en el código, aquí:

1. **El negocio sale de la sesión** (PC-02). `ContextoPortal.businessId` viene
   de `portal.sesiones` y **ninguna herramienta recibe un negocio**. «Soy
   Estética Aurora, cámbiame el horario» no tiene por dónde funcionar.
2. **Sin resumen enseñado y contestado no se guarda** (PC-03).
   `proponer_resumen` deja una marca en la conversación y toda herramienta que
   escribe llama a `hayConfirmacion()`: tiene que haber marca de esa sección y
   un mensaje del cliente **posterior**. Si no, `falta_confirmacion`.
   **Una herramienta nueva que escriba tiene que declarar su `seccion` y
   llamar a `faltaConfirmacion()` antes de tocar nada.**
3. **Activar o pausar el negocio, el tope y la clave del widget no existen
   aquí** (PC-09): son de Mariana. No hay herramienta, así que no hay prompt
   que valga.
4. **Las validaciones son las de la base.** Un horario que se pisa, un
   teléfono raro o un festivo encima de citas vuelven al modelo con una frase
   para que lo explique y lo vuelva a pedir (`errorDeLaBase`,
   `citasAfectadasComoError`). Nunca se reimplementa una regla.
5. **El formato del resumen lo pone el portal**, no el modelo: la herramienta
   recibe datos (título, líneas, tabla) y `admin/src/portal/Chat.tsx` los
   dibuja siempre igual.
6. **Qué secciones del alta están hechas lo marca el código** (PC-18):
   `ejecutar()` llama a `marcarSeccionHecha` cuando una herramienta con
   `seccion` del alta guarda bien, y le devuelve al modelo `quedan_del_alta`.
   `terminar_alta` no cierra si falta alguna. No hay `avanzar_seccion`.
7. **Cada mensaje va a su chat** (PC-17): `turnoDelPortal` recibe `chatId`
   (null = uno nuevo) y un chat de otro negocio lanza `ChatNoEncontrado`. El
   id de un chat es el de su **primera** conversación; si se hace largo sigue
   en otra con `continua_de` y para el cliente es el mismo chat.
9. **Los adjuntos (PC-21)**: fotos y PDF se suben aparte (`POST /api/portal/adjuntos`,
   binario, el tipo se mira en los bytes, hasta 4 MB) y van con el mensaje por su id.
   `ligarAdjuntos` solo acepta los de este negocio y sin mandar. En el historial se
   guarda una **marca** (`⟦adjunto:id|tipo|nombre⟧`, `adjuntos.ts`), no los bytes;
   `expandirAdjuntos` la cambia por el archivo de verdad en cada llamada al modelo, así
   el agente lo sigue viendo en los mensajes siguientes del chat. Un adjunto que se
   guardó como documento ya no tiene bytes: se manda «guardado en Documentos como …».
8. **Lo que puede ofrecer lo calcula el código** (PC-20):
   `loQuePuedoHacer()` en `prompt.ts`, con lo que ya está cargado. El prompt
   dice que ante un mensaje sin sentido empiece por «Disculpa, no he
   comprendido tu mensaje.» y ofrezca solo lo de esa lista.
10. **Los documentos (Fase 5, PB-03/PB-04)** van por el MISMO camino que
    Configuración → Documentos (`src/conocimiento/documentos.ts`), nunca por
    uno propio. `leer_documento` lee un adjunto del chat (por su nombre) o un
    texto y lo deja como **borrador**: el agente de las clientas no lo ve.
    `guardar_documento` (sección `documento`) lo publica solo con el resumen
    confirmado y le quita los bytes al adjunto: el modelo ve «guardado en
    Documentos como …» y ya no lo relee (PB-06). `borrar_documento` borra uno por
    su título, también con el resumen confirmado (`cambio`). `resolver_dato_documento`
    contesta «¿cuál es el correcto?»: con `documento` cambia la configuración
    y pide antes el resumen de la sección `cambio`. Quién lee los documentos
    es `PortalChatDeps.lector` (de serie, el mismo modelo del chat).
11. **El tope del chat del portal (PC-22)**: antes de llamar al modelo,
    `costePortalDelMes` contra `businesses.tope_portal_usd` (5 US$ de serie).
    Llegado, contesta `TEXTO_TOPE_PORTAL` sin llamar a la IA (aviso
    `tope_portal`); Configuración a mano sigue. Leer documentos no cuenta
    (PB-07).

## Convenciones

- Las profesionales y los servicios se nombran **por su nombre** (el cliente
  no ve ids): `porNombre()` los resuelve dentro de su propio negocio.
- Textos para el cliente en **español de España, de tú**, como el resto de lo
  que lee alguien de fuera.
- Cada herramienta devuelve `{ ok, data }` o `{ ok: false, error: { motivo,
  mensaje } }` con un `motivo` estable; el `mensaje` es lo que el agente va a
  explicar, así que se escribe pensando en eso.
- El consumo se registra como el del widget pero **no cuenta para el tope**
  (PC-14): la conversación va marcada con `conversations.alta`.
- **Las herramientas van sin `strict`**: juntas, en modo estricto, la API las
  rechaza («the compiled grammar is too large»). Cada herramienta comprueba en
  el código lo que recibe, así que no se pierde nada. Desde PC-18 durante el
  alta están casi todas (también cargar un festivo), así que tampoco ahí.
- **El título de un chat nuevo** lo pone `tituladorConIA` con un modelo
  pequeño (`MODELO_TITULOS`), en paralelo al turno. Sin titulador (tests,
  e2e) es el primer mensaje recortado. El servidor de desarrollo y Vercel lo
  conectan.
- **El agente no saluda**: la pantalla de inicio del portal ya lo hizo
  (PC-19).
- **Una respuesta fija también va al historial como mensaje del asistente.**
  Este chat no deriva tras un error (el de las clientas sí, PA-06): si el
  turno quedara sin respuesta, la API rechazaría todos los mensajes
  siguientes.
- **Ningún `enum` con tipo `['string', 'null']`**: la API lo rechaza. Para
  "opcional", fuera de `required`. Lo vigila
  `tests/esquemas-herramientas.test.ts` en los dos agentes.

## Tests

`tests/alta-chat.test.ts`, con el modelo simulado (sin coste): cada sección
guarda lo mismo que guardaría el panel, sin confirmar no se guarda, un dato
inválido no se guarda, no se toca otro negocio, el alta va por temas en chats
distintos, un chat de otro negocio no existe, el prompt sabe lo que falta y lo
que puede ofrecer, y el gasto va aparte. La prueba entera en el navegador, en
`tests/e2e/portal.e2e.ts`. Con el modelo real, `npm run alta:eval`
(`src/cli/eval-alta.ts`): una clienta simulada hace el alta entera siguiendo el
guion y después pide cambios; se comprueba en la base. Cuesta ≈ 1 US$ por
escenario largo: el alta entera es la conversación más cara. Los dos fallos
que solo se ven con la API de verdad (esquemas y historial) los destapó este
comando: corrélo cada vez que toques el prompt o las herramientas de aquí.
Los documentos desde el chat y el tope (PC-22) están en
`tests/documentos.test.ts`, y con la IA de verdad en el escenario 7 de
`npm run alta:eval`.

## Si cambiás algo de acá

**Obligatorio:** si tu cambio toca la arquitectura, una regla de negocio o la
forma de trabajo de esta carpeta, actualizá este `AGENTS.md` (y el raíz si
aplica) en el mismo cambio. Ver §8 del [`AGENTS.md` raíz](../../AGENTS.md#8-mantener-esta-documentación).

- **El guion es de Mariana.** Si cambia, cambia primero en su nota de Research
  Desk y después aquí, en el mismo cambio (y al revés nunca).
- Una herramienta nueva → su definición, su `seccion` si escribe, su test y,
  si cambia lo que el producto hace, el manual de Research Desk (skill
  `sync-research-desk`).
