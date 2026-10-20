---
name: sync-research-desk
description: Mantiene al día los documentos de producto del Recepcionista IA en Research Desk (el manual "Cómo funciona el Recepcionista", el cuestionario de alta, la hoja de ruta, la nota de decisiones de producto y "Costes y cosas a vigilar"). Usala SIN que Mariana lo pida, en el mismo turno, cada vez que cambie cómo se comporta el producto — una regla de negocio, un ajuste por negocio, lo que hace el agente o el widget, el estado de una fase, decisiones-producto.md, costes, tiempos o riesgos — y también cuando ella diga "actualizá el manual" o "pasalo a Research Desk".
---

# Sincronizar Research Desk

Mariana pidió (16/10/2026) que todo avance o decisión del producto quede
apuntado en sus documentos de Research Desk **sin tener que pedirlo**: "confío
en que lo harás tú siempre". Es parte de terminar un cambio, no un extra.

**No toca el repo.** El repo (`_specs/`, `README.md`, `AGENTS.md`) se
actualiza aparte; esto es la versión para leer de Mariana.

## Qué documento según el cambio

Space: **"mm - agente recepcionista"** (`spc_20261015t1816fv77wyc`).

| Si cambia… | Documento | Artifact |
|---|---|---|
| **Cualquier cosa de cómo funciona el producto** (siempre) | Cómo funciona el Recepcionista — el manual, el principal | `art_20261016t05187b4pfjv` |
| Un ajuste por negocio (nuevo o cambiado) | Cuestionario de alta: la pregunta, el ejemplo de Aurora y la ficha exportada | `art_20261016t0518xh6vgg1` |
| El estado de las fases o la tabla de decisiones | Hoja de ruta Recepcionista IA | `art_20261016t0418n68yyee` |
| `_specs/decisiones-producto.md` | Decisiones de producto: es una **copia** del .md; se reescribe entera | `art_20261016t09377swes0b` |
| Costes, tiempos o riesgos (tokens medidos, modelo o precios, cosas para hablar más adelante) | Costes y cosas a vigilar (documento vivo) | `art_20261016t0937svta3z4` |

**No hace falta** para cambios internos que no cambian el comportamiento
(refactor, tests, documentación técnica, `AGENTS.md`). Ante la duda, el
manual se actualiza.

## Cómo

1. Cargá la skill **`research-desk`** y seguí sus pasos de conexión: `dq
   context`, `GET /readme` y `GET /api/commands/schema`. Usá los comandos que
   diga esa guía en vivo, no los de memoria.
2. **Leé el contenido actual** del documento antes de escribir: se edita
   sobre lo que hay, sin perder lo que Mariana haya cambiado a mano.
3. Escribí con **`artifact.write-body`** la página entera (HTML completo, o el
   Markdown entero en la nota de decisiones). Nunca edites a mano los
   archivos de `~/Documents/research_desk/`.
4. Mantené el estilo del documento: lenguaje de producto (no de base de
   datos), en el registro de Mariana, con ejemplos de Estética Aurora y los
   códigos de las reglas (PR-07, PW-04…).
5. Si la regla está ⚠️ por confirmar, que se vea así también en el documento.

## Al terminar

Decilo en **una línea** en el resumen a Mariana, por ejemplo: *"Actualicé el
manual (nueva sección de límites del widget) y el cuestionario (pregunta de
dominios)."*

Si Research Desk no está abierto o no responde, **no lo des por hecho**: decí
qué documentos quedaron pendientes y qué hay que cambiar en cada uno, para
hacerlo cuando esté disponible.

## Si cambia algo de esto

Un documento nuevo en el space, o uno que deja de usarse → la tabla de arriba
(es la única lista de ids que hay en el repo).
