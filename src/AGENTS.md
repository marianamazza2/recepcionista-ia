# src/ — la aplicación

TypeScript sobre Node 22, ESM, sin framework. Las cuatro capas del maestro
(§3.1) se ven en las carpetas:

```
src/
├── api/              CANAL (HTTP)   handlers (Request) => Response: widget, chat, página de la cita
├── adapters/
│   ├── channels/     CANAL          lo que pasa con un mensaje de cada canal (web-widget.ts)
│   ├── booking/      ADAPTADORES    la agenda detrás de BookingAdapter (SupabaseAdapter)
│   └── sms/          ADAPTADORES    el envío de SMS detrás de SmsProvider
├── core/             NÚCLEO         el loop del agente, prompt, herramientas, guardrails. Igual para todos
├── config/           CONFIGURACIÓN  lo que el agente sabe de UN negocio, leído de la base
├── db/               datos          cliente Postgres, tenant, clientas, conversaciones, consumo, widget
├── citas/            SMS de confirmación y de cancelación, y página del enlace (PA-09, PW-07, PW-10)
├── cli/              comandos de npm (chat, eval, consumo, build del widget)
├── dev/              servidor local de la demo
└── vercel/           la publicación en Vercel: la función (handler.ts) y el build (build.ts)
```

## Dirección de las dependencias

```
api → adapters/channels → core → config, db, adapters/booking
                       ↘ citas → core (time, tools/common, tools/reservas → plazo de PR-07), adapters/sms, db
cli, dev, vercel → cualquiera
```

- **`core/` nunca importa** de `api/`, `adapters/channels/`, `adapters/sms/`,
  `citas/`, `cli/` ni `dev/`. Un canal nuevo (WhatsApp, Fase 8) se enchufa
  encima sin tocar el núcleo.
- `core/` habla con la agenda **solo** a través de la interfaz
  `BookingAdapter` (`adapters/booking/types.ts`), nunca con SQL de citas.
- `db/` no conoce el agente (la única excepción es `db/usage.ts`, que usa la
  tabla de precios de `core/costes.ts`).

## Convenciones de código

- **TypeScript estricto** (`tsconfig.json`): `strict`,
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `verbatimModuleSyntax`. No se relajan. Con `exactOptionalPropertyTypes`, un
  opcional se pasa con spread condicional (`...(x !== undefined ? { x } : {})`),
  no con `x: undefined`.
- **ESM con extensión `.js`** en los imports relativos (`'./time.js'`), e
  `import type` para lo que es solo tipo.
- **Dependencias mínimas.** Runtime: `@anthropic-ai/sdk` y `postgres`. Nada
  más sin una razón escrita en `docs/DECISIONES.md`. No se usa `supabase-js`
  (D-34).
- **Postgres directo** con la librería `postgres`, siempre a través de
  `db/client.ts → createSql()` (`prepare: false` por el pooler de Supabase).
- **Toda escritura o lectura de un negocio va en `inTenant(sql, businessId, …)`**
  (`db/tenant.ts`), que declara el tenant con scope de transacción (D-16), **y
  además** filtra por `business_id` en el SQL (T-03). Las únicas lecturas sin
  tenant son las que todavía no lo conocen (resolver un negocio por slug o por
  clave del widget).
- **Hora local ↔ UTC solo en `core/time.ts`** (D-54, T-01). Nada de sumar
  offsets a mano. Las fechas viajan como `Date` (UTC) entre capas y como
  `'YYYY-MM-DD'` / `'HH:MM'` locales hacia el modelo.
- **Inyectable para testear**: reloj (`now`), modelo (`ModelClient`),
  proveedor de SMS, logger de errores (`onError`). Nada lee `new Date()` ni
  `process.env` en el medio de la lógica; los ajustes se leen una vez
  (`settingsFromEnv`) y se pasan.
- **Errores**: los de negocio son clases tipadas (`adapters/booking/errors.ts`)
  con un `reason` estable; se distinguen con `instanceof`, nunca por texto. Lo
  que llega al modelo o al navegador nunca es un error interno.
- **Nombres**: dominio en español (`crearReserva`, `costeDelMes`), contrato del
  maestro en inglés (`BookingAdapter`, `createBooking`).
- Cabecera `// ====` en cada archivo: qué es, fase/tarea, reglas que aplica.

## `cli/` y `dev/`

- Cada comando es un archivo en `cli/` que se ejecuta con `tsx` y tiene su
  script en `package.json`. Leen `.env` con `process.loadEnvFile` y nunca
  imprimen secretos. Los que gastan API (`chat`, `eval`) imprimen el coste al
  terminar.
- `dev/server.ts` levanta **dos orígenes** (API en :4311, web del negocio en
  :4310, cambiables con `API_PORT`/`DEMO_PORT`) para que CORS y PW-06 se
  comporten como en producción. Escucha en IPv4 e IPv6 locales: si otro
  programa ocupa el puerto en `::1`, el navegador iría a él sin avisar. No es
  código de producción: no metas lógica de negocio ahí. `dev/widget-build.ts`
  empaqueta el widget con esbuild (devDependency, igual que `playwright-core`
  para la prueba en el navegador).

## Si cambiás algo de acá

**Obligatorio:** si tu cambio toca la arquitectura, una regla de negocio o la
forma de trabajo de esta carpeta, actualizá este `AGENTS.md` (y el raíz si
aplica) en el mismo cambio. Ver §8 del [`AGENTS.md` raíz](../AGENTS.md#8-mantener-esta-documentación).

- Una carpeta nueva en `src/`: añadila al árbol de arriba y, si tiene reglas
  propias, creale su `AGENTS.md` y sumala a la tabla del `AGENTS.md` raíz.
- Un comando nuevo en `cli/`: script en `package.json` + §4 del `AGENTS.md`
  raíz + `README.md` raíz.
- Una variable de entorno nueva: `.env.example` (sin valor secreto) +
  `README.md`.
