# src/api/ — las rutas HTTP

Handlers estándar de la API Fetch: `(Request) => Promise<Response>`. Corren
igual en el servidor local (`src/dev/server.ts`) y en la función de Vercel (`src/vercel/handler.ts`).
`app.ts → createApi(deps)` las junta en un solo punto de entrada.

| Archivo | Qué tiene |
|---|---|
| `app.ts` | El router: ruta + método → handler. 404/405 para lo demás |
| `widget.ts` | `widgetConfig`, `chat`, `historial` |
| `cita.ts` | La página HTML del enlace del SMS (ver y cancelar) |
| `http.ts` | Piezas comunes: `json`, `leerJson` (con tope de tamaño), origen y CORS, preflight, IP, `escaparHtml` |
| `admin/rutas.ts` | El panel interno (Fase 4): `/api/admin/…` |
| `admin/auth.ts` | Cuentas del panel: `AuthPanel` y Supabase Auth (PI-01) |
| `admin/entrada.ts` | Validación de la forma del cuerpo, con mensajes en palabras |
| `admin/errores.ts` | Errores de la base y del motor → frase para el panel |

## Contrato

### `GET /api/widget/config?key=wk_…`

Lo público del negocio para pintar el widget (PW-01, PW-02, PW-17). Nada más:
ni ids, ni ajustes internos, ni tope. `logo` es la imagen entera como data URL
(hasta ~150 KB): el widget no la pide a ninguna otra web.

```json
{ "nombre": "…", "color": "#…", "logo": "data:image/…;base64,…|null", "bienvenida": "…|null",
  "aviso": { "texto": "Soy la asistente virtual de {negocio}, al escribir aceptas…", "enlace": "https://…|null" },
  "maxCaracteres": 1000 }
```

### `POST /api/chat`

```json
// petición
{ "key": "wk_…", "sessionToken": "…|null", "clientMessageId": "<uuid>", "texto": "…" }
// respuesta (siempre 200 una vez resuelto el negocio y el origen)
{ "sessionToken": "…|null", "respuesta": "…", "escalada": false,
  "nuevaConversacion": false, "aviso": "mensaje_largo|limite_mensajes|limite_conversaciones|tope_mensual|ocupado|error" }
```

- `clientMessageId` es la clave de idempotencia: reenviar el mismo devuelve la
  misma respuesta sin volver a llamar al modelo.
- `aviso` solo aparece si la respuesta es un texto fijo del canal.
- `nuevaConversacion: true` → el navegador olvida los mensajes que tenía.

### `GET /api/chat/historial?key=wk_…`

Con `Authorization: Bearer <sessionToken>`. Devuelve
`{ mensajes: [{ rol: "clienta"|"asistente", texto }], escalada }` para retomar
la conversación al recargar (PW-03). Token inválido, caducado o de otro
negocio → `401 sesion_no_valida`, siempre igual.

### `GET|POST /cita/:token`

Página HTML (no JSON) con la cita y el botón de cancelar (aplica PR-07 igual
que el agente). Token inventado, caducado o de una cita borrada → la misma
página de "enlace no válido" (404).

## Códigos de error

| Status | `error` | Cuándo |
|---|---|---|
| 400 | `peticion_no_valida` | JSON roto o campos con forma incorrecta |
| 401 | `sesion_no_valida` | Historial sin token válido |
| 403 | `origen_no_permitido` | El `Origin` no está en los dominios del negocio (PW-06). Sin cabeceras CORS |
| 404 | `clave_desconocida` / `no_encontrado` | Clave del widget inexistente / ruta desconocida |
| 405 | `metodo_no_permitido` | Método equivocado |
| 413 | `demasiado_grande` | Cuerpo de más de 16 KB |
| 503 | `no_disponible` | Fallo antes de poder resolver el negocio |

## El panel: `/api/admin/…` (Fase 4)

Todas con `Authorization: Bearer <token de Supabase Auth>` de una persona de
`panel.personas` (PI-01); si no, `401 no_autorizado`. Sin cuentas
configuradas, `503 panel_no_configurado`. Sin CORS (mismo origen). Los
errores son `{ error, mensaje }` con `mensaje` para enseñar tal cual; al
activar incompleto, además `falta: [códigos]`; en una cita, `motivo`.

| Método y ruta | Qué hace | Devuelve |
|---|---|---|
| `POST sesion` `{email, password}` | Entrar (sin token) | `{accessToken, refreshToken, expiraEn, email}` |
| `POST sesion/renovar` `{refreshToken}` | Renovar (sin token) | lo mismo |
| `GET yo` | Quién soy | `{email}` |
| `GET negocios` | Todos, con estado, lo que falta y derivaciones pendientes | lista |
| `POST negocios` `{nombre, sector?, timezone?}` | Alta: en prueba y sin dominios (PI-03) | `201 {id, slug}` |
| `GET negocios/:id` | Todo el negocio (bloques, lo que falta, `widgetKey`, `widgetJs`) | el negocio |
| `PUT negocios/:id/datos` · `reglas` · `chat` | Guardar un bloque (el chat: dominios, color, logo, privacidad, tope) | el negocio |
| `POST negocios/:id/activar` · `pausar` | PI-03 (409 con `falta` si no se puede), PI-04 | el negocio |
| `POST negocios/:id/clave` | Clave nueva del widget; la anterior deja de valer (PI-09) | el negocio |
| `POST negocios/:id/servicios` · `PUT …/servicios/:sid` | Alta y edición (`activo: false` = desactivar, PI-04) | el negocio |
| `POST negocios/:id/profesionales` · `PUT …/profesionales/:pid` | Igual, con `servicioIds` | el negocio |
| `PUT negocios/:id/horario` `{staffId|null, tramos}` | Sustituye el horario del local o el propio de una profesional | el negocio |
| `POST negocios/:id/festivos` · `DELETE …/festivos/:fid` | Días enteros (`fechaDesde`, `fechaHasta?`) o unas horas (`horaDesde`, `horaHasta`), del local o de una profesional (PI-12) | el negocio |
| `POST negocios/:id/preguntas` · `PUT`/`DELETE …/preguntas/:qid` | Preguntas frecuentes (PI-08; 409 al pasar el límite) | el negocio |
| `GET negocios/:id/conversaciones?filtro=todas|derivadas|pruebas` | Lista (PI-06) | lista |
| `GET negocios/:id/conversaciones/:cid` | Una conversación: líneas (clienta, asistente, herramienta con entrada y resultado), derivaciones, coste | detalle |
| `GET negocios/:id/derivaciones` · `POST …/derivaciones/:eid/resolver` | Pendientes y marcar resuelta (PI-07) | lista de pendientes |
| `GET negocios/:id/agenda?fecha=AAAA-MM-DD` | Las citas del día (de serie, hoy en la zona del negocio) | `{fecha, citas}` |
| `POST negocios/:id/citas` `{serviceId, staffId, fecha, hora, telefono, nombre, notas?}` | Cita a mano (PR-04, PI-14), con su SMS | `201 {id, sms}` |
| `POST negocios/:id/citas/:aid/cancelar` | Cancelar desde la agenda, con SMS (PW-10) | `{cancelada}` |
| `POST negocios/:id/probar` `{sessionToken?, clientMessageId?, texto}` | Probar el chat (PI-13): como `POST /api/chat`, marcado como prueba | como `/api/chat` |
| `GET consumo?mes=AAAA-MM` | El mes de todos los negocios, con las pruebas aparte (PI-11) | lista de informes |
