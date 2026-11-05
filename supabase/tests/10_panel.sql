-- =============================================================================
-- Test 10 — Panel interno (Fase 4 · 4.1)
-- =============================================================================
-- panel.personas (PI-01), preguntas frecuentes y su límite (PI-08, RA007),
-- conversaciones de prueba (PI-13), derivaciones resueltas (PI-07), lo que
-- falta para activar (PI-03, RA008) y las citas a mano (PR-04, PI-14).
-- =============================================================================

\set ON_ERROR_STOP on

begin;
\ir _helpers.sql

\echo '10 — panel interno'

-- --- Fixture -------------------------------------------------------------------
-- A: abre de 10:00 a 14:00 los lunes, servicio de 60 + 15 de margen, una
-- profesional. B: abre las 24 h (para probar la antelación a cualquier hora).
insert into public.businesses (id, nombre, slug, estado) values
  ('10101010-1010-4010-8010-000000000001', 'Panel A', 'test-panel-a', 'trial'),
  ('10101010-1010-4010-8010-000000000002', 'Panel B', 'test-panel-b', 'trial');

insert into public.staff (id, business_id, nombre) values
  ('10101010-1010-4010-8010-0000000000a1', '10101010-1010-4010-8010-000000000001', 'Ana'),
  ('10101010-1010-4010-8010-0000000000b1', '10101010-1010-4010-8010-000000000002', 'Bea');
insert into public.services (id, business_id, nombre, duracion_min, buffer_min) values
  ('10101010-1010-4010-8010-0000000000a2', '10101010-1010-4010-8010-000000000001', 'Corte', 60, 15),
  ('10101010-1010-4010-8010-0000000000b2', '10101010-1010-4010-8010-000000000002', 'Rápido', 30, 0);
insert into public.customers (id, business_id, telefono, nombre) values
  ('10101010-1010-4010-8010-0000000000a3', '10101010-1010-4010-8010-000000000001', '+34600100001', 'Clara'),
  ('10101010-1010-4010-8010-0000000000a4', '10101010-1010-4010-8010-000000000001', '+34600100002', 'Dora'),
  ('10101010-1010-4010-8010-0000000000b3', '10101010-1010-4010-8010-000000000002', '+34600100003', 'Eva');

-- =============================================================================
-- PI-01 · panel.personas
-- =============================================================================
select test.ok(
  to_regclass('panel.personas') is not null and to_regclass('public.personas') is null,
  'PI-01: las personas del panel viven en el esquema panel, no en public'
);

select test.ok(
  (select c.relrowsecurity from pg_class c where c.oid = 'panel.personas'::regclass)
  and not exists (select 1 from pg_policy p where p.polrelid = 'panel.personas'::regclass),
  'PI-01: panel.personas con RLS y sin ninguna política (solo el servidor la lee)'
);

select test.throws(
  $q$insert into panel.personas (user_id, email) values (gen_random_uuid(), 'Mariana@Example.com')$q$,
  '23514', 'PI-01: el email se guarda en minúsculas'
);

insert into panel.personas (user_id, email) values ('10101010-1010-4010-8010-0000000000f1', 'panel@example.test');

select test.throws(
  $q$insert into panel.personas (user_id, email) values (gen_random_uuid(), 'panel@example.test')$q$,
  '23505', 'PI-01: un email, una persona'
);

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'test_panel_sin_privilegios') then
    create role test_panel_sin_privilegios nologin;
  end if;
end $$;
grant test_panel_sin_privilegios to current_user;
set local role test_panel_sin_privilegios;
select test.throws(
  $q$select * from panel.personas$q$,
  '42501', 'PI-01: un rol cualquiera no puede leer panel.personas'
);
reset role;

-- =============================================================================
-- PI-08 · preguntas frecuentes
-- =============================================================================
select test.succeeds(
  $q$insert into public.knowledge_docs (business_id, tipo, titulo, contenido_raw, orden)
     values ('10101010-1010-4010-8010-000000000001', 'faq', '¿Hay aparcamiento?', 'Sí, en la plaza.', 1)$q$,
  'PI-08: se guarda una pregunta frecuente con su orden'
);

select test.throws(
  $q$insert into public.knowledge_docs (business_id, tipo, titulo, contenido_raw)
     values ('10101010-1010-4010-8010-000000000001', 'faq', '¿Larga?', repeat('x', 1001))$q$,
  '23514', 'PI-08: una respuesta de más de 1.000 caracteres no es una pregunta frecuente'
);

select test.throws(
  $q$insert into public.knowledge_docs (business_id, tipo, titulo, contenido_raw)
     values ('10101010-1010-4010-8010-000000000001', 'faq', '¿Sin respuesta?', null)$q$,
  '23514', 'PI-08: una pregunta frecuente lleva respuesta'
);

insert into public.knowledge_docs (business_id, tipo, titulo, contenido_raw, orden)
select '10101010-1010-4010-8010-000000000001', 'faq', 'Pregunta ' || n, 'Respuesta ' || n, n + 1
  from generate_series(1, 19) n;

select test.ok(
  (select count(*) from public.knowledge_docs
    where business_id = '10101010-1010-4010-8010-000000000001' and tipo = 'faq') = 20,
  'PI-08: caben 20 preguntas'
);

select test.throws(
  $q$insert into public.knowledge_docs (business_id, tipo, titulo, contenido_raw)
     values ('10101010-1010-4010-8010-000000000001', 'faq', 'La 21', 'No cabe')$q$,
  'RA007', 'PI-08: la pregunta 21 se rechaza (RA007)'
);

select test.succeeds(
  $q$insert into public.knowledge_docs (business_id, tipo, titulo, contenido_raw)
     values ('10101010-1010-4010-8010-000000000002', 'faq', 'La 1 de B', 'El límite es por negocio')$q$,
  'PI-08: el límite es por negocio'
);

select test.throws(
  $q$insert into public.knowledge_docs (business_id, tipo, titulo, contenido_raw)
     select '10101010-1010-4010-8010-000000000002', 'faq', 'Larga ' || n, repeat('y', 990)
       from generate_series(1, 5) n$q$,
  'RA007', 'PI-08: más de 4.000 caracteres en total se rechaza (RA007)'
);

select test.succeeds(
  $q$insert into public.knowledge_docs (business_id, tipo, titulo, contenido_raw)
     values ('10101010-1010-4010-8010-000000000002', 'texto', 'Un documento largo', repeat('z', 10000))$q$,
  'PI-08: el límite solo cuenta las preguntas frecuentes (los documentos son de la Fase 5)'
);

-- =============================================================================
-- PI-13 · conversaciones de prueba · PI-07 · derivaciones resueltas
-- =============================================================================
insert into public.conversations (id, business_id) values
  ('10101010-1010-4010-8010-0000000000c1', '10101010-1010-4010-8010-000000000001');

select test.ok(
  (select not prueba from public.conversations where id = '10101010-1010-4010-8010-0000000000c1'),
  'PI-13: de serie una conversación no es de prueba'
);

insert into public.escalations (id, business_id, conversation_id, motivo) values
  ('10101010-1010-4010-8010-0000000000e1', '10101010-1010-4010-8010-000000000001',
   '10101010-1010-4010-8010-0000000000c1', 'dato_desconocido');

select test.throws(
  $q$update public.escalations set resuelta_at = now() where id = '10101010-1010-4010-8010-0000000000e1'$q$,
  '23514', 'PI-07: no hay fecha de resuelta sin estar resuelta'
);

select test.succeeds(
  $q$update public.escalations set resuelta = true, resuelta_at = now() where id = '10101010-1010-4010-8010-0000000000e1'$q$,
  'PI-07: se marca resuelta con su fecha'
);

-- =============================================================================
-- PI-03 · lo que falta para activar
-- =============================================================================
select test.ok(
  public.negocio_lo_que_falta('10101010-1010-4010-8010-000000000001')
    = array['profesional', 'horario', 'telefono', 'dominio'],
  'PI-03: a un negocio con un servicio y una profesional que no lo hace le falta profesional, horario, teléfono y dominio'
);

select test.throws(
  $q$update public.businesses set estado = 'activo' where id = '10101010-1010-4010-8010-000000000001'$q$,
  'RA008', 'PI-03: no se activa con datos incompletos (RA008)'
);

insert into public.staff_services (business_id, staff_id, service_id) values
  ('10101010-1010-4010-8010-000000000001', '10101010-1010-4010-8010-0000000000a1', '10101010-1010-4010-8010-0000000000a2'),
  ('10101010-1010-4010-8010-000000000002', '10101010-1010-4010-8010-0000000000b1', '10101010-1010-4010-8010-0000000000b2');
insert into public.business_hours (business_id, weekday, hora_apertura, hora_cierre) values
  ('10101010-1010-4010-8010-000000000001', 1, '10:00', '14:00');
insert into public.business_hours (business_id, weekday, hora_apertura, hora_cierre)
select '10101010-1010-4010-8010-000000000002', d, '00:00', '24:00' from generate_series(0, 6) d;
update public.businesses
   set telefono_humano = '+34910000000', widget_dominios = array['example.test']
 where id = '10101010-1010-4010-8010-000000000001';

select test.ok(
  cardinality(public.negocio_lo_que_falta('10101010-1010-4010-8010-000000000001')) = 0,
  'PI-03: con todo lo mínimo no falta nada'
);

select test.succeeds(
  $q$update public.businesses set estado = 'activo' where id = '10101010-1010-4010-8010-000000000001'$q$,
  'PI-03: con lo mínimo completo se activa'
);

select test.succeeds(
  $q$update public.businesses set estado = 'pausado' where id = '10101010-1010-4010-8010-000000000001'$q$,
  'PI-04: un negocio se pausa'
);

update public.services set activo = false where id = '10101010-1010-4010-8010-0000000000a2';
select test.ok(
  public.negocio_lo_que_falta('10101010-1010-4010-8010-000000000001') = array['servicio', 'profesional'],
  'PI-04: con el único servicio desactivado vuelve a faltar servicio (y quien lo haga)'
);
select test.throws(
  $q$update public.businesses set estado = 'activo' where id = '10101010-1010-4010-8010-000000000001'$q$,
  'RA008', 'PI-03: un negocio pausado tampoco se reactiva incompleto'
);
update public.services set activo = true where id = '10101010-1010-4010-8010-0000000000a2';

-- =============================================================================
-- PR-04 · PI-14 · citas a mano
-- =============================================================================
-- Lunes 3 de junio de 2030, en A (abre de 10:00 a 14:00, cada 30 min).
select test.ok(
  app.slot_es_valido('10101010-1010-4010-8010-000000000001', '10101010-1010-4010-8010-0000000000a2',
                     '10101010-1010-4010-8010-0000000000a1', '2030-06-03 10:15 Europe/Madrid') = 'RA001',
  'PR-04: el agente no reserva fuera de la rejilla (10:15 → RA001)'
);

select test.ok(
  app.slot_es_valido('10101010-1010-4010-8010-000000000001', '10101010-1010-4010-8010-0000000000a2',
                     '10101010-1010-4010-8010-0000000000a1', '2030-06-03 10:15 Europe/Madrid', true) is null,
  'PI-14: a mano, las 10:15 valen'
);

select test.throws(
  $q$select public.book_appointment(
       p_business_id => '10101010-1010-4010-8010-000000000001', p_service_id => '10101010-1010-4010-8010-0000000000a2',
       p_staff_id => '10101010-1010-4010-8010-0000000000a1', p_customer_id => '10101010-1010-4010-8010-0000000000a3',
       p_start_at => '2030-06-03 10:15 Europe/Madrid')$q$,
  'RA001', 'PR-04: book_appointment sin p_manual sigue exigiendo la rejilla'
);

select test.succeeds(
  $q$select public.book_appointment(
       p_business_id => '10101010-1010-4010-8010-000000000001', p_service_id => '10101010-1010-4010-8010-0000000000a2',
       p_staff_id => '10101010-1010-4010-8010-0000000000a1', p_customer_id => '10101010-1010-4010-8010-0000000000a3',
       p_start_at => '2030-06-03 10:15 Europe/Madrid', p_origen => 'manual', p_manual => true)$q$,
  'PI-14: cita a mano a las 10:15'
);

select test.ok(
  (select origen = 'manual' and end_at = '2030-06-03 11:15 Europe/Madrid'
     from public.appointments
    where business_id = '10101010-1010-4010-8010-000000000001'
      and start_at = '2030-06-03 10:15 Europe/Madrid'),
  'PI-14: queda con origen manual y dura lo que el servicio'
);

select test.throws(
  $q$select public.book_appointment(
       p_business_id => '10101010-1010-4010-8010-000000000001', p_service_id => '10101010-1010-4010-8010-0000000000a2',
       p_staff_id => '10101010-1010-4010-8010-0000000000a1', p_customer_id => '10101010-1010-4010-8010-0000000000a4',
       p_start_at => '2030-06-03 11:20 Europe/Madrid', p_origen => 'manual', p_manual => true)$q$,
  'RA004', 'PI-14: a mano se respeta el margen (PD-02): 11:20 choca con los 15 min tras la de las 10:15'
);

select test.throws(
  $q$select public.book_appointment(
       p_business_id => '10101010-1010-4010-8010-000000000001', p_service_id => '10101010-1010-4010-8010-0000000000a2',
       p_staff_id => '10101010-1010-4010-8010-0000000000a1', p_customer_id => '10101010-1010-4010-8010-0000000000a4',
       p_start_at => '2030-06-03 10:45 Europe/Madrid', p_origen => 'manual', p_manual => true)$q$,
  '23P01', 'PI-14: a mano no se pisa otra cita'
);

select test.throws(
  $q$select public.book_appointment(
       p_business_id => '10101010-1010-4010-8010-000000000001', p_service_id => '10101010-1010-4010-8010-0000000000a2',
       p_staff_id => '10101010-1010-4010-8010-0000000000a1', p_customer_id => '10101010-1010-4010-8010-0000000000a4',
       p_start_at => '2030-06-03 13:15 Europe/Madrid', p_origen => 'manual', p_manual => true)$q$,
  'RA001', 'PI-14: a mano no se sale del horario (13:15 + 60 min pasa del cierre)'
);

select test.throws(
  $q$select public.book_appointment(
       p_business_id => '10101010-1010-4010-8010-000000000001', p_service_id => '10101010-1010-4010-8010-0000000000a2',
       p_staff_id => '10101010-1010-4010-8010-0000000000a1', p_customer_id => '10101010-1010-4010-8010-0000000000a4',
       p_start_at => '2030-06-04 10:15 Europe/Madrid', p_origen => 'manual', p_manual => true)$q$,
  'RA001', 'PI-14: a mano no se reserva un día que no abre (martes)'
);

insert into public.time_off (business_id, staff_id, desde, hasta, motivo) values
  ('10101010-1010-4010-8010-000000000001', null, '2030-06-10 00:00 Europe/Madrid', '2030-06-11 00:00 Europe/Madrid', 'Festivo'),
  ('10101010-1010-4010-8010-000000000001', '10101010-1010-4010-8010-0000000000a1',
   '2030-06-17 12:00 Europe/Madrid', '2030-06-17 14:00 Europe/Madrid', 'Formación');

select test.throws(
  $q$select public.book_appointment(
       p_business_id => '10101010-1010-4010-8010-000000000001', p_service_id => '10101010-1010-4010-8010-0000000000a2',
       p_staff_id => '10101010-1010-4010-8010-0000000000a1', p_customer_id => '10101010-1010-4010-8010-0000000000a4',
       p_start_at => '2030-06-10 10:15 Europe/Madrid', p_origen => 'manual', p_manual => true)$q$,
  'RA002', 'PI-14: a mano no se reserva en un festivo del local'
);

select test.throws(
  $q$select public.book_appointment(
       p_business_id => '10101010-1010-4010-8010-000000000001', p_service_id => '10101010-1010-4010-8010-0000000000a2',
       p_staff_id => '10101010-1010-4010-8010-0000000000a1', p_customer_id => '10101010-1010-4010-8010-0000000000a4',
       p_start_at => '2030-06-17 11:15 Europe/Madrid', p_origen => 'manual', p_manual => true)$q$,
  'RA002', 'PI-12/PI-14: a mano no se reserva en una ausencia por horas de la profesional'
);

select test.throws(
  $q$select public.book_appointment(
       p_business_id => '10101010-1010-4010-8010-000000000001', p_service_id => '10101010-1010-4010-8010-0000000000a2',
       p_staff_id => '10101010-1010-4010-8010-0000000000a1', p_customer_id => '10101010-1010-4010-8010-0000000000a3',
       p_start_at => '2030-06-03 10:15 Europe/Madrid', p_origen => 'manual', p_manual => true)$q$,
  'RA006', 'PI-14: a mano la clienta tampoco puede tener dos citas a la vez (PR-08)'
);

-- Antelación (PD-05): en B, que abre las 24 h, una hora y cuarto desde la hora
-- en punto actual cae siempre fuera de la rejilla y dentro de las 2 h.
select test.throws(
  format($q$select public.book_appointment(
       p_business_id => '10101010-1010-4010-8010-000000000002', p_service_id => '10101010-1010-4010-8010-0000000000b2',
       p_staff_id => '10101010-1010-4010-8010-0000000000b1', p_customer_id => '10101010-1010-4010-8010-0000000000b3',
       p_start_at => %L)$q$, date_trunc('hour', now()) + interval '1 hour'),
  'RA003', 'PD-05: el agente no reserva dentro de la antelación mínima'
);

select test.succeeds(
  format($q$select public.book_appointment(
       p_business_id => '10101010-1010-4010-8010-000000000002', p_service_id => '10101010-1010-4010-8010-0000000000b2',
       p_staff_id => '10101010-1010-4010-8010-0000000000b1', p_customer_id => '10101010-1010-4010-8010-0000000000b3',
       p_start_at => %L, p_origen => 'manual', p_manual => true)$q$, date_trunc('hour', now()) + interval '1 hour 15 minutes'),
  'PI-14: a mano, dentro de la antelación y fuera de la rejilla'
);

select test.ok(
  to_regprocedure('public.book_appointment(uuid, uuid, uuid, uuid, timestamptz, text, public.appointment_origen, text)') is null,
  'book_appointment tiene una sola firma (con p_manual)'
);

select test.resumen();

rollback;
