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

---

## Cómo conversa el agente (Fase 2) · ✅ confirmadas

Aparecieron al escribir el spec de la Fase 2 (16/10/2026). Mariana las
confirmó el 16/10/2026 con el valor de serie propuesto.

| # | Tema | Decisión | Estado |
|---|---|---|---|
| PA-01 | Confirmar antes de reservar | Resume la cita y espera un sí explícito antes de reservar, cancelar o mover | ✅ confirmada |
| PA-02 | Datos para reservar | Nombre y teléfono (el teléfono identifica a la clienta) | ✅ confirmada |
| PA-03 | Horarios que ofrece de una vez | Hasta 3, los más cercanos a lo que pidió | ✅ confirmada |
| PA-04 | Se presenta como asistente virtual | Sí, en el primer mensaje | ✅ confirmada |
| PA-05 | Cuándo deriva a una persona | Si lo pide, si insiste tras PD-04, salud, quejas, cancelación bloqueada, si no entiende tras dos intentos o si algo falla | ✅ confirmada |
| PA-06 | Qué pasa al derivar | Avisa al equipo, da el teléfono del local y deja de agendar en esa conversación | ✅ confirmada |
| PA-07 | Preguntas que no sabe | Dice que no tiene ese dato y ofrece pasar con una persona. Nunca inventa | ✅ confirmada |
| PA-08 | Ver y tocar citas | Cada clienta solo ve y cambia sus propias citas (las de su teléfono) | ✅ confirmada |

### PA-01 · Confirmar antes de reservar

Antes de reservar, cancelar o mover, el agente resume lo que va a hacer
(*"limpieza facial el martes 20 a las 16:00 con Lucía, ¿te la reservo?"*) y
espera un sí. *Por qué:* un malentendido en una cita es caro para el local y
para la clienta; una pregunta más es barata.

### PA-02 · Datos para reservar

Pide **nombre y teléfono**. El teléfono es lo que identifica a la clienta (así
se la reconoce como habitual en PD-03) y lo que usará el local para avisarla.
No pide email: es un dato más que tratar (RGPD) sin uso en el MVP.

### PA-03 · Cuántos horarios ofrece

Hasta **3** de una vez, los más cercanos a lo que pidió. Una lista larga en un
chat abruma; si ninguno le va, ofrece otros.

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

En la Fase 2 (sin panel todavía): se registra la derivación para el equipo, la
conversación queda marcada como "pasada a una persona", el agente le da el
teléfono del local y ya no agenda en esa conversación. Cuando exista el panel
(Fase 4), el equipo verá ahí las derivaciones pendientes.

### PA-07 · Preguntas que no sabe

Si le preguntan algo que no está en la configuración del negocio, dice que no
tiene ese dato y ofrece pasar con una persona. **Nunca inventa.** A partir de la
Fase 5 podrá buscar en los documentos del negocio.

### PA-08 · Ver y tocar citas

Cada clienta solo puede ver, cancelar o mover **sus propias citas**, las
asociadas a su teléfono. Nunca las de otra persona, aunque dé un nombre o un
número de cita.
