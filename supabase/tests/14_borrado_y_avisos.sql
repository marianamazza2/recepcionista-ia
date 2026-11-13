-- =============================================================================
-- Test 14 — Borrado de datos (PD-13) y quién cuenta para activar (PI-20)
-- =============================================================================
-- Decidido el 13/11/2026. Se comprueba:
--   · el texto del chat caduca a los 6 meses y la conversación y la ficha se
--     quedan; el consumo no se toca;
--   · borrar a una clienta: su texto se va, sus conversaciones se desligan, su
--     ficha queda anónima y sus citas siguen en la agenda;
--   · PI-20: una profesional que no trabaja ningún día no cuenta en "lo que
--     falta" y el negocio no se puede activar sin nadie con días.
-- =============================================================================
\set ON_ERROR_STOP on
begin;
\ir _helpers.sql

-- -----------------------------------------------------------------------------
-- PD-13 · retención
-- -----------------------------------------------------------------------------
insert into public.businesses (id, nombre, slug, telefono_humano, widget_dominios) values
  ('14141414-1414-4414-8414-000000000001', 'Borrado A', 'test-borrado-a', '+34910000789', array['x.test']);
insert into public.customers (id, business_id, telefono, nombre, email) values
  ('14141414-1414-4414-8414-0000000000c1', '14141414-1414-4414-8414-000000000001', '+34600111222', 'María', 'maria@x.test'),
  ('14141414-1414-4414-8414-0000000000c2', '14141414-1414-4414-8414-000000000001', '+34600111333', 'Bea', 'bea@x.test');

-- Una conversación vieja (7 meses) y otra de hoy, cada una con dos mensajes.
insert into public.conversations (id, business_id, customer_id, ultimo_mensaje_at) values
  ('14141414-1414-4414-8414-0000000000e1', '14141414-1414-4414-8414-000000000001', '14141414-1414-4414-8414-0000000000c1', now() - interval '7 months'),
  ('14141414-1414-4414-8414-0000000000e2', '14141414-1414-4414-8414-000000000001', '14141414-1414-4414-8414-0000000000c2', now());
insert into public.messages (business_id, conversation_id, rol, contenido) values
  ('14141414-1414-4414-8414-000000000001', '14141414-1414-4414-8414-0000000000e1', 'user', 'tengo la piel sensible'),
  ('14141414-1414-4414-8414-000000000001', '14141414-1414-4414-8414-0000000000e1', 'assistant', 'te lo apunto'),
  ('14141414-1414-4414-8414-000000000001', '14141414-1414-4414-8414-0000000000e2', 'user', 'quería una cita'),
  ('14141414-1414-4414-8414-000000000001', '14141414-1414-4414-8414-0000000000e2', 'assistant', 'claro');
insert into public.usage_events (business_id, tipo, cantidad, coste_estimado) values
  ('14141414-1414-4414-8414-000000000001', 'mensaje', 1, 0.01);

select test.ok(
  (select mensajes from app.borrar_conversaciones_vencidas(6)) = 2,
  'PD-13: borra los 2 mensajes de la conversación de hace 7 meses');
select test.ok(
  (select count(*) from public.messages where conversation_id = '14141414-1414-4414-8414-0000000000e1') = 0,
  'PD-13: el texto vencido ya no está');
select test.ok(
  (select count(*) from public.messages where conversation_id = '14141414-1414-4414-8414-0000000000e2') = 2,
  'PD-13: el texto de la conversación de hoy sigue entero');
select test.ok(
  (select count(*) from public.conversations where business_id = '14141414-1414-4414-8414-000000000001') = 2
  and (select customer_id from public.conversations where id = '14141414-1414-4414-8414-0000000000e1')
      = '14141414-1414-4414-8414-0000000000c1',
  'PD-13: la conversación se queda y sigue ligada a su clienta');
select test.ok(
  (select count(*) from public.customers where business_id = '14141414-1414-4414-8414-000000000001') = 2,
  'PD-13: la ficha de la clienta no se toca');
select test.ok(
  (select count(*) from public.usage_events where business_id = '14141414-1414-4414-8414-000000000001') = 1,
  'PD-13: el consumo no se toca');
select test.ok(
  (select mensajes from app.borrar_conversaciones_vencidas(6)) = 0,
  'PD-13: una segunda pasada no borra nada (es idempotente)');
select test.throws($q$select app.borrar_conversaciones_vencidas(0)$q$, 'RA009', 'PD-13: 0 meses se rechaza');

-- -----------------------------------------------------------------------------
-- PD-13 · derecho de supresión
-- -----------------------------------------------------------------------------
insert into public.services (id, business_id, nombre, duracion_min) values
  ('14141414-1414-4414-8414-0000000000a1', '14141414-1414-4414-8414-000000000001', 'Peeling', 60);
insert into public.staff (id, business_id, nombre) values
  ('14141414-1414-4414-8414-0000000000b1', '14141414-1414-4414-8414-000000000001', 'Núria');
insert into public.appointments (business_id, staff_id, service_id, customer_id, start_at, end_at) values
  ('14141414-1414-4414-8414-000000000001', '14141414-1414-4414-8414-0000000000b1',
   '14141414-1414-4414-8414-0000000000a1', '14141414-1414-4414-8414-0000000000c2',
   now() + interval '2 days', now() + interval '2 days 1 hour');

select test.ok(
  (select citas from app.borrar_clienta('14141414-1414-4414-8414-000000000001', '14141414-1414-4414-8414-0000000000c2')) = 1,
  'PD-13: borrar a Bea deja su cita en pie y la cuenta');
select test.ok(
  (select count(*) from public.messages where conversation_id = '14141414-1414-4414-8414-0000000000e2') = 0,
  'PD-13: su texto de chat se borra sin esperar los 6 meses');
select test.ok(
  (select customer_id from public.conversations where id = '14141414-1414-4414-8414-0000000000e2') is null,
  'PD-13: su conversación queda desligada');
select test.ok(
  (select nombre is null and email is null and telefono like 'borrada-%'
     from public.customers where id = '14141414-1414-4414-8414-0000000000c2'),
  'PD-13: su ficha queda anónima');
select test.ok(
  (select count(*) from public.appointments where customer_id = '14141414-1414-4414-8414-0000000000c2') = 1,
  'PD-13: la cita sigue en la agenda del negocio');
select test.throws(
  $q$select app.borrar_clienta('14141414-1414-4414-8414-000000000001', '14141414-1414-4414-8414-0000000000c9')$q$,
  'RA010', 'PD-13: una clienta de otro negocio (o inexistente) se rechaza');

-- -----------------------------------------------------------------------------
-- PI-20 · quién cuenta para activar
-- -----------------------------------------------------------------------------
insert into public.staff_services (business_id, staff_id, service_id) values
  ('14141414-1414-4414-8414-000000000001', '14141414-1414-4414-8414-0000000000b1', '14141414-1414-4414-8414-0000000000a1');
insert into public.business_hours (business_id, weekday, hora_apertura, hora_cierre) values
  ('14141414-1414-4414-8414-000000000001', 1, '10:00', '14:00'),
  ('14141414-1414-4414-8414-000000000001', 3, '10:00', '14:00');

select test.ok(
  app.profesional_trabaja_algun_dia('14141414-1414-4414-8414-000000000001', '14141414-1414-4414-8414-0000000000b1'),
  'PI-20: sin días libres, hereda el horario del local y trabaja');
select test.ok(
  public.negocio_lo_que_falta('14141414-1414-4414-8414-000000000001') = '{}',
  'PI-03: con todo puesto, no falta nada');

insert into public.staff_dias_libres (business_id, staff_id, weekday) values
  ('14141414-1414-4414-8414-000000000001', '14141414-1414-4414-8414-0000000000b1', 1),
  ('14141414-1414-4414-8414-000000000001', '14141414-1414-4414-8414-0000000000b1', 3);

select test.ok(
  not app.profesional_trabaja_algun_dia('14141414-1414-4414-8414-000000000001', '14141414-1414-4414-8414-0000000000b1'),
  'PI-20: con todos los días del local marcados "no trabaja", no trabaja ninguno');
select test.ok(
  public.negocio_lo_que_falta('14141414-1414-4414-8414-000000000001') = array['profesional'],
  'PI-20: esa profesional no cuenta en "lo que falta"');
select test.throws(
  $q$update public.businesses set estado = 'activo' where id = '14141414-1414-4414-8414-000000000001'$q$,
  'RA008', 'PI-20 + PI-03: sin nadie que trabaje, el negocio no se activa');

insert into public.business_hours (business_id, staff_id, weekday, hora_apertura, hora_cierre) values
  ('14141414-1414-4414-8414-000000000001', '14141414-1414-4414-8414-0000000000b1', 6, '10:00', '13:00');

select test.ok(
  app.profesional_trabaja_algun_dia('14141414-1414-4414-8414-000000000001', '14141414-1414-4414-8414-0000000000b1'),
  'PI-20: un tramo propio en sábado la devuelve a la cuenta, aunque el local cierre ese día');
select test.ok(
  public.negocio_lo_que_falta('14141414-1414-4414-8414-000000000001') = '{}',
  'PI-20: y entonces ya no falta nada');

select test.resumen();
rollback;
