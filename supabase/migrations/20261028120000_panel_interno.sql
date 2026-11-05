-- =============================================================================
-- Fase 4 · 4.1 — Panel interno y alta de negocios
-- =============================================================================
-- Lo que necesita el panel de Mariana (_specs/fase-4-panel-interno.md):
--
--   · panel.personas (PI-01): quién puede entrar al panel. Es la única tabla
--     que no es de un negocio, así que vive en su propio esquema `panel` y no
--     en `public`: PostgREST solo expone `public`, y los tests 01 y 04 siguen
--     exigiendo business_id y política de tenant a todo lo de `public`. RLS
--     activo y SIN política: nadie la lee salvo el servidor (BYPASSRLS).
--   · knowledge_docs (PI-08): preguntas frecuentes como tipo = 'faq'
--     (titulo = pregunta, contenido_raw = respuesta) con su orden, y el límite
--     de ~20 preguntas o ~4.000 caracteres por negocio en la base (RA007),
--     porque van dentro del prompt en cada mensaje. La Fase 5 las indexará sin
--     migrar datos.
--   · conversations.prueba (PI-13): las conversaciones de "Probar el chat".
--   · escalations.resuelta_at (PI-07): cuándo se marcó resuelta.
--   · Lo que falta para activar (PI-03): negocio_lo_que_falta() y un trigger
--     que impide pasar a 'activo' sin lo mínimo (RA008).
--   · Citas a mano (PR-04, PI-14): app.slot_es_valido() y book_appointment()
--     ganan p_manual. Con p_manual se salta la rejilla (PR-01) y la antelación
--     (PD-05); NUNCA el horario, el cierre, los festivos, los solapes ni el
--     margen. Es un parámetro aparte y no se deduce de origen = 'manual': al
--     mover una cita (rescheduleBooking) se copia su origen, y el agente no
--     puede saltarse la rejilla al mover una cita que cargó Mariana.
--
-- PI-04 (desactivar, no borrar) y PI-12 (festivos por horas, de una
-- profesional o del local, con motivo) ya los cubrían services.activo,
-- staff.activo, businesses.estado y time_off (timestamptz + staff_id + motivo).
--
-- No se toca ninguna migración anterior.
-- =============================================================================

set search_path = public;

-- -----------------------------------------------------------------------------
-- panel.personas — quién entra al panel (PI-01)
-- -----------------------------------------------------------------------------
create schema if not exists panel;
revoke all on schema panel from public;

create table panel.personas (
  -- El id del usuario en Supabase Auth (auth.users.id). Sin FK: en el Postgres
  -- local no existe el esquema auth (D-24).
  user_id    uuid primary key,
  email      text not null unique
    constraint personas_email_minusculas check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+$'),
  activa     boolean not null default true,
  created_at timestamptz not null default now()
);

alter table panel.personas enable row level security;
-- Sin política a propósito: con RLS y ninguna política, anon y authenticated
-- no ven nada aunque alguien expusiera el esquema. El servidor hace BYPASSRLS.

comment on schema panel is
  'Fase 4: lo que no es de ningún negocio (las personas del panel interno). No se expone por PostgREST.';
comment on table panel.personas is
  'PI-01: quién puede entrar al panel interno. Sin registro público: las cuentas se crean con npm run panel:cuenta. RLS sin política: solo el servidor la lee.';

-- -----------------------------------------------------------------------------
-- knowledge_docs — preguntas frecuentes (PI-08)
-- -----------------------------------------------------------------------------
alter table public.knowledge_docs
  add column orden integer not null default 0,
  add constraint knowledge_docs_faq_corta check (
    tipo <> 'faq'
    or (length(titulo) <= 200
        and contenido_raw is not null
        and length(trim(contenido_raw)) > 0
        and length(contenido_raw) <= 1000)
  );

create index knowledge_docs_faq_idx on public.knowledge_docs (business_id, orden, created_at)
  where tipo = 'faq';

comment on column public.knowledge_docs.orden is
  'PI-08: orden en que se muestran (y van al prompt) las preguntas frecuentes. 0 de serie.';
comment on constraint knowledge_docs_faq_corta on public.knowledge_docs is
  'PI-08: una pregunta frecuente es corta (pregunta ≤ 200, respuesta ≤ 1.000 caracteres). Lo largo, a la Fase 5.';

-- PI-08: como mucho 20 preguntas o 4.000 caracteres (pregunta + respuesta) por
-- negocio. En un trigger y no en el código: van en cada mensaje al modelo, y
-- es coste. El advisory lock por negocio evita que dos altas simultáneas se
-- pasen del límite entre las dos.
create or replace function app.limite_preguntas_frecuentes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  c_max_preguntas  constant integer := 20;
  c_max_caracteres constant integer := 4000;
  v_n     integer;
  v_chars integer;
begin
  if new.tipo <> 'faq' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('faq:business:' || new.business_id::text, 0));

  select count(*), coalesce(sum(length(k.titulo) + length(coalesce(k.contenido_raw, ''))), 0)
    into v_n, v_chars
    from public.knowledge_docs k
   where k.business_id = new.business_id
     and k.tipo = 'faq'
     and k.id <> new.id;

  v_n     := v_n + 1;
  v_chars := v_chars + length(new.titulo) + length(coalesce(new.contenido_raw, ''));

  if v_n > c_max_preguntas or v_chars > c_max_caracteres then
    raise exception 'Límite de preguntas frecuentes: % preguntas y % caracteres (máximo % y %)',
      v_n, v_chars, c_max_preguntas, c_max_caracteres
      using errcode = 'RA007',
            hint = 'Acortá o quitá alguna pregunta; lo largo va en la base de conocimiento (Fase 5).';
  end if;
  return new;
end;
$$;

comment on function app.limite_preguntas_frecuentes() is
  'PI-08: rechaza con RA007 una pregunta frecuente que deja al negocio con más de 20 preguntas o 4.000 caracteres.';

create trigger knowledge_docs_limite_faq
  before insert or update of tipo, titulo, contenido_raw, business_id on public.knowledge_docs
  for each row execute function app.limite_preguntas_frecuentes();

-- -----------------------------------------------------------------------------
-- conversations.prueba (PI-13) · escalations.resuelta_at (PI-07)
-- -----------------------------------------------------------------------------
alter table public.conversations
  add column prueba boolean not null default false;

comment on column public.conversations.prueba is
  'PI-13: conversación de "Probar el chat" desde el panel. Cuesta lo mismo que una real; el visor la marca y el informe de consumo la separa.';

alter table public.escalations
  add column resuelta_at timestamptz,
  add constraint escalations_resuelta_coherente check (resuelta or resuelta_at is null);

comment on column public.escalations.resuelta_at is
  'PI-07: cuándo se marcó como resuelta desde el panel. NULL si está pendiente (o se resolvió antes de la Fase 4).';

-- -----------------------------------------------------------------------------
-- Lo que falta para activar un negocio (PI-03)
-- -----------------------------------------------------------------------------
-- Códigos estables (el panel los pone en palabras):
--   servicio     ningún servicio activo
--   profesional  ninguna profesional activa que haga un servicio activo
--   horario      el local no tiene horario
--   telefono     falta el teléfono del local (el agente lo da al derivar)
--   dominio      el chat no tiene ningún dominio donde aparecer
create or replace function public.negocio_lo_que_falta(p_business_id uuid)
returns text[]
language sql
stable
set search_path = ''
as $$
  select array_remove(array[
    case when not exists (
      select 1 from public.services s
       where s.business_id = p_business_id and s.activo) then 'servicio' end,
    case when not exists (
      select 1 from public.staff st
        join public.staff_services ss on ss.staff_id = st.id and ss.business_id = st.business_id
        join public.services s on s.id = ss.service_id and s.business_id = st.business_id and s.activo
       where st.business_id = p_business_id and st.activo) then 'profesional' end,
    case when not exists (
      select 1 from public.business_hours bh
       where bh.business_id = p_business_id and bh.staff_id is null) then 'horario' end,
    case when (select coalesce(trim(b.telefono_humano), '') = '' from public.businesses b
                where b.id = p_business_id) then 'telefono' end,
    case when (select cardinality(b.widget_dominios) = 0 from public.businesses b
                where b.id = p_business_id) then 'dominio' end
  ], null);
$$;

comment on function public.negocio_lo_que_falta(uuid) is
  'PI-03: lo mínimo que le falta a un negocio para activarse (servicio, profesional, horario, telefono, dominio). Vacío = se puede activar.';

create or replace function app.comprobar_activacion()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_falta text[];
begin
  if new.estado = 'activo' and old.estado is distinct from 'activo' then
    v_falta := public.negocio_lo_que_falta(new.id);
    if cardinality(v_falta) > 0 then
      raise exception 'No se puede activar el negocio: falta %', array_to_string(v_falta, ', ')
        using errcode = 'RA008', detail = array_to_string(v_falta, ',');
    end if;
  end if;
  return new;
end;
$$;

comment on function app.comprobar_activacion() is
  'PI-03: rechaza con RA008 pasar un negocio a activo si negocio_lo_que_falta() no está vacío. El detalle lleva los códigos separados por comas.';

-- Solo al CAMBIAR a activo: los negocios que ya estaban activos (Aurora) y los
-- que se crean activos (fixtures de los tests) no se tocan.
create trigger businesses_comprobar_activacion
  before update of estado on public.businesses
  for each row execute function app.comprobar_activacion();

-- -----------------------------------------------------------------------------
-- ¿Es válido este hueco? — con el modo manual (PR-04, PI-14)
-- -----------------------------------------------------------------------------
-- Misma función, mismo orden de comprobaciones (D-26, D-27); solo cambia que
-- con p_manual no se exige la rejilla (RA001 por rejilla) ni la antelación
-- (RA003). Se borra la versión de 4 argumentos: con un quinto con valor de
-- serie, las dos casarían con las llamadas de siempre y Postgres no sabría
-- cuál usar. available_slots la sigue llamando con 4 (p_manual = false).
drop function app.slot_es_valido(uuid, uuid, uuid, timestamptz);

create function app.slot_es_valido(
  p_business_id uuid,
  p_service_id  uuid,
  p_staff_id    uuid,
  p_start_at    timestamptz,
  p_manual      boolean default false
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

  v_dia := (p_start_at at time zone v_neg.timezone)::date;

  -- --- RA001 · horario, rejilla y cierre (PD-01, PR-01, PR-02) ----------------
  -- PR-04: a mano (p_manual) la rejilla no se exige; el tramo y el cierre sí.
  if not exists (
    select 1
      from app.tramos_efectivos(p_business_id, p_staff_id, v_dia) t
     where p_start_at >= t.desde
       and v_fin_jornada <= t.hasta
       and (p_manual
            or mod(extract(epoch from (p_start_at - t.desde))::numeric,
                   v_neg.intervalo_huecos_min * 60) = 0)
  ) then
    return 'RA001';
  end if;

  -- --- RA002 · festivos y ausencias -------------------------------------------
  if exists (
    select 1 from public.time_off o
     where o.business_id = p_business_id
       and (o.staff_id is null or o.staff_id = p_staff_id)
       and tstzrange(o.desde, o.hasta) && tstzrange(p_start_at, v_fin_jornada)
  ) then
    return 'RA002';
  end if;

  -- --- RA003 · antelación mínima (PD-05) --------------------------------------
  -- PR-04: a mano no se exige (una clienta que está en el local).
  if not p_manual
     and p_start_at < now() + make_interval(hours => v_neg.antelacion_min_horas) then
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
  -- PD-02: el margen se respeta siempre, también a mano.
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

comment on function app.slot_es_valido(uuid, uuid, uuid, timestamptz, boolean) is
  'Única fuente de verdad de "¿es un hueco válido?". NULL si lo es; si no, el SQLSTATE del motivo (23503, 23514, RA001–RA004, 23P01). p_manual (PR-04, PI-14): sin rejilla ni antelación mínima.';

-- -----------------------------------------------------------------------------
-- book_appointment — con el modo manual (PI-14)
-- -----------------------------------------------------------------------------
-- El cuerpo es el de …120600_lock_por_clienta con p_manual pasado a
-- slot_es_valido. Se borra la firma de 8 argumentos por lo mismo que arriba.
drop function public.book_appointment(uuid, uuid, uuid, uuid, timestamptz, text, public.appointment_origen, text);

create function public.book_appointment(
  p_business_id uuid,
  p_service_id  uuid,
  p_staff_id    uuid,
  p_customer_id uuid,
  p_start_at    timestamptz,
  p_notas       text                      default null,
  p_origen      public.appointment_origen default 'agente',
  p_external_id text                      default null,
  p_manual      boolean                   default false
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
  perform app.lock_clienta(p_customer_id);

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

    v_motivo := app.slot_es_valido(p_business_id, p_service_id, p_staff_id, p_start_at, p_manual);
    if v_motivo is not null then
      perform app.rechazar_hueco(v_motivo, p_staff_id, p_start_at);
    end if;

    v_staff_id := p_staff_id;
  else
    -- --- Asignación automática (PD-03, tarea 1.4) -----------------------------
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

    select st.id
      into v_staff_id
      from public.staff st
      join public.staff_services ss on ss.staff_id = st.id and ss.service_id = p_service_id
     where st.business_id = p_business_id
       and st.activo
       and app.slot_es_valido(p_business_id, p_service_id, st.id, p_start_at, p_manual) is null
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
      select array_agg(distinct app.slot_es_valido(p_business_id, p_service_id, st.id, p_start_at, p_manual))
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

comment on function public.book_appointment(uuid, uuid, uuid, uuid, timestamptz, text, public.appointment_origen, text, boolean) is
  'Reserva atómica. Valida el hueco con app.slot_es_valido(), serializa por profesional con advisory lock, asigna profesional si p_staff_id es NULL (PD-03) y rechaza con RA006 si la clienta ya tiene una cita que se pisa (PR-08). p_manual (PR-04, PI-14): cita a mano desde el panel, sin rejilla ni antelación mínima.';
