-- =============================================================================
-- Test 11 — Días que una profesional no trabaja (PI-19, amplía PD-01)
-- =============================================================================
-- El caso de Mariana (30/10/2026): Rodrigo tiene horario propio el jueves y
-- el sábado; el viernes el local abre, pero él no trabaja. Comprueba la
-- tabla (restricciones, aislamiento entre negocios, RLS) y que el motor no
-- ofrece ni reserva ese día, tampoco a mano, con available_slots y
-- slot_es_valido diciendo lo mismo minuto a minuto (D-26).
-- =============================================================================

\set ON_ERROR_STOP on

begin;
\ir _helpers.sql

\echo '11 — días que una profesional no trabaja'

-- --- Fixture -------------------------------------------------------------------
-- Clínica que abre de lunes a viernes de 10:00 a 19:00. Rodrigo: jueves 10–14
-- y sábado 15–20 propios, el viernes no trabaja, el resto como el local. Ana:
-- como el local todos los días. Semana del lunes 21/10/2030.
\set clinica '\'11111111-1111-4111-8111-000000000001\''
\set otra    '\'11111111-1111-4111-8111-000000000002\''
\set rodrigo '\'11111111-1111-4111-8111-0000000000a1\''
\set ana     '\'11111111-1111-4111-8111-0000000000a2\''
\set ajena   '\'11111111-1111-4111-8111-0000000000b1\''
\set limpieza '\'11111111-1111-4111-8111-0000000000c1\''

insert into public.businesses (id, nombre, slug) values
  (:clinica, 'Clínica Libres', 'test-dias-libres'),
  (:otra, 'Otra Libres', 'test-dias-libres-otra');
insert into public.staff (id, business_id, nombre) values
  (:rodrigo, :clinica, 'Rodrigo'),
  (:ana, :clinica, 'Ana'),
  (:ajena, :otra, 'Ajena');
insert into public.services (id, business_id, nombre, duracion_min) values
  (:limpieza, :clinica, 'Limpieza', 45);
insert into public.staff_services (business_id, staff_id, service_id) values
  (:clinica, :rodrigo, :limpieza),
  (:clinica, :ana, :limpieza);
insert into public.business_hours (business_id, staff_id, weekday, hora_apertura, hora_cierre)
  select :clinica::uuid, null::uuid, d, '10:00'::time, '19:00'::time from generate_series(1, 5) d;
insert into public.business_hours (business_id, staff_id, weekday, hora_apertura, hora_cierre) values
  (:clinica, :rodrigo, 4, '10:00', '14:00'),
  (:clinica, :rodrigo, 6, '15:00', '20:00');
insert into public.customers (id, business_id, telefono, nombre) values
  ('11111111-1111-4111-8111-0000000000d1', :clinica, '+34611100001', 'Paciente');

-- =============================================================================
-- La tabla
-- =============================================================================
select test.succeeds(
  format($q$insert into public.staff_dias_libres (business_id, staff_id, weekday) values (%L, %L, 5)$q$, :clinica, :rodrigo),
  'PI-19: Rodrigo no trabaja los viernes'
);

select test.throws(
  format($q$insert into public.staff_dias_libres (business_id, staff_id, weekday) values (%L, %L, 5)$q$, :clinica, :rodrigo),
  '23505', 'un mismo día no se marca dos veces'
);

select test.throws(
  format($q$insert into public.staff_dias_libres (business_id, staff_id, weekday) values (%L, %L, 7)$q$, :clinica, :ana),
  '23514', 'el día de la semana va de 0 (domingo) a 6 (sábado)'
);

select test.throws(
  format($q$insert into public.staff_dias_libres (business_id, staff_id, weekday) values (%L, %L, 1)$q$, :clinica, :ajena),
  '23503', 'no se puede marcar el día libre de una profesional de otro negocio'
);

select test.ok(
  (select c.relrowsecurity from pg_class c where c.oid = 'public.staff_dias_libres'::regclass)
  and exists (select 1 from pg_policy p where p.polrelid = 'public.staff_dias_libres'::regclass and p.polname = 'tenant_isolation'),
  'staff_dias_libres tiene RLS y su política de tenant'
);

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'test_libres_sin_privilegios') then
    create role test_libres_sin_privilegios nologin;
  end if;
end $$;
grant usage on schema public, app to test_libres_sin_privilegios;
grant select on public.staff_dias_libres to test_libres_sin_privilegios;
grant test_libres_sin_privilegios to current_user;
select app.set_business_id(:otra);
set local role test_libres_sin_privilegios;
select test.ok(
  (select count(*) from public.staff_dias_libres) = 0,
  'desde otro negocio no se ven los días libres de este'
);
reset role;
select app.set_business_id(:clinica);
set local role test_libres_sin_privilegios;
select test.ok(
  (select count(*) from public.staff_dias_libres) = 1,
  'el negocio ve los suyos'
);
reset role;
select set_config('app.business_id', '', true);

-- =============================================================================
-- El motor (PD-01 + PI-19)
-- =============================================================================
select test.ok(
  not exists (select 1 from app.tramos_efectivos(:clinica, :rodrigo, '2030-10-25')),
  'el viernes (no trabaja) Rodrigo no tiene ningún tramo, aunque el local abra'
);

select test.ok(
  (select array_agg(to_char(desde at time zone 'Europe/Madrid', 'HH24:MI') || '-' || to_char(hasta at time zone 'Europe/Madrid', 'HH24:MI'))
     from app.tramos_efectivos(:clinica, :rodrigo, '2030-10-21')) = array['10:00-19:00']
  and (select array_agg(to_char(desde at time zone 'Europe/Madrid', 'HH24:MI') || '-' || to_char(hasta at time zone 'Europe/Madrid', 'HH24:MI'))
     from app.tramos_efectivos(:clinica, :rodrigo, '2030-10-24')) = array['10:00-14:00'],
  'el lunes trabaja como el local y el jueves con sus horas propias (PD-01 sigue igual)'
);

select test.ok(
  not exists (select 1 from public.available_slots(:clinica, :limpieza, '2030-10-25 00:00+02', '2030-10-26 00:00+02', :rodrigo))
  and exists (select 1 from public.available_slots(:clinica, :limpieza, '2030-10-25 00:00+02', '2030-10-26 00:00+02', :ana)),
  'available_slots: el viernes no ofrece a Rodrigo, sí a Ana'
);

select test.ok(
  (select bool_and(s.staff_id = :ana::uuid)
     from public.available_slots(:clinica, :limpieza, '2030-10-25 00:00+02', '2030-10-26 00:00+02') s),
  'available_slots sin profesional: el viernes solo salen huecos de Ana'
);

select test.ok(
  app.slot_es_valido(:clinica, :limpieza, :rodrigo, '2030-10-25 10:00 Europe/Madrid') = 'RA001'
  and app.slot_es_valido(:clinica, :limpieza, :rodrigo, '2030-10-25 10:15 Europe/Madrid', true) = 'RA001',
  'slot_es_valido: el viernes Rodrigo no vale, tampoco a mano (PI-14)'
);

select test.throws(
  format($q$select public.book_appointment(p_business_id => %L, p_service_id => %L, p_staff_id => %L,
                   p_customer_id => '11111111-1111-4111-8111-0000000000d1', p_start_at => '2030-10-25 10:00 Europe/Madrid')$q$,
         :clinica, :limpieza, :rodrigo),
  'RA001', 'book_appointment no reserva a Rodrigo el viernes'
);

select test.throws(
  format($q$select public.book_appointment(p_business_id => %L, p_service_id => %L, p_staff_id => %L,
                   p_customer_id => '11111111-1111-4111-8111-0000000000d1', p_start_at => '2030-10-25 10:15 Europe/Madrid',
                   p_origen => 'manual', p_manual => true)$q$,
         :clinica, :limpieza, :rodrigo),
  'RA001', 'tampoco una cita a mano (PI-14): no se salta el horario'
);

select test.ok(
  (select (public.book_appointment(p_business_id => :clinica, p_service_id => :limpieza, p_staff_id => null,
                                   p_customer_id => '11111111-1111-4111-8111-0000000000d1',
                                   p_start_at => '2030-10-25 12:00 Europe/Madrid')).staff_id) = :ana::uuid,
  'con asignación automática, el viernes se asigna a Ana'
);

-- Si por error un día tuviera horas propias y "no trabaja", gana "no trabaja".
insert into public.staff_dias_libres (business_id, staff_id, weekday) values (:clinica, :rodrigo, 4);
select test.ok(
  not exists (select 1 from app.tramos_efectivos(:clinica, :rodrigo, '2030-10-24')),
  'con horas propias y "no trabaja" el mismo día, gana "no trabaja"'
);
delete from public.staff_dias_libres where staff_id = :rodrigo and weekday = 4;

-- Única fuente de verdad (D-26): reserva y disponibilidad dicen lo mismo,
-- también el día que no trabaja (vacío) y con horas propias.
select test.ok(
  (select coalesce(array_agg(s.start_at order by s.start_at), '{}')
     from public.available_slots(:clinica, :limpieza, '2030-10-25 00:00+02', '2030-10-26 00:00+02', :rodrigo) s)
  = (select coalesce(array_agg(t order by t), '{}')
       from generate_series('2030-10-25 00:00:00+02'::timestamptz, '2030-10-25 23:55:00+02', interval '5 minutes') t
      where app.slot_es_valido(:clinica, :limpieza, :rodrigo, t) is null)
  and (select coalesce(array_agg(s.start_at order by s.start_at), '{}')
     from public.available_slots(:clinica, :limpieza, '2030-10-24 00:00+02', '2030-10-25 00:00+02', :rodrigo) s)
  = (select coalesce(array_agg(t order by t), '{}')
       from generate_series('2030-10-24 00:00:00+02'::timestamptz, '2030-10-24 23:55:00+02', interval '5 minutes') t
      where app.slot_es_valido(:clinica, :limpieza, :rodrigo, t) is null),
  'available_slots y slot_es_valido coinciden minuto a minuto el viernes (no trabaja) y el jueves (horas propias)'
);

select test.ok(
  (select count(*) from public.available_slots(:clinica, :limpieza, '2030-10-24 00:00+02', '2030-10-25 00:00+02', :rodrigo)) > 0,
  'el jueves sí hay huecos de Rodrigo (la comparación no es trivial)'
);

-- Borrar la profesional se lleva sus días libres.
delete from public.staff_services where staff_id = :rodrigo;
delete from public.appointments where staff_id = :rodrigo;
delete from public.staff where id = :rodrigo;
select test.ok(
  not exists (select 1 from public.staff_dias_libres where staff_id = :rodrigo::uuid),
  'al borrar una profesional se borran sus días libres'
);

select test.resumen();

rollback;
