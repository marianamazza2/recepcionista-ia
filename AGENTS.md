# AGENTS.md — cómo se trabaja en este repo

Guía para cualquier persona o agente (Claude Code incluido) que toque el
proyecto. Lo que está acá **no es sugerencia**: es la forma de trabajo
acordada.

> **Regla obligatoria:** si un cambio toca la **arquitectura**, una **regla de
> negocio** o la **forma de trabajo**, se actualizan los `AGENTS.md` afectados
> (este y los de cada carpeta implicada) **en el mismo cambio**. Un cambio así
> sin su `AGENTS.md` al día no está terminado. Ver
> [Mantener esta documentación](#8-mantener-esta-documentación).

Cada carpeta importante tiene su propio `AGENTS.md` con las reglas locales.
Leé el de la carpeta que vas a tocar **antes** de tocarla:

| Carpeta | Qué hay | Reglas |
|---|---|---|
| `_specs/` | Spec maestro, specs de fase y reglas de negocio | [`_specs/AGENTS.md`](_specs/AGENTS.md) |
| `src/` | La aplicación (TypeScript, Node 22) | [`src/AGENTS.md`](src/AGENTS.md) |
| `src/core/` | El núcleo del agente: igual para todos los negocios | [`src/core/AGENTS.md`](src/core/AGENTS.md) |
| `src/adapters/` | Agenda, canales y SMS detrás de interfaces | [`src/adapters/AGENTS.md`](src/adapters/AGENTS.md) |
| `src/db/` | Acceso a datos: tenant, clientas, conversaciones, consumo | [`src/db/AGENTS.md`](src/db/AGENTS.md) |
| `src/api/` | Handlers HTTP públicos (widget, página de la cita) | [`src/api/AGENTS.md`](src/api/AGENTS.md) · [`README`](src/api/README.md) |
| `supabase/` | Migraciones, seed y tests SQL | [`supabase/AGENTS.md`](supabase/AGENTS.md) |
| `tests/` | Tests TypeScript (Vitest) contra una base real | [`tests/AGENTS.md`](tests/AGENTS.md) |
| `widget/` | El chat embebible que va en la web del negocio | [`widget/AGENTS.md`](widget/AGENTS.md) · [`README`](widget/README.md) |
| `demo/` | La web inventada de Estética Aurora con el widget pegado (la sirve `npm run dev`) | Sin reglas propias: negocio ficticio, sin marcas reales |
| `scripts/` | Runner de tests SQL y acceso a la nube | [`scripts/README.md`](scripts/README.md) |
| `.claude/skills/` | Procedimientos de todos los días (verificar, migrar, consultar, Research Desk) | [§7b](#7b-skills-del-proyecto) |

El [`README.md`](README.md) raíz explica **qué hace** el sistema y cómo
ponerlo en marcha. Este archivo explica **cómo se trabaja**.

---

## 1. La regla de oro

> **Un motor. Muchas configuraciones.** Si para un negocio nuevo hay que tocar
> el código del núcleo, algo se diseñó mal.

Consecuencias que se aplican siempre:

- **Nada de datos de un negocio concreto en `src/core/`** (ni "Aurora", ni
  horarios, ni textos propios). Todo sale de la base vía
  `src/config/business.ts`. `tests/prompt.test.ts` lo comprueba.
- **Multi-tenant desde la primera línea.** Toda tabla lleva `business_id`
  (salvo `businesses`), toda consulta filtra por `business_id` aunque la
  conexión haga BYPASSRLS (T-03), y toda tabla nueva tiene RLS y política.
- **Lo que no se puede romper va en la base o en el código, nunca solo en el
  prompt.** El solape de citas lo impide Postgres (`no_overlap`,
  `no_overlap_cliente`); que una clienta solo toque sus citas (PA-08) lo
  impide la herramienta. El prompt explica; el código y la base garantizan.

## 2. Dónde vive cada decisión

| Tipo | Dónde | Se sube |
|---|---|---|
| Alcance, arquitectura y plan de fases | `_specs/mazzmkt-recepcionista-ia-spec.md` (maestro) | Sí |
| Qué hay que hacer en una fase | `_specs/fase-N-*.md` | Sí |
| **Reglas de negocio** (PD-, PR-, PA-, PW-, PI-) | `_specs/decisiones-producto.md` — **fuente de verdad** | Sí |
| Decisiones técnicas ya tomadas (D-NN) y trampas (T-NN) | `docs/DECISIONES.md` | **No** (`docs/` está en `.gitignore`) |
| Decisiones esperando a Mariana | `docs/DECISIONES-PENDIENTES.md` | No |
| Por qué una tabla o función es así | El comentario de cabecera de su migración | Sí |

Reglas:

- **No inventes reglas de negocio.** Si al implementar aparece una decisión de
  producto que no está en `decisiones-producto.md`, se anota ahí como
  **⚠️ por confirmar** con una propuesta, y se le avisa a Mariana. No se
  implementa como si estuviera decidida.
- Si `docs/` no existe en tu copia (es local), no lo recrees a ciegas: las
  decisiones técnicas nuevas se anotan igual, pidiéndole el archivo a Mariana
  o dejándolas en el comentario de cabecera del código/migración.
- Citá los códigos (`PR-07`, `D-45`, `T-01`) en comentarios y tests cuando el
  código implementa una regla: es lo que permite rastrear el porqué.

## 3. Cómo se avanza: por fases

El proyecto se construye en fases cerradas (maestro §11). Cada fase:

1. Tiene su spec en `_specs/fase-N-*.md`, con objetivo, criterio de
   terminada, tareas, orden sugerido y un prompt de arranque.
2. Se ejecuta en **una sesión fresca** de Claude Code, leyendo primero lo que
   el spec pone en "Depende de".
3. Se cierra solo cuando se cumplen todos los puntos de su "Definition of
   Done", **en local y en el proyecto Supabase de la nube** (PD-06).
4. Termina con su sección en `docs/DECISIONES.md`, el `README.md` al día y
   sus commits (`Phase N: …`).
5. Va en **una sola rama y un solo PR por fase**: el spec y la implementación
   juntos. El spec se escribe en la rama de la fase y abre su PR; la sesión
   que construye la fase sigue en esa misma rama y actualiza ese PR (no abre
   otro). **Mariana revisa y mergea**; Claude Code nunca mergea ni hace push a
   `main`.

No se adelanta trabajo de fases futuras: lo que está "fuera del alcance" de la
fase en curso no se hace (por ejemplo, no se declara una herramienta que
todavía no hace nada).

## 4. Comandos

```bash
npm install
cp .env.example .env        # y completar DATABASE_URL (nunca subir .env)

npm run typecheck           # tsc --noEmit, modo estricto
npm test                    # tests TypeScript (Vitest), contra DATABASE_URL
npm run test:sql            # tests SQL de supabase/tests/
npm run test:e2e            # la demo en Google Chrome con el modelo simulado (necesita Chrome)
npm run chat -- --negocio estetica-aurora     # conversar por la Terminal (usa la API real)
npm run agent:eval          # escenarios con el modelo real (cuesta céntimos)
npm run dev                 # demo del widget: web en :4310, servidor del widget en :4311 (API real)
npm run consumo -- --negocio estetica-aurora  # consumo del mes y % del tope
npm run build:widget        # genera widget/dist/widget.js
npm run build:vercel        # arma .vercel/output para publicar (necesita PUBLIC_API_URL; lo corre Vercel)
```

`npm run typecheck` comprueba también el widget (`tsc -p widget`).

Contra la nube: `./scripts/con-supabase.sh npm test` (ver
[`scripts/README.md`](scripts/README.md)); con
`SUPABASE_POOLER_MODO=transaccion` delante, por el pooler en modo transacción,
el que usa Vercel.

La demo está publicada en Vercel (PW-08): cada `git push` a `main` la
actualiza. Por eso **a `main` no se hace push nunca**: los cambios llegan por
el PR de la fase (§3), que mergea Mariana, y lo que se sube tiene que pasar
los tests antes.

**En esta máquina no hay Docker** (decisión de Mariana, D-24): no uses
`supabase start` ni `supabase db reset`. Las migraciones se aplican con
`supabase db push --db-url "$URL?sslmode=disable" --include-all` contra el
Postgres 17 local (`recepcionista_dev`). **No apagues ni reinicies ese
Postgres sin avisar.**

## 5. Antes de dar algo por terminado

- [ ] `npm run typecheck`, `npm test` y `npm run test:sql` en verde (y
      `npm run test:e2e` si tocaste el widget, la API o la demo).
- [ ] Si tocaste el agente (prompt, herramientas, loop): `npm run agent:eval`
      sigue todo OK. Cuesta dinero: avisá antes de correrlo varias veces.
- [ ] Si tocaste la base: también contra Supabase en la nube
      (`./scripts/con-supabase.sh …`) antes de cerrar una fase.
- [ ] Tests nuevos para lo nuevo (SQL para la base, TypeScript para el resto).
- [ ] Si cambió la arquitectura, una regla de negocio o la forma de trabajo:
      los `AGENTS.md` afectados están al día (§8).
- [ ] El resto de la documentación actualizada (§8).

## 6. Seguridad y secretos

- Las claves (`ANTHROPIC_API_KEY`, contraseñas de base) **solo en `.env`**.
  Nunca en el código, en un commit, en un log ni en el chat. No las pidas ni
  las muestres; `.env.example` lleva los nombres sin valores.
- Al navegador no llega nada secreto. La clave del widget es pública por
  diseño; lo que protege es el dominio (PW-06), los límites (PW-05) y el token
  de sesión.
- Tokens que dan acceso (sesión del widget, enlace del SMS): en la base **solo
  su hash** (SHA-256).
- Nada de desplegar (Vercel), contratar servicios ni conectar proveedores
  reales (SMS) sin el visto bueno explícito de Mariana.
- Datos de salud: el RGPD está abierto (PD-11). No se añaden datos sensibles a
  SMS, logs ni prompts más allá de lo que ya está decidido.

## 7. Estilo común

- **Idioma.** Documentación, comentarios, nombres de dominio y mensajes de
  error en **español**. La documentación para el equipo usa el registro de
  Mariana (voseo: "corré", "tenés"). Lo que lee la **clienta final** (prompt,
  respuestas fijas, widget, SMS) va en **español de España, de tú**.
  Identificadores técnicos que vienen del maestro (`BookingAdapter`,
  `getAvailability`, `businessId`) se quedan en inglés.
- **Cabecera en cada archivo** de código y migración: un bloque
  `// ====` (o `-- ====`) que dice qué es, en qué fase/tarea nació y qué
  reglas implementa. Al cambiar el archivo, se actualiza la cabecera.
- **Comentarios que explican el porqué**, con su código de decisión, no el qué.
- **Commits y PR en inglés**, aunque el resto esté en español: commits cortos
  (`Phase 2: agent core`) con el detalle en el cuerpo, y el título y la
  descripción de cada PR también en inglés (los códigos como `PI-03` y los
  nombres de archivo se dejan tal cual).

## 7b. Skills del proyecto

Procedimientos de todos los días, en `.claude/skills/`. Claude Code los usa
**solo**, cuando la tarea encaja con su descripción: no hace falta escribir
`/nombre` (aunque también funciona). Cualquier otro agente o persona puede
leer el `SKILL.md` y seguir los mismos pasos.

| Skill | Cuándo se usa |
|---|---|
| `verificar` | Antes de dar por terminado cualquier cambio: tipos, tests TypeScript y SQL (local y, si se pide, nube) y documentación al día |
| `migracion-nueva` | Cualquier cambio en el esquema o en las funciones de la base: nombre, cabecera, RLS, test SQL, aplicar sin Docker |
| `consultar-base` | Ver qué pasó, solo leyendo: conversaciones, herramientas, citas, derivaciones, consumo, SMS |
| `sync-research-desk` | Cada vez que cambia cómo se comporta el producto: actualizar el manual y los demás documentos de Research Desk |

Se encadenan: `migracion-nueva` termina con `verificar`, y `verificar`
recuerda `sync-research-desk` si cambió el producto.

## 8. Mantener esta documentación

Los `AGENTS.md` y `README.md` son parte del código. **Si un cambio hace que
alguno diga algo falso, ese mismo cambio lo corrige.** Y siempre que cambie
alguna de estas tres cosas, **hay que actualizar los `AGENTS.md`**, sin
excepción:

1. **Arquitectura:** capas, carpetas, dependencias entre módulos, interfaces
   (`BookingAdapter`, `SmsProvider`, `runAgentTurn`), stack, cómo se guarda o
   se protege un dato.
2. **Reglas de negocio:** una regla PD/PR/PA/PW/PI nueva o cambiada, sobre todo
   si cambia dónde se aplica (código, base o prompt) o qué hay que testear.
3. **Forma de trabajo:** comandos, flujo de fases, cómo se testea o se
   verifica, convenciones de código, qué se puede hacer sin preguntar.

Al terminar cualquier cambio, revisá: *¿algún `AGENTS.md` dice ahora algo
falso o le falta algo de esto?* Si sí, se corrige en el mismo cambio.

| Si cambiás… | Actualizá… |
|---|---|
| Una convención, un comando, el flujo de trabajo | Este archivo y el `AGENTS.md` de las carpetas afectadas |
| La arquitectura (capas, dependencias, interfaces) | Este archivo, `src/AGENTS.md` y el `AGENTS.md` de cada carpeta implicada |
| La estructura de una carpeta o sus reglas | El `AGENTS.md` (y `README.md`) de esa carpeta, y la tabla de arriba |
| Una carpeta nueva con reglas propias | Creale su `AGENTS.md` y sumala a la tabla de arriba |
| Un procedimiento que cubre una skill (comandos, pasos, ids de Research Desk) | El `SKILL.md` de esa skill; una skill nueva, a la tabla de §7b |
| Scripts de `package.json`, variables de `.env.example` | §4 de este archivo y el `README.md` raíz |
| Una regla de negocio | `_specs/decisiones-producto.md` (fuente de verdad; avisar a Mariana) **y** el `AGENTS.md` de la carpeta donde se aplica (p. ej. `src/core/AGENTS.md` si es un guardrail, `supabase/AGENTS.md` si es una restricción) |
| Una decisión técnica | `docs/DECISIONES.md` y, si cambia cómo se trabaja, el `AGENTS.md` afectado |
| El estado de una fase, migraciones, tests | `README.md` raíz |

Además, Mariana mantiene un manual de producto ("Cómo funciona el
Recepcionista") en su espacio de Research Desk: si un cambio altera **cómo se
comporta el producto** (una regla, un ajuste por negocio), también hay que
reflejarlo ahí. Lo indica cada spec de fase en su tarea de documentación.

`CLAUDE.md` solo importa este archivo: no le agregues contenido propio.
