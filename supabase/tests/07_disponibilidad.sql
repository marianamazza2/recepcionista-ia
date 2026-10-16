-- =============================================================================
-- Test 07 — Disponibilidad: available_slots (spec de fase 1.2, 1.5, 1.7)
-- =============================================================================
-- Una aserción por regla de decisiones-producto.md (PD-01, PD-02, PD-05,
-- PR-01, PR-02), más festivos, ausencias, filtro por servicio, canceladas,
-- cambio de hora y rango máximo.
--
-- Sobre el tiempo: nada de esto puede depender de la fecha de hoy. Todo usa
-- fechas fijas en octubre-noviembre de 2030, salvo la antelación, que se mide
-- contra now() con un negocio que abre las 24 horas.
--
-- El cambio de hora se prueba en 2030 y no en 2026 como sugiere el spec: el
-- 25/10/2026 está a pocos días y el test dejaría de funcionar en cuanto pase.
-- La situación es la misma: el domingo 27/10/2030 España pasa a horario de
-- invierno, entre los lunes 21/10 y 28/10.
--
-- Calendario del fixture (todo lunes salvo el martes 15/10):
--   lun 14/10  día base                 lun 28/10  después del cambio de hora
--   mar 15/10  horario propio de Berta  lun 04/11  margen tras una cita
--   mié 16/10  festivo del negocio      lun 11/11  cita cancelada
--   lun 21/10  ausencia de Alba, antes del cambio de hora
-- =============================================================================

\set ON_ERROR_STOP on

begin;
\ir _helpers.sql

\echo '07 — disponibilidad'

-- --- Fixture -----------------------------------------------------------------
insert into public.businesses (id, nombre, slug, timezone) values
  ('77777777-7777-4777-8777-000000000001', 'Test Disponibilidad', 'test-disponibilidad', 'Europe/Madrid');

insert into public.staff (id, business_id, nombre) values
  ('77777777-7777-4777-8777-00000000000a', '77777777-7777-4777-8777-000000000001', 'Alba'),
  ('77777777-7777-4777-8777-00000000000b', '77777777-7777-4777-8777-000000000001', 'Berta'),
  ('77777777-7777-4777-8777-00000000000c', '77777777-7777-4777-8777-000000000001', 'Carla');

insert into public.services (id, business_id, nombre, duracion_min, buffer_min) values
  -- 60 min + 15 de margen
  ('77777777-7777-4777-8777-0000000000f1', '77777777-7777-4777-8777-000000000001', 'Facial', 60, 15),
  ('77777777-7777-4777-8777-0000000000f2', '77777777-7777-4777-8777-000000000001', 'Cejas', 30, 0);

-- Alba y Berta hacen el facial; Carla solo cejas.
insert into public.staff_services (business_id, staff_id, service_id) values
  ('77777777-7777-4777-8777-000000000001', '77777777-7777-4777-8777-00000000000a', '77777777-7777-4777-8777-0000000000f1'),
  ('77777777-7777-4777-8777-000000000001', '77777777-7777-4777-8777-00000000000b', '77777777-7777-4777-8777-0000000000f1'),
  ('77777777-7777-4777-8777-000000000001', '77777777-7777-4777-8777-00000000000c', '77777777-7777-4777-8777-0000000000f2');

insert into public.business_hours (business_id, staff_id, weekday, hora_apertura, hora_cierre) values
  -- Lunes partido 9–14 / 16–20
  ('77777777-7777-4777-8777-000000000001', null, 1, '09:00', '14:00'),
  ('77777777-7777-4777-8777-000000000001', null, 1, '16:00', '20:00'),
  -- Martes 10–14 para el negocio…
  ('77777777-7777-4777-8777-000000000001', null, 2, '10:00', '14:00'),
  -- …pero Berta tiene horario propio el martes: solo de 16 a 19 (PD-01)
  ('77777777-7777-4777-8777-000000000001', '77777777-7777-4777-8777-00000000000b', 2, '16:00', '19:00'),
  -- Miércoles 9–14 (ese día es festivo)
  ('77777777-7777-4777-8777-000000000001', null, 3, '09:00', '14:00');

insert into public.time_off (business_id, staff_id, desde, hasta, motivo) values
  ('77777777-7777-4777-8777-000000000001', null,
   '2030-10-16 00:00:00+02', '2030-10-17 00:00:00+02', 'Festivo'),
  ('77777777-7777-4777-8777-000000000001', '77777777-7777-4777-8777-00000000000a',
   '2030-10-21 00:00:00+02', '2030-10-22 00:00:00+02', 'Ausencia de Alba');

insert into public.customers (id, business_id, telefono) values
  ('77777777-7777-4777-8777-00000000000d', '77777777-7777-4777-8777-000000000001', '+34670000001');

insert into public.appointments (business_id, staff_id, service_id, customer_id, start_at, end_at, estado) values
  -- Lun 04/11: Alba ocupada 10:00–11:00 (+15 de margen → libre desde las 11:15)
  ('77777777-7777-4777-8777-000000000001', '77777777-7777-4777-8777-00000000000a',
   '77777777-7777-4777-8777-0000000000f1', '77777777-7777-4777-8777-00000000000d',
   '2030-11-04 10:00:00+01', '2030-11-04 11:00:00+01', 'confirmada'),
  -- Lun 11/11: cita CANCELADA de Alba a las 10:00
  ('77777777-7777-4777-8777-000000000001', '77777777-7777-4777-8777-00000000000a',
   '77777777-7777-4777-8777-0000000000f1', '77777777-7777-4777-8777-00000000000d',
   '2030-11-11 10:00:00+01', '2030-11-11 11:00:00+01', 'cancelada');

-- Atajo: horas LOCALES ('HH24:MI') de los huecos de un día local para un
-- servicio y, opcionalmente, una profesional.
create function pg_temp.horas(p_dia date, p_staff uuid default null,
                              p_service uuid default '77777777-7777-4777-8777-0000000000f1')
returns text[] language sql stable as $$
  select coalesce(array_agg(to_char(s.start_at at time zone 'Europe/Madrid', 'HH24:MI')
                            order by s.start_at), '{}')
    from public.available_slots(
           '77777777-7777-4777-8777-000000000001', p_service,
           p_dia::timestamp       at time zone 'Europe/Madrid',
           (p_dia + 1)::timestamp at time zone 'Europe/Madrid',
           p_staff) s;
$$;

\set alba  '''77777777-7777-4777-8777-00000000000a'''
\set berta '''77777777-7777-4777-8777-00000000000b'''
\set carla '''77777777-7777-4777-8777-00000000000c'''

-- =============================================================================
-- Tramo partido y cierre (PR-02 de serie: el margen puede quedar fuera)
-- =============================================================================
-- 60 min de servicio, cada 30: por la mañana de 9:00 a 13:00, por la tarde de
-- 16:00 a 19:00. Nada en el descanso, y nada que no quepa antes del cierre.
select test.ok(
  pg_temp.horas('2030-10-14', :alba) = array[
    '09:00','09:30','10:00','10:30','11:00','11:30','12:00','12:30','13:00',
    '16:00','16:30','17:00','17:30','18:00','18:30','19:00'],
  'tramo partido: huecos solo dentro de los tramos, ninguno en el descanso del mediodía'
);

select test.ok(
  not ('13:30' = any (pg_temp.horas('2030-10-14', :alba))),
  'un servicio que no cabe al final del tramo (13:30 + 60 > 14:00) no se ofrece'
);

select test.ok(
  '13:00' = any (pg_temp.horas('2030-10-14', :alba))
  and '19:00' = any (pg_temp.horas('2030-10-14', :alba)),
  'PR-02 de serie: el último hueco termina al cierre y su margen queda fuera'
);

-- PR-02 con margen dentro del horario: servicio + margen (75 min) tienen que caber.
update public.businesses set margen_dentro_horario = true
 where id = '77777777-7777-4777-8777-000000000001';

select test.ok(
  (select max(h) filter (where h < '15:00') from unnest(pg_temp.horas('2030-10-14', :alba)) h) = '12:30'
  and (select max(h) from unnest(pg_temp.horas('2030-10-14', :alba)) h) = '18:30',
  'PR-02 con margen_dentro_horario: los últimos huecos son 12:30 y 18:30'
);

update public.businesses set margen_dentro_horario = false
 where id = '77777777-7777-4777-8777-000000000001';

-- =============================================================================
-- Intervalo (PR-01)
-- =============================================================================
select test.ok(
  (select array_agg(distinct substr(h, 4, 2) order by substr(h, 4, 2))
     from unnest(pg_temp.horas('2030-10-14')) h) = array['00', '30'],
  'intervalo de serie (30): los inicios caen en :00 y :30'
);

update public.businesses set intervalo_huecos_min = 15
 where id = '77777777-7777-4777-8777-000000000001';

select test.ok(
  (select array_agg(distinct substr(h, 4, 2) order by substr(h, 4, 2))
     from unnest(pg_temp.horas('2030-10-14')) h) = array['00', '15', '30', '45'],
  'intervalo 15: los inicios caen en :00, :15, :30 y :45'
);

update public.businesses set intervalo_huecos_min = 30
 where id = '77777777-7777-4777-8777-000000000001';

-- =============================================================================
-- Orden y filtro por profesional
-- =============================================================================
select test.ok(
  (select array_agg(s.staff_id::text || '@' || to_char(s.start_at at time zone 'Europe/Madrid', 'HH24:MI'))
     from public.available_slots(
            '77777777-7777-4777-8777-000000000001',
            '77777777-7777-4777-8777-0000000000f1',
            '2030-10-14 09:00:00+02', '2030-10-14 10:00:00+02') s)
    = array[:alba || '@09:00', :berta || '@09:00', :alba || '@09:30', :berta || '@09:30'],
  'un registro por profesional y hueco, por inicio y luego por profesional (orden estable)'
);

select test.ok(
  pg_temp.horas('2030-10-14', :berta) = pg_temp.horas('2030-10-14', :alba)
  and (select bool_and(s.staff_id = :berta)
         from public.available_slots(
                '77777777-7777-4777-8777-000000000001',
                '77777777-7777-4777-8777-0000000000f1',
                '2030-10-14 00:00:00+02', '2030-10-15 00:00:00+02', :berta) s),
  'con p_staff_id solo salen los huecos de esa profesional'
);

select test.ok(
  (select (s.end_at - s.start_at) = interval '60 minutes'
     from public.available_slots(
            '77777777-7777-4777-8777-000000000001',
            '77777777-7777-4777-8777-0000000000f1',
            '2030-10-14 00:00:00+02', '2030-10-15 00:00:00+02') s
    limit 1),
  'end_at es el fin del servicio, sin el margen'
);

-- =============================================================================
-- Filtro por servicio
-- =============================================================================
select test.ok(
  pg_temp.horas('2030-10-14', :carla) = '{}'
  and not exists (
    select 1 from public.available_slots(
                    '77777777-7777-4777-8777-000000000001',
                    '77777777-7777-4777-8777-0000000000f1',
                    '2030-10-14 00:00:00+02', '2030-10-15 00:00:00+02') s
     where s.staff_id = :carla),
  'quien no hace el servicio no aparece aunque esté libre'
);

select test.ok(
  cardinality(pg_temp.horas('2030-10-14', :carla, '77777777-7777-4777-8777-0000000000f2')) > 0,
  'y sí aparece para el servicio que hace'
);

-- =============================================================================
-- Festivos y ausencias
-- =============================================================================
select test.ok(
  pg_temp.horas('2030-10-16') = '{}',
  'festivo del negocio: ningún hueco ese día'
);

select test.ok(
  pg_temp.horas('2030-10-21', :alba) = '{}'
  and cardinality(pg_temp.horas('2030-10-21', :berta)) = 16,
  'ausencia de una profesional: ella no tiene huecos, la otra sí'
);

-- =============================================================================
-- PD-01: el horario propio reemplaza al del local
-- =============================================================================
select test.ok(
  pg_temp.horas('2030-10-15', :berta) = array['16:00','16:30','17:00','17:30','18:00'],
  'PD-01: con horario propio, Berta solo aparece en su tramo (16–19) y no en el del local'
);

select test.ok(
  pg_temp.horas('2030-10-15', :alba) = array['10:00','10:30','11:00','11:30','12:00','12:30','13:00'],
  'PD-01: sin horario propio ese día, Alba hereda el del local (10–14)'
);

select test.ok(
  pg_temp.horas('2030-10-14', :berta) = pg_temp.horas('2030-10-14', :alba),
  'PD-01: el horario propio del martes no afecta al lunes de Berta'
);

-- =============================================================================
-- Margen (PD-02)
-- =============================================================================
-- Alba tiene cita el 04/11 de 10:00 a 11:00 con 15 de margen.
update public.businesses set intervalo_huecos_min = 15
 where id = '77777777-7777-4777-8777-000000000001';

select test.ok(
  (select min(h) from unnest(pg_temp.horas('2030-11-04', :alba)) h where h >= '10:00') = '11:15',
  'margen con intervalo 15: tras una cita de 60 + 15, el siguiente hueco empieza a los 75 min'
);

update public.businesses set intervalo_huecos_min = 30
 where id = '77777777-7777-4777-8777-000000000001';

select test.ok(
  (select min(h) from unnest(pg_temp.horas('2030-11-04', :alba)) h where h >= '10:00') = '11:30',
  'margen con intervalo 30: el siguiente hueco empieza a los 90 min'
);

-- 09:00 + 60 termina justo a las 10:00, pero su propio margen pisaría la cita.
select test.ok(
  not ('09:00' = any (pg_temp.horas('2030-11-04', :alba)))
  and '09:00' = any (pg_temp.horas('2030-11-04', :berta)),
  'el hueco nuevo también necesita su propio margen libre antes de la cita siguiente'
);

-- =============================================================================
-- Canceladas
-- =============================================================================
select test.ok(
  '10:00' = any (pg_temp.horas('2030-11-11', :alba)),
  'una cita cancelada no bloquea su hueco'
);

-- =============================================================================
-- Cambio de hora (T-01)
-- =============================================================================
-- Berta abre a las 9:00 locales los dos lunes. Antes del cambio es CEST (+02),
-- después CET (+01): el mismo 9:00 son instantes UTC distintos.
select test.ok(
  (select min(s.start_at) from public.available_slots(
            '77777777-7777-4777-8777-000000000001',
            '77777777-7777-4777-8777-0000000000f1',
            '2030-10-21 00:00:00+00', '2030-10-22 00:00:00+00', :berta) s)
    = '2030-10-21 07:00:00+00'::timestamptz,
  'cambio de hora: el lunes 21/10/2030 a las 9:00 locales son las 07:00 UTC'
);

select test.ok(
  (select min(s.start_at) from public.available_slots(
            '77777777-7777-4777-8777-000000000001',
            '77777777-7777-4777-8777-0000000000f1',
            '2030-10-28 00:00:00+00', '2030-10-29 00:00:00+00', :berta) s)
    = '2030-10-28 08:00:00+00'::timestamptz,
  'cambio de hora: el lunes 28/10/2030 a las 9:00 locales son las 08:00 UTC'
);

-- Una semana que cruza el cambio: todos los huecos siguen en hora local redonda.
select test.ok(
  (select bool_and(to_char(s.start_at at time zone 'Europe/Madrid', 'MI') in ('00', '30')
                   and (s.start_at at time zone 'Europe/Madrid')::time >= '09:00')
     from public.available_slots(
            '77777777-7777-4777-8777-000000000001',
            '77777777-7777-4777-8777-0000000000f1',
            '2030-10-21 00:00:00+02', '2030-10-29 00:00:00+01') s),
  'cambio de hora: en una semana que lo cruza, los huecos siguen en la rejilla local'
);

-- =============================================================================
-- Rango
-- =============================================================================
select test.throws(
  $q$select * from public.available_slots(
       '77777777-7777-4777-8777-000000000001',
       '77777777-7777-4777-8777-0000000000f1',
       '2030-10-01 00:00:00+02', '2030-12-01 00:00:00+01')$q$,
  '22023', 'rango demasiado grande (más de 31 días): error claro'
);

select test.throws(
  $q$select * from public.available_slots(
       '77777777-7777-4777-8777-000000000001',
       '77777777-7777-4777-8777-0000000000f1',
       '2030-10-15 00:00:00+02', '2030-10-14 00:00:00+02')$q$,
  '22023', 'rango al revés: error claro'
);

select test.succeeds(
  $q$select * from public.available_slots(
       '77777777-7777-4777-8777-000000000001',
       '77777777-7777-4777-8777-0000000000f1',
       '2030-10-01 00:00:00+02', '2030-10-31 23:00:00+01')$q$,
  'un mes entero se puede pedir'
);

-- =============================================================================
-- Antelación (PD-05) — relativa a now()
-- =============================================================================
-- Negocio que abre las 24 horas todos los días: así siempre hay huecos cerca de
-- "ahora", sea la hora que sea cuando corre el test.
insert into public.businesses (id, nombre, slug, timezone) values
  ('77777777-7777-4777-8777-000000000002', 'Test 24 horas', 'test-24-horas', 'Europe/Madrid');
insert into public.staff (id, business_id, nombre) values
  ('77777777-7777-4777-8777-0000000000aa', '77777777-7777-4777-8777-000000000002', 'Guardia');
insert into public.services (id, business_id, nombre, duracion_min) values
  ('77777777-7777-4777-8777-0000000000ff', '77777777-7777-4777-8777-000000000002', 'Express', 30);
insert into public.staff_services (business_id, staff_id, service_id) values
  ('77777777-7777-4777-8777-000000000002', '77777777-7777-4777-8777-0000000000aa', '77777777-7777-4777-8777-0000000000ff');
insert into public.business_hours (business_id, weekday, hora_apertura, hora_cierre)
  select '77777777-7777-4777-8777-000000000002', d, '00:00', '24:00' from generate_series(0, 6) d;

select test.ok(
  (select min(s.start_at) from public.available_slots(
            '77777777-7777-4777-8777-000000000002', '77777777-7777-4777-8777-0000000000ff',
            now() - interval '1 day', now() + interval '1 day') s)
    between now() + interval '2 hours' and now() + interval '2 hours 30 minutes',
  'antelación de serie (2 h): nada antes de now() + 2 h, y el primer hueco es el siguiente de la rejilla'
);

update public.businesses set antelacion_min_horas = 5
 where id = '77777777-7777-4777-8777-000000000002';

select test.ok(
  (select min(s.start_at) from public.available_slots(
            '77777777-7777-4777-8777-000000000002', '77777777-7777-4777-8777-0000000000ff',
            now() - interval '1 day', now() + interval '1 day') s)
    >= now() + interval '5 hours',
  'antelación configurable: con 5 h no aparece nada antes de now() + 5 h'
);

select test.resumen();
rollback;
