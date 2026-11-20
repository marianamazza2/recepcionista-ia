# admin/ — el panel interno y el portal del cliente

**Dos apps, un proyecto.** Desde la Fase 9, `admin/` tiene dos entradas:

| Entrada | Quién | Dónde | Habla con |
|---|---|---|---|
| `index.html` → `src/main.tsx` | **Mariana** (Fase 4) | `/panel/` | `/api/admin/…` |
| `portal.html` → `src/portal/main.tsx` | **el cliente** (Fase 9) | `/portal/` | `/api/portal/…` |

Están juntas a propósito (D-88): así el portal reutiliza **tal cual** la
ficha, la agenda, los estilos y las piezas comunes, en vez de duplicarlas y,
con ellas, las reglas (PC-05). Cada una tiene su config de Vite
(`vite.config.ts` y `vite.portal.config.ts`) y su carpeta de salida (`dist` y
`dist-portal`).

El panel ve todos los negocios, sus conversaciones y teléfonos: tiene que
estar cerrado. El portal ve **solo el suyo**. Qué hace cada uno y cómo se
usan: [`README.md`](README.md).

## Pantallas compartidas: `negocio-api.tsx`

La ficha (`src/paginas/Ficha.tsx`) y la agenda (`src/paginas/Agenda.tsx`) son
las mismas en los dos sitios. No llaman a una API concreta: piden la de su
contexto con `useApiNegocio()` y usan caminos **relativos al negocio**
(`datos`, `servicios/:id`, `agenda`). Cada app pone el suyo con
`<ProveedorNegocio>`.

`ver` ('panel' | 'portal') es lo **único** que cambia: con `'portal'` no se
ven el tope mensual, activar/pausar, la clave del widget ni el código para
pegar en la web (PC-09). **No cambia ninguna validación.** Si hace falta algo
que solo vale en un sitio, va detrás de `ver`, nunca en una copia de la
pantalla.

## Reglas

1. **Solo habla con nuestra API** (`/api/admin/…` el panel, `/api/portal/…`
   el portal; mismo origen), nunca con Supabase directamente: ni
   `supabase-js`, ni claves en el navegador. El login también pasa por la API
   (`POST /api/admin/sesion`, `POST /api/portal/sesion`).
2. **La sesión, en `sessionStorage`** (se pierde al cerrar la pestaña), en
   `try/catch`. El token va en `Authorization`; nada de cookies. Un 401 se
   intenta renovar una vez y, si no, vuelta a "Entrar" (`src/api.ts`). El
   portal tiene su propia sesión y su propia clave de almacenamiento
   (`src/portal/api.ts`): son dos mundos y un token de uno no vale en el otro.
   `ErrorApi` sí es **la misma clase** para los dos (`src/error-api.ts`), para
   que `mensajeDe()` enseñe la frase que mandó la API.
3. **Las reglas de negocio no se repiten aquí.** El panel no valida horarios,
   solapes, colores ni límites: los valida la base y la API devuelve el error
   con palabras, que se enseña tal cual (`Aviso`). Aquí solo hay ayudas de
   forma (tipos de campo, `maxLength`).
4. **Lo que borra o corta, con confirmación:** pausar, cambiar la clave del
   widget (PI-09), desactivar algo con citas futuras (PI-04), cancelar una
   cita. Y un aviso que sí es del panel y no de la base: un horario propio
   fuera del horario del local se puede guardar (PD-01), pero se confirma
   antes (PI-18). Un festivo, una ausencia o un horario que deja fuera citas
   ya dadas: la API contesta `citas_afectadas` y el panel enseña el cartel
   (dejarlas o cancelarlas, PI-21). Cada guardado de una sección manda su
   `version` (PI-22): datos, reglas y chat guardan la de cuando se abrieron
   (sus formularios no se recargan solos) y la renuevan al guardar; las filas
   y el horario usan la de la ficha actual, porque se recargan con ella. Las cuentas de horarios son funciones puras en
   `src/horario.ts`, testeadas desde `tests/panel-horario.test.ts` y
   `tests/borrado.test.ts` (`trabajaAlgunDia`, PI-20). Los avisos en **ámbar**
   no impiden guardar, solo advierten: un servicio que no hace nadie, un
   horario propio fuera del local (PI-18) y una profesional que no trabaja
   ningún día (PI-20, 13/11/2026); esa última además hace que el negocio no se
   pueda activar, y eso lo impide la base (PI-03).
5. **Lo que se ve de una conversación se pinta como texto** (React escapa):
   nunca `dangerouslySetInnerHTML`. Lo escribe gente de fuera.
6. **El logo se reduce en el navegador** (`src/logo.ts`, PI-10): el servidor
   no tiene librerías de imagen. Antes de aceptar cualquier tamaño, se intenta
   decodificar la imagen: un archivo renombrado se rechaza y conserva el logo
   anterior (aceptación 15). El límite final lo pone la base (D-75).
7. **Textos para Mariana en español de España, de tú** (como verá el cliente
   la Fase 9). Usable en portátil; en el móvil, que no se rompa.
8. **Sin router ni librería de estado**: rutas por hash (`#/negocios/…`,
   `useRuta`) y `useCarga`/`useAccion` en `src/ui.tsx`. Dependencias solo de
   desarrollo (React, Vite, Tailwind): lo publicado son estáticos.
9. `dist/` y `dist-portal/` son generados (los compilan `npm run dev`,
   `npm run build:panel`, `npm run build:portal` y `npm run build:vercel`); no
   se editan a mano.
10. **La agenda es visual** (PC-16) y la dibuja una rejilla propia con CSS, sin
    librería de calendario (D-89). **Qué horas están abiertas no se calcula
    aquí**: viene de la API (`app.tramos_efectivos`), así que lo sombreado es
    exactamente lo que el motor considera cerrado.
11. **El portal se ve como un chat de IA** (Fase 9b, PC-17 y PC-19): a la
    izquierda «Nuevo chat» y el historial; arriba «Agente | Portal» y el
    círculo del perfil (despliega «Cuenta» con el nombre y el email como datos, «Ajustes» —todavía no abre nada— y Cerrar sesión; sin ventanas). El portal está
    **siempre**, con o sin datos; lo vacío ofrece «Pídeselo al agente»,
    que abre `#/nuevo/:pedido` (un chat nuevo con el mensaje de
    `src/portal/pedir.ts` ya enviado). En la ficha compartida, ese aviso
    sale solo si el contexto trae `pedirAlAgente` (el panel no lo pone). El
    resumen para confirmar lo dibuja `src/portal/Chat.tsx` con los datos
    que manda el agente: **el formato no lo inventa el modelo**.
12. **Selectores de test estables**: las respuestas del chat llevan
    `data-rol="asistente"` (y las del cliente `data-rol="cliente"`); la caja
    es «Escribe tu mensaje». Usá eso, no clases de Tailwind.

## Tests

`npm run test:e2e` incluye `tests/e2e/panel.e2e.ts` y
`tests/e2e/portal.e2e.ts` (Chrome, cuentas falsas, modelo simulado): el
segundo hace el camino entero, de la invitación a la cita, y deja capturas de
cada pantalla en ordenador y en móvil (`PORTAL_CAPTURAS`). La API que hay
debajo la cubren `tests/admin-api.test.ts`, `tests/portal-api.test.ts` y
`tests/alta-chat.test.ts`. `npm run typecheck` comprueba también `admin/`
(`tsc -p admin`), las dos apps.

## Si cambiás algo de acá

**Obligatorio:** si tu cambio toca la arquitectura, una regla de negocio o la
forma de trabajo de esta carpeta, actualizá este `AGENTS.md` (y el raíz si
aplica) en el mismo cambio. Ver §8 del [`AGENTS.md` raíz](../AGENTS.md#8-mantener-esta-documentación).

- Una ruta nueva de la API → `src/api/admin/rutas.ts`, su fila en
  [`src/api/README.md`](../src/api/README.md) y su test.
- Una sección nueva → la tabla de [`README.md`](README.md).
- Si cambia cómo se comporta el producto, el manual de Research Desk
  (skill `sync-research-desk`).
