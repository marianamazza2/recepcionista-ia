-- =============================================================================
-- Fase 1 · 1.2 + 1.5 — Motor de disponibilidad
-- =============================================================================
-- Tres piezas, de abajo arriba:
--
--   app.tramos_efectivos()   qué tramos trabaja una profesional un día local
--                            (PD-01), ya convertidos a instantes UTC.
--   app.slot_es_valido()     LA ÚNICA FUENTE DE VERDAD: ¿este inicio es un
--                            hueco válido para esta profesional y este
--                            servicio? Devuelve NULL si sí, o el SQLSTATE del
--                            motivo si no. La usan available_slots y
--                            book_appointment; si cambia una regla, se cambia
--                            acá y solo acá.
--   public.available_slots() genera candidatos (días locales × tramos ×
--                            inicios cada N minutos) y se queda con los que
--                            slot_es_valido() acepta.
--
-- Zonas horarias (D-09, T-01): business_hours está en hora LOCAL; todo lo demás
-- en timestamptz. La conversión es SIEMPRE `(fecha + hora) AT TIME ZONE tz`, que
-- resuelve el cambio de hora sin offsets a mano.
--
-- Seguridad (D-17): todo es SECURITY INVOKER y no declara tenant. Corre con los
-- permisos del llamador, así que RLS sigue aplicando.
-- =============================================================================

set search_path = public;

-- -----------------------------------------------------------------------------
-- Tramos efectivos de una profesional en un día local (PD-01)
-- -----------------------------------------------------------------------------
-- Si la profesional tiene tramos propios ese weekday, se usan SOLO esos. Si no,
-- hereda los del negocio (staff_id NULL). weekday = EXTRACT(dow): 0 = domingo
-- (D-10).
create or replace function app.tramos_efectivos(
  p_business_id uuid,
  p_staff_id    uuid,
  p_dia         date
)
returns table (desde timestamptz, hasta timestamptz)
language sql
stable
set search_path = ''
as $$
  select (p_dia + bh.hora_apertura) at time zone b.timezone,
         (p_dia + bh.hora_cierre)   at time zone b.timezone
    from public.business_hours bh
    join public.businesses b on b.id = bh.business_id
   where bh.business_id = p_business_id
     and bh.weekday = extract(dow from p_dia)
     and (
           bh.staff_id = p_staff_id
        or (bh.staff_id is null
            and not exists (
              select 1 from public.business_hours propio
               where propio.business_id = p_business_id
                 and propio.staff_id    = p_staff_id
                 and propio.weekday     = extract(dow from p_dia)))
         )
   order by 1;
$$;

comment on function app.tramos_efectivos(uuid, uuid, date) is
  'PD-01: tramos que trabaja una profesional un día local, en UTC. El horario propio reemplaza al del negocio ese weekday.';

-- -----------------------------------------------------------------------------
-- ¿Es válido este hueco? — la única fuente de verdad (1.5)
-- -----------------------------------------------------------------------------
-- Devuelve NULL si el hueco es válido. Si no, el SQLSTATE con el que
-- book_appointment rechazaría la reserva (tabla de 1.3):
--
--   23503  servicio o profesional inexistente, inactivo o de otro negocio
--   23514  la profesional no presta ese servicio
--   RA001  fuera de horario: no cae en un tramo, no está en la rejilla del
--          intervalo (PR-01) o el servicio no cabe antes del cierre (PR-02)
--   RA002  pisa un festivo del negocio o una ausencia de la profesional
--   RA003  no respeta la antelación mínima (PD-05)
--   23P01  pisa otra cita (servicio contra servicio)
--   RA004  solo choca por el margen, el suyo o el de la cita vecina (PD-02)
--
-- El orden de las comprobaciones decide qué motivo se informa cuando fallan
-- varias: primero lo estructural, después "no abrimos" y por último "está
-- ocupado". Así un domingo a una hora de ahora se responde "no abrimos", que
-- es lo que el agente tiene que decir (PD-04).
--
-- Cómo se mide el margen:
--   · una cita existente ocupa [start_at, end_at + buffer_min de SU servicio);
--   · el hueco nuevo necesita libre [inicio, inicio + duración + SU buffer).
--   · contra el cierre del tramo y contra los bloqueos de time_off, el margen
--     cuenta solo si businesses.margen_dentro_horario (PR-02).
create or replace function app.slot_es_valido(
  p_business_id uuid,
  p_service_id  uuid,
  p_staff_id    uuid,
  p_start_at    timestamptz
)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_neg        record;
  v_duracion   interval;
  v_buffer     interval;
  v_fin        timestamptz;   -- fin del servicio (lo que se guarda en end_at)
  v_fin_margen timestamptz;   -- fin del servicio + su margen
  v_fin_jornada timestamptz;  -- lo que tiene que caber dentro del horario
  v_dia        date;
begin
  -- --- Estructura: negocio, servicio, profesional ------------------------------
  select b.timezone, b.antelacion_min_horas, b.intervalo_huecos_min, b.margen_dentro_horario
    into v_neg
    from public.businesses b
   where b.id = p_business_id;
  if not found then
    return '23503';
  end if;

  select make_interval(mins => s.duracion_min), make_interval(mins => s.buffer_min)
    into v_duracion, v_buffer
    from public.services s
   where s.id = p_service_id
     and s.business_id = p_business_id
     and s.activo;
  if not found then
    return '23503';
  end if;

  if not exists (
    select 1 from public.staff st
     where st.id = p_staff_id and st.business_id = p_business_id and st.activo
  ) then
    return '23503';
  end if;

  if not exists (
    select 1 from public.staff_services ss
     where ss.staff_id = p_staff_id and ss.service_id = p_service_id
  ) then
    return '23514';
  end if;

  v_fin        := p_start_at + v_duracion;
  v_fin_margen := v_fin + v_buffer;
  v_fin_jornada := case when v_neg.margen_dentro_horario then v_fin_margen else v_fin end;

  -- El día local en que empieza el hueco. Ningún tramo cruza la medianoche
  -- (hora_cierre > hora_apertura), así que basta con mirar ese día.
  v_dia := (p_start_at at time zone v_neg.timezone)::date;

  -- --- RA001 · horario, rejilla y cierre (PD-01, PR-01, PR-02) ----------------
  -- La rejilla se mide en tiempo transcurrido desde la apertura del tramo, no
  -- en minutos de reloj: así un tramo que cruzara un cambio de hora seguiría
  -- ofreciendo huecos cada N minutos reales.
  if not exists (
    select 1
      from app.tramos_efectivos(p_business_id, p_staff_id, v_dia) t
     where p_start_at >= t.desde
       and v_fin_jornada <= t.hasta
       and mod(extract(epoch from (p_start_at - t.desde))::numeric,
               v_neg.intervalo_huecos_min * 60) = 0
  ) then
    return 'RA001';
  end if;

  -- --- RA002 · festivos y ausencias -------------------------------------------
  -- staff_id NULL cierra el negocio entero; con valor, solo a esa profesional.
  if exists (
    select 1 from public.time_off o
     where o.business_id = p_business_id
       and (o.staff_id is null or o.staff_id = p_staff_id)
       and tstzrange(o.desde, o.hasta) && tstzrange(p_start_at, v_fin_jornada)
  ) then
    return 'RA002';
  end if;

  -- --- RA003 · antelación mínima (PD-05) --------------------------------------
  if p_start_at < now() + make_interval(hours => v_neg.antelacion_min_horas) then
    return 'RA003';
  end if;

  -- --- 23P01 · otra cita en el mismo tramo de servicio ------------------------
  if exists (
    select 1 from public.appointments a
     where a.staff_id = p_staff_id
       and a.estado <> 'cancelada'
       and tstzrange(a.start_at, a.end_at) && tstzrange(p_start_at, v_fin)
  ) then
    return '23P01';
  end if;

  -- --- RA004 · margen con otra cita (PD-02) -----------------------------------
  -- no_overlap no protege el margen (T-02): esta comprobación es la única.
  if exists (
    select 1 from public.appointments a
      join public.services sa on sa.id = a.service_id
     where a.staff_id = p_staff_id
       and a.estado <> 'cancelada'
       and tstzrange(a.start_at, a.end_at + make_interval(mins => sa.buffer_min))
           && tstzrange(p_start_at, v_fin_margen)
  ) then
    return 'RA004';
  end if;

  return null;
end;
$$;

comment on function app.slot_es_valido(uuid, uuid, uuid, timestamptz) is
  'Única fuente de verdad de "¿es un hueco válido?". NULL si lo es; si no, el SQLSTATE del motivo (23503, 23514, RA001–RA004, 23P01).';

-- -----------------------------------------------------------------------------
-- available_slots — huecos libres (1.2)
-- -----------------------------------------------------------------------------
create or replace function public.available_slots(
  p_business_id uuid,
  p_service_id  uuid,
  p_from        timestamptz,
  p_to          timestamptz,
  p_staff_id    uuid default null
)
returns table (staff_id uuid, start_at timestamptz, end_at timestamptz)
language plpgsql
stable
set search_path = ''
as $$
declare
  c_rango_max constant interval := interval '31 days';
  v_tz        text;
  v_intervalo interval;
  v_duracion  interval;
begin
  if p_from is null or p_to is null or p_to <= p_from then
    raise exception 'Rango inválido: p_to (%) tiene que ser posterior a p_from (%)', p_to, p_from
      using errcode = 'invalid_parameter_value';
  end if;

  if p_to - p_from > c_rango_max then
    raise exception 'Rango demasiado grande: como mucho % por consulta', c_rango_max
      using errcode = 'invalid_parameter_value',
            hint    = 'Pedí la disponibilidad por semanas o por meses.';
  end if;

  select b.timezone, make_interval(mins => b.intervalo_huecos_min)
    into v_tz, v_intervalo
    from public.businesses b
   where b.id = p_business_id;

  select make_interval(mins => s.duracion_min)
    into v_duracion
    from public.services s
   where s.id = p_service_id and s.business_id = p_business_id and s.activo;

  -- Negocio o servicio que no existe (o que RLS no deja ver): no hay huecos.
  if v_tz is null or v_duracion is null then
    return;
  end if;

  return query
  with
  -- Días LOCALES del negocio que toca el rango.
  dias as (
    select d::date as dia
      from generate_series(
             (p_from at time zone v_tz)::date,
             (p_to   at time zone v_tz)::date,
             interval '1 day') d
  ),
  -- Profesionales activas que hacen el servicio (filtro por servicio).
  profesionales as (
    select st.id, st.nombre
      from public.staff st
      join public.staff_services ss on ss.staff_id = st.id and ss.service_id = p_service_id
     where st.business_id = p_business_id
       and st.activo
       and (p_staff_id is null or st.id = p_staff_id)
  ),
  -- Inicios candidatos: cada `intervalo` desde la apertura de cada tramo. Se
  -- corta un poco antes del cierre solo para no generar candidatos que seguro
  -- no caben; la decisión final la toma slot_es_valido().
  candidatos as (
    select p.id as staff_id, p.nombre, inicio
      from profesionales p
     cross join dias
     cross join lateral app.tramos_efectivos(p_business_id, p.id, dias.dia) t
     cross join lateral generate_series(t.desde, t.hasta - v_duracion, v_intervalo) inicio
  )
  select c.staff_id, c.inicio, c.inicio + v_duracion
    from candidatos c
   where c.inicio >= p_from
     and c.inicio <  p_to
     and app.slot_es_valido(p_business_id, p_service_id, c.staff_id, c.inicio) is null
   order by c.inicio, c.nombre, c.staff_id;
end;
$$;

comment on function public.available_slots(uuid, uuid, timestamptz, timestamptz, uuid) is
  'Huecos libres de un servicio en [p_from, p_to), uno por profesional y hueco, ordenados por inicio y profesional. end_at = fin del servicio, sin margen. Máximo 31 días.';
