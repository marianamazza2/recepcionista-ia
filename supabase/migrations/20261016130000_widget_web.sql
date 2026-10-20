-- =============================================================================
-- Fase 3 · 3.1 — Canal widget web
-- =============================================================================
-- Lo que necesita el widget para atender desde la web de un negocio:
--
--   · businesses: la clave pública del widget, dónde puede ir (PW-06), su color
--     (PW-01), la URL de su política de privacidad (PW-02) y el tope mensual de
--     coste (PW-04).
--   · conversations: el hash del token de sesión del navegador (el token solo lo
--     tiene el navegador) y el hash de la IP para el límite de conversaciones
--     nuevas por hora (PW-05).
--   · usage_events: el coste pasa a US$ (los precios de la API están en dólares)
--     y cada evento se enlaza con su conversación para el informe de consumo.
--   · appointment_links: el enlace del SMS a la página de la cita (PW-07). Solo
--     se guarda el hash del token.
--   · sms_messages: cada SMS que se genera, con su estado (PW-07).
--
-- No se toca ninguna migración anterior. RLS en las dos tablas nuevas, igual
-- que el resto (el test 04 falla si alguna queda sin política).
-- =============================================================================

set search_path = public;

-- -----------------------------------------------------------------------------
-- businesses — ajustes del widget
-- -----------------------------------------------------------------------------
alter table public.businesses
  -- Pública por diseño (va en el <script> de la web del negocio). Lo que
  -- protege es el dominio, los límites y el token de sesión, no la clave.
  -- El default se evalúa por fila: cada negocio existente recibe una distinta.
  add column widget_key text not null unique
    default 'wk_' || replace(gen_random_uuid()::text, '-', '')
    constraint businesses_widget_key_formato check (widget_key ~ '^wk_[A-Za-z0-9_]{16,64}$'),
  add column widget_dominios text[] not null default '{}'
    constraint businesses_widget_dominios_minusculas check (widget_dominios = lower(widget_dominios::text)::text[]),
  add column widget_color text not null default '#4f6d7a'
    constraint businesses_widget_color_hex check (widget_color ~ '^#[0-9a-fA-F]{6}$'),
  add column privacidad_url text
    constraint businesses_privacidad_url_http check (privacidad_url ~ '^https?://'),
  add column tope_mensual_usd numeric(10,2) not null default 100
    constraint businesses_tope_valido check (tope_mensual_usd >= 0);

comment on column public.businesses.widget_key is
  'Fase 3: clave PÚBLICA del widget (data-key del <script>). Identifica al negocio; no es un secreto.';
comment on column public.businesses.widget_dominios is
  'PW-06: hosts donde puede cargar el widget (ej. {esteticaaurora.es,www.esteticaaurora.es}). Sin puerto ni esquema. Vacío = en ninguno.';
comment on column public.businesses.widget_color is
  'PW-01: color de la marca del negocio en el widget (#RRGGBB).';
comment on column public.businesses.privacidad_url is
  'PW-02: URL de la política de privacidad del negocio. NULL = el aviso sale sin enlace.';
comment on column public.businesses.tope_mensual_usd is
  'PW-04: coste máximo del agente por mes natural, en US$. Al llegar, el widget responde con un texto fijo sin llamar a la IA. De serie 100.';

-- -----------------------------------------------------------------------------
-- conversations — sesión del navegador (PW-03) y límite por IP (PW-05)
-- -----------------------------------------------------------------------------
alter table public.conversations
  add column session_token_hash text unique
    constraint conversations_session_token_hash_formato check (session_token_hash ~ '^[0-9a-f]{64}$'),
  add column ip_hash text
    constraint conversations_ip_hash_formato check (ip_hash ~ '^[0-9a-f]{64}$');

create index conversations_ip_recientes_idx on public.conversations (business_id, ip_hash, created_at desc)
  where ip_hash is not null;

comment on column public.conversations.session_token_hash is
  'Fase 3: SHA-256 del token de sesión del widget. El token solo lo guarda el navegador; sin él no se lee ni se escribe la conversación. NULL en las de la Terminal.';
comment on column public.conversations.ip_hash is
  'PW-05: SHA-256 de (negocio, IP) de quien la empezó, para limitar conversaciones nuevas por hora. No se guarda la IP.';

-- -----------------------------------------------------------------------------
-- usage_events — en US$ y enlazados a la conversación
-- -----------------------------------------------------------------------------
alter table public.usage_events
  add column conversation_id uuid,
  add column detalle jsonb not null default '{}'::jsonb,
  -- Si algún día se borra una conversación (PD-11), el consumo se queda: es
  -- la base del margen. Solo se pierde el enlace.
  add constraint usage_events_conversation_fk
    foreign key (business_id, conversation_id)
    references public.conversations (business_id, id)
    on delete set null (conversation_id);

create index usage_events_conversation_idx on public.usage_events (conversation_id)
  where conversation_id is not null;

comment on column public.usage_events.coste_estimado is
  'Coste en US$ (los precios de la API están en dólares; Fase 3 corrigió el "EUR" de la Fase 0). numeric(12,6) porque un token cuesta fracciones de céntimo.';
comment on column public.usage_events.conversation_id is
  'Conversación que generó el consumo (NULL si se borró o si no viene de una).';
comment on column public.usage_events.detalle is
  'Desglose para auditar: tokens por tipo y modelo, id de la cita, motivo de una respuesta fija…';

-- -----------------------------------------------------------------------------
-- appointment_links — el enlace del SMS a la página de la cita (PW-07)
-- -----------------------------------------------------------------------------
-- Hasta ahora ninguna tabla apuntaba a una cita. Como el resto de tablas hijas
-- (D-02), appointments declara UNIQUE (business_id, id) para ser destino de FK
-- compuestas: un enlace o un SMS no puede apuntar a una cita de otro negocio.
alter table public.appointments
  add constraint appointments_business_id_id_key unique (business_id, id);

create table public.appointment_links (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  appointment_id uuid not null,
  -- SHA-256 del token del enlace. El token solo viaja en el SMS.
  token_hash     text not null unique
    constraint appointment_links_token_hash_formato check (token_hash ~ '^[0-9a-f]{64}$'),
  -- Deja de valer al pasar la cita.
  expira_at      timestamptz not null,
  created_at     timestamptz not null default now(),
  foreign key (business_id, appointment_id)
    references public.appointments (business_id, id) on delete cascade
);

create index appointment_links_appointment_idx on public.appointment_links (appointment_id);

comment on table public.appointment_links is
  'PW-07: enlaces a la página de una cita (/cita/:token). Solo el hash del token; caduca al terminar la cita.';

-- -----------------------------------------------------------------------------
-- sms_messages — cada SMS generado (PW-07)
-- -----------------------------------------------------------------------------
create type public.sms_estado as enum ('pendiente', 'enviado', 'fallido', 'prueba');

create table public.sms_messages (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  appointment_id uuid,
  telefono       text not null check (telefono ~ '^\+[0-9]{6,15}$'),
  -- El texto tal cual se mandó, salvo el token del enlace, que no se guarda
  -- (va como "[enlace]"). Para reintentar se genera un enlace nuevo.
  texto          text not null check (length(trim(texto)) > 0),
  estado         public.sms_estado not null default 'pendiente',
  proveedor      text not null,
  proveedor_id   text,
  error          text,
  created_at     timestamptz not null default now(),
  enviado_at     timestamptz,
  foreign key (business_id, appointment_id)
    references public.appointments (business_id, id) on delete cascade
);

create index sms_messages_business_idx on public.sms_messages (business_id, created_at desc);
create index sms_messages_appointment_idx on public.sms_messages (appointment_id);
create index sms_messages_fallidos_idx on public.sms_messages (business_id, created_at desc)
  where estado = 'fallido';

comment on table public.sms_messages is
  'PW-07: SMS de confirmación. Si el envío falla la cita sigue valiendo y el SMS queda "fallido" para reintentar. "prueba" = proveedor de prueba (no se envió de verdad).';

-- -----------------------------------------------------------------------------
-- RLS en lo nuevo (maestro §3.3), igual que en …120600_rls.sql
-- -----------------------------------------------------------------------------
do $do$
declare
  v_tabla text;
begin
  foreach v_tabla in array array['appointment_links', 'sms_messages'] loop
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
