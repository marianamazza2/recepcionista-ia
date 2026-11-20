-- =============================================================================
-- Fase 9 · 9.1 — Portal del cliente, alta por chat y turnos sueltos
-- =============================================================================
-- Lo que necesita la Fase 9 (_specs/fase-9-portal-cliente.md):
--
--   · portal.invitaciones (PC-02): el enlace que Mariana genera desde su
--     panel, ligado a UN negocio y a UN email. De la base solo sale el hash
--     del token (como las sesiones del widget): un enlace no se puede
--     reconstruir desde aquí. Un solo uso, caduca a los 7 días, anulable.
--   · portal.codigos (PC-02, PC-15): el código de seis dígitos que confirma
--     ese email antes de crear la cuenta. Mismas reglas que PA-16 (10
--     minutos, tres intentos, un solo uso) y en la base solo su hash.
--   · portal.cuentas (PC-11): la cuenta del cliente. NO es una cuenta de
--     Supabase Auth: crear usuarios desde el servidor pediría la
--     SUPABASE_SERVICE_ROLE_KEY, que no puede ir a Vercel (§6 del AGENTS.md
--     raíz), y el alta con la clave anon abriría registro público, que PC-11
--     prohíbe (el enlace es la única puerta). La contraseña se guarda con
--     scrypt (src/portal/password.ts), nunca en claro.
--   · portal.sesiones: el token de sesión del portal, otra vez solo su hash.
--   · portal.alta (PC-03, PC-11, PC-13): por qué sección va el chat del alta,
--     cuándo terminó y cuándo lo revisó Mariana (el aviso de su panel).
--
--   Todo eso vive en el esquema `portal` y no en `public` por lo mismo que
--   panel.personas (Fase 4): PostgREST solo expone `public`, y aquí hay
--   contraseñas y tokens. RLS activo y SIN política, como panel.personas:
--   solo el servidor (BYPASSRLS) las lee. Aun así cada tabla lleva su
--   business_id con FK en cascada, y TODA consulta filtra por él (T-03): que
--   una cuenta solo toque su negocio lo decide el código, no la URL ni el chat.
--
--   · public.staff_turnos_sueltos (PC-06): una profesional trabaja un día
--     concreto fuera de su horario. Es dato de negocio normal, así que va en
--     `public` con business_id, RLS y política de tenant.
--     En el motor manda sobre todo lo demás ESE día (app.tramos_efectivos) y,
--     si ese día es festivo del LOCAL, abre la agenda solo para ella y solo
--     esas horas (app.slot_es_valido): sus propias ausencias siguen cerrando.
--   · public.conversations.alta (PC-14): la conversación del PORTAL — el chat
--     del alta y los cambios que el cliente pide después por el mismo chat.
--     Su gasto de IA no cuenta para el tope del negocio (PW-04 es para
--     atender clientas) y se ve aparte en el consumo. PC-14 nombra el chat
--     del alta; que el chat del portal de después vaya por el mismo camino
--     es la misma idea (no es una clienta), anotado como ⚠️ por confirmar en
--     decisiones-producto.md.
--
-- No se toca ninguna migración anterior.
-- =============================================================================

set search_path = public;

-- -----------------------------------------------------------------------------
-- Esquema portal
-- -----------------------------------------------------------------------------
create schema if not exists portal;
revoke all on schema portal from public;

comment on schema portal is
  'Fase 9: cuentas, sesiones, invitaciones y estado del alta del portal del cliente. No se expone por PostgREST: aquí hay contraseñas y tokens.';

-- -----------------------------------------------------------------------------
-- portal.invitaciones (PC-02)
-- -----------------------------------------------------------------------------
create table portal.invitaciones (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  email       text not null
    constraint invitaciones_email_minusculas check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+$'),
  token_hash  text not null unique,
  expira_at   timestamptz not null,
  usada_at    timestamptz,
  anulada_at  timestamptz,
  created_at  timestamptz not null default now()
);

create index invitaciones_business_idx on portal.invitaciones (business_id, created_at desc);

comment on table portal.invitaciones is
  'PC-02: el enlace de invitación de un negocio. Un solo uso, 7 días, anulable. Solo el hash del token (sha256): el enlace no se puede reconstruir desde la base.';
comment on column portal.invitaciones.email is
  'PC-02: el email del contacto. La cuenta se crea con ESE email y hay que confirmarlo con un código.';
comment on column portal.invitaciones.anulada_at is
  'PC-02: Mariana la anuló, o se generó otra para el mismo negocio (la anterior deja de valer al momento).';

-- -----------------------------------------------------------------------------
-- portal.codigos (PC-02): confirmar el email antes de crear la cuenta
-- -----------------------------------------------------------------------------
create table portal.codigos (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  invitacion_id uuid not null references portal.invitaciones(id) on delete cascade,
  codigo_hash   text not null,
  intentos      smallint not null default 0 check (intentos >= 0),
  expira_at     timestamptz not null,
  usado_at      timestamptz,
  created_at    timestamptz not null default now()
);

create index codigos_invitacion_idx on portal.codigos (invitacion_id, created_at desc);

comment on table portal.codigos is
  'PC-02: código de seis dígitos al email de la invitación. Como PA-16: 10 minutos, tres intentos, un solo uso, y en la base solo el hash (ligado a la invitación).';

-- -----------------------------------------------------------------------------
-- portal.cuentas (PC-11)
-- -----------------------------------------------------------------------------
create table portal.cuentas (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references public.businesses(id) on delete cascade,
  email            text not null unique
    constraint cuentas_email_minusculas check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+$'),
  password_hash    text not null,
  activa           boolean not null default true,
  created_at       timestamptz not null default now(),
  ultimo_acceso_at timestamptz
);

create index cuentas_business_idx on portal.cuentas (business_id);

comment on table portal.cuentas is
  'PC-11: la cuenta del cliente en su portal. Pertenece a UN negocio y solo ve el suyo. Sin registro público: se crea con una invitación (PC-02).';
comment on column portal.cuentas.email is
  'Único en todo el sistema: con email y contraseña se entra a un portal, así que un email no puede ser de dos negocios. Varias personas del mismo negocio, fuera del alcance de la Fase 9.';
comment on column portal.cuentas.password_hash is
  'scrypt con sal, en el formato de src/portal/password.ts. Nunca la contraseña en claro.';

-- -----------------------------------------------------------------------------
-- portal.sesiones
-- -----------------------------------------------------------------------------
create table portal.sesiones (
  id           uuid primary key default gen_random_uuid(),
  cuenta_id    uuid not null references portal.cuentas(id) on delete cascade,
  business_id  uuid not null references public.businesses(id) on delete cascade,
  token_hash   text not null unique,
  expira_at    timestamptz not null,
  created_at   timestamptz not null default now(),
  ultimo_uso_at timestamptz not null default now()
);

create index sesiones_cuenta_idx on portal.sesiones (cuenta_id);

comment on table portal.sesiones is
  'Sesión del portal: el navegador guarda un token aleatorio y la base solo su sha256, como el widget. El business_id de la sesión es el que manda en toda la API del portal (nunca el de la URL ni el del chat).';

-- -----------------------------------------------------------------------------
-- portal.alta (PC-03, PC-11, PC-13)
-- -----------------------------------------------------------------------------
create table portal.alta (
  business_id     uuid primary key references public.businesses(id) on delete cascade,
  seccion         smallint not null default 0 check (seccion between 0 and 9),
  conversation_id uuid,
  terminada_at    timestamptz,
  revisada_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint alta_revisada_despues check (revisada_at is null or terminada_at is not null)
);

comment on table portal.alta is
  'PC-03/PC-11: por dónde va el chat del alta de cada negocio (sección 0 bienvenida … 9 cierre), para recibirle por donde lo dejó. PC-13: terminada_at dispara el aviso del panel interno y revisada_at lo apaga.';
comment on column portal.alta.conversation_id is
  'La conversación del chat del alta en public.conversations (con alta = true). Una por negocio.';

-- -----------------------------------------------------------------------------
-- RLS en lo nuevo de `portal`: activo y SIN política, como panel.personas
-- -----------------------------------------------------------------------------
-- Con RLS y ninguna política, anon y authenticated no ven nada aunque alguien
-- expusiera el esquema. El servidor hace BYPASSRLS y filtra por business_id.
do $do$
declare
  v_tabla text;
begin
  foreach v_tabla in array array['invitaciones', 'codigos', 'cuentas', 'sesiones', 'alta'] loop
    execute format('alter table portal.%I enable row level security', v_tabla);
  end loop;
end
$do$;

-- -----------------------------------------------------------------------------
-- public.staff_turnos_sueltos (PC-06)
-- -----------------------------------------------------------------------------
create table public.staff_turnos_sueltos (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  staff_id      uuid not null,
  fecha         date not null,
  hora_apertura time not null,
  hora_cierre   time not null,
  motivo        text check (motivo is null or length(motivo) <= 200),
  created_at    timestamptz not null default now(),
  constraint turnos_sueltos_horas check (hora_cierre > hora_apertura),
  foreign key (business_id, staff_id) references public.staff (business_id, id) on delete cascade
);

create index staff_turnos_sueltos_dia_idx on public.staff_turnos_sueltos (business_id, fecha);

comment on table public.staff_turnos_sueltos is
  'PC-06: una profesional trabaja un día CONCRETO fuera de su horario de la semana. Ese día manda sobre PD-01 y PI-19, y en un festivo del local abre la agenda solo para ella y solo esas horas.';
comment on column public.staff_turnos_sueltos.hora_cierre is
  'Hora local del negocio, como business_hours. 24:00 vale (medianoche del día siguiente).';

alter table public.staff_turnos_sueltos enable row level security;

create policy tenant_isolation on public.staff_turnos_sueltos
  for all
  using      (business_id = app.current_business_id())
  with check (business_id = app.current_business_id());

comment on policy tenant_isolation on public.staff_turnos_sueltos is
  'Aislamiento por tenant. El backend (service_role) hace BYPASSRLS; esta política cubre el resto de accesos.';

-- Dos turnos sueltos de la misma profesional el mismo día no se pisan, igual
-- que los tramos de business_hours (límites [): contiguos valen).
set search_path = public, extensions;

alter table public.staff_turnos_sueltos
  add constraint turnos_sueltos_sin_solape
  exclude using gist (
    business_id with =,
    staff_id with =,
    fecha with =,
    (numrange(extract(epoch from hora_apertura), extract(epoch from hora_cierre), '[)')) with &&
  );

comment on constraint turnos_sueltos_sin_solape on public.staff_turnos_sueltos is
  'PC-06: la misma profesional no puede tener dos turnos sueltos que se pisen el mismo día; contiguos sí.';

set search_path = public;

-- -----------------------------------------------------------------------------
-- public.conversations.alta (PC-14)
-- -----------------------------------------------------------------------------
alter table public.conversations
  add column alta boolean not null default false;

comment on column public.conversations.alta is
  'PC-14: conversación del portal del cliente (el chat del alta y los cambios que pide después). Su gasto de IA NO cuenta para el tope del negocio (PW-04 es para atender clientas) y se ve aparte en el consumo.';

-- -----------------------------------------------------------------------------
-- app.tramos_efectivos — con los turnos sueltos (PC-06)
-- -----------------------------------------------------------------------------
-- Igual que en …20261030120000_dias_libres, con una regla delante: si esa
-- profesional tiene turnos sueltos ese día, SOLO valen esos (ni su horario
-- propio, ni el del local, ni "no trabaja"). La columna `suelto` dice de
-- dónde salió el tramo: slot_es_valido la usa para el festivo del local.
--
-- Cambia el tipo de retorno, así que se borra la versión anterior (no se
-- puede `create or replace` con otra tabla de salida).
drop function app.tramos_efectivos(uuid, uuid, date);

create function app.tramos_efectivos(
  p_business_id uuid,
  p_staff_id    uuid,
  p_dia         date
)
returns table (desde timestamptz, hasta timestamptz, suelto boolean)
language sql
stable
set search_path = ''
as $$
  -- PC-06: el turno suelto manda ese día.
  select (p_dia + ts.hora_apertura) at time zone b.timezone,
         (p_dia + ts.hora_cierre)   at time zone b.timezone,
         true
    from public.staff_turnos_sueltos ts
    join public.businesses b on b.id = ts.business_id
   where ts.business_id = p_business_id
     and ts.staff_id    = p_staff_id
     and ts.fecha       = p_dia

  union all

  -- PD-01 + PI-19: horario propio, o el del local, o ninguno si no trabaja.
  select (p_dia + bh.hora_apertura) at time zone b.timezone,
         (p_dia + bh.hora_cierre)   at time zone b.timezone,
         false
    from public.business_hours bh
    join public.businesses b on b.id = bh.business_id
   where bh.business_id = p_business_id
     and bh.weekday = extract(dow from p_dia)
     and not exists (
           select 1 from public.staff_turnos_sueltos ts
            where ts.business_id = p_business_id
              and ts.staff_id    = p_staff_id
              and ts.fecha       = p_dia)
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
  'PD-01 + PI-19 + PC-06: tramos que trabaja una profesional un día local, en UTC. Un turno suelto ese día reemplaza a todo lo demás (suelto = true); si no, el horario propio reemplaza al del local, y un día en staff_dias_libres no tiene ninguno.';

-- -----------------------------------------------------------------------------
-- app.slot_es_valido — el festivo del local no cierra un turno suelto (PC-06)
-- -----------------------------------------------------------------------------
-- Misma firma y mismo orden de comprobaciones que en …20261028120000_panel_interno
-- (D-26, D-27). Lo único nuevo es RA002: si el hueco cae ENTERO dentro de un
-- turno suelto de esa profesional, el festivo del LOCAL (staff_id null) no lo
-- cierra; sus propias ausencias sí.
create or replace function app.slot_es_valido(
  p_business_id uuid,
  p_service_id  uuid,
  p_staff_id    uuid,
  p_start_at    timestamptz,
  p_manual      boolean default false
)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_neg        record;
  v_duracion   interval;
  v_buffer     interval;
  v_fin        timestamptz;   -- fin del servicio (lo que se guarda en end_at)
  v_fin_margen timestamptz;   -- fin del servicio + su margen
  v_fin_jornada timestamptz;  -- lo que tiene que caber dentro del horario
  v_dia        date;
  v_suelto     boolean;       -- PC-06: el hueco cabe en un turno suelto de ella
begin
  -- --- Estructura: negocio, servicio, profesional ------------------------------
  select b.timezone, b.antelacion_min_horas, b.intervalo_huecos_min, b.margen_dentro_horario
    into v_neg
    from public.businesses b
   where b.id = p_business_id;

  if not found then
    return '23503';
  end if;

  select make_interval(mins => s.duracion_min), make_interval(mins => s.buffer_min)
    into v_duracion, v_buffer
    from public.services s
   where s.id = p_service_id
     and s.business_id = p_business_id
     and s.activo;

  if not found then
    return '23503';
  end if;

  if not exists (
    select 1 from public.staff st
     where st.id = p_staff_id and st.business_id = p_business_id and st.activo
  ) then
    return '23503';
  end if;

  if not exists (
    select 1 from public.staff_services ss
     where ss.staff_id = p_staff_id and ss.service_id = p_service_id
  ) then
    return '23514';
  end if;

  v_fin        := p_start_at + v_duracion;
  v_fin_margen := v_fin + v_buffer;
  v_fin_jornada := case when v_neg.margen_dentro_horario then v_fin_margen else v_fin end;

  v_dia := (p_start_at at time zone v_neg.timezone)::date;

  -- --- RA001 · horario, rejilla y cierre (PD-01, PR-01, PR-02) ----------------
  -- PR-04: a mano (p_manual) la rejilla no se exige; el tramo y el cierre sí.
  if not exists (
    select 1
      from app.tramos_efectivos(p_business_id, p_staff_id, v_dia) t
     where p_start_at >= t.desde
       and v_fin_jornada <= t.hasta
       and (p_manual
            or mod(extract(epoch from (p_start_at - t.desde))::numeric,
                   v_neg.intervalo_huecos_min * 60) = 0)
  ) then
    return 'RA001';
  end if;

  -- --- RA002 · festivos y ausencias -------------------------------------------
  -- PC-06: en un festivo del local, el turno suelto abre la agenda solo para
  -- esa profesional y solo esas horas. Sus ausencias propias siguen cerrando.
  v_suelto := exists (
    select 1
      from app.tramos_efectivos(p_business_id, p_staff_id, v_dia) t
     where t.suelto
       and p_start_at >= t.desde
       and v_fin_jornada <= t.hasta
  );

  if exists (
    select 1 from public.time_off o
     where o.business_id = p_business_id
       and (case when v_suelto then o.staff_id = p_staff_id
                 else (o.staff_id is null or o.staff_id = p_staff_id) end)
       and tstzrange(o.desde, o.hasta) && tstzrange(p_start_at, v_fin_jornada)
  ) then
    return 'RA002';
  end if;

  -- --- RA003 · antelación mínima (PD-05) --------------------------------------
  -- PR-04: a mano no se exige (una clienta que está en el local).
  if not p_manual
     and p_start_at < now() + make_interval(hours => v_neg.antelacion_min_horas) then
    return 'RA003';
  end if;

  -- --- 23P01 · otra cita en el mismo tramo de servicio ------------------------
  if exists (
    select 1 from public.appointments a
     where a.staff_id = p_staff_id
       and a.estado <> 'cancelada'
       and tstzrange(a.start_at, a.end_at) && tstzrange(p_start_at, v_fin)
  ) then
    return '23P01';
  end if;

  -- --- RA004 · margen con otra cita (PD-02) -----------------------------------
  -- PD-02: el margen se respeta siempre, también a mano.
  if exists (
    select 1 from public.appointments a
      join public.services sa on sa.id = a.service_id
     where a.staff_id = p_staff_id
       and a.estado <> 'cancelada'
       and tstzrange(a.start_at, a.end_at + make_interval(mins => sa.buffer_min))
           && tstzrange(p_start_at, v_fin_margen)
  ) then
    return 'RA004';
  end if;

  return null;
end;
$$;

comment on function app.slot_es_valido(uuid, uuid, uuid, timestamptz, boolean) is
  'Única fuente de verdad de "¿es un hueco válido?". NULL si lo es; si no, el SQLSTATE del motivo (23503, 23514, RA001–RA004, 23P01). p_manual (PR-04, PI-14): sin rejilla ni antelación mínima. PC-06: un turno suelto abre el festivo del local solo para esa profesional y esas horas.';
