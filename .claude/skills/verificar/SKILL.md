---
name: verificar
description: Revisa que todo funcione en el Recepcionista IA — tipos, tests TypeScript y tests SQL contra la base local (y, si se pide, contra Supabase en la nube) — y que la documentación quede al día. Usala SIEMPRE antes de dar por terminado cualquier cambio de código, migración o seed, y cuando Mariana pregunte cosas como "¿está todo bien?", "¿rompí algo?", "revisá que funcione", "corré los tests" o "¿puedo hacer commit?".
---

# Verificar el proyecto

Comprobación completa antes de dar algo por terminado (§5 del `AGENTS.md`
raíz). **No gasta dinero de API**: el modelo de los tests es simulado. Los
escenarios con el modelo real (`npm run agent:eval`) **no** se corren aquí.

## 1. La base local está levantada

```bash
pg_isready -h 127.0.0.1 -p 5432
```

Si no responde, **no la arranques ni la reinicies**: avisá a Mariana
(`brew services start postgresql@17` es decisión suya). No hay Docker en esta
máquina: nunca `supabase start` ni `supabase db reset`.

## 2. Las tres comprobaciones, en este orden

```bash
npm run typecheck
npx tsc -p widget          # solo si se tocó widget/
npm test
npm run test:sql
```

- Corré `npm test` en segundo plano si tarda más de ~2 minutos.
- Si falla algo, **no lo arregles en silencio**: primero decí qué falló (con la
  salida exacta), después proponé o aplicá el arreglo y volvé a verificar.
- Un fallo de `tests/04_rls_aislamiento.sql` casi siempre es una tabla nueva
  sin RLS o sin política (ver `supabase/AGENTS.md`).
- Un fallo de `06_seeds.sql` después de tocar `supabase/seed.sql`: hay que
  recargar el seed (`psql "$DATABASE_URL" -f supabase/seed.sql`) o actualizar
  el test en el mismo cambio.

## 3. Contra la nube (solo si se pide, o al cerrar una fase)

Solo cuando Mariana lo pida o al cerrar una fase (PD-06). Si hay migraciones
nuevas, hay que empujarlas antes (`supabase db push`, **preguntá primero**:
cambia la base compartida de la nube).

```bash
./scripts/con-supabase.sh npm run test:sql
./scripts/con-supabase.sh npm test
```

Nunca muestres la contraseña ni la cadena de conexión.

## 4. Documentación

Repasá el diff (`git status`, `git diff`) y respondé estas preguntas:

- ¿Cambió la **arquitectura**, una **regla de negocio** o la **forma de
  trabajo**? → los `AGENTS.md` afectados tienen que estar al día (§8 del
  `AGENTS.md` raíz). Si no lo están, actualizalos.
- ¿Migración, test o script nuevo? → sus filas en las tablas del `README.md`
  raíz.
- ¿Variable de entorno nueva? → `.env.example` sin valores secretos.
- ¿Cambió cómo se comporta el producto? → usá la skill `sync-research-desk`.

## 5. Resumen para Mariana

Corto y en lenguaje simple:

```
Tipos ✅ · Tests TypeScript ✅ N/N · Tests SQL ✅ N/N · Nube: no verificada
Documentación: actualicé src/core/AGENTS.md (nueva regla en el loop).
```

Si algo no se pudo comprobar (la base caída, la nube sin verificar), decilo
explícitamente: nunca lo des por bueno.
