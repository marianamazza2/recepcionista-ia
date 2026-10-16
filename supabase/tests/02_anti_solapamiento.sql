-- =============================================================================
-- Test 02 — ANTI-SOLAPAMIENTO (spec de fase 0.7.1 y 0.7.2) · el test estrella
-- =============================================================================
-- Es la garantía comercial del producto: dos citas del mismo profesional no
-- pueden pisarse. Si este test se pone en rojo, el producto está roto.
--
-- El test monta su propio negocio y hace ROLLBACK al final: no depende de los
-- seeds ni los ensucia.
-- =============================================================================

\set ON_ERROR_STOP on

begin;
\ir _helpers.sql

\echo '02 — anti-solapamiento'

-- --- Fixture -----------------------------------------------------------------
insert into public.businesses (id, nombre, slug) values
  ('11111111-1111-4111-8111-000000000001', 'Test Solapamiento', 'test-solapamiento');

insert into public.staff (id, business_id, nombre) values
  ('11111111-1111-4111-8111-00000000000a', '11111111-1111-4111-8111-000000000001', 'Profesional A'),
  ('11111111-1111-4111-8111-00000000000b', '11111111-1111-4111-8111-000000000001', 'Profesional B');

insert into public.services (id, business_id, nombre, duracion_min) values
  ('11111111-1111-4111-8111-00000000000c', '11111111-1111-4111-8111-000000000001', 'Servicio de 60', 60);

insert into public.customers (id, business_id, telefono, nombre) values
  ('11111111-1111-4111-8111-00000000000d', '11111111-1111-4111-8111-000000000001', '+34600000001', 'Cliente Test'),
  -- PR-08: una clienta no puede tener dos citas a la vez, así que las citas a
  -- la misma hora con otra profesional son de otra clienta.
  ('11111111-1111-4111-8111-00000000000e', '11111111-1111-4111-8111-000000000001', '+34600000002', 'Otra clienta');

-- Atajo para no repetir las columnas fijas en cada aserción.
create function pg_temp.cita(
  p_id text, p_staff text, p_desde text, p_hasta text, p_estado text default 'confirmada',
  p_cliente text default '11111111-1111-4111-8111-00000000000d'
) returns text language sql immutable as $$
  select format(
    $q$insert into public.appointments
         (id, business_id, staff_id, service_id, customer_id, start_at, end_at, estado)
       values (%L, '11111111-1111-4111-8111-000000000001', %L,
               '11111111-1111-4111-8111-00000000000c',
               %L, %L, %L, %L)$q$,
    p_id, p_staff, p_cliente, p_desde, p_hasta, p_estado
  );
$$;

-- =============================================================================
-- 1. Hueco libre → debe pasar
-- =============================================================================
select test.succeeds(
  pg_temp.cita('11111111-1111-4111-8111-0000000000f1',
               '11111111-1111-4111-8111-00000000000a',
               '2026-09-14 10:00:00+02', '2026-09-14 11:00:00+02'),
  'cita en hueco libre: se inserta'
);

-- =============================================================================
-- 2. Todas las formas de pisarse con el MISMO profesional → deben fallar
--    (SQLSTATE 23P01 = exclusion_violation)
-- =============================================================================
select test.throws(
  pg_temp.cita('11111111-1111-4111-8111-0000000000f2',
               '11111111-1111-4111-8111-00000000000a',
               '2026-09-14 10:30:00+02', '2026-09-14 11:30:00+02'),
  '23P01', 'solape parcial por el final: rechazado'
);

select test.throws(
  pg_temp.cita('11111111-1111-4111-8111-0000000000f3',
               '11111111-1111-4111-8111-00000000000a',
               '2026-09-14 09:30:00+02', '2026-09-14 10:30:00+02'),
  '23P01', 'solape parcial por el principio: rechazado'
);

select test.throws(
  pg_temp.cita('11111111-1111-4111-8111-0000000000f4',
               '11111111-1111-4111-8111-00000000000a',
               '2026-09-14 10:00:00+02', '2026-09-14 11:00:00+02'),
  '23P01', 'mismo rango exacto: rechazado'
);

select test.throws(
  pg_temp.cita('11111111-1111-4111-8111-0000000000f5',
               '11111111-1111-4111-8111-00000000000a',
               '2026-09-14 10:15:00+02', '2026-09-14 10:45:00+02'),
  '23P01', 'cita contenida dentro de otra: rechazada'
);

select test.throws(
  pg_temp.cita('11111111-1111-4111-8111-0000000000f6',
               '11111111-1111-4111-8111-00000000000a',
               '2026-09-14 09:00:00+02', '2026-09-14 12:00:00+02'),
  '23P01', 'cita que engloba a otra: rechazada'
);

-- =============================================================================
-- 3. Citas pegadas, sin pisarse → deben pasar
--    El rango es '[)': el final de una es el principio de la siguiente.
-- =============================================================================
select test.succeeds(
  pg_temp.cita('11111111-1111-4111-8111-0000000000f7',
               '11111111-1111-4111-8111-00000000000a',
               '2026-09-14 11:00:00+02', '2026-09-14 12:00:00+02'),
  'cita pegada justo al final de la anterior: se inserta'
);

-- =============================================================================
-- 4. Mismo horario, PROFESIONAL DISTINTO → conviven (spec 0.7.2)
-- =============================================================================
select test.succeeds(
  pg_temp.cita('11111111-1111-4111-8111-0000000000f8',
               '11111111-1111-4111-8111-00000000000b',
               '2026-09-14 10:00:00+02', '2026-09-14 11:00:00+02',
               p_cliente => '11111111-1111-4111-8111-00000000000e'),
  'misma hora con otro profesional (y otra clienta): convive, no es solape'
);

-- PR-08 (no_overlap_cliente): la MISMA clienta a la misma hora con otra
-- profesional no puede: una persona no está en dos cabinas a la vez.
select test.throws(
  pg_temp.cita('11111111-1111-4111-8111-0000000000e1',
               '11111111-1111-4111-8111-00000000000b',
               '2026-09-14 10:30:00+02', '2026-09-14 11:30:00+02'),
  '23P01', 'misma clienta, otra profesional, horarios que se pisan: rechazado (no_overlap_cliente)'
);

-- Acotado al negocio del test: los seeds también tienen citas ese mismo lunes.
select test.ok(
  (select count(*) from public.appointments
    where business_id = '11111111-1111-4111-8111-000000000001'
      and start_at = '2026-09-14 10:00:00+02'
      and estado <> 'cancelada') = 2,
  'quedan 2 citas simultáneas, una por profesional'
);

-- =============================================================================
-- 5. Las CANCELADAS no ocupan hueco (spec 0.7.1, tercer caso)
-- =============================================================================
select test.succeeds(
  pg_temp.cita('11111111-1111-4111-8111-0000000000f9',
               '11111111-1111-4111-8111-00000000000a',
               '2026-09-14 10:30:00+02', '2026-09-14 11:30:00+02', 'cancelada'),
  'cita CANCELADA sobre un hueco ocupado: se inserta'
);

-- Y no se puede resucitar una cancelada si mientras tanto el hueco se llenó:
-- la restricción también actúa en el UPDATE, no solo en el INSERT.
select test.throws(
  $q$update public.appointments set estado = 'confirmada'
      where id = '11111111-1111-4111-8111-0000000000f9'$q$,
  '23P01', 'reactivar una cancelada sobre un hueco ocupado: rechazado'
);

-- Al revés: si se cancela la que ocupaba, su hueco vuelve a estar libre.
select test.succeeds(
  $q$update public.appointments set estado = 'cancelada'
      where id = '11111111-1111-4111-8111-0000000000f1'$q$,
  'cancelar la cita de las 10:00 funciona'
);

select test.succeeds(
  pg_temp.cita('11111111-1111-4111-8111-0000000000fa',
               '11111111-1111-4111-8111-00000000000a',
               '2026-09-14 10:15:00+02', '2026-09-14 11:00:00+02'),
  'cita nueva encima de una cancelada: se inserta'
);

-- =============================================================================
-- 6. Rango inválido → lo corta el CHECK, no la exclusión
-- =============================================================================
select test.throws(
  pg_temp.cita('11111111-1111-4111-8111-0000000000fb',
               '11111111-1111-4111-8111-00000000000b',
               '2026-09-14 15:00:00+02', '2026-09-14 14:00:00+02'),
  '23514', 'cita que termina antes de empezar: rechazada'
);

select test.resumen();
rollback;
