-- =============================================================================
-- Antes de la Fase 9 — La clienta es su email; confirmación por email y
-- código para tocar sus citas desde el chat (PA-16, PA-17, PW-18)
-- =============================================================================
-- Decidido por Mariana el 13/11/2026:
--   · PA-17: la ficha se busca por EMAIL. El teléfono se sigue guardando para
--     que el local pueda llamarla, pero ya no identifica. Una clienta sin
--     email reserva igual con su teléfono y se la busca por él.
--   · PW-18: la confirmación de la cita llega por email (el SMS queda apagado).
--   · PA-16: para ver, cancelar o mover una cita desde el chat, un código de
--     seis dígitos al email: 10 minutos, un solo uso, tres intentos y en la
--     base solo su hash (SHA-256), como los demás tokens.
--
--   · customers.email (ya existía, sin uso): en minúsculas y con formato de
--     email. Único por negocio entre las que lo tienen. El teléfono deja de
--     ser único: dos personas con email propio pueden dar el mismo móvil (una
--     madre y su hija). Sigue siendo único entre las fichas SIN email, porque
--     ahí el teléfono es lo que la identifica.
--   · conversations.verificada_at: cuándo la clienta escribió bien el código
--     en esta conversación. Sin él, las herramientas no enseñan ni tocan citas.
--   · codigos_verificacion: los códigos enviados, solo con su hash.
--   · email_messages: cada email generado, con su estado (como sms_messages).
--     Ni el enlace ni el código se guardan: van tapados.
--
-- No se toca ninguna migración anterior. RLS en las tablas nuevas.
-- =============================================================================

set search_path = public;

-- -----------------------------------------------------------------------------
-- customers — el email identifica (PA-17)
-- -----------------------------------------------------------------------------
update public.customers set email = lower(trim(email)) where email is not null;
update public.customers set email = null where email is not null and email = '';

alter table public.customers
  add constraint customers_email_formato
    check (email is null or (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  drop constraint customers_telefono_unico_por_negocio;

create unique index customers_email_unico_por_negocio
  on public.customers (business_id, email) where email is not null;
create unique index customers_telefono_unico_sin_email
  on public.customers (business_id, telefono) where email is null;

comment on index public.customers_email_unico_por_negocio is
  'PA-17: el email identifica a la clienta dentro de UN negocio.';
comment on index public.customers_telefono_unico_sin_email is
  'PA-17: sin email, el teléfono identifica a la clienta (solo entre las fichas sin email).';
comment on column public.customers.email is
  'PA-17: lo que identifica a la clienta (en minúsculas). A él van la confirmación (PW-18) y los códigos (PA-16). NULL = reservó sin email: solo puede cambiar sus citas llamando al local.';

-- -----------------------------------------------------------------------------
-- conversations — verificada con el código (PA-16)
-- -----------------------------------------------------------------------------
alter table public.conversations add column verificada_at timestamptz;

comment on column public.conversations.verificada_at is
  'PA-16: cuándo la clienta escribió bien el código de su email en esta conversación. Sin él no se ven, cancelan ni mueven citas desde el chat.';

-- -----------------------------------------------------------------------------
-- codigos_verificacion (PA-16)
-- -----------------------------------------------------------------------------
create table public.codigos_verificacion (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  conversation_id uuid not null,
  customer_id     uuid not null,
  codigo_hash     text not null check (codigo_hash ~ '^[0-9a-f]{64}$'),
  expira_at       timestamptz not null,
  intentos        integer not null default 0 check (intentos between 0 and 3),
  usado_at        timestamptz,
  created_at      timestamptz not null default now(),
  foreign key (business_id, conversation_id) references public.conversations (business_id, id) on delete cascade,
  foreign key (business_id, customer_id) references public.customers (business_id, id) on delete cascade
);

create index codigos_verificacion_conversacion_idx
  on public.codigos_verificacion (business_id, conversation_id, created_at desc);

comment on table public.codigos_verificacion is
  'PA-16: códigos de 6 dígitos al email de la clienta para ver, cancelar o mover citas desde el chat. 10 minutos, un solo uso, 3 intentos; solo el hash SHA-256 (ligado a la conversación).';

-- -----------------------------------------------------------------------------
-- email_messages (PW-18)
-- -----------------------------------------------------------------------------
create table public.email_messages (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  appointment_id  uuid,
  customer_id     uuid,
  tipo            text not null check (tipo in ('confirmacion', 'cancelacion', 'codigo')),
  email           text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  asunto          text not null check (length(trim(asunto)) > 0),
  -- El texto tal cual se mandó, salvo el enlace y el código, que no se
  -- guardan (van como "[enlace]" y "[código]").
  texto           text not null check (length(trim(texto)) > 0),
  estado          public.sms_estado not null default 'pendiente',
  proveedor       text not null,
  proveedor_id    text,
  error           text,
  created_at      timestamptz not null default now(),
  enviado_at      timestamptz,
  foreign key (business_id, appointment_id) references public.appointments (business_id, id) on delete cascade,
  foreign key (business_id, customer_id) references public.customers (business_id, id) on delete cascade
);

create index email_messages_business_idx on public.email_messages (business_id, created_at desc);
create index email_messages_appointment_idx on public.email_messages (appointment_id);
create index email_messages_fallidos_idx on public.email_messages (business_id, created_at desc)
  where estado = 'fallido';

comment on table public.email_messages is
  'PW-18: emails de confirmación y cancelación de citas, y códigos (PA-16). Si el envío falla la cita sigue valiendo y el email queda "fallido". "prueba" = proveedor de prueba (no se envió de verdad). Mismos estados que sms_messages.';

-- -----------------------------------------------------------------------------
-- RLS en lo nuevo (maestro §3.3), igual que en …120600_rls.sql
-- -----------------------------------------------------------------------------
do $do$
declare
  v_tabla text;
begin
  foreach v_tabla in array array['codigos_verificacion', 'email_messages'] loop
    execute format('alter table public.%I enable row level security', v_tabla);
    execute format(
      'create policy tenant_isolation on public.%I
         for all
         using      (business_id = app.current_business_id())
         with check (business_id = app.current_business_id())',
      v_tabla
    );
    execute format(
      'comment on policy tenant_isolation on public.%I is %L',
      v_tabla,
      'Aislamiento por tenant. El backend (service_role) hace BYPASSRLS; esta política cubre el resto de accesos.'
    );
  end loop;
end
$do$;
