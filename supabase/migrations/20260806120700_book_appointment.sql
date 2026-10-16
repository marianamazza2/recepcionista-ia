-- =============================================================================
-- Fase 0 · 0.5 — RPC book_appointment (ESQUELETO)
-- =============================================================================
-- Reserva atómica. En la Fase 0 hace lo mínimo indispensable:
--   · comprueba que servicio, profesional y cliente existen Y son de ese negocio;
--   · comprueba que el profesional presta ese servicio;
--   · calcula end_at a partir de services.duracion_min;
--   · inserta, y deja que la restricción `no_overlap` sea la que impide pisar
--     un hueco ocupado (traduciendo el error a un mensaje utilizable).
--
-- ⚠️ LO QUE ES DE LA FASE 1, NO SE IMPLEMENTA ACÁ:
--   · huecos libres reales (business_hours, conversión al timezone del negocio);
--   · festivos y ausencias (time_off);
--   · buffers entre citas (services.buffer_min);
--   · elección automática de profesional cuando el cliente no pide uno.
-- El único invariante que YA está garantizado en la Fase 0 es el que importa:
-- no se puede solapar. Lo demás son reglas de negocio que se suman encima.
--
-- SEGURIDAD: la función es SECURITY INVOKER a propósito. Corre con los permisos
-- de quien la llama, así que RLS le sigue aplicando. En particular NO llama a
-- app.set_business_id(): si lo hiciera, cualquiera podría pasarle un
-- business_id ajeno y saltarse el aislamiento. El tenant lo declara el llamador.
-- =============================================================================

set search_path = public;

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
  v_duracion_min integer;
  v_end_at       timestamptz;
  v_cita         public.appointments;
begin
  -- --- Validaciones mínimas ---------------------------------------------------
  select s.duracion_min
    into v_duracion_min
    from public.services s
   where s.id = p_service_id
     and s.business_id = p_business_id
     and s.activo;

  if not found then
    raise exception 'El servicio % no existe, no está activo o no pertenece al negocio %',
      p_service_id, p_business_id
      using errcode = 'foreign_key_violation';
  end if;

  if not exists (
    select 1 from public.staff st
     where st.id = p_staff_id
       and st.business_id = p_business_id
       and st.activo
  ) then
    raise exception 'El profesional % no existe, no está activo o no pertenece al negocio %',
      p_staff_id, p_business_id
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

  if not exists (
    select 1 from public.staff_services ss
     where ss.staff_id   = p_staff_id
       and ss.service_id = p_service_id
  ) then
    raise exception 'El profesional % no presta el servicio %', p_staff_id, p_service_id
      using errcode = 'check_violation',
            hint    = 'Revisá staff_services o elegí otro profesional.';
  end if;

  -- --- Cálculo del fin --------------------------------------------------------
  -- end_at cubre solo el servicio. El buffer separa citas y lo aplica el cálculo
  -- de huecos de la Fase 1, no la duración almacenada.
  v_end_at := p_start_at + make_interval(mins => v_duracion_min);

  -- --- Inserción atómica ------------------------------------------------------
  -- Sin SELECT previo de comprobación a propósito: entre el SELECT y el INSERT
  -- cabe otra reserva. La restricción `no_overlap` es lo que decide, y decide
  -- siempre, incluso con dos reservas simultáneas al mismo hueco.
  begin
    insert into public.appointments (
      business_id, staff_id, service_id, customer_id,
      start_at, end_at, estado, origen, external_id, notas
    )
    values (
      p_business_id, p_staff_id, p_service_id, p_customer_id,
      p_start_at, v_end_at, 'confirmada', p_origen, p_external_id, p_notas
    )
    returning * into v_cita;
  exception
    when exclusion_violation then
      raise exception 'El hueco % – % ya está ocupado para ese profesional', p_start_at, v_end_at
        using errcode = 'exclusion_violation',
              hint    = 'Consultá la disponibilidad y ofrecé otro hueco.';
  end;

  return v_cita;
end;
$$;

comment on function public.book_appointment(uuid, uuid, uuid, uuid, timestamptz, text, public.appointment_origen, text) is
  'Fase 0 (esqueleto): inserta una cita de forma atómica apoyándose en la restricción no_overlap. Horarios, festivos y buffers llegan en la Fase 1.';
