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
  (select count(*) from public.business_hours
    where business_id = :aurora and staff_id is null) = 9,
  'hay 9 tramos del local (partido de lunes a jueves, continuo el viernes)'
);

-- El viernes es el día distinto: jornada continua, un solo tramo.
select test.ok(
  (select count(*) from public.business_hours
    where business_id = :aurora and staff_id is null and weekday = 5) = 1,
  'el viernes tiene jornada continua (un único tramo)'
);

select test.ok(
  (select min(hora_apertura) from public.business_hours
    where business_id = :aurora and staff_id is null and weekday = 4)
    = '10:00'::time,
  'el jueves abre más tarde que el resto'
);

-- Fase 1 · PD-01: un horario propio, para tener el caso en los datos.
select test.ok(
  (select count(*) from public.business_hours where business_id = :aurora) = 10
  and exists (
    select 1 from public.business_hours
     where business_id = :aurora
       and staff_id = 'c0000000-0000-4000-8000-000000000002'
       and weekday = 4 and hora_apertura = '16:00' and hora_cierre = '21:00'),
  'Lucía tiene horario propio el jueves (solo 16–21): 10 tramos en total'
);

-- --- Ajustes por negocio (Fase 1) --------------------------------------------
select test.ok(
  (select antelacion_min_horas = 2
      and intervalo_huecos_min = 30
      and not margen_dentro_horario
      and asignacion_profesional = 'preguntar'
      and cancelacion_modo = 'informar'
      and cancelacion_plazo_horas = 24
     from public.businesses where id = :aurora),
  'ajustes de serie: antelación 2 h, huecos cada 30, margen fuera del horario, el agente pregunta, cancelación solo informa (24 h)'
);

-- --- Widget web (Fase 3) ----------------------------------------------------
select test.ok(
  (select widget_key = 'wk_demo_estetica_aurora_0001'
      -- En la nube se le suma el dominio de la demo publicada (PW-08).
      and widget_dominios[1] = 'localhost'
      and widget_color ~ '^#[0-9a-fA-F]{6}$'
      and tope_mensual_usd = 100
      and widget_logo like 'data:image/svg+xml;base64,%'
     from public.businesses where id = :aurora),
  'widget: la clave fija de la demo, en localhost (PW-06), con su color, tope de 100 US$ (PW-04) y su isotipo (PW-17)'
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
-- Se cuentan las del seed (UUID d0…/e0…, D-25): desde la Fase 2 el agente crea
-- clientas y citas reales cada vez que alguien conversa (npm run chat).
select test.ok(
  (select count(*) from public.customers
    where business_id = :aurora and id::text like 'd0000000-%') = 2,
  'hay 2 clientes finales'
);

select test.ok(
  (select count(*) from public.appointments
    where business_id = :aurora and id::text like 'e0000000-%') = 3,
  'hay 3 citas de ejemplo'
);

select test.ok(
  (select count(*) from public.appointments
    where business_id = :aurora and id::text like 'e0000000-%' and estado = 'cancelada') = 1,
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
-- Desde la Fase 2 el agente escribe conversaciones y mensajes cada vez que
-- alguien conversa (npm run chat), así que esas tablas ya no tienen por qué
-- estar vacías: solo se comprueba que existen. De conocimiento, desde la
-- Fase 4 hay preguntas frecuentes (PI-08); los documentos y los trozos
-- indexados siguen vacíos hasta la Fase 5.
select test.ok(
  (select count(*) from public.knowledge_docs where tipo <> 'faq') = 0
  and (select count(*) from public.knowledge_chunks) = 0,
  'de conocimiento solo hay preguntas frecuentes: documentos y trozos llegan en la fase 5'
);
select test.ok(
  (select array_agg(titulo order by orden) from public.knowledge_docs
    where business_id = 'a0000000-0000-4000-8000-000000000001' and tipo = 'faq')
  = array['¿Hay aparcamiento cerca?', '¿Cómo se puede pagar?', '¿Tenéis bonos regalo?'],
  'PI-08: Aurora tiene sus 3 preguntas frecuentes, en orden'
);
select test.ok(
  to_regclass('public.conversations') is not null
  and to_regclass('public.messages') is not null
  and to_regclass('public.escalations') is not null,
  'las tablas de conversación existen (las escribe el agente desde la fase 2)'
);

select test.resumen();
rollback;
