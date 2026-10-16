-- =============================================================================
-- Fase 0 · 0.2 — Integraciones y consumo (maestro §5.5)
-- =============================================================================
-- integrations · usage_events
-- =============================================================================

set search_path = public;

-- -----------------------------------------------------------------------------
-- integrations — dónde vive la agenda real de cada negocio
-- -----------------------------------------------------------------------------
create type public.integration_tipo as enum ('supabase', 'google_calendar', 'calcom');

create table public.integrations (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  tipo          public.integration_tipo not null,
  credenciales  text,
  config        jsonb not null default '{}'::jsonb,
  activa        boolean not null default true,
  created_at    timestamptz not null default now(),
  constraint integrations_una_por_tipo unique (business_id, tipo)
);

create index integrations_business_idx on public.integrations (business_id);

comment on column public.integrations.credenciales is
  'SIEMPRE cifrado en la capa de aplicación: acá nunca se guarda un secreto en claro (maestro §9, RGPD).';
comment on column public.integrations.config is
  'Parámetros no sensibles del adaptador (calendar_id, urls, mapeos).';

-- -----------------------------------------------------------------------------
-- usage_events — para saber el margen real (maestro §14: riesgo nº1)
-- -----------------------------------------------------------------------------
create type public.usage_tipo as enum ('mensaje', 'token', 'cita');

create table public.usage_events (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  tipo            public.usage_tipo not null,
  cantidad        numeric(14,4) not null check (cantidad >= 0),
  coste_estimado  numeric(12,6) not null default 0 check (coste_estimado >= 0),
  created_at      timestamptz not null default now()
);

-- El uso se consulta siempre "de este negocio, en este periodo".
create index usage_events_business_periodo_idx on public.usage_events (business_id, created_at desc);
create index usage_events_tipo_idx             on public.usage_events (business_id, tipo, created_at desc);

comment on table public.usage_events is
  'Consumo por tenant desde el día uno (maestro §1). Alimenta el coste real y los topes por cliente.';
comment on column public.usage_events.coste_estimado is
  'Coste en EUR. numeric(12,6) porque un token cuesta fracciones de céntimo.';
