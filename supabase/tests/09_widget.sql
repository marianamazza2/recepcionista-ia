-- =============================================================================
-- Test 09 — Canal widget web (Fase 3 · 3.1)
-- =============================================================================
-- Columnas nuevas de businesses, conversations y usage_events, y las tablas
-- appointment_links y sms_messages: valores de serie, restricciones,
-- integridad entre negocios y RLS. Y el logo del widget (PW-17, 28/10/2026).
-- =============================================================================

\set ON_ERROR_STOP on

begin;
\ir _helpers.sql

\echo '09 — canal widget web'

-- --- Fixture: dos negocios ---------------------------------------------------
insert into public.businesses (id, nombre, slug) values
  ('99999999-9999-4999-8999-000000000001', 'Widget A', 'test-widget-a'),
  ('99999999-9999-4999-8999-000000000002', 'Widget B', 'test-widget-b');

insert into public.staff (id, business_id, nombre) values
  ('99999999-9999-4999-8999-00000000000a', '99999999-9999-4999-8999-000000000001', 'Ana');
insert into public.services (id, business_id, nombre, duracion_min) values
  ('99999999-9999-4999-8999-00000000000b', '99999999-9999-4999-8999-000000000001', 'Servicio', 30);
insert into public.staff_services (business_id, staff_id, service_id) values
  ('99999999-9999-4999-8999-000000000001', '99999999-9999-4999-8999-00000000000a', '99999999-9999-4999-8999-00000000000b');
insert into public.customers (id, business_id, telefono, nombre) values
  ('99999999-9999-4999-8999-00000000000c', '99999999-9999-4999-8999-000000000001', '+34690000001', 'Clienta A');
insert into public.appointments (id, business_id, staff_id, service_id, customer_id, start_at, end_at) values
  ('99999999-9999-4999-8999-00000000000d', '99999999-9999-4999-8999-000000000001',
   '99999999-9999-4999-8999-00000000000a', '99999999-9999-4999-8999-00000000000b',
   '99999999-9999-4999-8999-00000000000c', '2030-06-03 10:00+02', '2030-06-03 10:30+02');

-- --- businesses: ajustes del widget ------------------------------------------
select test.ok(
  (select widget_key ~ '^wk_[0-9a-f]{32}$'
      and widget_dominios = '{}'
      and widget_color = '#4f6d7a'
      and privacidad_url is null
      and tope_mensual_usd = 100
     from public.businesses where id = '99999999-9999-4999-8999-000000000001'),
  'de serie: clave aleatoria, sin dominios, color neutro, sin URL de privacidad, tope 100 US$'
);

select test.ok(
  (select count(distinct widget_key) from public.businesses
    where id in ('99999999-9999-4999-8999-000000000001', '99999999-9999-4999-8999-000000000002')) = 2,
  'cada negocio recibe una clave distinta'
);

select test.throws(
  $q$update public.businesses set widget_key = (select widget_key from public.businesses where id = '99999999-9999-4999-8999-000000000002')
      where id = '99999999-9999-4999-8999-000000000001'$q$,
  '23505', 'dos negocios no pueden compartir clave'
);

select test.throws(
  $q$update public.businesses set widget_color = 'rojo' where id = '99999999-9999-4999-8999-000000000001'$q$,
  '23514', 'el color tiene que ser #RRGGBB'
);

select test.throws(
  $q$update public.businesses set privacidad_url = 'javascript:alert(1)' where id = '99999999-9999-4999-8999-000000000001'$q$,
  '23514', 'la URL de privacidad tiene que ser http(s)'
);

select test.throws(
  $q$update public.businesses set widget_dominios = array['EsteticaAurora.es'] where id = '99999999-9999-4999-8999-000000000001'$q$,
  '23514', 'los dominios se guardan en minúsculas'
);

select test.throws(
  $q$update public.businesses set tope_mensual_usd = -1 where id = '99999999-9999-4999-8999-000000000001'$q$,
  '23514', 'el tope no puede ser negativo'
);

-- --- businesses: logo del widget (PW-17) --------------------------------------
select test.ok(
  (select widget_logo is null from public.businesses where id = '99999999-9999-4999-8999-000000000001'),
  'PW-17: de serie, sin logo (el widget muestra la inicial)'
);

select test.succeeds(
  $q$update public.businesses set widget_logo = 'data:image/png;base64,iVBORw0KGgo='
      where id = '99999999-9999-4999-8999-000000000001'$q$,
  'PW-17: acepta un logo como data URL en base64'
);

select test.succeeds(
  $q$update public.businesses set widget_logo = 'data:image/svg+xml;base64,PHN2Zy8+'
      where id = '99999999-9999-4999-8999-000000000001'$q$,
  'PW-17: también en SVG'
);

select test.throws(
  $q$update public.businesses set widget_logo = 'https://esteticaaurora.es/logo.png'
      where id = '99999999-9999-4999-8999-000000000001'$q$,
  '23514', 'PW-17: el logo no puede ser un enlace a otra web'
);

select test.throws(
  $q$update public.businesses set widget_logo = 'data:text/html;base64,PHNjcmlwdD4='
      where id = '99999999-9999-4999-8999-000000000001'$q$,
  '23514', 'PW-17: solo imágenes'
);

select test.throws(
  $q$update public.businesses set widget_logo = 'data:image/png;base64,' || repeat('A', 200000)
      where id = '99999999-9999-4999-8999-000000000001'$q$,
  '23514', 'PW-17: como mucho 200.000 caracteres'
);

-- --- conversations: token de sesión -------------------------------------------
insert into public.conversations (id, business_id, session_token_hash, ip_hash) values
  ('99999999-9999-4999-8999-0000000000e1', '99999999-9999-4999-8999-000000000001', repeat('a', 64), repeat('b', 64));

select test.throws(
  $q$insert into public.conversations (business_id, session_token_hash)
     values ('99999999-9999-4999-8999-000000000002', repeat('a', 64))$q$,
  '23505', 'un token de sesión no puede abrir dos conversaciones (tampoco de otro negocio)'
);

select test.throws(
  $q$insert into public.conversations (business_id, session_token_hash)
     values ('99999999-9999-4999-8999-000000000001', 'token-en-claro')$q$,
  '23514', 'en la base solo cabe el hash del token, nunca el token'
);

-- --- usage_events: enlazados a la conversación, en US$ -----------------------
insert into public.usage_events (business_id, tipo, cantidad, coste_estimado, conversation_id) values
  ('99999999-9999-4999-8999-000000000001', 'token', 1000, 0.012345, '99999999-9999-4999-8999-0000000000e1');

select test.throws(
  $q$insert into public.usage_events (business_id, tipo, cantidad, conversation_id)
     values ('99999999-9999-4999-8999-000000000002', 'mensaje', 1, '99999999-9999-4999-8999-0000000000e1')$q$,
  '23503', 'un evento no puede apuntar a la conversación de otro negocio'
);

select test.ok(
  col_description('public.usage_events'::regclass,
    (select attnum from pg_attribute where attrelid = 'public.usage_events'::regclass and attname = 'coste_estimado'))
    like 'Coste en US$%',
  'el comentario de coste_estimado dice US$'
);

delete from public.conversations where id = '99999999-9999-4999-8999-0000000000e1';

select test.ok(
  (select conversation_id is null and coste_estimado = 0.012345
     from public.usage_events where business_id = '99999999-9999-4999-8999-000000000001'),
  'al borrar la conversación el consumo se queda (solo pierde el enlace)'
);

-- --- appointment_links -------------------------------------------------------
insert into public.appointment_links (business_id, appointment_id, token_hash, expira_at) values
  ('99999999-9999-4999-8999-000000000001', '99999999-9999-4999-8999-00000000000d', repeat('c', 64), '2030-06-03 10:30+02');

select test.throws(
  $q$insert into public.appointment_links (business_id, appointment_id, token_hash, expira_at)
     values ('99999999-9999-4999-8999-000000000002', '99999999-9999-4999-8999-00000000000d', repeat('d', 64), now())$q$,
  '23503', 'un enlace no puede apuntar a la cita de otro negocio'
);

select test.throws(
  $q$insert into public.appointment_links (business_id, appointment_id, token_hash, expira_at)
     values ('99999999-9999-4999-8999-000000000001', '99999999-9999-4999-8999-00000000000d', repeat('c', 64), now())$q$,
  '23505', 'el hash del token es único'
);

-- --- sms_messages ------------------------------------------------------------
insert into public.sms_messages (business_id, appointment_id, telefono, texto, estado, proveedor) values
  ('99999999-9999-4999-8999-000000000001', '99999999-9999-4999-8999-00000000000d', '+34690000001',
   'Widget A: cita confirmada. Para verla o cancelarla: [enlace]', 'prueba', 'prueba');

select test.ok(
  (select estado = 'prueba' from public.sms_messages where business_id = '99999999-9999-4999-8999-000000000001'),
  'un SMS del proveedor de prueba queda en estado "prueba"'
);

select test.ok(
  (select array_agg(e::text order by e::text) from unnest(enum_range(null::public.sms_estado)) e)
    = array['enviado', 'fallido', 'pendiente', 'prueba'],
  'los estados de un SMS son pendiente, enviado, fallido y prueba'
);

select test.throws(
  $q$insert into public.sms_messages (business_id, telefono, texto, proveedor)
     values ('99999999-9999-4999-8999-000000000001', '690000001', 'x', 'prueba')$q$,
  '23514', 'el teléfono del SMS va con prefijo internacional'
);

-- Borrar la cita se lleva su enlace y sus SMS.
delete from public.appointments where id = '99999999-9999-4999-8999-00000000000d';
select test.ok(
  not exists (select 1 from public.appointment_links where appointment_id = '99999999-9999-4999-8999-00000000000d')
  and not exists (select 1 from public.sms_messages where appointment_id = '99999999-9999-4999-8999-00000000000d'),
  'al borrar la cita se borran su enlace y sus SMS'
);

-- --- RLS de las tablas nuevas -------------------------------------------------
insert into public.appointments (id, business_id, staff_id, service_id, customer_id, start_at, end_at) values
  ('99999999-9999-4999-8999-0000000000d2', '99999999-9999-4999-8999-000000000001',
   '99999999-9999-4999-8999-00000000000a', '99999999-9999-4999-8999-00000000000b',
   '99999999-9999-4999-8999-00000000000c', '2030-06-04 10:00+02', '2030-06-04 10:30+02');
insert into public.sms_messages (business_id, appointment_id, telefono, texto, proveedor) values
  ('99999999-9999-4999-8999-000000000001', '99999999-9999-4999-8999-0000000000d2', '+34690000001', 'Texto', 'prueba');
insert into public.appointment_links (business_id, appointment_id, token_hash, expira_at) values
  ('99999999-9999-4999-8999-000000000001', '99999999-9999-4999-8999-0000000000d2', repeat('e', 64), '2030-06-04 10:30+02');

set client_min_messages = warning;
drop role if exists test_widget;
set client_min_messages = notice;
create role test_widget nologin;
grant test_widget to current_user;
grant usage on schema public, app to test_widget;
grant select, insert, update, delete on all tables in schema public to test_widget;
set local role test_widget;

select app.set_business_id('99999999-9999-4999-8999-000000000002');
select test.ok(
  (select count(*) from public.sms_messages) = 0 and (select count(*) from public.appointment_links) = 0,
  'desde otro negocio no se ve ningún SMS ni enlace'
);

select app.set_business_id('99999999-9999-4999-8999-000000000001');
select test.ok(
  (select count(*) from public.sms_messages) = 1 and (select count(*) from public.appointment_links) = 1,
  'el negocio ve sus SMS y sus enlaces'
);

reset role;

select test.resumen();
rollback;
