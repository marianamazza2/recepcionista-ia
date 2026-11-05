-- =============================================================================
-- Test 12 — Tramos sin solape (Fase 4 · aceptación 31, PD-01)
-- =============================================================================
-- Local (staff_id NULL), profesionales, otros días/negocios, tramos pegados,
-- cierre a medianoche y UPDATE. La base protege también accesos sin panel.
-- =============================================================================
\set ON_ERROR_STOP on
begin;
\ir _helpers.sql

insert into public.businesses (id, nombre, slug) values
  ('12121212-1212-4212-8212-000000000001', 'Tramos A', 'test-tramos-a'),
  ('12121212-1212-4212-8212-000000000002', 'Tramos B', 'test-tramos-b');
insert into public.staff (id, business_id, nombre) values
  ('12121212-1212-4212-8212-0000000000a1', '12121212-1212-4212-8212-000000000001', 'Ana'),
  ('12121212-1212-4212-8212-0000000000a2', '12121212-1212-4212-8212-000000000001', 'Bea');
insert into public.business_hours (business_id, weekday, hora_apertura, hora_cierre) values
  ('12121212-1212-4212-8212-000000000001', 1, '10:00', '14:00');
select test.throws($q$insert into public.business_hours (business_id, weekday, hora_apertura, hora_cierre)
  values ('12121212-1212-4212-8212-000000000001', 1, '13:00', '18:00')$q$, '23P01', 'local: solape parcial rechazado');
select test.throws($q$insert into public.business_hours (business_id, weekday, hora_apertura, hora_cierre)
  values ('12121212-1212-4212-8212-000000000001', 1, '11:00', '12:00')$q$, '23P01', 'local: tramo contenido rechazado');
select test.throws($q$insert into public.business_hours (business_id, weekday, hora_apertura, hora_cierre)
  values ('12121212-1212-4212-8212-000000000001', 1, '09:00', '15:00')$q$, '23P01', 'local: tramo que engloba rechazado');
select test.succeeds($q$insert into public.business_hours (business_id, weekday, hora_apertura, hora_cierre) values
  ('12121212-1212-4212-8212-000000000001', 1, '14:00', '24:00'),
  ('12121212-1212-4212-8212-000000000001', 2, '10:00', '14:00'),
  ('12121212-1212-4212-8212-000000000002', 1, '10:00', '14:00')$q$, 'contiguos, medianoche, otro día y otro negocio permitidos');
select test.succeeds($q$insert into public.business_hours (business_id, staff_id, weekday, hora_apertura, hora_cierre) values
  ('12121212-1212-4212-8212-000000000001', '12121212-1212-4212-8212-0000000000a1', 1, '09:00', '15:00'),
  ('12121212-1212-4212-8212-000000000001', '12121212-1212-4212-8212-0000000000a2', 1, '09:00', '15:00')$q$, 'PD-01: horarios propios independientes del local y de otra profesional');
select test.throws($q$insert into public.business_hours (business_id, staff_id, weekday, hora_apertura, hora_cierre) values
  ('12121212-1212-4212-8212-000000000001', '12121212-1212-4212-8212-0000000000a1', 1, '14:00', '18:00')$q$, '23P01', 'profesional: solape rechazado');
select test.succeeds($q$insert into public.business_hours (business_id, staff_id, weekday, hora_apertura, hora_cierre) values
  ('12121212-1212-4212-8212-000000000001', '12121212-1212-4212-8212-0000000000a1', 1, '15:00', '24:00')$q$, 'profesional: tramos contiguos permitidos');
select test.throws($q$update public.business_hours set hora_apertura = '13:30'
  where business_id = '12121212-1212-4212-8212-000000000001' and staff_id is null and weekday = 1 and hora_apertura = '14:00'$q$, '23P01', 'UPDATE tampoco introduce solapes');
select test.throws($q$update public.business_hours set hora_apertura = '14:30'
  where business_id = '12121212-1212-4212-8212-000000000001' and staff_id = '12121212-1212-4212-8212-0000000000a1' and weekday = 1 and hora_apertura = '15:00'$q$, '23P01', 'UPDATE de profesional tampoco introduce solapes');
select test.resumen();
rollback;
