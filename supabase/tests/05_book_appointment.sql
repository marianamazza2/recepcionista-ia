-- =============================================================================
-- Test 05 — RPC book_appointment (spec de fase 0.5)
-- =============================================================================
-- En la Fase 0 el RPC hace lo mínimo: valida pertenencia al negocio, calcula
-- end_at desde la duración del servicio e inserta de forma atómica, dejando que
-- la restricción no_overlap sea la que decide si el hueco está libre.
--
-- Horarios, festivos y buffers son de la Fase 1: los comprueban 07 y 08.
-- =============================================================================

\set ON_ERROR_STOP on

begin;
\ir _helpers.sql

\echo '05 — RPC book_appointment (esqueleto)'

-- --- Fixture: dos negocios, para poder probar los cruces --------------------
insert into public.businesses (id, nombre, slug) values
  ('44444444-4444-4444-8444-000000000001', 'Negocio RPC', 'test-negocio-rpc'),
  ('44444444-4444-4444-8444-000000000002', 'Negocio Ajeno', 'test-negocio-ajeno');

insert into public.staff (id, business_id, nombre, activo) values
  ('44444444-4444-4444-8444-00000000000a', '44444444-4444-4444-8444-000000000001', 'Marta', true),
  ('44444444-4444-4444-8444-00000000000b', '44444444-4444-4444-8444-000000000001', 'Lucía', true),
  ('44444444-4444-4444-8444-00000000000e', '44444444-4444-4444-8444-000000000001', 'De baja', false);

insert into public.services (id, business_id, nombre, duracion_min, buffer_min, activo) values
  ('44444444-4444-4444-8444-00000000000c', '44444444-4444-4444-8444-000000000001', 'Facial 60', 60, 10, true),
  ('44444444-4444-4444-8444-00000000000f', '44444444-4444-4444-8444-000000000001', 'Descatalogado', 30, 0, false);

insert into public.customers (id, business_id, telefono, nombre) values
  ('44444444-4444-4444-8444-00000000000d', '44444444-4444-4444-8444-000000000001', '+34640000001', 'Ana'),
  -- PR-08: para probar el hueco ocupado hace falta OTRA clienta (Ana no puede
  -- tener dos citas a la vez; eso es RA006, probado en el test 08).
  ('44444444-4444-4444-8444-00000000000e', '44444444-4444-4444-8444-000000000001', '+34640000003', 'Bea'),
  ('44444444-4444-4444-8444-000000000ddd', '44444444-4444-4444-8444-000000000002', '+34640000002', 'Cliente ajeno');

-- Marta hace el facial; Lucía no lo hace.
insert into public.staff_services (business_id, staff_id, service_id) values
  ('44444444-4444-4444-8444-000000000001',
   '44444444-4444-4444-8444-00000000000a',
   '44444444-4444-4444-8444-00000000000c');

-- Ajuste de la Fase 1: desde que book_appointment valida horario y antelación,
-- este test necesita que el negocio abra (lunes 9–20) y que las fechas estén
-- en el futuro. Las fechas pasaron del 14/09/2026 —que ya quedó atrás— al lunes
-- 14/10/2030. Las aserciones son las mismas de la Fase 0: se ajustó el
-- fixture, no la regla.
insert into public.business_hours (business_id, staff_id, weekday, hora_apertura, hora_cierre) values
  ('44444444-4444-4444-8444-000000000001', null, 1, '09:00', '20:00');

-- =============================================================================
-- Camino feliz
-- =============================================================================
select test.succeeds(
  $q$select public.book_appointment(
       '44444444-4444-4444-8444-000000000001',
       '44444444-4444-4444-8444-00000000000c',
       '44444444-4444-4444-8444-00000000000a',
       '44444444-4444-4444-8444-00000000000d',
       '2030-10-14 10:00:00+02')$q$,
  'reserva válida: la crea'
);

select test.ok(
  (select count(*) from public.appointments
    where business_id = '44444444-4444-4444-8444-000000000001') = 1,
  'la cita quedó guardada'
);

-- end_at sale de services.duracion_min, no lo pasa el llamador.
select test.ok(
  (select end_at from public.appointments
    where business_id = '44444444-4444-4444-8444-000000000001')
    = '2030-10-14 11:00:00+02'::timestamptz,
  'end_at = start_at + duracion_min del servicio (60 min)'
);

-- El buffer NO entra en end_at: separa citas, no alarga el servicio.
select test.ok(
  (select end_at - start_at from public.appointments
    where business_id = '44444444-4444-4444-8444-000000000001') = interval '60 minutes',
  'buffer_min no se suma a la duración de la cita'
);

select test.ok(
  (select estado from public.appointments
    where business_id = '44444444-4444-4444-8444-000000000001') = 'confirmada'
  and (select origen from public.appointments
        where business_id = '44444444-4444-4444-8444-000000000001') = 'agente',
  'la cita nace confirmada y con origen agente por defecto'
);

-- =============================================================================
-- El hueco ocupado lo corta la restricción, no un SELECT previo
-- =============================================================================
select test.throws(
  $q$select public.book_appointment(
       '44444444-4444-4444-8444-000000000001',
       '44444444-4444-4444-8444-00000000000c',
       '44444444-4444-4444-8444-00000000000a',
       '44444444-4444-4444-8444-00000000000e',
       '2030-10-14 10:30:00+02')$q$,
  '23P01', 'reservar sobre un hueco ocupado: rechazado'
);

select test.ok(
  (select count(*) from public.appointments
    where business_id = '44444444-4444-4444-8444-000000000001') = 1,
  'tras el rechazo no quedó ninguna cita a medias'
);

-- =============================================================================
-- Validaciones mínimas de la Fase 0
-- =============================================================================
select test.throws(
  $q$select public.book_appointment(
       '44444444-4444-4444-8444-000000000001',
       '44444444-4444-4444-8444-00000000000c',
       '44444444-4444-4444-8444-00000000000b',   -- Lucía no presta este servicio
       '44444444-4444-4444-8444-00000000000d',
       '2030-10-14 16:00:00+02')$q$,
  '23514', 'profesional que no presta el servicio: rechazado'
);

select test.throws(
  $q$select public.book_appointment(
       '44444444-4444-4444-8444-000000000001',
       '44444444-4444-4444-8444-00000000000f',   -- servicio inactivo
       '44444444-4444-4444-8444-00000000000a',
       '44444444-4444-4444-8444-00000000000d',
       '2030-10-14 16:00:00+02')$q$,
  '23503', 'servicio inactivo: rechazado'
);

select test.throws(
  $q$select public.book_appointment(
       '44444444-4444-4444-8444-000000000001',
       '44444444-4444-4444-8444-00000000000c',
       '44444444-4444-4444-8444-00000000000e',   -- profesional inactivo
       '44444444-4444-4444-8444-00000000000d',
       '2030-10-14 16:00:00+02')$q$,
  '23503', 'profesional inactivo: rechazado'
);

select test.throws(
  $q$select public.book_appointment(
       '44444444-4444-4444-8444-000000000001',
       '44444444-4444-4444-8444-00000000000c',
       '44444444-4444-4444-8444-00000000000a',
       '44444444-4444-4444-8444-000000000ddd',   -- cliente de otro negocio
       '2030-10-14 16:00:00+02')$q$,
  '23503', 'cliente de otro negocio: rechazado'
);

select test.throws(
  $q$select public.book_appointment(
       '44444444-4444-4444-8444-000000000002',   -- negocio que no es dueño del servicio
       '44444444-4444-4444-8444-00000000000c',
       '44444444-4444-4444-8444-00000000000a',
       '44444444-4444-4444-8444-00000000000d',
       '2030-10-14 16:00:00+02')$q$,
  '23503', 'servicio de otro negocio: rechazado'
);

select test.resumen();
rollback;
