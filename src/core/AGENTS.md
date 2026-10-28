# src/core/ — el núcleo del agente

**El mismo código para todos los negocios.** Lo que cambia entre negocios
llega como datos (`BusinessConfig`, de `src/config/business.ts`). Si una tarea
te pide escribir aquí algo propio de un negocio, la tarea está mal planteada:
es configuración (una columna en `businesses`) o un párrafo del prompt que se
elige según un ajuste.

| Archivo | Qué hace |
|---|---|
| `agent.ts` | `runAgentTurn`: el loop de tool use, historial, límites, derivar. Punto de entrada único del núcleo |
| `prompt.ts` | `buildSystemPrompt` (determinista, cacheado) y `contextoDelTurno` (fecha, hora y clienta, en cada turno) |
| `tools/` | Las herramientas: definición (lo que ve el modelo) + ejecución (lo que hace el código) |
| `guardrails.ts` | Límites del loop, respuestas fijas, limpieza del texto para la clienta |
| `time.ts` | La **única** conversión hora local ↔ UTC |
| `phone.ts` | Teléfonos a `+34…` |
| `costes.ts` | Precios de la API (US$) y coste de una llamada |

## Reglas que no se rompen

1. **Tool use manual** (D-44), no el tool runner del SDK: el loop guarda cada
   vuelta, aplica límites y corta al derivar.
2. **Historial solo-añadir** (D-45): se reenvía el `content` de cada respuesta
   tal cual, con los bloques `thinking`. Nunca se reescribe ni se reordena un
   mensaje ya guardado. Las respuestas fijas se guardan con `mensajes: []`
   (en el log, fuera del historial de la API).
3. **System prompt determinista.** La misma configuración → el mismo texto,
   byte a byte (es el prefijo cacheado). Nada de fecha, hora ni datos de la
   clienta en él: eso va en `contextoDelTurno`, un mensaje `system` detrás del
   de la clienta (D-46). Las listas, siempre en el mismo orden.
4. **Lo que no se puede saltar, en el código** (D-50), no solo en el prompt:
   PA-08 (solo sus citas, `tools/common.ts → citaDeLaClienta`), PR-07
   bloquear, PA-06 (tras derivar no se escribe), precios ocultos (se descartan
   al cargar la configuración), límites de vueltas y tokens.
5. **El modelo nunca ve UTC ni ids de base que no necesita.** Las herramientas
   reciben y devuelven hora local (`fecha`, `hora`, `dia` legible).
6. **Errores del SDK por clase**, nunca por texto. `stop_reason` se mira antes
   de leer la respuesta.
7. **Modelo y esfuerzo no se cambian en el código**: son `AGENT_MODEL` y
   `AGENT_EFFORT` (decisión de coste de Mariana). Los límites, `AGENT_MAX_*`.
8. **El núcleo no conoce el canal.** Si un canal necesita algo (p. ej. el
   `externalId` del widget), entra como parámetro opcional de `runAgentTurn`,
   con el cambio mínimo.

## Añadir o cambiar una herramienta

Cada herramienta es un `AgentTool` (`tools/types.ts`):

```ts
export const miHerramienta: AgentTool = {
  name: 'mi_herramienta',          // snake_case, en español
  escribe: true,                   // true si cambia agenda o clienta → bloqueada tras derivar (PA-06)
  definition(config) { … },        // strict: true, additionalProperties: false, nombres con enum (D-49)
  async run(input, ctx) { … },     // devuelve ok({...}) o fallo({ motivo, mensaje, alternativas? })
};
```

1. Un archivo en `tools/` (o junto a sus parientes), registrada en
   `tools/index.ts → TOOLS` (se ordenan por nombre: no rompas el orden).
2. `definition` construida **solo** con la configuración: servicios y
   profesionales como `enum` de nombres, nunca ids.
3. `run` nunca confía en el modelo: valida la entrada, comprueba la regla y
   traduce los errores del motor con `errorDeReserva` / `motivoYMensaje`, con
   alternativas ya buscadas cuando aplica.
4. Un `motivo` nuevo es un string estable en snake_case; documentalo donde se
   explique al modelo (prompt o descripción).
5. Tests en `tests/tools.test.ts` (contra Aurora) y, si cambia el loop,
   `tests/agent.test.ts` con el modelo simulado.
6. Actualizá la lista de herramientas del `README.md` raíz y, si cambia lo que
   el agente puede hacer, `decisiones-producto.md` y el manual de Research Desk.
7. `npm run agent:eval` antes de dar por bueno el cambio.

No se declara una herramienta que todavía no hace nada (por eso
`buscar_en_conocimiento` no existe hasta la Fase 5).

## Cambiar el prompt

- Cada párrafo es una función en `prompt.ts`; los ajustes por negocio eligen
  entre párrafos ya escritos (PD-03, PR-07…).
- Texto para la clienta: español de España, de tú, sin datos inventados.
- **Preguntas frecuentes (Fase 4, PI-08):** van al final de "Datos del
  negocio", con la instrucción de responder con ellas tal cual y pasar al
  equipo lo que no esté. Es el único cambio del núcleo en la Fase 4; las
  carga `config/business.ts` en el orden del negocio y su límite lo pone la
  base (RA007), no el prompt.
- `tests/prompt.test.ts` comprueba determinismo, que no haya precios ocultos ni
  datos de un negocio concreto. Si añadís un modo, añadí su caso.
- Los escenarios del eval comprueban lo grave, no el estilo (D-56).

## Si cambiás algo de acá

**Obligatorio:** si tu cambio toca la arquitectura, una regla de negocio o la
forma de trabajo de esta carpeta, actualizá este `AGENTS.md` (y el raíz si
aplica) en el mismo cambio. Ver §8 del [`AGENTS.md` raíz](../../AGENTS.md#8-mantener-esta-documentación).

- Regla nueva en el código → la tabla de D-50 en `docs/DECISIONES.md` y la
  cabecera de `guardrails.ts`.
- Cambio en `runAgentTurn` o en `TurnResult` → revisá quién lo llama
  (`adapters/channels/`, `cli/`) y `src/api/README.md`.
- Precios nuevos → `costes.ts` y la nota de costes de Research Desk.
