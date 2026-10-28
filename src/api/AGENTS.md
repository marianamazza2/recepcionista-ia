# src/api/ — reglas para los handlers HTTP

Es la parte del sistema **expuesta a internet**. El contrato de cada ruta está
en [`README.md`](README.md).

## Reglas

1. **Handlers estándar** `(Request) => Promise<Response>`, sin framework ni
   tipos de Node (`IncomingMessage`). La traducción desde Node vive en
   `node.ts` y la usan los dos: `src/dev/server.ts` y la función de Vercel
   (`src/vercel/handler.ts`). Una ruta nueva bajo `/api/` o `/cita/` ya llega
   a Vercel; otra raíz pide tocar las rutas de `src/vercel/build.ts`.
2. **Delgados.** Validan la forma de la petición y llaman a la lógica del
   canal (`adapters/channels/web-widget.ts`) o a `citas/`. La lógica de
   negocio no va aquí.
3. **Orden fijo** en las rutas del widget: clave → negocio (404) → origen
   (403, **sin** cabeceras CORS) → validación de la entrada → lo demás. Nada se
   procesa antes de comprobar el origen.
4. **CORS solo para el origen comprobado**, nunca `*`, sin credenciales,
   siempre con `vary: Origin`. Se compara el host exacto contra
   `widget_dominios` (PW-06).
5. **Nunca sale un error interno.** Una vez resuelto el negocio, cualquier
   fallo responde 200 con el texto fijo que da el teléfono del local; antes,
   `503 no_disponible`. El error real va a `deps.onError`.
6. **Validación estricta** con expresiones regulares para clave (`wk_…`),
   token de sesión, uuid del `clientMessageId`. Cuerpo con tope (16 KB).
7. **El id de una conversación o de una cita nunca viaja solo**: se llega a
   ellas por token, y en la base se busca por el hash del token.
8. **Respuestas que no distinguen**: un token inválido, caducado o de otro
   negocio da exactamente la misma respuesta (no se filtra si existe).
9. **HTML con `escaparHtml`** en todo lo que venga de la base, y las cabeceras
   de seguridad de `cita.ts` (CSP, `noindex`, `x-frame-options: DENY`).
   Textos para la clienta: español de España, de tú.
10. `cache-control: no-store` por defecto (lo pone `json`). Solo la config
    pública del widget se cachea.

## El panel (`admin/`, Fase 4)

`/api/admin/…` tiene reglas propias, distintas de las del widget:

11. **Cuenta en cada petición** (PI-01): token de Supabase Auth verificado
    con `GET /auth/v1/user` (`admin/auth.ts`, detrás de la interfaz
    `AuthPanel` para poder testear sin red) **y** la persona activa en
    `panel.personas`. Si no, 401 — también con la clave de un widget. Solo
    `POST /sesion` y `/sesion/renovar` no la piden. Sin proveedor configurado,
    503 (el panel no se abre sin login).
12. **Mismo origen, sin CORS**: el panel se sirve junto a la API. El token va
    en `Authorization`, nunca en una cookie (sin CSRF).
13. **El negocio sale de la URL** y todo va con su `business_id` (T-03): pedir
    la conversación o la cita de otro negocio da 404.
14. **Errores en palabras** (`admin/errores.ts`): `{ error, mensaje }` con una
    frase para el panel; las validaciones de negocio siguen en la base y aquí
    solo se traducen (restricción → frase). Lo que no se reconoce va a
    `onError` y el panel recibe un 500 genérico.
15. Cuerpo hasta 512 KB (el logo viaja en el JSON), la forma se valida con
    `admin/entrada.ts`.

## Tests

`tests/admin-api.test.ts` cubre el panel con un `AuthPanel` falso.
`tests/widget-api.test.ts` llama a `createApi` directamente con `Request`
construidos a mano y el modelo simulado: dominio, sesión, idempotencia (también
simultánea), orden, límites y tope. `tests/cita-sms.test.ts` cubre la página
de la cita. Una ruta nueva o un caso de error nuevo lleva su test.

## Si cambiás algo de acá

**Obligatorio:** si tu cambio toca la arquitectura, una regla de negocio o la
forma de trabajo de esta carpeta, actualizá este `AGENTS.md` (y el raíz si
aplica) en el mismo cambio. Ver §8 del [`AGENTS.md` raíz](../../AGENTS.md#8-mantener-esta-documentación).

- Ruta, campo, status o código de error → la tabla de [`README.md`](README.md)
  y, si el widget lo usa, `widget/src/widget.ts`.
- Un límite o un aviso nuevo del canal → `LIMITES_WIDGET` / `AvisoWidget` en
  `adapters/channels/web-widget.ts`, y la regla PW correspondiente en
  `_specs/decisiones-producto.md`.
