-- =============================================================================
-- Test 06 — Seeds del negocio de prueba (spec de fase 0.6 · DoD punto 4)
-- =============================================================================
-- A diferencia de los otros, este test SÍ mira los datos cargados por
-- supabase/seed.sql. Sirve para dos cosas: comprobar que el reset dejó el
-- negocio de prueba listo, y que las fases siguientes pueden confiar en esos
-- UUID fijos.
-- =============================================================================

\set ON_ERROR_STOP on

begin;
\ir _helpers.sql

\echo '06 — seeds: Estética Aurora'

\set aurora '''a0000000-0000-4000-8000-000000000001'''

-- --- El negocio --------------------------------------------------------------
select test.ok(
  exists (
    select 1 from public.businesses
     where id = :aurora
       and nombre = 'Estética Aurora'
       and slug = 'estetica-aurora'
       and timezone = 'Europe/Madrid'
       and estado = 'activo'
  ),
  'existe Estética Aurora, activa y en Europe/Madrid'
);

select test.ok(
  (select politica_cancelacion is not null
      and mensaje_bienvenida  is not null
      and tono_de_voz         is not null
      and direccion           is not null
     from public.businesses where id = :aurora),
  'la config que va al system prompt está completa (maestro §8)'
);

-- --- Servicios ---------------------------------------------------------------
select test.ok(
  (select count(*) from public.services where business_id = :aurora) = 4,
  'tiene 4 servicios'
);

select test.ok(
  (select count(distinct duracion_min) from public.services where business_id = :aurora) = 4,
  'los 4 servicios tienen duraciones distintas'
);

select test.ok(
  (select bool_and(duracion_min > 0 and buffer_min >= 0 and precio >= 0)
     from public.services where business_id = :aurora),
  'todos los servicios tienen duración, buffer y precio coherentes'
);

-- --- Profesionales -----------------------------------------------------------
select test.ok(
  (select count(*) from public.staff where business_id = :aurora and activo) = 2,
  'tiene 2 profesionales activos'
);

select test.ok(
  (select array_agg(nombre order by nombre) from public.staff where business_id = :aurora)
    = array['Lucía', 'Marta'],
  'los profesionales son Marta y Lucía'
);

-- Ningún servicio puede quedar huérfano: si nadie lo presta, el agente no
-- podría reservarlo nunca.
select test.ok(
  not exists (
    select 1 from public.services s
     where s.business_id = :aurora
       and not exists (select 1 from public.staff_services ss where ss.service_id = s.id)
  ),
  'todos los servicios los presta al menos un profesional'
);

select test.ok(
  (select count(*) from public.staff_services where business_id = :aurora) = 6,
  'la matriz staff_services tiene 6 relaciones'
);

-- --- Horarios ----------------------------------------------------------------
select test.ok(
  (select array_agg(distinct weekday order by weekday)
     from public.business_hours where business_id = :aurora)
    = array[1, 2, 3, 4, 5]::smallint[],
  'abre de lunes a viernes, y no abre fin de semana'
);

select test.ok(
  (select count(*) from public.business_hours where business_id = :aurora) = 9,
  'hay 9 tramos horarios (partido de lunes a jueves, continuo el viernes)'
);

-- El viernes es el día distinto: jornada continua, un solo tramo.
select test.ok(
  (select count(*) from public.business_hours where business_id = :aurora and weekday = 5) = 1,
  'el viernes tiene jornada continua (un único tramo)'
);

select test.ok(
  (select min(hora_apertura) from public.business_hours where business_id = :aurora and weekday = 4)
    = '10:00'::time,
  'el jueves abre más tarde que el resto'
);

-- --- Festivos y bloqueos -----------------------------------------------------
select test.ok(
  (select count(*) from public.time_off where business_id = :aurora) = 3,
  'hay 3 bloqueos cargados'
);

select test.ok(
  exists (select 1 from public.time_off where business_id = :aurora and staff_id is null),
  'hay al menos un festivo que cierra el negocio entero'
);

select test.ok(
  exists (select 1 from public.time_off where business_id = :aurora and staff_id is not null),
  'hay al menos una ausencia de un profesional concreto'
);

-- --- Clientes y citas --------------------------------------------------------
select test.ok(
  (select count(*) from public.customers where business_id = :aurora) = 2,
  'hay 2 clientes finales'
);

select test.ok(
  (select count(*) from public.appointments where business_id = :aurora) = 3,
  'hay 3 citas de ejemplo'
);

select test.ok(
  (select count(*) from public.appointments
    where business_id = :aurora and estado = 'cancelada') = 1,
  'una de las citas está cancelada, para tener el caso'
);

-- Las dos citas del lunes a las 10:00 son de profesionales distintos: es el
-- caso que demuestra que compartir horario no es solapar.
select test.ok(
  (select count(distinct staff_id) from public.appointments
    where business_id = :aurora
      and start_at = '2026-10-19 10:00:00+02'
      and estado <> 'cancelada') = 2,
  'las dos citas simultáneas del lunes son de profesionales distintos'
);

-- Coherencia: cada cita usa un profesional que presta ese servicio.
select test.ok(
  not exists (
    select 1 from public.appointments a
     where a.business_id = :aurora
       and not exists (
         select 1 from public.staff_services ss
          where ss.staff_id = a.staff_id and ss.service_id = a.service_id
       )
  ),
  'toda cita usa un profesional que presta ese servicio'
);

-- Coherencia: la duración de cada cita coincide con la de su servicio.
select test.ok(
  not exists (
    select 1 from public.appointments a
      join public.services s on s.id = a.service_id
     where a.business_id = :aurora
       and a.end_at - a.start_at <> make_interval(mins => s.duracion_min)
  ),
  'la duración de cada cita coincide con la de su servicio'
);

-- --- La agenda vive en nuestra base (maestro §7) -----------------------------
select test.ok(
  exists (select 1 from public.integrations
           where business_id = :aurora and tipo = 'supabase' and activa),
  'el negocio tiene la integración supabase activa'
);

-- --- Las tablas de fases futuras están creadas y vacías ----------------------
select test.ok(
  (select count(*) from public.knowledge_docs)   = 0
  and (select count(*) from public.knowledge_chunks) = 0
  and (select count(*) from public.conversations)    = 0
  and (select count(*) from public.messages)         = 0,
  'las tablas de conocimiento y conversación existen y están vacías (fases 2, 3 y 5)'
);

select test.resumen();
rollback;
