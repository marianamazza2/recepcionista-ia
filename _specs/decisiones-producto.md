# DECISIONES DE PRODUCTO
### Cómo funciona el Recepcionista IA · reglas fijas y ajustes por negocio

Este documento es la **fuente de verdad de las reglas de negocio** del producto,
escritas en lenguaje de producto (no de base de datos). Se sube a GitHub a
propósito: es de lo más valioso del proyecto.

- **Reglas del motor:** iguales para todos los negocios. Cambiarlas es cambiar el producto.
- **Ajustes por negocio:** cada cliente los define al darse de alta. Tienen un
  valor de serie para no empezar de cero.

La versión técnica (por qué el esquema está como está) vive en
`docs/DECISIONES.md`, que es local.

Documentos visuales que salen de este: *Cómo funciona el Recepcionista* (para
Mariana) y el *Cuestionario de alta* (para usar con cada cliente).

---

## Resumen

| # | Tema | Regla del motor (fija) | Ajuste por negocio (de serie) | Decidido |
|---|---|---|---|---|
| PD-01 | Horarios | El horario propio de una profesional **reemplaza** al del local ese día. Sin horario propio, hereda el del local | Horario del local y de cada profesional | 16/10/2026 |
| PD-02 | Margen entre citas | El margen **se respeta siempre** | Minutos de margen por servicio (0 = sin margen) | 16/10/2026 |
| PD-03 | Elección de profesional | Si la clienta no tiene preferencia: primer hueco libre o la que menos citas tenga | Cómo se elige (de serie: **el agente pregunta**) | 16/10/2026 |
| PD-04 | Fuera de horario | Dice que no abre y **ofrece los huecos más cercanos**. Si insiste, ofrece pasar con una persona | — | 16/10/2026 |
| PD-05 | Antelación mínima | No se reserva con menos antelación que la configurada | Horas mínimas (de serie: **2**) | 16/10/2026 |
| PD-06 | Entorno | Cada fase se cierra verificando en un proyecto Supabase en la nube (gratuito) | — | 16/10/2026 |
| PR-01 | Cada cuánto se ofrecen horarios | Los huecos empiezan cada X minutos desde la apertura | Intervalo (de serie: **30 min**) | 16/10/2026 |
| PR-02 | Margen al final del día | El servicio siempre tiene que terminar antes del cierre | Si el margen de la última cita cuenta dentro del horario (de serie: **no cuenta**) | 16/10/2026 |
| PR-03 | Margen antes de un festivo o ausencia | Se trata igual que el cierre del día | El mismo ajuste de PR-02 (de serie: **no cuenta**) | 16/10/2026 |
| PR-04 | Horas fuera de la rejilla | El agente solo reserva en la rejilla; si piden otra hora, ofrece las más cercanas. Recepción podrá saltársela (Fase 4) | — | 16/10/2026 |
| PR-05 | Reprogramar | Mantiene la misma profesional y el mismo servicio; si la clienta pide otra, se cancela y se crea una nueva | — | 16/10/2026 |
| PR-06 | "La última vez te atendió…" | Solo cuenta la última cita **ya pasada** y atendida | — | 16/10/2026 |
| PR-07 | Cancelar o reprogramar dentro del plazo | Lo decide cada negocio | Modo (de serie: **solo informar**) y plazo en horas (de serie: **24**) | 16/10/2026 |
| PR-08 | Dos citas a la vez | Una clienta **no puede tener dos citas que se pisen**. Si pide una a la hora de otra suya, el agente dice que no puede; si ella quiere, se queda la nueva y la anterior se mueve o se anula, todo junto | — | 16/10/2026 |

Las propuestas del widget (PW-01 a PW-08, Fase 3) y las que aparecieron al construirlo (PW-09 a PW-15) están al final: todas ✅ decididas (PW-08 y PW-10 el 20/10/2026; el resto, y PW-16, que apareció al confirmarlas, el 28/10/2026).

---

## PD-01 · Horarios del local y de cada profesional

**Regla del motor.** Si una profesional tiene horario propio un día, ese día
manda el suyo y no el del local. Los días en que no tiene horario propio,
trabaja en el horario del local.

**Cómo se calculan los huecos** (en este orden):

1. La clienta elige el **servicio**.
2. Elige el **día** (o pide "lo antes posible").
3. Solo cuentan las **profesionales que hacen ese servicio**.
4. A cada una se le aplica su horario de ese día y se le restan festivos,
   ausencias y las citas que ya tiene (con sus márgenes).
5. Se ofrecen solo los horarios donde cabe el **servicio completo más su margen**.

**Ejemplo.** El local abre de 9 a 18. Lucía trabaja de 13 a 17 y solo hace
manicura. Una clienta pide limpieza facial a las 14:00: Lucía no cuenta, aunque
esté trabajando, porque no hace ese servicio.

**Ajuste por negocio:** el horario del local y, si los hay, los horarios propios
de cada profesional.

## PD-02 · Margen entre citas

**Regla del motor.** El margen después de cada cita se respeta siempre. El
agente nunca ofrece ni acepta un horario que se lo coma.

**Ajuste por negocio:** cada servicio tiene dos números que pone el local:

- **Duración:** lo que dura el servicio (es lo que ve la clienta).
- **Margen después:** el tiempo para limpiar, preparar o tomar notas.

Ejemplo: limpieza facial de 45 min + 15 de margen. La agenda bloquea 60 min; la
clienta ve una cita de 45. Un negocio que no quiera margen pone 0.

## PD-03 · Quién atiende si la clienta no pide a nadie

**Ajuste por negocio**, con dos modos:

- **Preguntar** (de serie):
  - Clienta habitual (se la reconoce por el teléfono): *"La última vez te atendió
    Marta. ¿Quieres repetir con ella?"*
  - Clienta nueva: *"Para el martes a las 16:00 tengo a Marta o a Lucía. ¿Tienes
    preferencia?"*
- **Asignar automáticamente:** el agente no pregunta y aplica la regla de abajo.

**Regla del motor cuando la clienta dice "me da igual"** (o en modo automático):

- **No eligió hora:** se ofrece el **primer hueco libre** de cualquier
  profesional que haga el servicio.
- **Ya eligió hora, o hay empate:** se asigna a la profesional **con menos citas
  ese día**. Si siguen empatadas, siempre en el mismo orden (estable).
- En todos los casos el agente **dice el nombre**: *"te la dejo con Lucía"*,
  para que la clienta pueda pedir cambio.

## PD-04 · Piden una hora en la que el local no abre

**Regla del motor.** El agente dice que ese día u hora no abre y **ofrece los
huecos libres más cercanos**. Si la clienta insiste (busca una excepción), le
ofrece pasar con una persona.

*Por qué:* ofrecer una alternativa concreta cierra más reservas y alarga menos
la conversación.

## PD-05 · Antelación mínima para reservar

**Regla del motor.** No se puede reservar un hueco que empiece antes de
*ahora + antelación mínima*.

**Ajuste por negocio:** las horas mínimas. De serie, **2 horas**.

No confundir con la política de **cancelación** (por ejemplo, 24 h), que es
otra cosa y también la define cada negocio.

## PD-06 · Dónde se verifica cada fase

Se trabaja en Postgres local para ir rápido y **cada fase se cierra verificando
en un proyecto Supabase en la nube** (plan gratuito). Así se prueban también las
piezas propias de Supabase que en local no existen.

---

## PR-01 · Cada cuánto se ofrecen horarios

Aparecieron al escribir el spec de la Fase 1 y se confirmaron el 16/10/2026.

**Ajuste por negocio:** los horarios que se ofrecen empiezan cada X minutos
desde la apertura. De serie, **cada 30 minutos** (10:00, 10:30, 11:00…): en
punto y a las medias, que es lo que prefieren muchos locales. Un negocio puede
poner 15, 60 u otro valor.

## PR-02 · El margen al final del día

**Regla del motor:** el servicio siempre tiene que **terminar antes del cierre**.

**Ajuste por negocio:** si el margen de la **última cita del día** tiene que caber
también dentro del horario. De serie, **no cuenta**: después de la última cita no
hay otra que esperar.

Ejemplo: cierre a las 20:00, horarios cada 30 min y limpieza de 60 + 10 de margen.
- De serie (no cuenta): la última limpieza empieza a las **19:00**. Termina a las
  20:00 y su margen queda después del cierre.
- Si el negocio quiere que cuente (por ejemplo, para recoger antes de cerrar):
  a las 19:00 el margen llegaría a las 20:10, así que la última es a las **18:30**.

---

## PR-03 · El margen antes de un festivo o una ausencia

Decidido el 16/10/2026.

**Caso:** Marta tiene una formación de 16:00 a 20:00. Una limpieza de 60 + 10
de margen a las 15:00 termina a las 16:00, y sus 10 minutos de limpieza caerían
de 16:00 a 16:10, ya dentro de la formación.

**Regla del motor:** un festivo o una ausencia se tratan **igual que el cierre
del día** (PR-02).

**Ajuste por negocio:** el mismo de PR-02, sin pregunta nueva. De serie **no
cuenta**: la limpieza de las 15:00 se ofrece, porque después no viene otra
clienta. Si el negocio quiere que el margen caiga dentro del horario, vale para
el cierre y también antes de un festivo o una ausencia (la última sería a las
14:30).

## PR-04 · Horas fuera de la rejilla

Decidido el 16/10/2026.

**Regla del motor:** el agente solo reserva en los horarios de la rejilla (PR-01:
cada 30 minutos desde la apertura, de serie). Si una clienta pide las 10:15, le
dice que esa hora no está disponible y le ofrece las más cercanas (10:00 o
10:30).

*Por qué:* la agenda queda ordenada y no se pierden huecos sueltos de 15
minutos.

**Recepción (cuando exista el panel, Fase 4):** podrá saltarse la rejilla y la
antelación mínima al cargar una cita a mano. Es una persona del negocio
decidiendo, no el agente: por ejemplo, una clienta que está en el local y quiere
entrar en 20 minutos.

## PR-05 · Reprogramar

Decidido el 16/10/2026.

**Regla del motor:** mover una cita mantiene la **misma profesional** y el mismo
servicio. Si esa profesional no tiene el hueco nuevo, la cita no se mueve y queda
como estaba, y el agente ofrece otros horarios con ella.

Si la clienta **prefiere otra profesional**, es decisión suya: el agente cancela
la cita y crea una nueva con quien ella elija.

## PR-06 · "La última vez te atendió…"

Decidido el 16/10/2026.

**Regla del motor:** cuenta solo la **última cita que ya pasó**. Una cita futura
ya reservada no cuenta: *"la última vez te atendió"* habla de algo que ocurrió.
Tampoco cuentan las canceladas ni las marcadas como "no se presentó", porque esa
vez nadie la atendió.

## PR-07 · Cancelar o reprogramar dentro del plazo

Decidido el 16/10/2026.

**Caso:** la política de Estética Aurora dice *"sin coste hasta 24 h antes"*. Una
clienta quiere cancelar por el chat con 3 horas de antelación.

**Ajuste por negocio**, con dos modos:

- **Solo informar** (de serie): el agente cancela y le recuerda la política (por
  ejemplo, que se cobra el 50 %).
- **Bloquear dentro del plazo:** con menos horas que las del plazo, el agente no
  cancela y la pasa con una persona.

Y el **plazo en horas** (de serie: **24**).

*Por qué "solo informar" de serie:* el agente no cobra la penalización (la aplica
el local), y una clienta que no va a venir no viene aunque se le bloquee: el
bloqueo solo suma una llamada a recepción. El negocio que quiera ser estricto lo
elige al darse de alta.

**Reprogramar** sigue la misma regla que cancelar: mover una cita a último
momento libera el hueco igual que cancelarla.

**Siempre:** el texto de la política es el que escribe cada negocio, y el agente
lo explica tal cual. Las citas ya completadas o "no presentadas" no se pueden
cancelar. Recepción puede cancelar siempre.

Lo que hace el agente en cada modo se programa en la Fase 2. Esta fase deja el
ajuste guardado en la configuración del negocio.

## PR-08 · Una clienta no puede tener dos citas a la vez

Decidido el 16/10/2026, al probar el agente: Mariana reservó dos veces el lunes
19 a las 17:00, una con Lucía y otra con Marta. El motor impedía que una
*profesional* tuviera dos citas a la vez, pero no que una *clienta* las tuviera.

**Regla del motor:** una clienta no puede tener dos citas que se pisen. Lo
impide la base de datos (igual que el solape de una profesional), no el agente.
El margen no cuenta: una cita puede empezar justo cuando termina la otra.

**Qué hace el agente:**

> — Quiero una consulta de valoración el lunes 19 a las 18:30.
> — No puedo reservarla porque ya tienes una cita a esa hora: limpieza facial
>   profunda el lunes 19 de 18:30 a 19:30 con Lucía.
> — Ah, me había olvidado. Agéndame esta nueva y mueve la anterior a otro horario.
> — Para mover tu cita con Lucía, el primer día que tengo es el lunes 19 en estos
>   horarios: - 12:00 - 12:30 - 13:00
> — La primera.
> — ¡Perfecto! Te agendo la nueva el lunes 19 a las 18:30 y muevo tu cita con
>   Lucía al lunes 19 a las 12:00, ¿me confirmas si es correcto?
> — Sí.
> — ¡Hecho! Consulta de valoración de 18:30 a 18:50 con Marta, y tu limpieza con
>   Lucía pasa a las 12:00.

- Primero dice que no puede y qué cita choca, **sin ofrecer opciones**: espera
  a que la clienta diga qué quiere.
- Si quiere la nueva, la anterior se **mueve** (con su misma profesional,
  PR-05) o se **anula**, como ella diga.
- **Una sola confirmación** para las dos cosas (PA-01).
- **Todo junto:** se hacen las dos cosas o ninguna. Si algo falla, todo queda
  como estaba y ofrece otras horas.
- La política de cancelación se aplica a la cita anterior (PR-07).
- Nunca le ofrece horarios en los que ya tiene otra cita.

---

## Cómo conversa el agente (Fase 2) · ✅ confirmadas

Aparecieron al escribir el spec de la Fase 2 (16/10/2026). Mariana las
confirmó el 16/10/2026 con el valor de serie propuesto.

| # | Tema | Decisión | Estado |
|---|---|---|---|
| PA-01 | Confirmar antes de reservar | Confirma **una sola vez** al elegir el horario ("¿me confirmas si es correcto?") y espera un sí antes de reservar, cancelar o mover | ✅ confirmada (ajustada el 16/10) |
| PA-02 | Datos para reservar | Nombre y teléfono (el teléfono identifica a la clienta) | ✅ confirmada |
| PA-03 | Horarios que ofrece de una vez | Hasta 3, los más cercanos a lo que pidió, con el día una vez y las horas debajo | ✅ confirmada (formato, 16/10) |
| PA-04 | Se presenta como asistente virtual | Sí, en el primer mensaje | ✅ confirmada |
| PA-05 | Cuándo deriva a una persona | Si lo pide, si insiste tras PD-04, salud, quejas, cancelación bloqueada, si no entiende tras dos intentos o si algo falla | ✅ confirmada |
| PA-06 | Qué pasa al derivar | Avisa al equipo, da el teléfono del local y deja de agendar en esa conversación | ✅ confirmada |
| PA-07 | Preguntas que no sabe | Dice que no tiene ese dato y **siempre** pasa la consulta al equipo. Nunca inventa | ✅ confirmada (ajustada el 16/10, con PA-10) |
| PA-08 | Ver y tocar citas | Cada clienta solo ve y cambia sus propias citas (las de su teléfono) | ✅ confirmada |

### PA-01 · Confirmar antes de reservar

Antes de reservar, cancelar o mover, el agente confirma lo que va a hacer y
espera un sí. *Por qué:* un malentendido en una cita es caro para el local y
para la clienta; una pregunta más es barata.

*Ajustada el 16/10/2026 por Mariana, al probar el agente:* al reservar se
confirma **una sola vez**, cuando la clienta elige el horario, y en ese mismo
mensaje se piden los datos si faltan:

> — ¡Perfecto! Te agendo el lunes 19 de octubre a las 17:00, ¿me confirmas si
>   es correcto? Para reservarla, dime también tu nombre y tu teléfono.
> — Claro, Mariana Mazzariello, 603 624 645.
> — ¡Hecho, Mariana! Tienes cita para la limpieza facial profunda el lunes 19
>   de octubre de 17:00 a 18:00. Te la dejo con Lucía.

Con el sí (o los datos sin cambiar nada) reserva directamente: no vuelve a
resumir ni a preguntar "¿te la reservo?". Al reservar dice **siempre** quién la
atiende, sin ofrecer cambiarla (si la clienta lo pide, lo gestiona). Si la
clienta cambia algo, vuelve a confirmar.

### PA-02 · Datos para reservar

Pide **nombre y teléfono**. El teléfono es lo que identifica a la clienta (así
se la reconoce como habitual en PD-03) y lo que usará el local para avisarla.
No pide email: es un dato más que tratar (RGPD) sin uso en el MVP.

### PA-03 · Cuántos horarios ofrece

Hasta **3** de una vez, los más cercanos a lo que pidió. Una lista larga en un
chat abruma; si ninguno le va, ofrece otros.

*Formato (16/10/2026):* el día una sola vez y las horas debajo:

> Para la limpieza facial profunda (60 min, 55 €) el primer día que tengo es el
> lunes 19 de octubre en estos horarios:
> - 16:00
> - 16:30
> - 17:00

### PA-04 · Se presenta como asistente virtual

En el primer mensaje dice que es la **asistente virtual** del negocio. La
normativa europea de IA pide avisar a la persona de que está hablando con una
IA, y además genera confianza: nadie se siente engañado.

### PA-05 · Cuándo deriva a una persona

- La clienta pide hablar con alguien.
- Insiste en una hora que no existe, después de ofrecerle alternativas (PD-04).
- Preguntas de salud o médicas, o sobre si un tratamiento le conviene.
- Quejas o reclamaciones.
- Cancelación o cambio dentro del plazo con el modo "bloquear" (PR-07).
- No entiende lo que le piden tras dos intentos, o algo falla.

### PA-06 · Qué pasa al derivar

En la Fase 2 (sin panel): se registra la derivación para el equipo, la
conversación queda marcada como "pasada a una persona", el agente le da el
teléfono del local y ya no agenda en esa conversación. Cuando exista el panel
(Fase 4), el equipo verá ahí las derivaciones pendientes.

*Ajustada el 16/10/2026 con PA-12:* esto vale cuando se pasa **la
conversación** (pide una persona, queja, cancelación bloqueada, insiste, no
entiende, algo falla). Cuando solo se pasa **una pregunta** que no sabe
responder, la conversación sigue (ver PA-12).

### PA-07 · Preguntas que no sabe

Si le preguntan algo que no está en la configuración del negocio, dice que no
tiene ese dato y **pasa la consulta al equipo** (deriva). **Nunca inventa.** A
partir de la Fase 5 podrá buscar en los documentos del negocio.

*Ajustada el 16/10/2026 con PA-10:* al principio decía "ofrece pasar con una
persona"; Mariana decidió que lo que no sabe, **siempre lo deriva**.

### PA-08 · Ver y tocar citas

Cada clienta solo puede ver, cancelar o mover **sus propias citas**, las
asociadas a su teléfono. Nunca las de otra persona, aunque dé un nombre o un
número de cita.

---

## Decisiones al implementar la Fase 2

Aparecieron al construir el agente (16/10/2026). Mariana las decidió el mismo
día. No queda ninguna abierta.

| # | Tema | Decisión / qué hace ahora | Estado |
|---|---|---|---|
| PA-09 | Quién es quien escribe | **No se verifica la titularidad del teléfono.** Al reservar, llega un SMS de confirmación con un enlace para cancelar o cambiar la cita y el chat sigue pudiendo cancelar y mover (B2) | ✅ decidida 16/10/2026 |
| PA-10 | Preguntas de salud | Responde **solo con la información que dio el negocio** (el cliente del producto); si no la hay, deriva. Lo que no sabe, siempre lo deriva | ✅ decidida 16/10/2026 |
| PA-11 | Para quién es la cita | La cita es del teléfono que se pide; el nombre es el de la persona que viene, **titular de esa línea** | ✅ decidida 16/10/2026 |
| PA-12 | Lo que no sabe, sin cortar la conversación | Dice que no tiene el dato y que lo pasa al equipo, pregunta "¿puedo ayudarte en algo más?" y **sigue atendiendo** (también dando citas) | ✅ decidida 16/10/2026 |

### PA-09 · Quién es quien escribe · ✅ decidida el 16/10/2026

**El caso:** en un chat cualquiera puede escribir un teléfono que no es suyo y
ver, cancelar o mover las citas de esa persona, o reservar a su nombre.

**Decisión:** **no se verifica la titularidad** del teléfono (no hay código por
SMS ni comprobación del nombre); Mariana acepta ese riesgo. En su lugar, al
reservar se envía un **SMS de confirmación** al teléfono de la cita, con un
**enlace para cancelar o cambiar** la cita. Así la dueña del teléfono siempre se
entera de lo que se hace con sus citas.

**Y el chat sigue pudiendo cancelar y mover citas** (opción B2, elegida por
Mariana frente a B1, "el chat solo reserva"): es lo más cómodo para la clienta,
y con el SMS la dueña del teléfono se entera.

**Qué hace ahora:** así, todavía sin SMS. El SMS necesita un proveedor y cuesta unos
céntimos por mensaje; se construye en la Fase 3 (confirmación) y lo reutilizan
los recordatorios de la Fase 6.

### PA-10 · Preguntas de salud · ✅ decidida el 16/10/2026

**Regla:** a una pregunta de salud ("¿me va bien con rosácea?", "¿puedo
hacérmelo embarazada?") el agente responde **solo si el negocio dio esa
información** (hoy, las descripciones de sus servicios; desde la Fase 5, sus
documentos), y la da tal cual, sin valorar el caso de la clienta. **Si el
negocio no la dio, deriva.** Y en general: **lo que no sabe, siempre lo deriva**
(ajusta PA-07).

*Consecuencia que conviene tener presente:* el agente derivará más a menudo
(por ejemplo, ante "¿tenéis parking?" si el negocio no lo puso). Por eso
importa PA-12.

### PA-11 · Para quién es la cita · ✅ decidida el 16/10/2026

**Regla:** la reserva es para el **teléfono que se pide**, y el nombre es el de
**la persona que viene a la cita, que tiene que ser la titular de esa línea**.
Si una madre quiere reservar para su hija, se piden el nombre y el teléfono **de
la hija**; nunca se reserva para alguien con el teléfono de otra persona.

Como cada conversación es de un solo teléfono (PA-08), si la madre ya se
identificó con el suyo, el agente le explica que la hija tiene que escribir
desde su propio chat o llamar al local.

El agente no puede comprobar quién es titular de una línea: lo pide y **se
fía**; se entiende que el teléfono es el de la persona que asistirá (confirmado
por Mariana el 16/10/2026). Verificarlo es otra decisión: PA-09.

### PA-12 · Lo que no sabe, sin cortar la conversación · ✅ decidida el 16/10/2026

**El problema:** con PA-10 el agente deriva todo lo que no sabe. Si derivar
cerrara la conversación (PA-06 tal cual), una pregunta sin importancia
("¿tenéis parking?") dejaría a la clienta sin poder reservar después.

**Regla:** cuando no sabe algo (un dato del negocio, o una pregunta de salud
que la información del negocio no responde), el agente dice que esa
información no la tiene y que se la pasa al equipo, y pregunta **"¿Puedo
ayudarte en algo más?"**. La conversación **sigue**: puede dar, cambiar y
cancelar citas. Al despedirse recuerda el teléfono del local.

> — ¿Tenéis parking cerca?
> — No sé si hay parking cerca. Le he pasado tu pregunta al equipo. ¿Puedo
>   ayudarte en algo más?
> — Sí, dame cita el martes a las 16:00…  *(y la reserva)*

**Cómo se implementó:** la pregunta se registra para el equipo **en el
momento** (no al final), para no perderla si la clienta se va sin contestar.

La conversación solo pasa entera al equipo (y el agente deja de agendar,
PA-06) cuando la clienta pide una persona, hay una queja, la política bloquea
su cancelación, insiste en una hora que no existe, no se entiende tras dos
intentos o algo falla.

---

## El widget web (Fase 3) · ✅ DECIDIDAS

Aparecieron al escribir el spec de la Fase 3 (`fase-3-widget-web.md`), el
16/10/2026. Son **propuestas**: Mariana tiene que confirmarlas o cambiarlas
antes de lanzar la fase.

| # | Tema | Propuesta de serie | ¿Ajuste por negocio? | Estado |
|---|---|---|---|---|
| PW-01 | Marca del widget | Solo la del negocio (nombre y color). El nombre del producto no aparece hasta que exista (PD-07) | Color | ✅ decidida 28/10/2026 |
| PW-02 | Aviso de privacidad | Línea fija antes del primer mensaje: "Soy la asistente virtual de {negocio}, al escribir aceptas nuestra política de privacidad", con enlace. La bienvenida saluda según la hora | URL de su política de privacidad | ✅ decidida 28/10/2026 |
| PW-03 | Cuánto dura la conversación en el navegador | Si vuelve antes de **2 h**, la retoma; después, conversación nueva | — | ✅ decidida 28/10/2026 |
| PW-04 | Tope mensual por negocio | **100 US$/mes** de coste del agente. Al 100 %, mensaje fijo con el teléfono del local; al 80 %, aviso en el informe de consumo | Tope (de serie 100 US$) | ✅ decidida 28/10/2026 |
| PW-05 | Límites anti-abuso | Mensajes de hasta **1.000 caracteres**; **20 mensajes por conversación y hora**; **10 conversaciones nuevas por hora** desde la misma IP | — | ✅ decidida 28/10/2026 |
| PW-06 | Dónde puede ir el widget | Solo en los **dominios que indique el negocio** | Lista de dominios | ✅ decidida 28/10/2026 |
| PW-07 | SMS de confirmación (PA-09) | En la Fase 3 se construye todo **menos el envío real** (proveedor de prueba). La página del enlace muestra la cita y permite **cancelarla**; para cambiarla, remite al chat o al teléfono | — | ✅ decidida 28/10/2026 |
| PW-08 | La demo pública | Se publica en **Vercel** contra el Supabase de la nube, con dos dominios (la web de la demo y el servidor del widget) | — | ✅ decidida 20/10/2026 |

### PW-01 · Marca del widget · ✅ decidida el 28/10/2026

La burbuja y la cabecera del chat llevan **el nombre y el color del negocio**:
para la clienta, está hablando con "Estética Aurora", no con un producto. Como
el nombre del producto (PD-07) todavía no existe, no aparece. Cuando exista,
la propuesta es como mucho un "Funciona con …" pequeño al pie, que también es
publicidad gratuita.

**Decisión (Mariana, 28/10/2026):** solo la marca del negocio. El "Funciona
con …" se decide cuando exista el nombre del producto.

### PW-02 · Aviso de privacidad · ✅ decidida el 28/10/2026

Antes de que la clienta escriba, una línea fija: *"Asistente virtual. Al
escribir aceptas la política de privacidad de {negocio}"*, con enlace a la
política del negocio si la tiene. Cumple dos cosas: avisar de que es una IA
(como PA-04, pero antes de escribir) e informar del tratamiento de datos.
**No sustituye a PD-11** (contrato de encargado, base legal para datos de
salud): eso sigue pendiente antes del primer cliente sanitario.

**Decisión (Mariana, 28/10/2026):** el aviso es obligatorio, pero en el tono
más humano posible: *"Soy la asistente virtual de {negocio}, al escribir
aceptas nuestra política de privacidad."* (texto ajustado por Mariana el mismo
día; "la asistente", como en la bienvenida). "política de privacidad" es un enlace a la del negocio, que abre en una
pestaña nueva. Y la bienvenida **saluda según la
hora** de quien escribe: si el mensaje de bienvenida del negocio empieza por
"¡Hola!", el widget lo convierte en "¡Hola, buenos días!" (de 6 a 14),
"¡Hola, buenas tardes!" (de 14 a 21) o "¡Hola, buenas noches!".

### PW-03 · Cuánto dura la conversación en el navegador · ✅ decidida el 28/10/2026

Si la clienta cierra la web y vuelve **antes de 2 horas**, ve sus mensajes y
sigue donde estaba. Después, empieza una conversación nueva (el agente la
reconoce igual cuando da su teléfono). Una conversación solo la ve **el
navegador que la empezó**.

**Decisión (Mariana, 28/10/2026):** 2 horas como máximo (la propuesta era
24 h). Pedir una cita lleva minutos, y en un dispositivo compartido (la tablet
de casa, el ordenador de una recepción) la siguiente persona no debe ver el
nombre ni el teléfono de la anterior al día siguiente. Pesa más con clínicas,
por los datos de salud (PD-11).

### PW-04 · Tope mensual por negocio · ✅ decidida el 28/10/2026

Para que un negocio con un uso raro (o un ataque) no se coma el margen. De
serie **100 US$ al mes** de coste del agente. Al llegar al tope, el widget
responde con un mensaje fijo con el teléfono del local, sin llamar a la IA. Al
80 %, aviso en el informe de consumo para que Mariana hable con el negocio (o
suba el tope).

**Lo que cuesta de verdad (pruebas del 20 y el 28/10/2026, Opus 5):** el primer
mensaje tras ~5 min sin nadie escribiendo cuesta ~0,06 US$ (la IA vuelve a leer
las reglas del negocio); los siguientes, 0,007–0,025 US$. Una reserva completa
salió en **0,10–0,16 US$**; con la IA "caliente" (escenarios seguidos), ~0,03.
Un negocio pequeño, con conversaciones sueltas, estará en **0,10–0,15 US$ por
conversación**: 10 al día ≈ 30–45 US$/mes, y 100 US$ ≈ 700–1.000
conversaciones al mes. La estimación inicial (≈ 0,05, unas 2.000) era
optimista para negocios pequeños.

**Decisión (Mariana, 28/10/2026):** de serie 100 US$ como freno de seguridad,
y **el tope de cada negocio se habla con el cliente** al contratar, según su
plan y lo que se espera que use. Está también en "Costes y cosas a vigilar".

### PW-05 · Límites anti-abuso · ✅ decidida el 28/10/2026

El widget está en una web pública: cualquiera puede escribirle. Límites de
serie: mensajes de hasta 1.000 caracteres, 20 mensajes por conversación y hora,
y 10 conversaciones nuevas por hora desde la misma conexión. Una clienta normal
no llega nunca. Al pasarse, un mensaje fijo amable con el teléfono del local.

**Decisión (Mariana, 28/10/2026):** sí, con estos números. Comprobar además
que quien escribe no es un bot queda como propuesta aparte (PW-16).

### PW-06 · Dónde puede ir el widget · ✅ decidida el 28/10/2026

Cada negocio dice en qué web(s) lo pega (por ejemplo `esteticaaurora.es`). El
widget solo funciona ahí: si alguien copia el código en otra web, no carga. Es
una pregunta más del cuestionario de alta.

**Decisión (Mariana, 28/10/2026):** sí. Es una regla **solo del widget web**
(en qué webs aparece la burbuja); los demás canales, como WhatsApp (Fase 8),
tendrán las suyas.

### PW-07 · SMS de confirmación (PA-09) · ✅ decidida el 28/10/2026

PA-09 decidió que al reservar llega un SMS con un enlace para cancelar o
cambiar la cita. Enviar SMS de verdad pide **contratar un proveedor** (Twilio u
otro, unos céntimos por mensaje), y el maestro quiere la Fase 3 **sin trámites
externos**. Propuesta:

- En la Fase 3 se construye todo: el texto, el enlace y la página. Un
  **proveedor de prueba** muestra el SMS en la consola en vez de mandarlo.
- El proveedor real se elige y se conecta cuando Mariana lo decida (antes del
  primer cliente real). Es cambiar una pieza, no rehacer nada.
- **La página del enlace** muestra la cita y deja **cancelarla** (con la misma
  regla PR-07 que el agente). Para **cambiarla**, remite al chat de la web o al
  teléfono del local: hacer una agenda completa en esa página es mucho más
  trabajo y el chat ya lo hace.
- Si el SMS falla, la reserva sigue valiendo.
- Texto: *"{negocio}: cita confirmada el {día} a las {hora} con {profesional}.
  Para verla o cancelarla: {enlace}"*. Sin datos de salud.

### PW-08 · La demo pública · ✅ decidida el 20/10/2026

La demo se probó primero en el ordenador de Mariana. **Decisión (Mariana,
20/10/2026): se publica en Vercel** contra el Supabase de la nube, para
enseñarla con un enlace. La cuenta y el proyecto de Vercel los crea Mariana;
las claves van en las variables del proyecto, nunca en el repo.

- **Dos dominios**, como en la realidad: uno para la web inventada de Estética
  Aurora (el que se enseña) y otro para el servidor del widget. El widget solo
  aparece en el de la demo (PW-06).
- Quien tenga el enlace gasta del saldo de la API: lo frenan los límites
  (PW-05) y el tope mensual de Aurora (PW-04, 100 US$; se puede bajar).
- El SMS sigue siendo de prueba (PW-07): sale en los logs de Vercel, no le
  llega a nadie.
- **El plan de Vercel:** de momento, el que ya tiene Mariana (20/10/2026). El
  gratuito (Hobby) es para uso personal y no comercial: si la demo se usa para
  vender, se revisa (el Pro).

---

## Al construir el widget (Fase 3) · ✅ DECIDIDAS

Aparecieron al implementar la Fase 3. **Ya funcionan así** con la propuesta de
serie (para poder probar la demo), pero son decisiones de Mariana: si alguna
cambia, se ajusta el código.

| # | Tema | Propuesta de serie (lo que hace ahora) | ¿Ajuste por negocio? | Estado |
|---|---|---|---|---|
| PW-09 | SMS al mover una cita | **Sí**: llega el mismo SMS de confirmación con la hora nueva y un enlace nuevo | — | ✅ decidida 28/10/2026 |
| PW-10 | SMS al cancelar por el chat | **Sí**: un SMS corto de "cita cancelada", sin enlace (PA-09). Desde la página del enlace, no | — | ✅ decidida 20/10/2026 |
| PW-11 | Color del widget si el negocio no elige | Un gris azulado neutro (`#4f6d7a`) | Sí (el color, PW-01) | ✅ decidida 28/10/2026 |
| PW-12 | Desde cuándo cuentan las 2 h (PW-03) | Desde el **último mensaje** de la conversación; al caducar, el widget lo avisa | — | ✅ decidida 28/10/2026 |
| PW-13 | Las 10 conversaciones por conexión (PW-05) | Se cuentan **por negocio** | — | ✅ decidida 28/10/2026 |
| PW-14 | Textos fijos del widget | Los de abajo, con el teléfono del local | — | ✅ decidida 28/10/2026 |
| PW-15 | Cancelar desde la página del SMS | Pide un **"¿Seguro?"** antes de cancelar | — | ✅ decidida 28/10/2026 |
| PW-17 | Logo del negocio en el widget | Un **círculo antes del nombre** en la cabecera del chat, con su logo o isotipo. Sin logo: la **inicial** del nombre | Sí (el logo) | ✅ decidida 28/10/2026 (lo de la inicial, ⚠️ por confirmar) |
| PW-16 | Comprobar que no es un bot | Todavía no: si se ven abusos, comprobación invisible (Cloudflare Turnstile) | — | ✅ decidida 28/10/2026 |

### PW-09 · SMS al mover una cita · ✅ decidida el 28/10/2026

Al mover una cita, en la base la cita "nueva hora" es otra fila, así que el
enlace del SMS anterior pasa a mostrar la cita vieja como cancelada. Para que
la clienta tenga un enlace que sirva, **se manda otro SMS de confirmación** con
la hora nueva: *"{negocio}: cita confirmada el {día} a las {hora} con
{profesional}. Para verla o cancelarla: {enlace}"*. También cuando el agente
mueve la cita anterior por PR-08.

*Alternativa:* un texto distinto ("tu cita ha cambiado al…"). Mismo coste.

### PW-10 · SMS al cancelar por el chat · ✅ decidida el 20/10/2026

PA-09 dice que la dueña del teléfono "siempre se entera de lo que se hace con
sus citas". Se entera al **reservar**, al **mover** (PW-09) y, con esta regla,
también al **cancelar** por el chat.

**Decisión (Mariana, 20/10/2026):** sí, un SMS corto, sin enlace: *"{negocio}:
tu cita del {día} a las {hora} se ha cancelado. Si no fuiste tú, llama al
{teléfono}."* Si el negocio no tiene teléfono, dice "llama al local". Cuesta un
SMS más por cancelación. Al cancelar desde la propia página del SMS no se manda
(ya lo está viendo), y si la cita ya estaba cancelada tampoco.

### PW-11 · Color del widget si el negocio no elige · ✅ decidida el 28/10/2026

Un gris azulado neutro (`#4f6d7a`), que no parece la marca de nadie. El texto
encima (blanco o casi negro) lo elige el widget solo, según el color, para que
se lea bien. Para Estética Aurora la demo usa un rosa empolvado (`#8a5a63`).

### PW-12 · Desde cuándo cuentan las 2 h (PW-03) · ✅ decidida el 28/10/2026

Desde el **último mensaje**, no desde que empezó: con 2 h (PW-03), una clienta
que escribió a las 10:00 y otra vez a las 11:30 la retoma hasta las 13:30.
Mirar el historial no cuenta como mensaje.

**Decisión (Mariana, 28/10/2026):** sí, y cuando caduca el widget lo dice: *"Tu
conversación anterior ha terminado. Empezamos una nueva."* (al volver a abrir
el chat, o si caduca con el chat abierto y escribe otra vez).

### PW-13 · Las 10 conversaciones por conexión (PW-05) · ✅ decidida el 28/10/2026

Se cuentan **por negocio**: si desde la misma conexión (por ejemplo, la wifi de
un centro comercial) se abren conversaciones en dos webs distintas, cada una
lleva su cuenta. La IP no se guarda: solo un resumen cifrado que no permite
recuperarla.

### PW-14 · Textos fijos del widget · ✅ decidida el 28/10/2026

Cuando responde el código y no la IA. *{tel}* es el teléfono del local:

| Cuándo | Texto |
|---|---|
| Mensaje de más de 1.000 caracteres | "Tu mensaje es demasiado largo. ¿Puedes escribirlo en menos de 1.000 caracteres?" |
| 20 mensajes en una hora | "Has enviado muchos mensajes seguidos y necesito una pausa. Vuelve a escribirme dentro de un rato o llama al {tel}." |
| 10 conversaciones nuevas en una hora | "Ahora mismo no puedo abrir más conversaciones desde esta conexión. Inténtalo más tarde o llama al {tel}." |
| Tope mensual (PW-04) | "Ahora mismo no puedo atenderte por aquí. Si quieres pedir o cambiar una cita, llama al {tel} y te ayudamos." |
| Dos mensajes a la vez | "Sigo con tu mensaje anterior. Espera un momento y vuelve a enviarlo." |
| Falla algo | "Perdona, ha habido un problema y no he podido responderte. Inténtalo de nuevo en un momento o llama al {tel}." |
| Tarda más de 60 s (en el widget) | "Está tardando más de lo normal o se ha cortado la conexión." + botón **Reintentar** |
| La conversación caducó (PW-12, en el widget) | "Tu conversación anterior ha terminado. Empezamos una nueva." |

El del tope no dice que hay un tope: para la clienta, simplemente hoy se pide
por teléfono.

### PW-15 · Cancelar desde la página del SMS · ✅ decidida el 28/10/2026

Como PA-01 en el chat (confirmar antes de cancelar): la página muestra la cita
y un botón **"Cancelar la cita"**; al pulsarlo pregunta *"¿Seguro que quieres
cancelar tu cita?"*, con la política de cancelación del negocio, y solo con
**"Sí, cancelar la cita"** se cancela. Además evita que una app que abre el
enlace para previsualizarlo cancele sin querer.

### PW-16 · Comprobar que no es un bot · ✅ decidida el 28/10/2026

Apareció al confirmar PW-05 (28/10/2026): ¿hay otra forma de frenar a los bots
además de los límites? Sí, y se puede sumar sin molestar a la clienta:

- **Comprobación invisible** (por ejemplo, Cloudflare Turnstile, gratis): el
  navegador resuelve una prueba en segundo plano antes del primer mensaje; una
  persona no ve nada y un bot simple no pasa. Hay que dar de alta una cuenta
  de Cloudflare y es un servicio externo más (sin datos de la clienta).
- **Campo trampa**: un campo oculto que solo rellenan los bots. Muy simple,
  pero solo para bots torpes.

*Propuesta:* no hacerlo todavía. Los límites (PW-05) y el tope (PW-04) ya
acotan el gasto; si en la demo publicada o con el primer cliente se ven abusos
en el informe de consumo, se añade la comprobación invisible. Sería trabajo de
una fase posterior y necesita el visto bueno de Mariana (servicio externo).

**Decisión (Mariana, 28/10/2026):** sí, como se propone: todavía no; se
añade si se ven abusos.

### PW-17 · Logo del negocio en el widget · ✅ decidida el 28/10/2026

**Decisión (Mariana, 28/10/2026):** en la cabecera del chat, antes del nombre
del negocio, un **círculo con su logo o isotipo**, para que se vea aún más
suyo (PW-01). Es un ajuste por negocio más: el cuestionario de alta pide el
logo (mejor cuadrado, PNG, SVG o JPG, hasta ~150 KB).

- El logo se guarda **en la base**, no como enlace a la web del negocio: así
  el chat no carga nada de otra web (más rápido, y sin que esa web sepa quién
  abre el chat).
- El círculo va en blanco, para que cualquier logo se vea bien sobre el color
  del negocio.
- *Propuesta, ⚠️ por confirmar:* **sin logo**, el círculo muestra la
  **inicial** del nombre ("E" de Estética Aurora) en el color del negocio.
  Alternativa: sin logo, no hay círculo.
- Para Estética Aurora la demo usa un isotipo inventado (un sol que asoma).

**Dominios (detalle de PW-06):** se compara el dominio exacto. `esteticaaurora.es`
y `www.esteticaaurora.es` son dos entradas: el cuestionario de alta pide los
dos.

