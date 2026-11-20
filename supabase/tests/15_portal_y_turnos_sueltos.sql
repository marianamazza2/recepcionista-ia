-- =============================================================================
-- Test 15 — Portal del cliente y turnos sueltos (Fase 9: PC-02, PC-06, PC-14)
-- =============================================================================
-- Dos mitades:
--
--   · Turnos sueltos (PC-06). El caso de Mariana: Núria trabaja el festivo
--     del 8 de diciembre de 10:00 a 14:00. Ese día la agenda se abre solo
--     para ella y solo esas horas; el resto del equipo sigue cerrado, y su
--     propia ausencia la cierra igual. También: un turno suelto un día que
--     normalmente no trabaja, y que al borrarlo el día vuelve a estar
--     cerrado. available_slots y slot_es_valido tienen que decir lo mismo
--     (D-26).
--   · Las tablas del portal (PC-02, PC-11): que existan, que su email esté
--     en minúsculas, que un email no sea de dos negocios, que todo se vaya
--     en cascada con el negocio y que tengan RLS (sin política, como
--     panel.personas: solo el servidor las lee).
--
-- Y PC-14: conversations.alta existe y es false de serie.
-- =============================================================================

\set ON_ERROR_STOP on

begin;
\ir _helpers.sql

\echo '15 — portal del cliente y turnos sueltos'

-- --- Fixture -------------------------------------------------------------------
-- Clínica que abre de lunes a viernes de 09:00 a 18:00. Núria y Olga hacen
-- "Peeling" (30 min, sin margen). El 8 de diciembre de 2030 es domingo, así
-- que el local ya está cerrado ese día; además se carga como festivo del
-- local, que es el caso que describe PC-06.
\set clinica  '\'15151515-1515-4515-8515-000000000001\''
\set otra     '\'15151515-1515-4515-8515-000000000002\''
\set nuria    '\'15151515-1515-4515-8515-0000000000a1\''
\set olga     '\'15151515-1515-4515-8515-0000000000a2\''
\set peeling  '\'15151515-1515-4515-8515-0000000000c1\''
\set paciente '\'15151515-1515-4515-8515-0000000000d1\''

insert into public.businesses (id, nombre, slug, timezone, antelacion_min_horas) values
  (:clinica, 'Clínica Sueltos', 'test-turnos-sueltos', 'Europe/Madrid', 0),
  (:otra, 'Otra Sueltos', 'test-turnos-sueltos-otra', 'Europe/Madrid', 0);
insert into public.staff (id, business_id, nombre) values
  (:nuria, :clinica, 'Núria'),
  (:olga, :clinica, 'Olga');
insert into public.services (id, business_id, nombre, duracion_min, buffer_min) values
  (:peeling, :clinica, 'Peeling', 30, 0);
insert into public.staff_services (business_id, staff_id, service_id) values
  (:clinica, :nuria, :peeling),
  (:clinica, :olga, :peeling);
insert into public.business_hours (business_id, staff_id, weekday, hora_apertura, hora_cierre)
  select :clinica::uuid, null::uuid, d, '09:00'::time, '18:00'::time from generate_series(1, 5) d;
insert into public.customers (id, business_id, telefono, nombre) values
  (:paciente, :clinica, '+34611150001', 'Paciente');
-- Festivo del local: el domingo 8 de diciembre de 2030, día entero.
insert into public.time_off (business_id, staff_id, desde, hasta, motivo) values
  (:clinica, null,
   ('2030-12-08'::date)::timestamp at time zone 'Europe/Madrid',
   ('2030-12-09'::date)::timestamp at time zone 'Europe/Madrid',
   'Festivo del local');

-- =============================================================================
-- La tabla de turnos sueltos
-- =============================================================================
select test.succeeds(
  format($q$insert into public.staff_turnos_sueltos (business_id, staff_id, fecha, hora_apertura, hora_cierre, motivo)
            values (%L, %L, '2030-12-08', '10:00', '14:00', 'Puente')$q$, :clinica, :nuria),
  'PC-06: Núria trabaja el festivo del 8 de diciembre de 10 a 14'
);

select test.throws(
  format($q$insert into public.staff_turnos_sueltos (business_id, staff_id, fecha, hora_apertura, hora_cierre)
            values (%L, %L, '2030-12-08', '13:00', '16:00')$q$, :clinica, :nuria),
  '23P01', 'dos turnos sueltos del mismo día no se pisan'
);

select test.succeeds(
  format($q$insert into public.staff_turnos_sueltos (business_id, staff_id, fecha, hora_apertura, hora_cierre)
            values (%L, %L, '2030-12-08', '14:00', '16:00')$q$, :clinica, :nuria),
  'dos turnos sueltos contiguos sí valen'
);
delete from public.staff_turnos_sueltos where fecha = '2030-12-08' and hora_apertura = '14:00';

select test.throws(
  format($q$insert into public.staff_turnos_sueltos (business_id, staff_id, fecha, hora_apertura, hora_cierre)
            values (%L, %L, '2030-12-08', '15:00', '12:00')$q$, :clinica, :nuria),
  '23514', 'el cierre tiene que ser posterior a la apertura'
);

-- La FK compuesta (D-02) impide cruzar negocios.
select test.throws(
  format($q$insert into public.staff_turnos_sueltos (business_id, staff_id, fecha, hora_apertura, hora_cierre)
            values (%L, %L, '2030-12-09', '10:00', '12:00')$q$, :otra, :nuria),
  '23503', 'una profesional de otro negocio no puede tener un turno suelto aquí'
);

-- =============================================================================
-- El motor: el turno suelto abre el festivo del local solo para ella
-- =============================================================================
select test.ok(
  (select count(*) = 1 from app.tramos_efectivos(:clinica, :nuria, '2030-12-08') where suelto),
  'PC-06: el 8 de diciembre Núria tiene su turno suelto y nada más'
);

select test.ok(
  (select count(*) = 0 from app.tramos_efectivos(:clinica, :olga, '2030-12-08')),
  'PC-06: ese día Olga no tiene ningún tramo (domingo, y el local cierra)'
);

select test.ok(
  app.slot_es_valido(:clinica, :peeling, :nuria,
    ('2030-12-08 10:00'::timestamp at time zone 'Europe/Madrid')) is null,
  'PC-06: las 10:00 del festivo son un hueco válido para Núria'
);

select test.ok(
  app.slot_es_valido(:clinica, :peeling, :nuria,
    ('2030-12-08 14:30'::timestamp at time zone 'Europe/Madrid')) = 'RA001',
  'PC-06: fuera de las horas del turno suelto, no (RA001)'
);

select test.ok(
  app.slot_es_valido(:clinica, :peeling, :olga,
    ('2030-12-08 10:00'::timestamp at time zone 'Europe/Madrid')) = 'RA001',
  'PC-06: ese día Olga sigue cerrada'
);

-- available_slots dice lo mismo (D-26): solo Núria y solo de 10 a 14.
select test.ok(
  (select count(*) = 8 from public.available_slots(:clinica, :peeling,
     ('2030-12-08 00:00'::timestamp at time zone 'Europe/Madrid'),
     ('2030-12-09 00:00'::timestamp at time zone 'Europe/Madrid'))),
  'PC-06: available_slots ofrece 8 huecos de 30 min ese día'
);

select test.ok(
  (select bool_and(staff_id = :nuria::uuid) from public.available_slots(:clinica, :peeling,
     ('2030-12-08 00:00'::timestamp at time zone 'Europe/Madrid'),
     ('2030-12-09 00:00'::timestamp at time zone 'Europe/Madrid'))),
  'PC-06: todos son de Núria'
);

-- Su propia ausencia sí la cierra, aunque tenga turno suelto.
insert into public.time_off (business_id, staff_id, desde, hasta, motivo) values
  (:clinica, :nuria,
   ('2030-12-08 10:00'::timestamp at time zone 'Europe/Madrid'),
   ('2030-12-08 11:00'::timestamp at time zone 'Europe/Madrid'),
   'Médico');

select test.ok(
  app.slot_es_valido(:clinica, :peeling, :nuria,
    ('2030-12-08 10:00'::timestamp at time zone 'Europe/Madrid')) = 'RA002',
  'PC-06: la ausencia propia de Núria sí cierra esas horas (RA002)'
);

select test.ok(
  app.slot_es_valido(:clinica, :peeling, :nuria,
    ('2030-12-08 11:00'::timestamp at time zone 'Europe/Madrid')) is null,
  'PC-06: pasada su ausencia, el turno suelto sigue abierto'
);

delete from public.time_off where staff_id = :nuria::uuid;

-- La reserva de verdad entra por ese hueco.
select test.succeeds(
  format($q$select public.book_appointment(%L, %L, %L, %L,
            ('2030-12-08 11:00'::timestamp at time zone 'Europe/Madrid'))$q$,
          :clinica, :peeling, :nuria, :paciente),
  'PC-06: se puede reservar en el turno suelto'
);

-- Un turno suelto un día que normalmente no trabaja (PI-19) manda igual.
insert into public.staff_dias_libres (business_id, staff_id, weekday) values (:clinica, :olga, 3);
select test.ok(
  (select count(*) = 0 from app.tramos_efectivos(:clinica, :olga, '2030-12-11')),
  'PI-19: el miércoles 11 Olga no trabaja'
);
insert into public.staff_turnos_sueltos (business_id, staff_id, fecha, hora_apertura, hora_cierre)
  values (:clinica, :olga, '2030-12-11', '16:00', '18:00');
select test.ok(
  (select count(*) = 1 and bool_and(suelto) from app.tramos_efectivos(:clinica, :olga, '2030-12-11')),
  'PC-06: el turno suelto manda sobre "no trabaja" ese día'
);
select test.ok(
  app.slot_es_valido(:clinica, :peeling, :olga,
    ('2030-12-11 09:00'::timestamp at time zone 'Europe/Madrid')) = 'RA001',
  'PC-06: y solo esas horas: a las 9:00 sigue cerrada aunque el local abra'
);

-- Borrarlo devuelve el día a como estaba.
delete from public.staff_turnos_sueltos where staff_id = :olga::uuid and fecha = '2030-12-11';
select test.ok(
  (select count(*) = 0 from app.tramos_efectivos(:clinica, :olga, '2030-12-11')),
  'PC-06: al borrar el turno suelto, ese día vuelve a estar cerrado'
);

-- Un día normal no cambia nada (el turno suelto no se "contagia").
select test.ok(
  (select count(*) = 1 and bool_and(not suelto) from app.tramos_efectivos(:clinica, :nuria, '2030-12-09')),
  'PD-01: el lunes 9 Núria sigue con el horario del local'
);

-- =============================================================================
-- Las tablas del portal (PC-02, PC-11)
-- =============================================================================
select test.succeeds(
  format($q$insert into portal.invitaciones (business_id, email, token_hash, expira_at)
            values (%L, 'contacto@clinicasueltos.test', 'hash-1', now() + interval '7 days')$q$, :clinica),
  'PC-02: una invitación para ese negocio y ese email'
);

select test.throws(
  format($q$insert into portal.invitaciones (business_id, email, token_hash, expira_at)
            values (%L, 'Contacto@Clinicasueltos.test', 'hash-2', now() + interval '7 days')$q$, :clinica),
  '23514', 'el email de la invitación va en minúsculas'
);

select test.throws(
  format($q$insert into portal.invitaciones (business_id, email, token_hash, expira_at)
            values (%L, 'otro@clinicasueltos.test', 'hash-1', now() + interval '7 days')$q$, :otra),
  '23505', 'el hash de un token no se repite'
);

select test.succeeds(
  format($q$insert into portal.cuentas (business_id, email, password_hash)
            values (%L, 'contacto@clinicasueltos.test', 'scrypt$x')$q$, :clinica),
  'PC-11: la cuenta queda ligada a su negocio'
);

select test.throws(
  format($q$insert into portal.cuentas (business_id, email, password_hash)
            values (%L, 'contacto@clinicasueltos.test', 'scrypt$y')$q$, :otra),
  '23505', 'un email no puede ser cuenta de dos negocios'
);

select test.succeeds(
  format($q$insert into portal.alta (business_id, seccion) values (%L, 2)$q$, :clinica),
  'PC-03: el alta guarda por qué sección va'
);

select test.throws(
  format($q$insert into portal.alta (business_id, seccion) values (%L, 11)$q$, :otra),
  '23514', 'la sección va de 0 a 9'
);

select test.throws(
  format($q$update portal.alta set revisada_at = now() where business_id = %L$q$, :clinica),
  '23514', 'PC-13: no se puede marcar revisada un alta sin terminar'
);

-- RLS: activo y sin política (como panel.personas). Nadie que no sea el
-- servidor (BYPASSRLS) ve nada, ni siquiera declarando el tenant.
select test.ok(
  (select bool_and(c.relrowsecurity)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'portal' and c.relkind = 'r'),
  'todas las tablas de portal tienen RLS activo'
);

select test.ok(
  (select count(*) = 0 from pg_policies where schemaname = 'portal'),
  'y ninguna política: solo el servidor las lee'
);

select test.ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'staff_turnos_sueltos'),
  'staff_turnos_sueltos tiene RLS'
);

select test.ok(
  (select count(*) = 1 from pg_policies
    where schemaname = 'public' and tablename = 'staff_turnos_sueltos' and policyname = 'tenant_isolation'),
  'y su política de tenant'
);

-- PC-14: la conversación del alta se marca y de serie no lo es.
insert into public.conversations (id, business_id, canal, alta)
  values ('15151515-1515-4515-8515-0000000000e1', :clinica, 'web', true);
insert into public.conversations (id, business_id, canal)
  values ('15151515-1515-4515-8515-0000000000e2', :clinica, 'web');
select test.ok(
  (select count(*) = 1 from public.conversations where business_id = :clinica::uuid and alta),
  'PC-14: la conversación del alta va marcada, y una normal no'
);

-- Todo se va con el negocio (cascada, D-03).
delete from public.businesses where id = :clinica::uuid;
select test.ok(
  (select count(*) = 0 from portal.invitaciones where business_id = :clinica::uuid)
  and (select count(*) = 0 from portal.cuentas where business_id = :clinica::uuid)
  and (select count(*) = 0 from portal.alta where business_id = :clinica::uuid)
  and (select count(*) = 0 from public.staff_turnos_sueltos where business_id = :clinica::uuid),
  'al borrar el negocio se va su portal y sus turnos sueltos'
);

select test.resumen();
rollback;
