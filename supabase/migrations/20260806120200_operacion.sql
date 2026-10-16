-- =============================================================================
-- Fase 0 · 0.2 + 0.3 — Operación (maestro §5.2)
-- =============================================================================
-- customers · appointments · LA RESTRICCIÓN ANTI-SOLAPAMIENTO
--
-- Esta migración contiene la garantía comercial del producto. Leer 0.3 del spec
-- de fase antes de tocar nada de acá.
-- =============================================================================

-- El opclass `gist_uuid_ops` que necesita `staff_id WITH =` lo aporta btree_gist,
-- instalado en el esquema `extensions`.
set search_path = public, extensions;

-- -----------------------------------------------------------------------------
-- customers — clientes finales del negocio
-- -----------------------------------------------------------------------------
create table public.customers (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  telefono    text not null check (length(trim(telefono)) > 0),
  nombre      text,
  email       text,
  notas       text,
  created_at  timestamptz not null default now(),
  -- El teléfono identifica al cliente DENTRO de un negocio, no globalmente:
  -- la misma persona puede ser clienta de dos negocios distintos.
  constraint customers_telefono_unico_por_negocio unique (business_id, telefono),
  unique (business_id, id)
);

create index customers_business_id_idx on public.customers (business_id);

comment on constraint customers_telefono_unico_por_negocio on public.customers is
  'Un teléfono identifica a un cliente dentro de UN negocio. El mismo teléfono puede existir en otros negocios.';

-- -----------------------------------------------------------------------------
-- appointments — el corazón del sistema
-- -----------------------------------------------------------------------------
create type public.appointment_estado as enum ('confirmada', 'cancelada', 'completada', 'no_show');
create type public.appointment_origen as enum ('agente', 'manual', 'externo');

create table public.appointments (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  staff_id    uuid not null,
  service_id  uuid not null,
  customer_id uuid not null,
  start_at    timestamptz not null,
  end_at      timestamptz not null,
  estado      public.appointment_estado not null default 'confirmada',
  origen      public.appointment_origen not null default 'agente',
  external_id text,
  notas       text,
  created_at  timestamptz not null default now(),

  constraint appointments_rango_valido check (end_at > start_at),

  -- FK COMPUESTAS, sin acción de borrado explícita (NO ACTION):
  --   · Borrar un servicio/profesional/cliente CON citas históricas falla →
  --     el histórico no se rompe por accidente.
  --   · Borrar el negocio entero sí funciona: NO ACTION se comprueba al final
  --     de la sentencia, para entonces el CASCADE de business_id ya se llevó
  --     las citas por delante. (Con RESTRICT esto fallaría.)
  foreign key (business_id, staff_id)    references public.staff (business_id, id),
  foreign key (business_id, service_id)  references public.services (business_id, id),
  foreign key (business_id, customer_id) references public.customers (business_id, id),

  -- Idempotencia frente a sistemas externos y reenvíos (maestro §9).
  constraint appointments_external_id_unico unique (business_id, external_id)
);

create index appointments_business_start_idx on public.appointments (business_id, start_at);
create index appointments_staff_start_idx    on public.appointments (staff_id, start_at);
create index appointments_customer_idx       on public.appointments (customer_id);
create index appointments_service_idx        on public.appointments (service_id);
-- La agenda del día casi siempre se consulta sin las canceladas.
create index appointments_agenda_idx on public.appointments (business_id, start_at)
  where estado <> 'cancelada';

comment on column public.appointments.end_at is
  'Fin del servicio en sí. NO incluye services.buffer_min: el buffer lo aplica el cálculo de huecos (Fase 1).';
comment on column public.appointments.external_id is
  'Id en el sistema de origen (Google Calendar, CRM) o clave de idempotencia del canal.';

-- =============================================================================
-- 🔒 GARANTÍA ANTI-SOLAPAMIENTO (spec de fase 0.3 · maestro §5.2)
-- =============================================================================
-- Dos citas del MISMO profesional cuyos rangos se pisan no pueden coexistir.
-- Las canceladas quedan fuera del índice, así que no bloquean su hueco.
--
-- Esto NO se delega al código de aplicación ni al criterio del LLM: aunque dos
-- reservas lleguen en el mismo milisegundo, Postgres rechaza la segunda con
-- SQLSTATE 23P01 (exclusion_violation).
--
-- Detalles que importan:
--   · tstzrange(start_at, end_at) usa el borde por defecto '[)', o sea que una
--     cita 10:00–11:00 y otra 11:00–12:00 NO se pisan. Es lo que queremos.
--   · staff_id es NOT NULL a propósito: con NULL el operador `=` no casaría y
--     la restricción no protegería esas filas.
--   · Requiere btree_gist (por `staff_id WITH =` sobre uuid).
-- =============================================================================
alter table public.appointments
  add constraint no_overlap
  exclude using gist (
    staff_id                       with =,
    tstzrange(start_at, end_at)    with &&
  ) where (estado <> 'cancelada');

comment on constraint no_overlap on public.appointments is
  'Garantía comercial del producto: imposible solapar dos citas del mismo profesional. Las canceladas no cuentan.';
