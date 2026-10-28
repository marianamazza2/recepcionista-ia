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
