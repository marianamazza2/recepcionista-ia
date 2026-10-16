-- =============================================================================
-- Fase 1 · 1.3 + 1.4 — book_appointment completo y asignación de profesional
-- =============================================================================
-- Reemplaza (create or replace, misma firma) el esqueleto de la Fase 0:
--
--   · p_staff_id admite NULL → asignación automática (PD-03, tarea 1.4).
--   · Valida el hueco con app.slot_es_valido(), la misma función que usa
--     available_slots: horario, rejilla, festivos, ausencias, antelación y
--     margen. Ya no basta con que no se solape.
--   · Serializa por profesional con un advisory lock ANTES de validar e
--     insertar. no_overlap no protege el margen (T-02): sin el lock, dos
--     reservas simultáneas a 11:00 y 11:05 podrían entrar las dos, cada una
--     sin ver a la otra. no_overlap sigue siendo la última barrera.
--
-- Códigos de error (amplía D-20). SQLSTATE propios para que el adaptador
-- TypeScript no tenga que leer mensajes:
--
--   23P01  hueco ocupado                    RA001  fuera de horario
--   RA002  festivo o ausencia               RA003  sin antelación mínima
--   RA004  pisa el margen de otra cita      RA005  nadie libre (asignación automática)
--   23514  la profesional no hace el servicio
--   23503  algo no es de ese negocio o está inactivo
--
-- Concurrencia: el lock solo sirve en READ COMMITTED (el modo por defecto),
-- donde cada sentencia de PL/pgSQL toma una foto nueva y, tras esperar el lock,
-- ve la cita que la otra transacción acaba de confirmar. En REPEATABLE READ o
-- SERIALIZABLE la foto es la del principio de la transacción; ahí el margen
-- quedaría desprotegido y solo no_overlap frenaría el solape.
--
-- Seguridad (D-17): SECURITY INVOKER, no declara el tenant.
-- =============================================================================

set search_path = public;

-- -----------------------------------------------------------------------------
-- Clave del advisory lock de una profesional
-- -----------------------------------------------------------------------------
-- Un bigint derivado del staff_id. Con el prefijo, la clave no choca con otros
-- usos futuros de advisory locks sobre el mismo uuid. Una colisión de hash solo
-- serializaría de más dos profesionales: nunca deja pasar nada.
create or replace function app.lock_profesional(p_staff_id uuid)
returns void
language sql
volatile
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('booking:staff:' || p_staff_id::text, 0));
$$;

comment on function app.lock_profesional(uuid) is
  'Serializa las reservas de una profesional hasta el final de la transacción (pg_advisory_xact_lock).';

-- -----------------------------------------------------------------------------
-- Lanza el error que corresponde a un motivo de app.slot_es_valido()
-- -----------------------------------------------------------------------------
create or replace function app.rechazar_hueco(
  p_motivo   text,
  p_staff_id uuid,
  p_start_at timestamptz
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_motivo
    when '23503' then
      raise exception 'La profesional % no existe, no está activa o no pertenece al negocio', p_staff_id
        using errcode = '23503';
    when '23514' then
      raise exception 'La profesional % no presta ese servicio', p_staff_id
        using errcode = '23514', hint = 'Proponé otra profesional.';
    when 'RA001' then
      raise exception 'A las % no hay un hueco en el horario de esa profesional o del local', p_start_at
        using errcode = 'RA001', hint = 'Ofrecé los huecos más cercanos (PD-04).';
    when 'RA002' then
      raise exception 'El % cae en un festivo o en una ausencia de esa profesional', p_start_at
        using errcode = 'RA002', hint = 'Ofrecé los huecos más cercanos (PD-04).';
    when 'RA003' then
      raise exception 'El % no respeta la antelación mínima del negocio', p_start_at
        using errcode = 'RA003', hint = 'Explicá la antelación y ofrecé el primer hueco válido.';
    when '23P01' then
      raise exception 'El hueco de las % ya está ocupado para esa profesional', p_start_at
        using errcode = '23P01', hint = 'Consultá la disponibilidad y ofrecé otro hueco.';
    when 'RA004' then
      raise exception 'A las % no se respeta el margen con otra cita de esa profesional', p_start_at
        using errcode = 'RA004', hint = 'Ofrecé otro hueco.';
    else
      raise exception 'Motivo de rechazo desconocido: %', p_motivo
        using errcode = 'internal_error';
  end case;
end;
$$;

-- -----------------------------------------------------------------------------
-- book_appointment
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
    -- igual aunque alguien inserte por fuera del RPC.
    when exclusion_violation then
      perform app.rechazar_hueco('23P01', v_staff_id, p_start_at);
  end;

  return v_cita;
end;
$$;

comment on function public.book_appointment(uuid, uuid, uuid, uuid, timestamptz, text, public.appointment_origen, text) is
  'Reserva atómica (Fase 1). Valida el hueco con app.slot_es_valido(), serializa por profesional con advisory lock y asigna profesional si p_staff_id es NULL (PD-03).';

-- -----------------------------------------------------------------------------
-- ultima_profesional — para "la última vez te atendió Marta" (PD-03)
-- -----------------------------------------------------------------------------
create or replace function public.ultima_profesional(
  p_business_id uuid,
  p_customer_id uuid
)
returns uuid
language sql
stable
set search_path = ''
as $$
  select a.staff_id
    from public.appointments a
   where a.business_id = p_business_id
     and a.customer_id = p_customer_id
     and a.estado <> 'cancelada'
   order by a.start_at desc, a.created_at desc
   limit 1;
$$;

comment on function public.ultima_profesional(uuid, uuid) is
  'Profesional de la última cita no cancelada de esa clienta (por start_at), o NULL si no tiene.';
