# widget/ — el chat embebible

La burbuja de chat que un negocio pega en su web (Fase 3 · 3.4). TypeScript
sin framework ni dependencias, empaquetado con esbuild en **un solo archivo**.

```
widget/
├── src/widget.ts     todo el widget: config, panel, envío, reintento, historial
├── src/saludo.ts     el saludo según la hora de la bienvenida (PW-02)
├── dist/widget.js    el archivo que se sirve a las webs (generado, no se edita)
└── tsconfig.json     propio: navegador (dom), es2020
```

## Pegarlo en una web

```html
<script src="https://<nuestro-servidor>/widget.js" data-key="wk_CLAVE_PUBLICA" async></script>
```

- La clave es la `widget_key` del negocio (pública por diseño).
- El dominio de la web tiene que estar en `businesses.widget_dominios`
  (host exacto: `www.` y sin `www.` son dos entradas). Si no, el servidor
  responde 403 y el widget no aparece (PW-06).
- La API se deduce del `src` del propio script: el widget habla siempre con el
  servidor que lo sirvió.

## Qué hace

1. Pide `GET /api/widget/config` y, si responde, pinta el botón con el nombre
   y el color del negocio (PW-01). En la cabecera, antes del nombre, un
   círculo con su logo (`widget_logo`, PW-17) o, si no tiene, su inicial.
2. Al abrir: bienvenida y aviso de privacidad (PW-02). Si la bienvenida del
   negocio empieza por "¡Hola!", le suma el saludo de la hora del navegador
   ("¡Hola, buenas tardes!…", `src/saludo.ts`). Si hay un token de sesión en
   `localStorage`, recupera el historial (PW-03); si caducó (2 h sin
   mensajes), avisa "Tu conversación anterior ha terminado. Empezamos una
   nueva." y empieza de cero (PW-12). El mismo aviso sale si caduca con el
   panel abierto y el servidor responde con `nuevaConversacion`.
3. Cada mensaje lleva un `clientMessageId` (uuid). Muestra "escribiendo…"; si
   pasan 60 s, ofrece reintentar **con el mismo id** (el servidor no lo
   procesa dos veces).
4. Pantalla completa en móviles, modo oscuro, `prefers-reduced-motion`.

Contrato de las rutas: [`src/api/README.md`](../src/api/README.md).

## Construirlo

- En local, `src/dev/server.ts` lo construye en memoria en cada petición
  (un cambio se ve al recargar).
- Para generar `dist/widget.js`: `npm run build:widget` (imprime el tamaño y
  el comprimido: hoy ≈9 KB, 3,7 KB comprimido).
- Para probarlo: `npm run dev` y abrir http://localhost:4310, o
  `npm run test:e2e` (Chrome, modelo simulado).
