-- =============================================================================
-- Fase 1 · 1.1 — Ajustes por negocio
-- =============================================================================
-- Cuatro columnas nuevas en `businesses` que convierten en configuración las
-- reglas de producto de `_specs/decisiones-producto.md`. Los valores por
-- defecto son los "de serie" de ese documento, así que un negocio recién dado
-- de alta funciona sin tocar nada.
--
-- `asignacion_profesional` no interviene en el cálculo de huecos: le dice al
-- agente (Fase 2) si pregunta antes de asignar profesional. Se crea ahora para
-- que la configuración quede completa.
-- =============================================================================

set search_path = public;

-- El enum va en su propia sentencia (D-04): si en el futuro hace falta añadir
-- un modo, será un `alter type … add value` en una migración aparte.
create type public.asignacion_profesional as enum ('preguntar', 'automatica');

alter table public.businesses
  add column antelacion_min_horas   integer not null default 2
    constraint businesses_antelacion_valida check (antelacion_min_horas >= 0),
  add column intervalo_huecos_min   integer not null default 30
    constraint businesses_intervalo_valido check (intervalo_huecos_min > 0 and intervalo_huecos_min <= 240),
  add column margen_dentro_horario  boolean not null default false,
  add column asignacion_profesional public.asignacion_profesional not null default 'preguntar';

comment on column public.businesses.antelacion_min_horas is
  'PD-05: horas mínimas entre ahora y el inicio de una reserva. De serie 2.';
comment on column public.businesses.intervalo_huecos_min is
  'PR-01: los huecos empiezan cada N minutos desde la apertura de cada tramo. De serie 30.';
comment on column public.businesses.margen_dentro_horario is
  'PR-02: si true, servicio + margen tienen que caber antes del cierre; si false (de serie), basta con el servicio.';
comment on column public.businesses.asignacion_profesional is
  'PD-03: si el agente pregunta con quién (de serie) o asigna solo. No cambia el cálculo de huecos.';
