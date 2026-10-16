-- =============================================================================
-- PR-08 — Una clienta no puede tener dos citas que se pisen
-- =============================================================================
-- Decidido por Mariana el 16/10/2026, al probar el agente: reservó dos veces
-- el lunes 19 a las 17:00 (una con Lucía, otra con Marta). no_overlap impide
-- que una PROFESIONAL tenga dos citas a la vez, pero no que una CLIENTA las
-- tenga.
--
--   · no_overlap_cliente: restricción de exclusión por clienta, gemela de
--     no_overlap. Es la garantía en la base, también ante dos reservas
--     simultáneas (que el advisory lock por profesional no serializa).
--   · book_appointment: lo comprueba antes y lo informa con su propio código,
--     RA006, para que el agente le diga a la clienta qué cita tiene.
--
-- No cuenta el margen: es la misma persona, no tiene que esperar a que se
-- limpie la cabina. Solo el tiempo del servicio, [inicio, fin).
--
-- Reprogramar (cancelar + crear en la misma transacción) no choca consigo
-- misma: la cita cancelada no cuenta.
-- =============================================================================

-- gist_uuid_ops viene de btree_gist, en el esquema extensions (D-01, T-05).
set search_path = public, extensions;

alter table public.appointments
  add constraint no_overlap_cliente
  exclude using gist (
    customer_id with =,
    tstzrange(start_at, end_at) with &&
  ) where (estado <> 'cancelada');

comment on constraint no_overlap_cliente on public.appointments is
  'PR-08: una clienta no puede tener dos citas no canceladas que se pisen. Gemela de no_overlap (que es por profesional).';

set search_path = public;

-- -----------------------------------------------------------------------------
-- book_appointment — misma firma; añade la comprobación PR-08 (RA006)
-- -----------------------------------------------------------------------------
create or replace function public.book_appointment(
  p_business_id uuid,
  p_service_id  uuid,
  p_staff_id    uuid,
  p_customer_id uuid,
  p_start_at    timestamptz,
  p_notas       text                      default null,
  p_origen      public.appointment_origen default 'agente',
  p_external_id text                      default null
)
returns public.appointments
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_tz           text;
  v_duracion_min integer;
  v_staff_id     uuid;
  v_motivo       text;
  v_motivos      text[];
  v_cita         public.appointments;
  v_restriccion  text;
begin
  -- --- Pertenencia: servicio y cliente ----------------------------------------
  -- (La profesional la valida app.slot_es_valido(), junto con todo lo demás.)
  select b.timezone into v_tz from public.businesses b where b.id = p_business_id;

  select s.duracion_min
    into v_duracion_min
    from public.services s
   where s.id = p_service_id
     and s.business_id = p_business_id
     and s.activo;

  if v_tz is null or not found then
    raise exception 'El servicio % no existe, no está activo o no pertenece al negocio %',
      p_service_id, p_business_id
      using errcode = 'foreign_key_violation';
  end if;

  if not exists (
    select 1 from public.customers c
     where c.id = p_customer_id
       and c.business_id = p_business_id
  ) then
    raise exception 'El cliente % no pertenece al negocio %', p_customer_id, p_business_id
      using errcode = 'foreign_key_violation';
  end if;

  -- --- PR-08: la clienta no puede tener dos citas que se pisen ---------------
  -- Va antes que el hueco de la profesional: si choca con una cita suya, eso es
  -- lo que le sirve saber al agente (si no, con su misma profesional diría
  -- "hueco ocupado", y la que lo ocupa es ella).
  if exists (
    select 1
      from public.appointments a
     where a.business_id = p_business_id
       and a.customer_id = p_customer_id
       and a.estado <> 'cancelada'
       and tstzrange(a.start_at, a.end_at)
           && tstzrange(p_start_at, p_start_at + make_interval(mins => v_duracion_min))
  ) then
    raise exception 'La clienta % ya tiene una cita que se solapa con las %', p_customer_id, p_start_at
      using errcode = 'RA006', hint = 'Decile qué cita tiene; puede mover o anular la anterior.';
  end if;

  if p_staff_id is not null then
    -- --- Profesional elegida ---------------------------------------------------
    perform app.lock_profesional(p_staff_id);

    v_motivo := app.slot_es_valido(p_business_id, p_service_id, p_staff_id, p_start_at);
    if v_motivo is not null then
      perform app.rechazar_hueco(v_motivo, p_staff_id, p_start_at);
    end if;

    v_staff_id := p_staff_id;
  else
    -- --- Asignación automática (PD-03, tarea 1.4) -----------------------------
    -- Se bloquean TODAS las candidatas, en orden de id: dos asignaciones
    -- automáticas simultáneas toman los locks en el mismo orden y no se
    -- interbloquean; una reserva con profesional elegida solo toma uno.
    -- (Bucle explícito y no un PERFORM … ORDER BY: así el orden de los locks
    -- no depende de cuándo decida el planificador evaluar la función.)
    for v_staff_id in
      select st.id
        from public.staff st
        join public.staff_services ss on ss.staff_id = st.id and ss.service_id = p_service_id
       where st.business_id = p_business_id
         and st.activo
       order by st.id
    loop
      perform app.lock_profesional(v_staff_id);
    end loop;
    v_staff_id := null;

    -- Candidatas: las que tienen ESTE hueco exacto. Se elige la que menos citas
    -- no canceladas tiene ese día local; empate → nombre y luego id.
    select st.id
      into v_staff_id
      from public.staff st
      join public.staff_services ss on ss.staff_id = st.id and ss.service_id = p_service_id
     where st.business_id = p_business_id
       and st.activo
       and app.slot_es_valido(p_business_id, p_service_id, st.id, p_start_at) is null
     order by (
              select count(*) from public.appointments a
               where a.staff_id = st.id
                 and a.estado <> 'cancelada'
                 and (a.start_at at time zone v_tz)::date = (p_start_at at time zone v_tz)::date
            ),
            st.nombre,
            st.id
     limit 1;

    if v_staff_id is null then
      -- Si todas fallan por el MISMO motivo de calendario (no abre, festivo,
      -- antelación), se informa ese motivo: le sirve más al agente que un
      -- "nadie libre". Si los motivos son de ocupación o mezclados, RA005.
      select array_agg(distinct app.slot_es_valido(p_business_id, p_service_id, st.id, p_start_at))
        into v_motivos
        from public.staff st
        join public.staff_services ss on ss.staff_id = st.id and ss.service_id = p_service_id
       where st.business_id = p_business_id
         and st.activo;

      if v_motivos is null then
        raise exception 'Ninguna profesional activa presta ese servicio'
          using errcode = 'check_violation';
      end if;

      if cardinality(v_motivos) = 1 and v_motivos[1] in ('RA001', 'RA002', 'RA003') then
        perform app.rechazar_hueco(v_motivos[1], null, p_start_at);
      end if;

      raise exception 'Ninguna profesional tiene libre el hueco de las %', p_start_at
        using errcode = 'RA005', hint = 'Ofrecé otros huecos.';
    end if;
  end if;

  -- --- Inserción --------------------------------------------------------------
  -- end_at cubre solo el servicio; el margen lo aplica slot_es_valido() (D-05).
  begin
    insert into public.appointments (
      business_id, staff_id, service_id, customer_id,
      start_at, end_at, estado, origen, external_id, notas
    )
    values (
      p_business_id, v_staff_id, p_service_id, p_customer_id,
      p_start_at, p_start_at + make_interval(mins => v_duracion_min),
      'confirmada', p_origen, p_external_id, p_notas
    )
    returning * into v_cita;
  exception
    -- Última barrera: con el lock no debería llegar acá, pero no_overlap decide
    -- igual aunque alguien inserte por fuera del RPC. no_overlap_cliente cubre
    -- dos reservas simultáneas de la MISMA clienta con profesionales distintas
    -- (el lock es por profesional y no las serializa).
    when exclusion_violation then
      get stacked diagnostics v_restriccion = constraint_name;
      if v_restriccion = 'no_overlap_cliente' then
        raise exception 'La clienta % ya tiene una cita que se solapa con las %', p_customer_id, p_start_at
          using errcode = 'RA006';
      end if;
      perform app.rechazar_hueco('23P01', v_staff_id, p_start_at);
  end;

  return v_cita;
end;
$$;

comment on function public.book_appointment(uuid, uuid, uuid, uuid, timestamptz, text, public.appointment_origen, text) is
  'Reserva atómica. Valida el hueco con app.slot_es_valido(), serializa por profesional con advisory lock, asigna profesional si p_staff_id es NULL (PD-03) y rechaza con RA006 si la clienta ya tiene una cita que se pisa (PR-08).';
