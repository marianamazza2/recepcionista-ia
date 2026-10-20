# tests/ — tests TypeScript (Vitest)

Tests de integración **contra una base de verdad** (la de `DATABASE_URL`: el
Postgres local o, con `scripts/con-supabase.sh`, la nube). No hay mocks de la
base. El modelo de IA, en cambio, **siempre es simulado** aquí: `npm test` no
gasta un céntimo.

```
tests/
├── helpers/
│   ├── fixtures.ts         AURORA (ids del seed), clientas de test, negocio de prueba 24 h
│   └── modelo-simulado.ts  ModelClient con respuestas guionizadas: texto(), herramientas()…
├── e2e/widget.e2e.ts       la demo en Google Chrome (npm run test:e2e, vitest.e2e.config.ts)
└── *.test.ts               uno por módulo o por regla (tabla en el README.md raíz)
```

## La prueba en el navegador (`npm run test:e2e`)

Aparte de `npm test` porque necesita **Google Chrome** instalado
(`playwright-core` con `channel: 'chrome'`: no descarga navegadores). Levanta
los servidores de `src/dev/server.ts` en puertos al azar, con el modelo
simulado, y escribe en Aurora con una clienta `+34999…`. Al terminar borra sus
conversaciones **y su consumo** (también las que no llegaron a guardar el
token). Las esperas llevan margen (30 s): contra la nube cada mensaje tarda
más. Correla si tocás el widget, la API o la demo.

## Reglas

1. **Confirman de verdad y limpian a mano** (D-37). No hay `ROLLBACK` como en
   los SQL, porque concurrencia e idempotencia solo se prueban con
   transacciones confirmadas. Por eso:
   - los negocios de prueba se crean en `beforeAll` y se borran en
     `afterAll` (el borrado arrastra todo en cascada);
   - contra **Estética Aurora** solo se escribe con clientas de test
     (teléfono **`+34999…`**, `telefonoDeTest()` / `createTestCustomer()`),
     y `deleteTestCustomers()` las borra al empezar y al terminar (también
     restos de ejecuciones anteriores);
   - **fechas fijas de 2030** y reloj inyectado (`now: () => AHORA`), nunca
     el día de hoy;
   - lo que escribe consumo (`usage_events`) se borra **antes** que su
     conversación: si no, queda suelto y cuenta en el informe del negocio
     (`deleteTestCustomers` ya lo hace);
   - cada conversación nueva del widget desde una IP distinta: el límite de
     10 por IP y hora (PW-05) salta entre tests si no.
2. **En serie** (`fileParallelism: false` en `vitest.config.ts`): todos los
   archivos escriben en la misma base. No lo cambies.
3. **Una conexión por archivo** con `createSql()`, cerrada con `sql.end()` en
   `afterAll`.
4. **El modelo simulado** (`helpers/modelo-simulado.ts`) recibe un guion de
   respuestas y guarda las peticiones: así se comprueba qué se le mandó al
   modelo (historial, herramientas, system prompt) sin red.
5. **Lo que se comprueba es la regla, con su código** en el nombre del test
   (`'PR-07 bloquear: no cancela dentro del plazo'`). Cada regla de negocio
   implementada en código tiene al menos un test.
6. Nada de `skip` ni `only` en lo que se sube.
7. Los textos de los tests van en español, como el resto.

## Los escenarios con el modelo real no están aquí

`npm run agent:eval` (`src/cli/eval.ts`) conversa con la API de verdad, cuesta
dinero y comprueba lo grave, no el estilo (D-56). Se corre al tocar el prompt,
las herramientas o el loop, no en cada cambio.

## Si cambiás algo de acá

**Obligatorio:** si tu cambio toca la arquitectura, una regla de negocio o la
forma de trabajo de esta carpeta, actualizá este `AGENTS.md` (y el raíz si
aplica) en el mismo cambio. Ver §8 del [`AGENTS.md` raíz](../AGENTS.md#8-mantener-esta-documentación).

- Archivo de test nuevo → su fila en la tabla "Tests TypeScript" del
  `README.md` raíz.
- Un fixture que crea filas en una tabla nueva → que `deleteTestCustomers` (o
  el borrado del negocio de prueba) también las limpie.
