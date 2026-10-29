# admin/ — el panel interno

React + Vite + Tailwind (maestro §4). Se sirve bajo `/panel/` desde el mismo
origen que la API:

- **En local:** `npm run dev` → http://localhost:4312/panel/ (se recompila
  solo al cambiar un archivo). Cómo crear la cuenta: README raíz, "Panel
  interno (Fase 4)".
- **En Vercel** (cuando Mariana lo confirme, PI-02): `npm run build:vercel`
  lo deja en `static/panel/`, con su CSP. Con `PANEL_HOST`, la raíz de ese
  dominio lleva al panel.

## Pantallas

| Ruta (hash) | Qué hay | Reglas |
|---|---|---|
| (sin sesión) | Entrar: email y contraseña, sin registro | PI-01 |
| `#/` | Negocios con su estado, lo que falta y derivaciones pendientes; dar de alta uno | PI-03 |
| `#/negocios/:id/ficha` | Publicar (lo que falta, activar/pausar —el widget solo aparece activo, PI-16—, código del widget, cambiar la clave) y los bloques del cuestionario de alta: negocio, servicios, profesionales, horarios, festivos, reglas, preguntas frecuentes y el chat en su web | PI-03, PI-04, PI-05, PI-08, PI-09, PI-10, PI-12, PI-16 |
| `#/negocios/:id/probar` | Conversar con el agente del negocio, también en prueba (cuesta lo mismo, descuenta del tope y queda como prueba) | PI-13, PI-15 |
| `#/negocios/:id/conversaciones(/:cid)` | Lista (todas, derivadas, pruebas) y una conversación con sus herramientas | PI-06 |
| `#/negocios/:id/derivaciones` | Pendientes, con enlace a la conversación y "Resuelta" | PI-07 |
| `#/negocios/:id/agenda` | Las citas del día; cargar una a mano o cancelarla | PR-04, PI-14, PW-10 |
| `#/consumo` | El mes de todos los negocios, con las pruebas aparte y el % del tope | PI-11 |

## Archivos

| Archivo | Qué tiene |
|---|---|
| `src/api.ts` | Cliente de `/api/admin/…`, sesión y tipos de lo que devuelve la API |
| `src/ui.tsx` | Rutas por hash, carga, acciones, avisos y formatos |
| `src/logo.ts` | Reducir el logo a 256 × 256 si pesa más de 150 KB (PI-10); contraste del texto sobre el color |
| `src/App.tsx` | Marco, sesión y rutas |
| `src/paginas/` | Una por pantalla (la ficha, en `Ficha.tsx`) |
| `vite.config.ts` | `base: '/panel/'`, React y Tailwind |
