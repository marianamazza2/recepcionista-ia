-- =============================================================================
-- Fase 4 · aceptación 31 — Tramos de horario sin solape (PD-01)
-- =============================================================================
-- La API aceptaba 10–14 y 13–18 para el mismo día. Además de duplicar huecos,
-- eso podía cambiar la rejilla según el tramo consultado. Dos exclusiones
-- impiden el solape también con escrituras concurrentes y con staff_id NULL.
-- El horario propio sigue reemplazando al local (PD-01): no se comparan entre
-- sí, ni entre profesionales o negocios. Los límites [) permiten tramos
-- contiguos y 24:00. Se conservan datos, RLS y migraciones anteriores.
-- =============================================================================

set search_path = public, extensions;

alter table public.business_hours
  add constraint business_hours_local_sin_solape
  exclude using gist (
    business_id with =,
    weekday with =,
    (numrange(extract(epoch from hora_apertura), extract(epoch from hora_cierre), '[)')) with &&
  ) where (staff_id is null),
  add constraint business_hours_staff_sin_solape
  exclude using gist (
    business_id with =,
    staff_id with =,
    weekday with =,
    (numrange(extract(epoch from hora_apertura), extract(epoch from hora_cierre), '[)')) with &&
  ) where (staff_id is not null);

comment on constraint business_hours_local_sin_solape on public.business_hours is
  'Fase 4, aceptación 31: el local no puede tener tramos solapados el mismo día; contiguos sí.';
comment on constraint business_hours_staff_sin_solape on public.business_hours is
  'PD-01, aceptación 31: cada profesional tiene tramos propios sin solape; independientes del local y del resto del equipo.';

set search_path = public;
