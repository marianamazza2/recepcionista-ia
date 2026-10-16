-- =============================================================================
-- Fase 0 · 0.2 — Conversación (maestro §5.3)
-- =============================================================================
-- conversations · messages · escalations
--
-- Las tablas se crean ahora; las escribe el núcleo del agente (Fase 2) y el
-- canal widget web (Fase 3).
-- =============================================================================

set search_path = public;

-- -----------------------------------------------------------------------------
-- conversations — un hilo por cliente final
-- -----------------------------------------------------------------------------
create type public.conversation_canal  as enum ('web', 'whatsapp', 'instagram');
create type public.conversation_estado as enum ('activa', 'escalada', 'cerrada');

create table public.conversations (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses(id) on delete cascade,
  customer_id       uuid,
  canal             public.conversation_canal  not null default 'web',
  estado            public.conversation_estado not null default 'activa',
  ultimo_mensaje_at timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  foreign key (business_id, customer_id) references public.customers (business_id, id),
  unique (business_id, id)
);

create index conversations_business_idx on public.conversations (business_id, ultimo_mensaje_at desc);
create index conversations_customer_idx on public.conversations (customer_id);

comment on column public.conversations.customer_id is
  'NULL hasta identificar a la persona. En el widget web la conversación arranca anónima y el cliente se crea cuando deja su teléfono.';
comment on column public.conversations.canal is
  'Canal de entrada. El MVP solo usa ''web''; ''whatsapp'' llega en la Fase 8.';

-- -----------------------------------------------------------------------------
-- messages
-- -----------------------------------------------------------------------------
create type public.message_rol as enum ('user', 'assistant', 'tool');

create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  -- business_id va desnormalizado a propósito: la regla del maestro §3.3 es que
  -- ninguna tabla existe sin business_id, y así RLS se aplica sin un JOIN a
  -- conversations en cada política. La FK compuesta impide que se desincronice.
  business_id     uuid not null references public.businesses(id) on delete cascade,
  conversation_id uuid not null,
  rol             public.message_rol not null,
  contenido       text,
  tool_calls      jsonb,
  tokens_in       integer not null default 0 check (tokens_in  >= 0),
  tokens_out      integer not null default 0 check (tokens_out >= 0),
  external_id     text,
  created_at      timestamptz not null default now(),
  foreign key (business_id, conversation_id)
    references public.conversations (business_id, id) on delete cascade,
  -- Idempotencia (maestro §9): los canales reenvían. El mismo message_id del
  -- canal no puede entrar dos veces y agendar la cita por duplicado.
  constraint messages_external_id_unico unique (business_id, external_id)
);

create index messages_conversation_idx on public.messages (conversation_id, created_at);
create index messages_business_idx     on public.messages (business_id, created_at);

comment on column public.messages.external_id is
  'Id del mensaje en el canal de origen. Clave de idempotencia para descartar reenvíos (maestro §9).';
comment on column public.messages.tool_calls is
  'Tool calls del turno, tal cual las devuelve el LLM. Es el log auditable de qué hizo el agente (maestro §9).';

-- -----------------------------------------------------------------------------
-- escalations — cuando pasa a un humano
-- -----------------------------------------------------------------------------
create table public.escalations (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  conversation_id uuid not null,
  motivo          text,
  resuelta        boolean not null default false,
  created_at      timestamptz not null default now(),
  foreign key (business_id, conversation_id)
    references public.conversations (business_id, id) on delete cascade
);

create index escalations_pendientes_idx on public.escalations (business_id, created_at desc)
  where not resuelta;
create index escalations_conversation_idx on public.escalations (conversation_id);
