# _specs/ — specs y reglas de negocio

Lo que hay que construir y las reglas con las que se construye. El código se
adapta a estos documentos, no al revés.

| Archivo | Qué es |
|---|---|
| `mazzmkt-recepcionista-ia-spec.md` | **El maestro.** Alcance del MVP, arquitectura de 4 capas, modelo de datos, herramientas, interfaz de adaptadores, requisitos no funcionales y plan de fases. Las secciones se citan como "maestro §N" |
| `fase-N-*.md` | Spec de ejecución de cada fase: objetivo, Definition of Done, tareas numeradas (N.1, N.2…), fuera de alcance, orden de trabajo y prompt de arranque |
| `decisiones-producto.md` | **Fuente de verdad de las reglas de negocio**, en lenguaje de producto. Se sube a GitHub a propósito |

## Los códigos de decisión

| Prefijo | Qué son | Ejemplo |
|---|---|---|
| `PD-` | Decisiones de producto de las primeras fases | PD-03 quién atiende |
| `PR-` | Reglas del motor de reservas | PR-07 cancelar dentro del plazo |
| `PA-` | Cómo conversa el agente | PA-08 solo sus citas |
| `PW-` | El widget web (Fase 3) | PW-06 dominios permitidos |
| `D-` / `T-` / `DT-` | Decisiones técnicas, trampas y deuda técnica | viven en `docs/DECISIONES.md` (local) |

Cada regla distingue **regla del motor** (igual para todos) y **ajuste por
negocio** (con su valor de serie). Los ajustes por negocio son columnas en la
base, no constantes en el código.

## Reglas

- **No se inventan reglas.** Una decisión de producto que aparece al
  implementar se añade a `decisiones-producto.md` como **⚠️ POR CONFIRMAR**,
  con contexto, propuesta de serie y ejemplo, y se avisa a Mariana. Cuando la
  confirma, pasa a ✅ con la fecha.
- **Códigos estables.** Nunca se renumera ni se reutiliza un código. Uno nuevo
  toma el siguiente libre de su prefijo.
- **Al tocar una regla**, se actualiza también la tabla "Resumen" del
  principio de `decisiones-producto.md`.
- **Los specs de fase se escriben antes de la fase**, con el mismo formato que
  los existentes (copiá la estructura de `fase-3-widget-web.md`). Una vez
  cerrada la fase no se reescriben: lo que cambió se registra en
  `docs/DECISIONES.md`.
- Si el código y un spec no coinciden, **no "arregles" el spec en silencio**:
  o el código está mal, o hay una decisión que registrar. Preguntá.
- Estos documentos están en el registro de Mariana (voseo) y en lenguaje de
  producto, no de base de datos.

## Si cambiás algo de acá

**Obligatorio:** si tu cambio toca la arquitectura, una regla de negocio o la
forma de trabajo de esta carpeta, actualizá este `AGENTS.md` (y el raíz si
aplica) en el mismo cambio. Ver §8 del [`AGENTS.md` raíz](../AGENTS.md#8-mantener-esta-documentación).

- `decisiones-producto.md` tiene copias fuera del repo (la nota "Decisiones de
  producto" y el manual "Cómo funciona el Recepcionista" en Research Desk):
  hay que actualizarlas también.
- Una fase nueva o un cambio en el plan: actualizá la tabla "Qué NO está
  hecho" del `README.md` raíz.
