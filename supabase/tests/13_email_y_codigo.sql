-- =============================================================================
-- Test 13 — La clienta es su email; códigos y emails (PA-16, PA-17, PW-18)
-- =============================================================================
-- Unicidad por email y, sin email, por teléfono; mismo teléfono con emails
-- distintos; formato del email; códigos con su hash y sus límites; emails con
-- su tipo; RLS en las dos tablas nuevas.
-- =============================================================================
\set ON_ERROR_STOP on
begin;
\ir _helpers.sql

\echo '13 — email y código'

insert into public.businesses (id, nombre, slug) values
  ('13131313-1313-4313-8313-000000000001', 'Email A', 'test-email-a'),
  ('13131313-1313-4313-8313-000000000002', 'Email B', 'test-email-b');

-- --- Fichas ------------------------------------------------------------------
select test.succeeds($q$insert into public.customers (id, business_id, telefono, nombre, email) values
  ('13131313-1313-4313-8313-0000000000c1', '13131313-1313-4313-8313-000000000001', '+34600000001', 'Madre', 'madre@example.com'),
  ('13131313-1313-4313-8313-0000000000c2', '13131313-1313-4313-8313-000000000001', '+34600000001', 'Hija', 'hija@example.com')$q$,
  'PA-17: el mismo teléfono con dos emails son dos fichas');
select test.throws($q$insert into public.customers (business_id, telefono, nombre, email)
  values ('13131313-1313-4313-8313-000000000001', '+34600000009', 'Otra', 'madre@example.com')$q$,
  '23505', 'PA-17: el email es único dentro del negocio');
select test.succeeds($q$insert into public.customers (business_id, telefono, nombre, email)
  values ('13131313-1313-4313-8313-000000000002', '+34600000001', 'Madre', 'madre@example.com')$q$,
  'el mismo email en otro negocio es otra clienta');
select test.throws($q$insert into public.customers (business_id, telefono, nombre, email)
  values ('13131313-1313-4313-8313-000000000001', '+34600000009', 'X', 'Mayus@Example.com')$q$,
  '23514', 'el email va en minúsculas');
select test.throws($q$insert into public.customers (business_id, telefono, nombre, email)
  values ('13131313-1313-4313-8313-000000000001', '+34600000009', 'X', 'sin-arroba')$q$,
  '23514', 'un email sin formato se rechaza');
select test.succeeds($q$insert into public.customers (id, business_id, telefono, nombre) values
  ('13131313-1313-4313-8313-0000000000c3', '13131313-1313-4313-8313-000000000001', '+34600000003', 'Sin email')$q$,
  'PA-17: se puede reservar sin email');
select test.throws($q$insert into public.customers (business_id, telefono, nombre)
  values ('13131313-1313-4313-8313-000000000001', '+34600000003', 'Repetida')$q$,
  '23505', 'sin email, el teléfono sigue siendo único');
select test.succeeds($q$insert into public.customers (business_id, telefono, nombre, email)
  values ('13131313-1313-4313-8313-000000000001', '+34600000003', 'Con email', 'otra@example.com')$q$,
  'una ficha con email puede compartir teléfono con una sin email');

-- --- Códigos -----------------------------------------------------------------
insert into public.conversations (id, business_id, customer_id, canal) values
  ('13131313-1313-4313-8313-0000000000d1', '13131313-1313-4313-8313-000000000001', '13131313-1313-4313-8313-0000000000c1', 'web');

select test.ok(
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'conversations' and column_name = 'verificada_at'),
  'PA-16: conversations.verificada_at existe'
);
select test.succeeds($q$insert into public.codigos_verificacion (business_id, conversation_id, customer_id, codigo_hash, expira_at)
  values ('13131313-1313-4313-8313-000000000001', '13131313-1313-4313-8313-0000000000d1', '13131313-1313-4313-8313-0000000000c1',
          repeat('a', 64), now() + interval '10 minutes')$q$, 'PA-16: se guarda un código con su hash');
select test.throws($q$insert into public.codigos_verificacion (business_id, conversation_id, customer_id, codigo_hash, expira_at)
  values ('13131313-1313-4313-8313-000000000001', '13131313-1313-4313-8313-0000000000d1', '13131313-1313-4313-8313-0000000000c1',
          '123456', now())$q$, '23514', 'PA-16: el código en claro no cabe (solo el hash)');
select test.throws($q$update public.codigos_verificacion set intentos = 4
  where business_id = '13131313-1313-4313-8313-000000000001'$q$, '23514', 'PA-16: no más de 3 intentos');
select test.throws($q$insert into public.codigos_verificacion (business_id, conversation_id, customer_id, codigo_hash, expira_at)
  values ('13131313-1313-4313-8313-000000000002', '13131313-1313-4313-8313-0000000000d1', '13131313-1313-4313-8313-0000000000c1',
          repeat('b', 64), now())$q$, '23503', 'un código no puede apuntar a la conversación de otro negocio');

-- --- Emails ------------------------------------------------------------------
select test.succeeds($q$insert into public.email_messages (business_id, customer_id, tipo, email, asunto, texto, proveedor)
  values ('13131313-1313-4313-8313-000000000001', '13131313-1313-4313-8313-0000000000c1', 'codigo',
          'madre@example.com', 'Tu código', 'Tu código es [código]', 'prueba')$q$, 'PW-18: se guarda un email');
select test.throws($q$insert into public.email_messages (business_id, tipo, email, asunto, texto, proveedor)
  values ('13131313-1313-4313-8313-000000000001', 'promocion', 'madre@example.com', 'x', 'x', 'prueba')$q$,
  '23514', 'solo confirmación, cancelación o código');

-- --- RLS ---------------------------------------------------------------------
select test.ok(
  (select bool_and(relrowsecurity) from pg_class
    where oid in ('public.codigos_verificacion'::regclass, 'public.email_messages'::regclass)),
  'RLS activo en codigos_verificacion y email_messages'
);

select test.resumen();
rollback;
