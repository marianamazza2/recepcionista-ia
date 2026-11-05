# src/db/ — acceso a datos

Funciones pequeñas y explícitas sobre la librería `postgres`. Sin ORM, sin
`supabase-js` (D-34).

| Archivo | Qué tiene |
|---|---|
| `client.ts` | `createSql()`: la única forma de abrir la conexión (`prepare: false`) |
| `tenant.ts` | `inTenant(sql, businessId, fn)`: transacción con el tenant declarado |
| `customers.ts` | Clientas: buscar y crear por teléfono (D-51) |
| `conversations.ts` | Conversaciones, mensajes (historial solo-añadir) y derivaciones |
| `usage.ts` | `usage_events`, coste del mes, tope e informe de consumo (US$) |
| `widget.ts` | Negocio por clave del widget (y por id para "Probar el chat", PI-13), sesiones por hash (las de prueba aparte), lock por conversación, límites |
| `negocios.ts` | Fase 4: alta y edición de un negocio por bloques (con los días que cada profesional no trabaja, PI-19), lo que falta (PI-03), activar/pausar, cambiar la clave (PI-09) |
| `visor.ts` | Fase 4: lista y detalle de conversaciones con sus herramientas (PI-06), derivaciones pendientes y resolverlas (PI-07) |
| `personas.ts` | Fase 4: quién entra al panel (`panel.personas`, PI-01) |

## Reglas

- **Toda función recibe `businessId`** y trabaja dentro de `inTenant`, que
  declara el tenant con scope de transacción (D-16). **Y además** cada
  consulta filtra `where business_id = …` (T-03): la conexión del backend hace
  BYPASSRLS, así que ese filtro es la barrera principal, no algo redundante.
- Las pocas lecturas sin tenant son las que lo resuelven (negocio por slug o
  por `widget_key`). Cualquier otra excepción se justifica en un comentario:
  en la Fase 4, la lista de negocios del panel y el consumo de todos
  (`listarNegocios`, `informeConsumoTodos`: el panel los ve todos, PI-01) y
  `panel.personas`, que no es de ningún negocio.
- **SQL con tagged templates** (`` tx`… ${valor}` ``), nunca concatenando
  strings. Esquema explícito (`public.messages`).
- **Concurrencia en la base**, no en memoria: `on conflict do nothing` sobre
  las `UNIQUE`, advisory locks de transacción (`pg_advisory_xact_lock`).
  El servidor puede tener varias instancias (Vercel).
- **Tokens y IPs, solo hasheados** (`sha256`, `hashIp`). Los tokens se generan
  con `nuevoToken()` (aleatorio de `crypto`).
- **El reloj de la base** (`now()`, `clock_timestamp()`) para límites,
  sesiones y meses de consumo; el del agente se inyecta aparte.
- Filas de la base → tipos en camelCase dentro de este módulo; el resto del
  código no ve nombres de columna.

## Si cambiás algo de acá

**Obligatorio:** si tu cambio toca la arquitectura, una regla de negocio o la
forma de trabajo de esta carpeta, actualizá este `AGENTS.md` (y el raíz si
aplica) en el mismo cambio. Ver §8 del [`AGENTS.md` raíz](../../AGENTS.md#8-mantener-esta-documentación).

`db/` no conoce el agente; las excepciones son `usage.ts` (precios de
`core/costes.ts`) y `visor.ts` (`core/guardrails.textoParaLaClienta`, para
enseñar en el visor lo mismo que vio la clienta).

Una columna o tabla nueva va primero en una migración (ver
[`supabase/AGENTS.md`](../../supabase/AGENTS.md)); acá solo se lee y escribe.
Actualizá la tabla de arriba si sumás un archivo.
