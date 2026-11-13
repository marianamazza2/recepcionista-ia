-- =============================================================================
-- Antes de la Fase 9 — Borrado de datos (PD-13) y el aviso de la profesional
-- que no trabaja ningún día (PI-20)
-- =============================================================================
-- Decidido por Mariana el 13/11/2026:
--
--   · PD-13: la ficha de la clienta (nombre, teléfono, email) y las citas se
--     guardan SIEMPRE: son la base de clientas y la agenda del negocio. Lo que
--     caduca es el TEXTO del chat, a los 6 meses. La conversación se queda,
--     ligada a su clienta, para poder seguir contando cuántas hubo. El consumo
--     (usage_events) no se toca: no tiene ningún dato personal.
--     → app.borrar_conversaciones_vencidas(meses)
--
--   · PD-13 (derecho de supresión): si una clienta pide que la borren, se borra
--     ELLA. Su ficha queda anónima ("clienta borrada") en vez de desaparecer,
--     porque las citas la referencian (FK sin acción de borrado, a propósito:
--     el histórico de la agenda es del negocio y no se agujerea). Su texto de
--     chat se borra entero, sin esperar los 6 meses.
--     → app.borrar_clienta(business_id, customer_id)
--
--   · PI-20: una profesional activa que hace servicios pero NO trabaja ningún
--     día no cuenta para activar el negocio (PI-03): no tendría ni un hueco
--     que ofrecer. Trabaja "algún día" quien tiene tramos propios algún día, o
--     quien hereda el horario del local un día que el local abre y ella no
--     tiene marcado "no trabaja" (PD-01 + PI-19).
--     → app.profesional_trabaja_algun_dia(business_id, staff_id), usada por
--       public.negocio_lo_que_falta()
--
-- El borrado es REAL (delete), no una marca. Las copias de seguridad de
-- Supabase conservan lo borrado hasta que rotan: eso se dice en el anexo de
-- RGPD, no se promete un borrado instantáneo (PD-11).
--
-- No se toca ninguna migración anterior. Las funciones van en `app` salvo
-- negocio_lo_que_falta, que ya era pública y se reemplaza.
-- =============================================================================

set search_path = public;

-- -----------------------------------------------------------------------------
-- PD-13 · El texto del chat caduca a los 6 meses
-- -----------------------------------------------------------------------------
create or replace function app.borrar_conversaciones_vencidas(p_meses int default 6)
returns table (conversaciones int, mensajes int)
language plpgsql
set search_path = ''
as $$
declare
  v_corte timestamptz := now() - make_interval(months => p_meses);
  v_convs uuid[];
  v_mensajes int;
begin
  if p_meses < 1 then
    raise exception 'Los meses de retención tienen que ser 1 o más (PD-13)'
      using errcode = 'RA009';
  end if;

  -- Las conversaciones que ya vencieron Y todavía tienen texto que borrar.
  select coalesce(array_agg(c.id), '{}')
    into v_convs
    from public.conversations c
   where c.ultimo_mensaje_at < v_corte
     and exists (select 1 from public.messages m where m.conversation_id = c.id);

  delete from public.messages m where m.conversation_id = any(v_convs);
  get diagnostics v_mensajes = row_count;

  -- Los códigos de verificación (PA-16) duran 10 minutos: los vencidos no
  -- hacen falta para nada. Se limpian con la misma pasada.
  delete from public.codigos_verificacion where expira_at < now() - interval '30 days';

  return query select cardinality(v_convs), v_mensajes;
end;
$$;

comment on function app.borrar_conversaciones_vencidas(int) is
  'PD-13: borra el TEXTO (messages) de las conversaciones sin actividad desde hace p_meses (6 de serie). La conversación y la ficha de la clienta se quedan. Devuelve cuántas conversaciones y cuántos mensajes.';

-- -----------------------------------------------------------------------------
-- PD-13 · Borrar a una clienta porque lo pide (derecho de supresión)
-- -----------------------------------------------------------------------------
create or replace function app.borrar_clienta(p_business_id uuid, p_customer_id uuid)
returns table (mensajes int, conversaciones int, citas int)
language plpgsql
set search_path = ''
as $$
declare
  v_mensajes int;
  v_convs int;
  v_citas int;
begin
  if not exists (
    select 1 from public.customers c
     where c.id = p_customer_id and c.business_id = p_business_id
  ) then
    raise exception 'Esa clienta no es de ese negocio'
      using errcode = 'RA010', hint = 'PD-13: se borra con --negocio y --clienta del mismo negocio.';
  end if;

  delete from public.messages m
   where m.business_id = p_business_id
     and m.conversation_id in (
       select c.id from public.conversations c
        where c.business_id = p_business_id and c.customer_id = p_customer_id
     );
  get diagnostics v_mensajes = row_count;

  update public.conversations c
     set customer_id = null
   where c.business_id = p_business_id and c.customer_id = p_customer_id;
  get diagnostics v_convs = row_count;

  select count(*) into v_citas
    from public.appointments a
   where a.business_id = p_business_id and a.customer_id = p_customer_id;

  -- La ficha se queda anónima: las citas la referencian y el histórico de la
  -- agenda es del negocio. El teléfono es obligatorio y único entre las fichas
  -- sin email, así que se le pone uno imposible y reconocible.
  update public.customers c
     set nombre   = null,
         email    = null,
         telefono = 'borrada-' || c.id::text,
         notas    = null
   where c.id = p_customer_id and c.business_id = p_business_id;

  return query select v_mensajes, v_convs, v_citas;
end;
$$;

comment on function app.borrar_clienta(uuid, uuid) is
  'PD-13 (derecho de supresión): borra el texto de chat de una clienta, desliga sus conversaciones y deja su ficha anónima. Sus citas se quedan en la agenda del negocio, sin nombre.';

-- -----------------------------------------------------------------------------
-- PI-20 · ¿Esta profesional trabaja algún día?
-- -----------------------------------------------------------------------------
create or replace function app.profesional_trabaja_algun_dia(p_business_id uuid, p_staff_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    -- Tramos propios: ese día trabaja, aunque el local esté cerrado (PD-01).
    select 1
      from public.business_hours bh
     where bh.business_id = p_business_id
       and bh.staff_id = p_staff_id
  ) or exists (
    -- Hereda el horario del local un día que el local abre y ella no tiene
    -- marcado "no trabaja" (PI-19).
    select 1
      from public.business_hours bh
     where bh.business_id = p_business_id
       and bh.staff_id is null
       and not exists (
         select 1 from public.staff_dias_libres dl
          where dl.staff_id = p_staff_id
            and dl.weekday = bh.weekday
       )
  );
$$;

comment on function app.profesional_trabaja_algun_dia(uuid, uuid) is
  'PI-20: true si la profesional tiene algún día con horas. Tramos propios cuentan siempre; los días del local, solo si no están marcados "no trabaja" (PD-01 + PI-19).';

-- -----------------------------------------------------------------------------
-- PI-20 · "Lo que falta" ya no cuenta a quien no trabaja ningún día
-- -----------------------------------------------------------------------------
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
       where st.business_id = p_business_id and st.activo
         -- PI-20: si no trabaja ningún día, no tiene huecos: no cuenta.
         and app.profesional_trabaja_algun_dia(p_business_id, st.id)) then 'profesional' end,
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
  'PI-03: lo mínimo que le falta a un negocio para activarse (servicio, profesional, horario, telefono, dominio). Vacío = se puede activar. PI-20 (13/11/2026): una profesional que no trabaja ningún día no cuenta como profesional.';
