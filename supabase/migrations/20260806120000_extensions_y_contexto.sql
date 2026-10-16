-- =============================================================================
-- Fase 0 · 0.1 — Extensiones y contexto de tenant
-- =============================================================================
-- Extensiones necesarias para el proyecto:
--   · btree_gist → permite combinar `=` sobre uuid con `&&` sobre rangos dentro
--     de una misma restricción EXCLUDE (la garantía anti-solapamiento de
--     `appointments`). Sin esto la restricción no se puede crear.
--   · vector (pgvector) → tipo `vector(1024)` para `knowledge_chunks`. Se crea
--     ahora aunque el RAG sea de la Fase 5.
--
-- Se instalan en el esquema `extensions` (convención de Supabase, mantiene
-- `public` limpio). Por eso las migraciones que usan operadores u objetos de
-- estas extensiones fijan `search_path = public, extensions`.
-- =============================================================================

create schema if not exists extensions;

set search_path = public, extensions;

create extension if not exists btree_gist with schema extensions;
create extension if not exists vector      with schema extensions;

grant usage on schema extensions to public;

-- -----------------------------------------------------------------------------
-- Esquema `app`: contexto de ejecución (multi-tenancy)
-- -----------------------------------------------------------------------------
create schema if not exists app;
grant usage on schema app to public;

comment on schema app is
  'Utilidades del núcleo: resolución del tenant en curso para las políticas RLS.';

-- ¿De qué negocio es la sesión actual?
--
-- Se resuelve en dos pasos, en este orden:
--   1. `app.business_id`, un GUC que fija el backend con app.set_business_id().
--      Es la vía del MVP: el backend corre con `service_role` y abre cada
--      unidad de trabajo declarando a qué negocio pertenece.
--   2. El claim `business_id` del JWT (`request.jwt.claims`), que es lo que
--      rellena PostgREST/Supabase Auth cuando la petición llega desde un
--      cliente autenticado. Preparado para las fases con panel de cliente.
--
-- Si no hay ninguno de los dos devuelve NULL → ninguna política casa → no se ve
-- ninguna fila. Denegar por defecto es lo correcto acá.
create or replace function app.current_business_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('app.business_id', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'business_id'
  )::uuid;
$$;

comment on function app.current_business_id() is
  'business_id del contexto actual (GUC app.business_id o claim JWT). NULL si no hay tenant declarado.';

-- Fija el tenant de la transacción en curso.
-- `is_local = true` a propósito: el valor muere con la transacción, así un
-- backend con pool de conexiones nunca hereda el tenant de otra petición.
create or replace function app.set_business_id(p_business_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('app.business_id', coalesce(p_business_id::text, ''), true);
end;
$$;

comment on function app.set_business_id(uuid) is
  'Declara el tenant de la transacción en curso (scope local: se limpia al terminar la transacción).';
