-- =============================================================================
-- Test 03 — Unicidad del cliente por negocio (spec de fase 0.7.3)
-- =============================================================================
-- Un teléfono identifica a un cliente DENTRO de un negocio. La misma persona
-- puede ser clienta de dos negocios distintos sin que eso sea un duplicado.
-- =============================================================================

\set ON_ERROR_STOP on

begin;
\ir _helpers.sql

\echo '03 — unicidad de cliente por negocio'

-- --- Fixture: dos negocios ---------------------------------------------------
insert into public.businesses (id, nombre, slug) values
  ('22222222-2222-4222-8222-000000000001', 'Negocio Uno', 'test-negocio-uno'),
  ('22222222-2222-4222-8222-000000000002', 'Negocio Dos', 'test-negocio-dos');

insert into public.customers (business_id, telefono, nombre) values
  ('22222222-2222-4222-8222-000000000001', '+34611111111', 'Ana');

-- --- Mismo teléfono, mismo negocio → falla (23505 = unique_violation) --------
select test.throws(
  $q$insert into public.customers (business_id, telefono, nombre)
     values ('22222222-2222-4222-8222-000000000001', '+34611111111', 'Ana duplicada')$q$,
  '23505', 'mismo teléfono en el mismo negocio: rechazado'
);

-- --- Mismo teléfono, otro negocio → pasa ------------------------------------
select test.succeeds(
  $q$insert into public.customers (business_id, telefono, nombre)
     values ('22222222-2222-4222-8222-000000000002', '+34611111111', 'Ana en otro negocio')$q$,
  'mismo teléfono en otro negocio: aceptado'
);

select test.ok(
  (select count(*) from public.customers where telefono = '+34611111111') = 2,
  'el teléfono existe una vez en cada negocio'
);

-- =============================================================================
-- Integridad entre tenants: las FK compuestas impiden mezclar negocios.
-- Una cita del negocio 1 no puede usar un profesional del negocio 2, aunque
-- alguien lo intente a propósito (23503 = foreign_key_violation).
-- =============================================================================
insert into public.staff (id, business_id, nombre) values
  ('22222222-2222-4222-8222-00000000000a', '22222222-2222-4222-8222-000000000001', 'Staff del 1'),
  ('22222222-2222-4222-8222-00000000000b', '22222222-2222-4222-8222-000000000002', 'Staff del 2');

insert into public.services (id, business_id, nombre, duracion_min) values
  ('22222222-2222-4222-8222-00000000000c', '22222222-2222-4222-8222-000000000001', 'Servicio del 1', 30);

insert into public.customers (id, business_id, telefono, nombre) values
  ('22222222-2222-4222-8222-00000000000d', '22222222-2222-4222-8222-000000000001', '+34622222222', 'Cliente del 1');

select test.throws(
  $q$insert into public.appointments
       (business_id, staff_id, service_id, customer_id, start_at, end_at)
     values ('22222222-2222-4222-8222-000000000001',
             '22222222-2222-4222-8222-00000000000b',   -- profesional de OTRO negocio
             '22222222-2222-4222-8222-00000000000c',
             '22222222-2222-4222-8222-00000000000d',
             '2026-09-14 10:00:00+02', '2026-09-14 10:30:00+02')$q$,
  '23503', 'cita con un profesional de otro negocio: rechazada'
);

select test.throws(
  $q$insert into public.staff_services (business_id, staff_id, service_id)
     values ('22222222-2222-4222-8222-000000000001',
             '22222222-2222-4222-8222-00000000000b',   -- profesional de OTRO negocio
             '22222222-2222-4222-8222-00000000000c')$q$,
  '23503', 'staff_services cruzando negocios: rechazado'
);

select test.resumen();
rollback;
