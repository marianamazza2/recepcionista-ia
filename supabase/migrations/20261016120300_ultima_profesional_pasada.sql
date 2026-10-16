-- =============================================================================
-- Fase 1 · PR-06 — ultima_profesional solo mira citas pasadas y atendidas
-- =============================================================================
-- Decidido por Mariana el 16/10/2026: "la última vez te atendió Marta" se
-- refiere a una cita que YA PASÓ. Una cita futura no cuenta, y una marcada
-- como no_show tampoco (esa vez nadie la atendió).
--
-- Cuenta como pasada la cita que ya empezó (start_at <= now()). Las
-- confirmadas que ya pasaron cuentan aunque nadie las haya marcado como
-- completadas: en el MVP nadie actualiza ese estado a mano.
-- =============================================================================

set search_path = public;

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
     and a.estado in ('confirmada', 'completada')
     and a.start_at <= now()
   order by a.start_at desc, a.created_at desc
   limit 1;
$$;

comment on function public.ultima_profesional(uuid, uuid) is
  'PR-06: profesional de la última cita YA PASADA y atendida (confirmada o completada) de esa clienta, o NULL. Las futuras, canceladas y no_show no cuentan.';
