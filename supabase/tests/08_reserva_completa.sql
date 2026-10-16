-- =============================================================================
-- Test 08 — book_appointment completo, asignación y ultima_profesional
-- (spec de fase 1.3, 1.4, 1.5, 1.7)
-- =============================================================================
-- La reserva valida con la MISMA función que la disponibilidad
-- (app.slot_es_valido), así que acá se comprueba sobre todo que cada motivo
-- de rechazo sale con su SQLSTATE y que la asignación automática elige bien.
--
-- Fechas fijas en 2030 (lunes 14/10 y siguientes), salvo la antelación, que
-- usa un negocio abierto las 24 horas y se mide contra now().
--
-- El test de concurrencia (dos reservas a la vez) necesita dos conexiones y
-- está en tests/concurrency.test.ts.
-- =============================================================================

\set ON_ERROR_STOP on

begin;
\ir _helpers.sql

\echo '08 — reserva completa'

-- --- Fixture -----------------------------------------------------------------
insert into public.businesses (id, nombre, slug, timezone) values
  ('88888888-8888-4888-8888-000000000001', 'Test Reserva', 'test-reserva', 'Europe/Madrid'),
  ('88888888-8888-4888-8888-000000000002', 'Test 24 horas', 'test-reserva-24h', 'Europe/Madrid');

insert into public.staff (id, business_id, nombre) values
  ('88888888-8888-4888-8888-00000000000a', '88888888-8888-4888-8888-000000000001', 'Alba'),
  ('88888888-8888-4888-8888-00000000000b', '88888888-8888-4888-8888-000000000001', 'Berta'),
  ('88888888-8888-4888-8888-0000000000aa', '88888888-8888-4888-8888-000000000002', 'Guardia');

insert into public.services (id, business_id, nombre, duracion_min, buffer_min) values
  ('88888888-8888-4888-8888-0000000000f1', '88888888-8888-4888-8888-000000000001', 'Facial', 60, 15),
  ('88888888-8888-4888-8888-0000000000ff', '88888888-8888-4888-8888-000000000002', 'Express', 30, 0);

insert into public.staff_services (business_id, staff_id, service_id) values
  ('88888888-8888-4888-8888-000000000001', '88888888-8888-4888-8888-00000000000a', '88888888-8888-4888-8888-0000000000f1'),
  ('88888888-8888-4888-8888-000000000001', '88888888-8888-4888-8888-00000000000b', '88888888-8888-4888-8888-0000000000f1'),
  ('88888888-8888-4888-8888-000000000002', '88888888-8888-4888-8888-0000000000aa', '88888888-8888-4888-8888-0000000000ff');

insert into public.business_hours (business_id, staff_id, weekday, hora_apertura, hora_cierre) values
  -- Lunes a miércoles 9–14
  ('88888888-8888-4888-8888-000000000001', null, 1, '09:00', '14:00'),
  ('88888888-8888-4888-8888-000000000001', null, 2, '09:00', '14:00'),
  ('88888888-8888-4888-8888-000000000001', null, 3, '09:00', '14:00');
insert into public.business_hours (business_id, weekday, hora_apertura, hora_cierre)
  select '88888888-8888-4888-8888-000000000002', d, '00:00', '24:00' from generate_series(0, 6) d;

insert into public.time_off (business_id, staff_id, desde, hasta, motivo) values
  -- Miércoles 16/10 festivo
  ('88888888-8888-4888-8888-000000000001', null,
   '2030-10-16 00:00:00+02', '2030-10-17 00:00:00+02', 'Festivo');

insert into public.customers (id, business_id, telefono, nombre) values
  ('88888888-8888-4888-8888-00000000000d', '88888888-8888-4888-8888-000000000001', '+34680000001', 'Habitual'),
  ('88888888-8888-4888-8888-00000000000e', '88888888-8888-4888-8888-000000000001', '+34680000002', 'Nueva'),
  -- PR-08: las reservas de pg_temp.reserva van con una clienta sin otras citas,
  -- para que cada rechazo sea por el hueco y no porque ella ya tiene cita.
  ('88888888-8888-4888-8888-00000000000f', '88888888-8888-4888-8888-000000000001', '+34680000004', 'Prueba'),
  ('88888888-8888-4888-8888-0000000000dd', '88888888-8888-4888-8888-000000000002', '+34680000003', 'Cliente 24 h');

-- Atajo: la llamada al RPC del negocio de prueba, como texto para test.throws.
-- p_staff NULL = asignación automática.
create function pg_temp.reserva(
  p_staff text, p_inicio text, p_cliente text default '88888888-8888-4888-8888-00000000000f'
) returns text
language sql immutable as $$
  select format(
    $q$select public.book_appointment(
         '88888888-8888-4888-8888-000000000001',
         '88888888-8888-4888-8888-0000000000f1',
         %s,
         %L,
         %L)$q$,
    coalesce(quote_literal(p_staff), 'null'), p_cliente, p_inicio);
$$;

\set alba  '''88888888-8888-4888-8888-00000000000a'''
\set berta '''88888888-8888-4888-8888-00000000000b'''

-- =============================================================================
-- Reserva válida
-- =============================================================================
select test.succeeds(
  pg_temp.reserva(:alba, '2030-10-14 10:00:00+02', '88888888-8888-4888-8888-00000000000d'),
  'reserva válida: se crea'
);

select test.ok(
  (select end_at from public.appointments
    where business_id = '88888888-8888-4888-8888-000000000001'
      and start_at = '2030-10-14 10:00:00+02')
    = '2030-10-14 11:00:00+02'::timestamptz,
  'end_at = inicio + duración, sin el margen'
);

-- Lo que se acaba de reservar desaparece de la disponibilidad.
select test.ok(
  not exists (
    select 1 from public.available_slots(
                    '88888888-8888-4888-8888-000000000001',
                    '88888888-8888-4888-8888-0000000000f1',
                    '2030-10-14 00:00:00+02', '2030-10-15 00:00:00+02', :alba) s
     where s.start_at = '2030-10-14 10:00:00+02'),
  'el hueco reservado ya no aparece en available_slots'
);

-- =============================================================================
-- Cada motivo de rechazo, con su SQLSTATE
-- =============================================================================
select test.throws(
  pg_temp.reserva(:alba, '2030-10-14 15:00:00+02'),
  'RA001', 'fuera de horario (15:00, cierra a las 14): RA001'
);

select test.throws(
  pg_temp.reserva(:alba, '2030-10-19 10:00:00+02'),
  'RA001', 'día que no abre (sábado): RA001'
);

select test.throws(
  pg_temp.reserva(:alba, '2030-10-14 13:30:00+02'),
  'RA001', 'el servicio no cabe antes del cierre (13:30 + 60): RA001'
);

select test.throws(
  pg_temp.reserva(:alba, '2030-10-14 12:10:00+02'),
  'RA001', 'fuera de la rejilla del intervalo (12:10 con intervalo 30): RA001'
);

select test.throws(
  pg_temp.reserva(:alba, '2030-10-16 10:00:00+02'),
  'RA002', 'en un festivo: RA002'
);

select test.throws(
  pg_temp.reserva(:alba, '2030-10-14 10:30:00+02'),
  '23P01', 'pisando otra cita: 23P01'
);

-- La cita de las 10:00 termina a las 11:00 y su margen llega a las 11:15.
select test.throws(
  pg_temp.reserva(:alba, '2030-10-14 11:00:00+02'),
  'RA004', 'pisando el margen de la cita anterior (11:00, margen hasta 11:15): RA004'
);

-- 09:00 + 60 termina a las 10:00, pero su propio margen pisa la cita de las 10.
select test.throws(
  pg_temp.reserva(:alba, '2030-10-14 09:00:00+02'),
  'RA004', 'cuyo propio margen pisa la cita siguiente (09:00): RA004'
);

select test.succeeds(
  pg_temp.reserva(:alba, '2030-10-14 11:30:00+02'),
  'pasado el margen (11:30): se crea'
);

-- Antelación: en el negocio de 24 h, dentro de una hora siempre está abierto.
select test.throws(
  format($q$select public.book_appointment(
              '88888888-8888-4888-8888-000000000002',
              '88888888-8888-4888-8888-0000000000ff',
              '88888888-8888-4888-8888-0000000000aa',
              '88888888-8888-4888-8888-0000000000dd',
              %L)$q$,
         date_trunc('hour', now()) + interval '1 hour'),
  'RA003', 'sin la antelación mínima (dentro de una hora, con 2 h de serie): RA003'
);

select test.throws(
  format($q$select public.book_appointment(
              '88888888-8888-4888-8888-000000000002',
              '88888888-8888-4888-8888-0000000000ff',
              '88888888-8888-4888-8888-0000000000aa',
              '88888888-8888-4888-8888-0000000000dd',
              %L)$q$,
         date_trunc('hour', now()) - interval '1 day'),
  'RA003', 'en el pasado: RA003'
);

select test.succeeds(
  format($q$select public.book_appointment(
              '88888888-8888-4888-8888-000000000002',
              '88888888-8888-4888-8888-0000000000ff',
              '88888888-8888-4888-8888-0000000000aa',
              '88888888-8888-4888-8888-0000000000dd',
              %L)$q$,
         date_trunc('hour', now()) + interval '3 hours'),
  'con antelación suficiente (dentro de 3 h): se crea'
);

-- Nada de lo rechazado dejó una cita a medias.
select test.ok(
  (select count(*) from public.appointments
    where business_id = '88888888-8888-4888-8888-000000000001') = 2,
  'tras los rechazos solo quedan las 2 citas válidas'
);

-- =============================================================================
-- Asignación automática (PD-03, tarea 1.4)
-- =============================================================================
-- Lunes 14/10: Alba ya tiene 2 citas (10:00 y 11:30) y Berta ninguna.
select test.ok(
  (select (public.book_appointment(
             '88888888-8888-4888-8888-000000000001',
             '88888888-8888-4888-8888-0000000000f1',
             null,
             '88888888-8888-4888-8888-00000000000e',
             '2030-10-14 13:00:00+02')).staff_id) = :berta,
  'sin profesional: se asigna a la que menos citas tiene ese día (Berta, 0 contra 2)'
);

-- Martes 15/10: las dos a cero → empate → orden estable por nombre: Alba.
select test.ok(
  (select (public.book_appointment(
             '88888888-8888-4888-8888-000000000001',
             '88888888-8888-4888-8888-0000000000f1',
             null,
             '88888888-8888-4888-8888-00000000000e',
             '2030-10-15 09:00:00+02')).staff_id) = :alba,
  'empate a cero: orden estable (Alba antes que Berta)'
);

-- Martes 15/10 a las 11:00: ahora Alba tiene 1 y Berta 0 → Berta.
select test.ok(
  (select (public.book_appointment(
             '88888888-8888-4888-8888-000000000001',
             '88888888-8888-4888-8888-0000000000f1',
             null,
             '88888888-8888-4888-8888-00000000000e',
             '2030-10-15 11:00:00+02')).staff_id) = :berta,
  'tras el empate, la siguiente va a la que quedó con menos (Berta)'
);

-- Candidatas = las que tienen ESE hueco exacto. Martes 22/10: Berta tiene una
-- cita a las 9:00 y Alba dos más tarde. A las 9:00 la de menos carga (Berta)
-- está ocupada, así que va Alba aunque tenga más citas ese día.
-- (Las tres de relleno son de la clienta Nueva: la Habitual reserva la de las 9:00
-- y no puede tener otra a esa hora, PR-08.)
select public.book_appointment('88888888-8888-4888-8888-000000000001', '88888888-8888-4888-8888-0000000000f1',
         :berta, '88888888-8888-4888-8888-00000000000e', '2030-10-22 09:00:00+02');
select public.book_appointment('88888888-8888-4888-8888-000000000001', '88888888-8888-4888-8888-0000000000f1',
         :alba, '88888888-8888-4888-8888-00000000000e', '2030-10-22 11:00:00+02');
select public.book_appointment('88888888-8888-4888-8888-000000000001', '88888888-8888-4888-8888-0000000000f1',
         :alba, '88888888-8888-4888-8888-00000000000e', '2030-10-22 12:30:00+02');

select test.ok(
  (select (public.book_appointment(
             '88888888-8888-4888-8888-000000000001',
             '88888888-8888-4888-8888-0000000000f1',
             null,
             '88888888-8888-4888-8888-00000000000d',
             '2030-10-22 09:00:00+02')).staff_id) = :alba,
  'solo cuentan las que tienen ese hueco exacto: la de menos carga está ocupada, va la otra'
);

-- Lunes 14/10 a las 10:00: Alba ya está; la automática se la lleva Berta.
select test.ok(
  (select (public.book_appointment(
             '88888888-8888-4888-8888-000000000001',
             '88888888-8888-4888-8888-0000000000f1',
             null,
             '88888888-8888-4888-8888-00000000000e',
             '2030-10-14 10:00:00+02')).staff_id) = :berta,
  'a la misma hora que una cita de Alba, la automática va a Berta'
);

-- Lunes 10:00 ya están las dos ocupadas.
select test.throws(
  pg_temp.reserva(null, '2030-10-14 10:00:00+02'),
  'RA005', 'sin nadie libre a esa hora: RA005'
);

-- Si para todas el motivo es el mismo y es de calendario, se informa ese.
select test.throws(
  pg_temp.reserva(null, '2030-10-16 10:00:00+02'),
  'RA002', 'asignación automática en un festivo: RA002 (no RA005)'
);

select test.throws(
  pg_temp.reserva(null, '2030-10-19 10:00:00+02'),
  'RA001', 'asignación automática un día que no abre: RA001 (no RA005)'
);

-- =============================================================================
-- PR-08: una clienta no puede tener dos citas que se pisen (RA006)
-- =============================================================================
-- Miércoles 23/10 (9–14), libre para las dos: la Habitual reserva con Alba a las 10:00.
select test.succeeds(
  pg_temp.reserva(:alba, '2030-10-23 10:00:00+02', '88888888-8888-4888-8888-00000000000d'),
  'PR-08: la Habitual reserva el miércoles 23 a las 10:00 con Alba'
);

select test.throws(
  pg_temp.reserva(:berta, '2030-10-23 10:30:00+02', '88888888-8888-4888-8888-00000000000d'),
  'RA006', 'la misma clienta con otra profesional a una hora que se pisa: RA006'
);

select test.throws(
  pg_temp.reserva(:alba, '2030-10-23 10:00:00+02', '88888888-8888-4888-8888-00000000000d'),
  'RA006', 'la misma clienta, misma hora y misma profesional: RA006 antes que hueco ocupado'
);

-- Pegada a la suya (empieza cuando termina la otra): sí puede. El margen no
-- cuenta para la clienta, solo para la profesional.
select test.succeeds(
  pg_temp.reserva(:berta, '2030-10-23 11:00:00+02', '88888888-8888-4888-8888-00000000000d'),
  'la misma clienta justo después de su otra cita, con otra profesional: se reserva'
);

-- Una cita cancelada no cuenta.
update public.appointments set estado = 'cancelada'
 where business_id = '88888888-8888-4888-8888-000000000001'
   and customer_id = '88888888-8888-4888-8888-00000000000d'
   and start_at = '2030-10-23 10:00:00+02';
select test.succeeds(
  pg_temp.reserva(:alba, '2030-10-23 10:00:00+02', '88888888-8888-4888-8888-00000000000d'),
  'con su cita de las 10:00 cancelada, puede volver a reservar a esa hora'
);

-- =============================================================================
-- Errores de la Fase 0 que siguen vigentes
-- =============================================================================
insert into public.staff (id, business_id, nombre) values
  ('88888888-8888-4888-8888-00000000000c', '88888888-8888-4888-8888-000000000001', 'Sin facial');

select test.throws(
  pg_temp.reserva('88888888-8888-4888-8888-00000000000c', '2030-10-15 12:00:00+02'),
  '23514', 'profesional que no hace el servicio: 23514'
);

select test.throws(
  pg_temp.reserva('88888888-8888-4888-8888-0000000000aa', '2030-10-15 12:00:00+02'),
  '23503', 'profesional de otro negocio: 23503'
);

-- =============================================================================
-- ultima_profesional
-- =============================================================================
-- PR-06 (decidido 16/10/2026): solo cuentan las citas YA PASADAS y atendidas.
-- Las citas pasadas se insertan directamente: book_appointment no deja
-- reservar en el pasado. Fechas relativas a now() para no depender del día.
--
-- La clienta "Nueva" tiene además citas reservadas en 2030 (de los bloques de
-- arriba, con Berta y Alba). Esas son futuras y no tienen que contar.
select test.ok(
  public.ultima_profesional('88888888-8888-4888-8888-000000000001',
                            '88888888-8888-4888-8888-00000000000e') is null,
  'ultima_profesional: las citas futuras no cuentan (solo tiene citas en 2030 → NULL)'
);

insert into public.appointments (business_id, staff_id, service_id, customer_id, start_at, end_at, estado) values
  -- hace 30 días con Alba, atendida
  ('88888888-8888-4888-8888-000000000001', :alba, '88888888-8888-4888-8888-0000000000f1',
   '88888888-8888-4888-8888-00000000000e',
   date_trunc('hour', now()) - interval '30 days', date_trunc('hour', now()) - interval '30 days' + interval '1 hour',
   'completada'),
  -- hace 10 días con Berta, confirmada (nadie la marcó como completada)
  ('88888888-8888-4888-8888-000000000001', :berta, '88888888-8888-4888-8888-0000000000f1',
   '88888888-8888-4888-8888-00000000000e',
   date_trunc('hour', now()) - interval '10 days', date_trunc('hour', now()) - interval '10 days' + interval '1 hour',
   'confirmada');

select test.ok(
  public.ultima_profesional('88888888-8888-4888-8888-000000000001',
                            '88888888-8888-4888-8888-00000000000e') = :berta,
  'ultima_profesional: la de la última cita pasada (hace 10 días, Berta), no las de 2030'
);

-- Hace 3 días no vino (no_show) con Alba: esa vez nadie la atendió.
insert into public.appointments (business_id, staff_id, service_id, customer_id, start_at, end_at, estado) values
  ('88888888-8888-4888-8888-000000000001', :alba, '88888888-8888-4888-8888-0000000000f1',
   '88888888-8888-4888-8888-00000000000e',
   date_trunc('hour', now()) - interval '3 days', date_trunc('hour', now()) - interval '3 days' + interval '1 hour',
   'no_show');

select test.ok(
  public.ultima_profesional('88888888-8888-4888-8888-000000000001',
                            '88888888-8888-4888-8888-00000000000e') = :berta,
  'ultima_profesional: una cita a la que no vino (no_show) no cuenta'
);

-- Si la de Berta se cancela, pasa a ser la anterior atendida (Alba, hace 30 días).
update public.appointments set estado = 'cancelada'
 where customer_id = '88888888-8888-4888-8888-00000000000e'
   and start_at = date_trunc('hour', now()) - interval '10 days';

select test.ok(
  public.ultima_profesional('88888888-8888-4888-8888-000000000001',
                            '88888888-8888-4888-8888-00000000000e') = :alba,
  'ultima_profesional: las canceladas no cuentan'
);

insert into public.customers (id, business_id, telefono, nombre) values
  ('88888888-8888-4888-8888-0000000000ee', '88888888-8888-4888-8888-000000000001', '+34680000009', 'Sin historial');

select test.ok(
  public.ultima_profesional('88888888-8888-4888-8888-000000000001',
                            '88888888-8888-4888-8888-0000000000ee') is null,
  'ultima_profesional: NULL para una clienta nueva'
);

select test.ok(
  public.ultima_profesional('88888888-8888-4888-8888-000000000002',
                            '88888888-8888-4888-8888-00000000000e') is null,
  'ultima_profesional: no mira citas de otro negocio'
);

-- =============================================================================
-- Única fuente de verdad (1.5): reserva y disponibilidad dicen lo mismo
-- =============================================================================
-- Todo hueco que ofrece available_slots se puede reservar, y ningún otro
-- inicio de la rejilla. Se comprueba en el lunes 21/10, que está vacío, contra
-- app.slot_es_valido directamente.
select test.ok(
  (select array_agg(s.start_at order by s.start_at)
     from public.available_slots(
            '88888888-8888-4888-8888-000000000001',
            '88888888-8888-4888-8888-0000000000f1',
            '2030-10-21 00:00:00+02', '2030-10-22 00:00:00+02', :alba) s)
  = (select array_agg(t order by t)
       from generate_series('2030-10-21 00:00:00+02'::timestamptz,
                            '2030-10-21 23:55:00+02', interval '5 minutes') t
      where app.slot_es_valido('88888888-8888-4888-8888-000000000001',
                               '88888888-8888-4888-8888-0000000000f1',
                               :alba, t) is null),
  'available_slots y slot_es_valido coinciden minuto a minuto (cada 5 min de un día entero)'
);

-- =============================================================================
-- RLS: las funciones son SECURITY INVOKER y respetan el tenant (D-17)
-- =============================================================================
set client_min_messages = warning;
drop role if exists test_motor;
set client_min_messages = notice;
create role test_motor nologin;
-- En Supabase `postgres` no es superusuario: puede crear el rol, pero para
-- hacer SET ROLE tiene que ser miembro (Postgres 16+). En local no hace daño.
grant test_motor to current_user;
grant usage on schema public, app to test_motor;
grant select, insert on all tables in schema public to test_motor;

set local role test_motor;

select test.ok(
  (select count(*) from public.available_slots(
            '88888888-8888-4888-8888-000000000001', '88888888-8888-4888-8888-0000000000f1',
            '2030-10-21 00:00:00+02', '2030-10-22 00:00:00+02')) = 0,
  'sin tenant declarado, available_slots no devuelve nada'
);

select app.set_business_id('88888888-8888-4888-8888-000000000002');

select test.ok(
  (select count(*) from public.available_slots(
            '88888888-8888-4888-8888-000000000001', '88888888-8888-4888-8888-0000000000f1',
            '2030-10-21 00:00:00+02', '2030-10-22 00:00:00+02')) = 0,
  'con el tenant de otro negocio, available_slots no devuelve nada'
);

select test.throws(
  pg_temp.reserva(:alba, '2030-10-21 10:00:00+02'),
  '23503', 'con el tenant de otro negocio, book_appointment no puede reservar'
);

select app.set_business_id('88888888-8888-4888-8888-000000000001');

select test.ok(
  (select count(*) from public.available_slots(
            '88888888-8888-4888-8888-000000000001', '88888888-8888-4888-8888-0000000000f1',
            '2030-10-21 00:00:00+02', '2030-10-22 00:00:00+02')) > 0,
  'con su propio tenant, available_slots sí devuelve huecos'
);

reset role;

select test.resumen();
rollback;
