-- =============================================================================
-- Fase 0 · 0.2 — Tenant y configuración (maestro §5.1)
-- =============================================================================
-- businesses · services · staff · staff_services · business_hours · time_off
--
-- Convenciones de todo el esquema:
--   · PK uuid con gen_random_uuid() (nativo en PG 13+, no hace falta pgcrypto).
--   · created_at timestamptz default now(). Todo se guarda en UTC; el timezone
--     del negocio (businesses.timezone) es solo para mostrar (maestro §9).
--   · Toda tabla operativa lleva business_id (maestro §3.3).
--   · Cada tabla hija declara UNIQUE (business_id, id) para poder ser destino de
--     claves foráneas COMPUESTAS. Eso hace imposible a nivel de base que una
--     fila apunte a un recurso de OTRO negocio (p. ej. una cita del negocio A
--     con un profesional del negocio B). Es aislamiento estructural, además del
--     que da RLS.
-- =============================================================================

set search_path = public;

-- -----------------------------------------------------------------------------
-- businesses — un registro por cliente que paga
-- -----------------------------------------------------------------------------
create type public.business_estado as enum ('activo', 'pausado', 'trial');

create table public.businesses (
  id                       uuid primary key default gen_random_uuid(),
  nombre                   text not null check (length(trim(nombre)) > 0),
  slug                     text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  timezone                 text not null default 'Europe/Madrid',
  sector                   text,
  estado                   public.business_estado not null default 'trial',
  plan                     text,
  whatsapp_phone_number_id text unique,
  tono_de_voz              text,
  mensaje_bienvenida       text,
  politica_cancelacion     text,
  direccion                text,
  telefono_humano          text,
  created_at               timestamptz not null default now()
);

comment on table  public.businesses is 'Tenant. Un registro por negocio cliente.';
comment on column public.businesses.timezone is
  'IANA tz del negocio (ej. Europe/Madrid). Solo para PRESENTAR: en la base todo va en UTC.';
comment on column public.businesses.whatsapp_phone_number_id is
  'Resolución de tenant por número (Fase 8). NULL mientras el canal sea solo widget web.';

-- -----------------------------------------------------------------------------
-- services — qué vende cada negocio
-- -----------------------------------------------------------------------------
create table public.services (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  nombre         text not null check (length(trim(nombre)) > 0),
  descripcion    text,
  duracion_min   integer not null check (duracion_min > 0),
  buffer_min     integer not null default 0 check (buffer_min >= 0),
  precio         numeric(10,2) check (precio >= 0),
  precio_visible boolean not null default true,
  activo         boolean not null default true,
  created_at     timestamptz not null default now(),
  unique (business_id, id)
);

create index services_business_id_idx on public.services (business_id);
create index services_activos_idx     on public.services (business_id) where activo;

comment on column public.services.buffer_min is
  'Minutos de margen DESPUÉS de la cita (limpieza, notas). No forma parte de end_at: lo consume el cálculo de huecos de la Fase 1.';
comment on column public.services.precio_visible is
  'Si es false el agente no cita el precio (maestro §6: nunca afirma un precio que no venga de la config).';

-- -----------------------------------------------------------------------------
-- staff — profesionales o recursos (sillón, sala, box)
-- -----------------------------------------------------------------------------
create table public.staff (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  nombre      text not null check (length(trim(nombre)) > 0),
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (business_id, id)
);

create index staff_business_id_idx on public.staff (business_id);

comment on table public.staff is
  'Profesional o recurso reservable. La restricción anti-solapamiento de appointments se aplica por staff_id.';

-- -----------------------------------------------------------------------------
-- staff_services — qué servicio puede dar cada profesional
-- -----------------------------------------------------------------------------
create table public.staff_services (
  business_id uuid not null references public.businesses(id) on delete cascade,
  staff_id    uuid not null,
  service_id  uuid not null,
  created_at  timestamptz not null default now(),
  primary key (staff_id, service_id),
  foreign key (business_id, staff_id)   references public.staff (business_id, id)    on delete cascade,
  foreign key (business_id, service_id) references public.services (business_id, id) on delete cascade
);

create index staff_services_business_id_idx on public.staff_services (business_id);
create index staff_services_service_id_idx  on public.staff_services (service_id);

comment on table public.staff_services is
  'Tabla puente. Las FK compuestas garantizan que profesional y servicio son del MISMO negocio.';

-- -----------------------------------------------------------------------------
-- business_hours — horario de atención
-- -----------------------------------------------------------------------------
create table public.business_hours (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  staff_id      uuid,
  weekday       smallint not null check (weekday between 0 and 6),
  hora_apertura time not null,
  hora_cierre   time not null,
  created_at    timestamptz not null default now(),
  constraint business_hours_tramo_valido check (hora_cierre > hora_apertura),
  foreign key (business_id, staff_id) references public.staff (business_id, id) on delete cascade,
  -- NULLS NOT DISTINCT: evita duplicar el mismo tramo del negocio (staff_id NULL).
  constraint business_hours_tramo_unico
    unique nulls not distinct (business_id, staff_id, weekday, hora_apertura, hora_cierre)
);

create index business_hours_lookup_idx on public.business_hours (business_id, weekday);

comment on column public.business_hours.staff_id is
  'NULL = el tramo aplica a todo el negocio. Con valor = horario propio de ese profesional.';
comment on column public.business_hours.weekday is
  'Día de la semana estilo ISO/EXTRACT(dow): 0 = domingo … 6 = sábado.';
comment on column public.business_hours.hora_apertura is
  'Hora LOCAL del negocio (businesses.timezone). La conversión a UTC la hace el cálculo de huecos (Fase 1).';

-- -----------------------------------------------------------------------------
-- time_off — festivos, vacaciones, bloqueos puntuales
-- -----------------------------------------------------------------------------
create table public.time_off (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  staff_id    uuid,
  desde       timestamptz not null,
  hasta       timestamptz not null,
  motivo      text,
  created_at  timestamptz not null default now(),
  constraint time_off_rango_valido check (hasta > desde),
  foreign key (business_id, staff_id) references public.staff (business_id, id) on delete cascade
);

create index time_off_lookup_idx on public.time_off (business_id, desde, hasta);

comment on column public.time_off.staff_id is
  'NULL = cierra el negocio entero (festivo). Con valor = ausencia de ese profesional.';
