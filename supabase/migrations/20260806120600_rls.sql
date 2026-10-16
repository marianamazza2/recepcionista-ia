-- =============================================================================
-- Fase 0 · 0.4 — Row Level Security
-- =============================================================================
-- CÓMO SE RESUELVE EL TENANT (spec de fase 0.4)
-- -----------------------------------------------------------------------------
-- El business_id del contexto lo devuelve `app.current_business_id()`, que mira
-- en este orden:
--   1. el GUC `app.business_id`, que fija el backend con `app.set_business_id()`
--      al abrir la transacción;
--   2. el claim `business_id` del JWT (`request.jwt.claims`) para peticiones que
--      llegan por PostgREST con sesión de usuario (fases con panel de cliente).
-- Si no hay ninguno devuelve NULL, ninguna política casa, y no se ve nada.
-- Denegar por defecto.
--
-- MODELO DE SEGURIDAD DEL MVP — importante, no confundir las capas:
--   · La PRIMERA barrera es el backend: corre con `service_role` y filtra por
--     business_id explícitamente en cada consulta. `service_role` tiene BYPASSRLS,
--     así que estas políticas NO lo frenan.
--   · RLS es la SEGUNDA barrera: protege cualquier acceso que no venga por el
--     backend (PostgREST con anon/authenticated, una credencial filtrada, un
--     bug que se olvide el WHERE). No es la única defensa, es la red debajo.
--
-- Se cubre TODA tabla con business_id, más `businesses` (donde el tenant es su
-- propio `id`). El test 04 falla si alguna tabla queda sin RLS o sin política:
-- es lo que impide que una tabla nueva de una fase futura entre desprotegida.
-- =============================================================================

set search_path = public;

-- -----------------------------------------------------------------------------
-- businesses: el tenant es la propia fila
-- -----------------------------------------------------------------------------
alter table public.businesses enable row level security;

create policy tenant_isolation on public.businesses
  for all
  using      (id = app.current_business_id())
  with check (id = app.current_business_id());

comment on policy tenant_isolation on public.businesses is
  'Un negocio solo se ve a sí mismo. El backend (service_role) hace BYPASSRLS.';

-- -----------------------------------------------------------------------------
-- Resto de tablas: aislamiento por business_id
-- -----------------------------------------------------------------------------
-- Se genera en bucle a propósito: una política idéntica escrita 14 veces a mano
-- es 14 oportunidades de equivocarse en una.
do $do$
declare
  v_tabla text;
  v_tablas constant text[] := array[
    'services',
    'staff',
    'staff_services',
    'business_hours',
    'time_off',
    'customers',
    'appointments',
    'conversations',
    'messages',
    'escalations',
    'knowledge_docs',
    'knowledge_chunks',
    'integrations',
    'usage_events'
  ];
begin
  foreach v_tabla in array v_tablas loop
    execute format('alter table public.%I enable row level security', v_tabla);

    execute format(
      'create policy tenant_isolation on public.%I
         for all
         using      (business_id = app.current_business_id())
         with check (business_id = app.current_business_id())',
      v_tabla
    );

    execute format(
      'comment on policy tenant_isolation on public.%I is %L',
      v_tabla,
      'Aislamiento por tenant. El backend (service_role) hace BYPASSRLS; esta política cubre el resto de accesos.'
    );
  end loop;
end
$do$;
