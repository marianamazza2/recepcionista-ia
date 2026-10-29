# admin/ — reglas del panel interno

Es **la herramienta de Mariana** (Fase 4), no la del cliente (Fase 9). Ve
todos los negocios, sus conversaciones y teléfonos: tiene que estar cerrada.
Qué hace y cómo se usa: [`README.md`](README.md).

## Reglas

1. **Solo habla con nuestra API** (`/api/admin/…`, mismo origen), nunca con
   Supabase directamente: ni `supabase-js`, ni claves en el navegador. El
   login también pasa por la API (`POST /api/admin/sesion`).
2. **La sesión, en `sessionStorage`** (se pierde al cerrar la pestaña), en
   `try/catch`. El token va en `Authorization`; nada de cookies. Un 401 se
   intenta renovar una vez y, si no, vuelta a "Entrar" (`src/api.ts`).
3. **Las reglas de negocio no se repiten aquí.** El panel no valida horarios,
   solapes, colores ni límites: los valida la base y la API devuelve el error
   con palabras, que se enseña tal cual (`Aviso`). Aquí solo hay ayudas de
   forma (tipos de campo, `maxLength`).
4. **Lo que borra o corta, con confirmación:** pausar, cambiar la clave del
   widget (PI-09), desactivar algo con citas futuras (PI-04), cancelar una
   cita. Y un aviso que sí es del panel y no de la base: un horario propio
   fuera del horario del local se puede guardar (PD-01), pero se confirma
   antes (PI-18). Las cuentas de horarios son funciones puras en
   `src/horario.ts`, testeadas desde `tests/panel-horario.test.ts`.
5. **Lo que se ve de una conversación se pinta como texto** (React escapa):
   nunca `dangerouslySetInnerHTML`. Lo escribe gente de fuera.
6. **El logo se reduce en el navegador** (`src/logo.ts`, PI-10): el servidor
   no tiene librerías de imagen. El límite final lo pone la base (D-75).
7. **Textos para Mariana en español de España, de tú** (como verá el cliente
   la Fase 9). Usable en portátil; en el móvil, que no se rompa.
8. **Sin router ni librería de estado**: rutas por hash (`#/negocios/…`,
   `useRuta`) y `useCarga`/`useAccion` en `src/ui.tsx`. Dependencias solo de
   desarrollo (React, Vite, Tailwind): lo publicado son estáticos.
9. `dist/` es generado (lo compilan `npm run dev`, `npm run build:panel` y
   `npm run build:vercel`); no se edita a mano.

## Tests

`npm run test:e2e` incluye `tests/e2e/panel.e2e.ts` (Chrome, cuentas falsas,
modelo simulado). La API que hay debajo la cubre `tests/admin-api.test.ts`.
`npm run typecheck` comprueba también `admin/` (`tsc -p admin`).

## Si cambiás algo de acá

**Obligatorio:** si tu cambio toca la arquitectura, una regla de negocio o la
forma de trabajo de esta carpeta, actualizá este `AGENTS.md` (y el raíz si
aplica) en el mismo cambio. Ver §8 del [`AGENTS.md` raíz](../AGENTS.md#8-mantener-esta-documentación).

- Una ruta nueva de la API → `src/api/admin/rutas.ts`, su fila en
  [`src/api/README.md`](../src/api/README.md) y su test.
- Una sección nueva → la tabla de [`README.md`](README.md).
- Si cambia cómo se comporta el producto, el manual de Research Desk
  (skill `sync-research-desk`).
