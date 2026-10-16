-- =============================================================================
-- Test 04 — RLS y aislamiento entre tenants (spec de fase 0.7.4 · DoD punto 2)
-- =============================================================================
-- Dos mitades:
--   A) Cobertura: ninguna tabla con business_id se queda sin RLS ni sin política.
--      Esta aserción es la que va a atrapar la tabla que alguien añada en la
--      Fase 3 o la 5 y se olvide de proteger.
--   B) Comportamiento: con un rol sin privilegios y un tenant declarado, se ven
--      las filas propias y solo las propias.
--
-- Ojo: `postgres` y `service_role` tienen BYPASSRLS, así que las políticas no
-- se pueden comprobar desde el usuario habitual. Por eso el test crea un rol
-- normal a propósito.
-- =============================================================================

\set ON_ERROR_STOP on

begin;
\ir _helpers.sql

\echo '04 — RLS y aislamiento entre tenants'

-- =============================================================================
-- A) Cobertura
-- =============================================================================
select test.ok(
  not exists (
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and not c.relrowsecurity
  ),
  'RLS activo en TODAS las tablas de public'
);

select test.ok(
  not exists (
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
  ),
  'todas las tablas de public tienen al menos una política'
);

-- La política tiene que filtrar por el tenant, no ser un `using (true)`.
select test.ok(
  not exists (
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_policy p on p.polrelid = c.oid
     where n.nspname = 'public'
       and c.relkind = 'r'
       and pg_get_expr(p.polqual, p.polrelid) not like '%current_business_id()%'
  ),
  'todas las políticas se apoyan en app.current_business_id()'
);

select test.ok(
  app.current_business_id() is null,
  'sin tenant declarado, app.current_business_id() es NULL'
);

-- =============================================================================
-- B) Comportamiento
-- =============================================================================

-- --- Fixture: dos negocios con datos propios --------------------------------
insert into public.businesses (id, nombre, slug) values
  ('33333333-3333-4333-8333-000000000001', 'Tenant A', 'test-tenant-a'),
  ('33333333-3333-4333-8333-000000000002', 'Tenant B', 'test-tenant-b');

insert into public.customers (business_id, telefono, nombre) values
  ('33333333-3333-4333-8333-000000000001', '+34630000001', 'Cliente de A'),
  ('33333333-3333-4333-8333-000000000001', '+34630000002', 'Otro cliente de A'),
  ('33333333-3333-4333-8333-000000000002', '+34630000003', 'Cliente de B');

-- --- Rol sin privilegios especiales (se va con el ROLLBACK) ------------------
set client_min_messages = warning;
drop role if exists test_tenant;
set client_min_messages = notice;

create role test_tenant nologin;
-- En Supabase `postgres` no es superusuario: puede crear el rol, pero para
-- hacer SET ROLE tiene que ser miembro (Postgres 16+). En local no hace daño.
grant test_tenant to current_user;
grant usage on schema public, app to test_tenant;
grant select, insert, update, delete on all tables in schema public to test_tenant;

set local role test_tenant;

-- --- Sin tenant declarado: no se ve nada -------------------------------------
select test.ok(
  (select count(*) from public.customers) = 0,
  'sin tenant declarado no se ve ningún cliente'
);

select test.ok(
  (select count(*) from public.businesses) = 0,
  'sin tenant declarado no se ve ningún negocio'
);

-- --- Con el tenant A: solo lo de A -------------------------------------------
select app.set_business_id('33333333-3333-4333-8333-000000000001');

select test.ok(
  (select count(*) from public.customers) = 2,
  'el tenant A ve sus 2 clientes'
);

select test.ok(
  not exists (select 1 from public.customers where telefono = '+34630000003'),
  'el tenant A NO ve el cliente del tenant B'
);

select test.ok(
  (select count(*) from public.businesses) = 1
  and (select nombre from public.businesses) = 'Tenant A',
  'el tenant A solo se ve a sí mismo en businesses'
);

-- --- Con el tenant B: solo lo de B -------------------------------------------
select app.set_business_id('33333333-3333-4333-8333-000000000002');

select test.ok(
  (select count(*) from public.customers) = 1
  and (select telefono from public.customers) = '+34630000003',
  'el tenant B ve únicamente su cliente'
);

-- --- WITH CHECK: no se puede escribir en el negocio de otro ------------------
-- 42501 = insufficient_privilege, que es como Postgres reporta la violación de
-- una política de RLS al insertar.
select test.throws(
  $q$insert into public.customers (business_id, telefono, nombre)
     values ('33333333-3333-4333-8333-000000000001', '+34630000009', 'Infiltrado')$q$,
  '42501', 'escribir una fila en el negocio ajeno: rechazado por RLS'
);

-- Tampoco se puede regalar una fila propia al negocio de al lado: eso lo corta
-- el WITH CHECK. (Se prueba desde A, porque desde B la fila de A ni se ve: el
-- UPDATE no fallaría, simplemente no encontraría nada que actualizar.)
select app.set_business_id('33333333-3333-4333-8333-000000000001');

select test.throws(
  $q$update public.customers
        set business_id = '33333333-3333-4333-8333-000000000002'
      where telefono = '+34630000001'$q$,
  '42501', 'mover una fila propia al negocio ajeno: rechazado por RLS'
);

-- Y el reverso, que es lo que hace invisible el ataque: desde B, la fila de A
-- no existe, así que un UPDATE a ciegas no toca nada.
select app.set_business_id('33333333-3333-4333-8333-000000000002');

select test.ok(
  (select count(*) from public.customers where telefono = '+34630000001') = 0,
  'desde el tenant B la fila del tenant A es invisible'
);

reset role;

select test.ok(
  (select count(*) from public.customers
    where business_id in ('33333333-3333-4333-8333-000000000001',
                          '33333333-3333-4333-8333-000000000002')) = 3,
  'desde el rol de servicio (BYPASSRLS) se siguen viendo los 3 clientes'
);

select test.resumen();
rollback;
