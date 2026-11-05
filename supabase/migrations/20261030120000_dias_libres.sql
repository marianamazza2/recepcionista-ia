-- =============================================================================
-- Fase 4 · PI-19 — Días que una profesional no trabaja (amplía PD-01)
-- =============================================================================
-- Al probar el panel (30/10/2026), una profesional con horario propio solo el
-- jueves y el sábado "trabajaba" también el viernes: por PD-01, un día sin
-- horario propio hereda el del local, y no había forma de decir que ese día
-- no trabaja. Mariana decidió (PI-19) que cada día de cada profesional tiene
-- tres estados:
--
--   · como el local (de serie): sin fila aquí ni tramos propios ese weekday;
--   · horas propias: tramos en business_hours con su staff_id (PD-01);
--   · no trabaja: una fila en staff_dias_libres para ese weekday.
--
-- El motor lo aplica en UN solo sitio: app.tramos_efectivos() no devuelve
-- ningún tramo ese día, así que available_slots y slot_es_valido (D-26), y
-- con ellos book_appointment y las citas a mano (PI-14, p_manual), dejan de
-- ofrecer y de aceptar ese día para esa profesional. Si por error hubiera a
-- la vez tramos propios y "no trabaja" el mismo día, gana "no trabaja" (la
-- API del panel no deja guardar las dos cosas).
--
-- Tabla de un negocio: business_id, FK compuesta con staff (D-02), RLS y
-- política tenant_isolation como el resto. No se toca ninguna migración
-- anterior.
-- =============================================================================

set search_path = public;

create table public.staff_dias_libres (
  business_id uuid not null references public.businesses(id) on delete cascade,
  staff_id    uuid not null,
  weekday     smallint not null check (weekday between 0 and 6),
  created_at  timestamptz not null default now(),
  primary key (staff_id, weekday),
  foreign key (business_id, staff_id) references public.staff (business_id, id) on delete cascade
);

create index staff_dias_libres_business_idx on public.staff_dias_libres (business_id, weekday);

comment on table public.staff_dias_libres is
  'PI-19: días de la semana en que una profesional NO trabaja aunque el local abra. Sin fila ni tramos propios = trabaja como el local (PD-01).';
comment on column public.staff_dias_libres.weekday is
  'Como business_hours.weekday: 0 = domingo … 6 = sábado (D-10).';

alter table public.staff_dias_libres enable row level security;

create policy tenant_isolation on public.staff_dias_libres
  for all
  using      (business_id = app.current_business_id())
  with check (business_id = app.current_business_id());

comment on policy tenant_isolation on public.staff_dias_libres is
  'Aislamiento por tenant. El backend (service_role) hace BYPASSRLS; esta política cubre el resto de accesos.';

-- -----------------------------------------------------------------------------
-- Tramos efectivos de una profesional en un día local (PD-01 + PI-19)
-- -----------------------------------------------------------------------------
-- Igual que en …120100_motor_disponibilidad, más una condición: si ese
-- weekday la profesional no trabaja, ningún tramo.
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
     and not exists (
           select 1 from public.staff_dias_libres l
            where l.business_id = p_business_id
              and l.staff_id    = p_staff_id
              and l.weekday     = extract(dow from p_dia))
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
  'PD-01 + PI-19: tramos que trabaja una profesional un día local, en UTC. El horario propio reemplaza al del negocio ese weekday; un día en staff_dias_libres no tiene ninguno.';
