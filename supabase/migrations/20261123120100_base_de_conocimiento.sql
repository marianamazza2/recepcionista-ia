-- =============================================================================
-- Fase 5 · 5.1 — La base de conocimiento: documentos, trozos, búsqueda y
--               valores para comparar con la configuración; y el tope del chat
--               del portal (PC-22)
-- =============================================================================
-- Amplía las tablas que la Fase 0 dejó vacías (…120400_conocimiento.sql) sin
-- reescribirlas. Reglas que implementa (decisiones-producto.md, 23/11/2026):
--
--   · PB-09 (la A): búsqueda de texto completo de Postgres en español, en
--     nuestra base, sin proveedor nuevo. Cada trozo guarda los títulos (del
--     documento y de su sección) y «las palabras con que lo pediría una
--     clienta», que escribe la IA al subirlo; los tres se indexan sin tildes
--     (`busqueda`, GIN). Si no hay coincidencias, se prueba por parecido de
--     letras (pg_trgm, `texto_plano`) para las faltas de ortografía. La
--     columna `embedding` de la Fase 0 se queda: es la opción B de reserva
--     (D-95, D-96).
--   · PB-04 / PB-01: los valores que el documento da para lo que hay en la
--     configuración (precio y duración de cada servicio, horarios, dirección,
--     teléfono) se guardan aparte en `knowledge_valores`, con el trozo de texto
--     exacto donde aparecen. LA COMPARACIÓN LA HACE EL CÓDIGO
--     (src/conocimiento/comparar.ts) cada vez que se leen, así que cuando la
--     configuración cambia el aviso de «quedó viejo» sale solo (D-98).
--   · PB-04: no se guarda el archivo original, solo su texto (D-97). Sí, su
--     tamaño, sus páginas, las páginas que no se pudieron leer y los
--     tratamientos que explica y no están en Servicios.
--   · PB-03: de dónde vino (portal, panel o chat). Un documento que el chat
--     del portal ya leyó pero que el negocio todavía no confirmó (PC-03) es un
--     'borrador': no lo ve el agente ni cuenta para los límites.
--   · PB-06: hasta 20 documentos y 100 páginas por negocio, en la base
--     (RA011), como RA007 para las preguntas frecuentes.
--   · PB-07: preparar un documento cuesta y lo paga MAZZMKT fuera de los dos
--     topes: `usage_events.concepto = 'preparar_documento'` (D-99).
--   · PB-06: al guardar desde el chat, el archivo sale de la conversación:
--     `portal.adjuntos` se queda sin sus bytes y con el título del documento.
--   · PC-22: `businesses.tope_portal_usd`, el tope del chat del portal
--     (5 US$ de serie, ajuste por negocio que cambia Mariana).
--
-- RLS: la tabla nueva lleva su política de tenant, como todas las de
-- `public` (tests/04). No se toca ninguna migración anterior.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Extensiones (D-01: viven en `extensions`)
-- -----------------------------------------------------------------------------
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

set search_path = public;

-- Quita las tildes (y la ñ → n): «bótox» y «botox» tienen que ser la misma
-- palabra. `unaccent` es STABLE (depende de su diccionario); con el diccionario
-- fijado por nombre el resultado no cambia, así que se envuelve como IMMUTABLE
-- para poder usarlo en columnas generadas (patrón habitual de Postgres).
create or replace function app.sin_tildes(p text)
returns text
language sql
immutable
parallel safe
strict
set search_path = ''
as $$ select extensions.unaccent('extensions.unaccent'::regdictionary, p) $$;

comment on function app.sin_tildes(text) is
  'PB-09: el texto sin tildes, para que «bótox» encuentre «botox». IMMUTABLE a propósito: el diccionario va fijado por nombre.';

-- -----------------------------------------------------------------------------
-- knowledge_docs — el documento del negocio (PB-02, PB-03, PB-04)
-- -----------------------------------------------------------------------------
alter table public.knowledge_docs
  add column resumen           text,
  add column origen            text,
  add column estado            text not null default 'activo',
  add column paginas           integer not null default 0,
  add column bytes             integer,
  add column nombre_archivo    text,
  add column paginas_ilegibles integer[] not null default '{}',
  add column sin_servicio      text[] not null default '{}',
  add column reemplazado_at    timestamptz,
  add column updated_at        timestamptz not null default now(),
  add constraint knowledge_docs_origen_valido check (origen is null or origen in ('portal', 'panel', 'chat')),
  add constraint knowledge_docs_estado_valido check (estado in ('borrador', 'activo')),
  add constraint knowledge_docs_paginas_validas check (paginas >= 0 and paginas <= 1000),
  add constraint knowledge_docs_bytes_validos check (bytes is null or bytes between 1 and 4194304),
  add constraint knowledge_docs_resumen_corto check (resumen is null or length(resumen) <= 300),
  -- Un documento (no una pregunta frecuente) tiene origen, un título corto y texto.
  add constraint knowledge_docs_documento_completo check (
    tipo = 'faq'
    or (origen is not null
        and length(titulo) <= 200
        and contenido_raw is not null
        and length(trim(contenido_raw)) > 0
        and length(contenido_raw) <= 400000)
  );

create index knowledge_docs_documentos_idx on public.knowledge_docs (business_id, created_at)
  where tipo <> 'faq';

comment on column public.knowledge_docs.contenido_raw is
  'El texto: en una pregunta frecuente, la respuesta (PI-08); en un documento, su texto limpio por secciones (PB-04: el archivo original NO se guarda, D-97). PB-01: si gana el valor de la configuración, se corrige aquí y en sus trozos.';
comment on column public.knowledge_docs.resumen is
  'PB-04: una línea de qué trata («Precios y descripción de 18 tratamientos faciales»). La escribe la IA al leerlo.';
comment on column public.knowledge_docs.origen is
  'PB-03: de dónde vino: portal (Configuración → Documentos del cliente), panel (Mariana) o chat (el «+» del chat del portal). NULL en las preguntas frecuentes.';
comment on column public.knowledge_docs.estado is
  'PC-03: borrador = el chat del portal ya lo leyó y enseñó el resumen, pero el negocio todavía no dijo que sí. No lo ve el agente ni cuenta para PB-06.';
comment on column public.knowledge_docs.paginas is
  'PB-06: páginas que cuenta para el límite de 100 por negocio (un PDF, sus páginas; una foto, 1; un texto, 1 cada ~3.000 caracteres).';
comment on column public.knowledge_docs.paginas_ilegibles is
  'PB-04: «No se pudo leer la página 4». Números de página empezando en 1.';
comment on column public.knowledge_docs.sin_servicio is
  'PB-04: tratamientos que el documento explica y no están en Servicios. No es una contradicción: el agente los explica pero no los reserva, y se le sugiere al negocio darlos de alta.';
comment on column public.knowledge_docs.reemplazado_at is
  'PB-03: cuándo se reemplazó por la versión nueva (se cambian texto, trozos y valores; el id y el título se quedan).';

-- PB-06: como mucho 20 documentos y 100 páginas por negocio. En un trigger y no
-- en el código, como RA007: así vale igual desde el portal, el panel y el chat.
-- Solo cuentan los activos (un borrador no es todavía un documento).
create or replace function app.limite_documentos()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  c_max_documentos constant integer := 20;
  c_max_paginas    constant integer := 100;
  v_n       integer;
  v_paginas integer;
begin
  if new.tipo = 'faq' or new.estado <> 'activo' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('documentos:business:' || new.business_id::text, 0));

  select count(*), coalesce(sum(k.paginas), 0)
    into v_n, v_paginas
    from public.knowledge_docs k
   where k.business_id = new.business_id
     and k.tipo <> 'faq'
     and k.estado = 'activo'
     and k.id <> new.id;

  if v_n + 1 > c_max_documentos then
    raise exception 'Límite de documentos: ya hay % (máximo %)', v_n, c_max_documentos
      using errcode = 'RA011', detail = 'documentos',
            hint = 'Borrá alguno o juntá varios en uno.';
  end if;
  if v_paginas + new.paginas > c_max_paginas then
    raise exception 'Límite de páginas: % + % (máximo %)', v_paginas, new.paginas, c_max_paginas
      using errcode = 'RA011', detail = 'paginas:' || (c_max_paginas - v_paginas)::text,
            hint = 'Borrá algún documento o subí solo las páginas que hacen falta.';
  end if;
  return new;
end;
$$;

comment on function app.limite_documentos() is
  'PB-06: rechaza con RA011 un documento activo que deja al negocio con más de 20 documentos o 100 páginas. detail = documentos | paginas:<las que quedan>.';

create trigger knowledge_docs_limite_documentos
  before insert or update of tipo, estado, paginas, business_id on public.knowledge_docs
  for each row execute function app.limite_documentos();

-- -----------------------------------------------------------------------------
-- knowledge_chunks — los trozos que busca el agente (PB-09)
-- -----------------------------------------------------------------------------
alter table public.knowledge_chunks
  add column orden    integer not null default 0,
  add column titulos  text not null default '',
  add column palabras text not null default '';

-- La búsqueda de texto: títulos (peso A), palabras de la clienta (B) y el
-- texto (C), en español y sin tildes.
alter table public.knowledge_chunks
  add column busqueda tsvector generated always as (
    setweight(to_tsvector('spanish'::regconfig, app.sin_tildes(titulos)), 'A')
    || setweight(to_tsvector('spanish'::regconfig, app.sin_tildes(palabras)), 'B')
    || setweight(to_tsvector('spanish'::regconfig, app.sin_tildes(contenido)), 'C')
  ) stored,
  -- Para el parecido de letras (pg_trgm): todo junto, en minúsculas y sin tildes.
  add column texto_plano text generated always as (
    lower(app.sin_tildes(titulos || ' ' || palabras || ' ' || contenido))
  ) stored;

create index knowledge_chunks_busqueda_idx on public.knowledge_chunks using gin (busqueda);

set search_path = public, extensions;
create index knowledge_chunks_trigramas_idx on public.knowledge_chunks using gin (texto_plano extensions.gin_trgm_ops);
set search_path = public;

comment on column public.knowledge_chunks.titulos is
  'PB-09: «Carta de tratamientos 2026 · Peelings»: el título del documento y el de su sección. Ayuda a buscar y a contestar.';
comment on column public.knowledge_chunks.palabras is
  'PB-09: las palabras con que lo pediría una clienta (sinónimos, cómo se dice en la calle, faltas típicas: «bótox», «pelin»). Las escribe la IA al subir el documento.';
comment on column public.knowledge_chunks.busqueda is
  'PB-09 (la A): búsqueda de texto completo en español, sin tildes. Generada: no se escribe a mano.';
comment on column public.knowledge_chunks.embedding is
  'PB-09: la opción B de reserva (embeddings con Voyage AI + pgvector). NULL mientras se use la A (D-95).';

-- -----------------------------------------------------------------------------
-- knowledge_valores — lo que el documento dice de la configuración (PB-04, PB-01)
-- -----------------------------------------------------------------------------
create table public.knowledge_valores (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  doc_id      uuid not null,
  tipo        text not null check (tipo in ('precio', 'duracion', 'horario', 'direccion', 'telefono')),
  -- precio y duración: de qué servicio de la configuración es (null si no hay uno).
  service_id  uuid,
  -- Lo que dice el documento: «Limpieza facial profunda», «de lunes a viernes».
  etiqueta    text not null default '' check (length(etiqueta) <= 300),
  -- horario: a qué días se refiere (0 = domingo … 6 = sábado, D-10).
  dias        integer[] not null default '{}',
  -- El valor, ya entendido: {"euros":55} · {"minutos":45} ·
  -- {"tramos":[{"desde":"09:00","hasta":"20:00"}]} · {"texto":"…"}.
  valor       jsonb not null,
  -- El trozo de texto exacto donde aparece y, dentro de él, el valor tal cual
  -- («Limpieza facial profunda … 55 €» y «55 €»). «Corregirlo» cambia
  -- texto_valor dentro de fragmento, en el texto del documento y en sus trozos.
  fragmento   text not null default '' check (length(fragmento) <= 2000),
  texto_valor text not null default '' check (length(texto_valor) <= 500),
  -- pendiente = al subir no coincidía y el negocio todavía no dijo cuál vale
  -- (PB-04); aceptado = coincidía o ya se decidió. Si después no coincide con
  -- la configuración, es que la configuración cambió: el documento quedó
  -- viejo (PB-01). Lo calcula el código al leerlo, no se guarda.
  estado      text not null check (estado in ('pendiente', 'aceptado')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, doc_id) references public.knowledge_docs (business_id, id) on delete cascade,
  foreign key (business_id, service_id) references public.services (business_id, id),
  constraint knowledge_valores_servicio_coherente check ((tipo in ('precio', 'duracion')) or service_id is null),
  constraint knowledge_valores_dias_validos check (dias <@ array[0, 1, 2, 3, 4, 5, 6])
);

create index knowledge_valores_doc_idx on public.knowledge_valores (business_id, doc_id);
create index knowledge_valores_servicio_idx on public.knowledge_valores (business_id, service_id) where service_id is not null;

comment on table public.knowledge_valores is
  'PB-04 / PB-01: los valores que un documento da para lo que está en la configuración (precio, duración, horario, dirección, teléfono), con el texto exacto donde aparecen. La comparación con la configuración la hace el código al leerlos (D-98): así un cambio de la configuración marca solo los documentos que quedaron viejos.';

-- -----------------------------------------------------------------------------
-- La búsqueda (PB-09, la A)
-- -----------------------------------------------------------------------------
-- Las palabras de la consulta se juntan con «o» (una clienta escribe frases
-- enteras: «qué cuidados hay después del peeling»), con prefijo (`:*`, desde 4 letras) y se
-- ordena por relevancia. Si no hay ninguna coincidencia, por parecido de letras
-- de cada palabra (pg_trgm: «pelin» encuentra «peeling»).
-- SECURITY INVOKER y sin declarar el tenant (D-17): lo hace quien llama, que
-- además pasa el negocio y aquí se filtra por él (T-03). Solo documentos
-- activos: un borrador del chat no existe para el agente.
create or replace function app.buscar_conocimiento(p_business_id uuid, p_consulta text, p_limite integer default 5)
returns table (chunk_id uuid, doc_id uuid, documento text, titulos text, contenido text, rango real)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_consulta tsquery;
  v_texto    text;
begin
  -- El prefijo solo en palabras de 4 letras o más: «pel» (de «pelo») no
  -- tiene que encontrar «peeling».
  select string_agg(distinct '''' || l.lexeme || '''' || case when length(l.lexeme) >= 4 then ':*' else '' end, ' | ')
    into v_texto
    from unnest(to_tsvector('spanish'::regconfig, app.sin_tildes(coalesce(p_consulta, '')))) l
   where l.lexeme ~ '^[[:alnum:]]+$' and length(l.lexeme) >= 2;

  if v_texto is not null then
    v_consulta := v_texto::tsquery;
    return query
      select c.id, c.doc_id, d.titulo, c.titulos, c.contenido,
             ts_rank(c.busqueda, v_consulta) as rango
        from public.knowledge_chunks c
        join public.knowledge_docs d on d.business_id = c.business_id and d.id = c.doc_id
       where c.business_id = p_business_id
         and d.estado = 'activo' and d.tipo <> 'faq'
         and c.busqueda @@ v_consulta
       order by rango desc, d.titulo, c.orden, c.id
       limit greatest(1, least(p_limite, 10));
    if found then
      return;
    end if;
  end if;

  -- Sin coincidencias: parecido de letras, palabra a palabra.
  return query
    select c.id, c.doc_id, d.titulo, c.titulos, c.contenido,
           sum(extensions.word_similarity(w, c.texto_plano))::real as rango
      from public.knowledge_chunks c
      join public.knowledge_docs d on d.business_id = c.business_id and d.id = c.doc_id
      cross join lateral unnest(regexp_split_to_array(lower(app.sin_tildes(coalesce(p_consulta, ''))), '[^a-z0-9]+')) w
     where c.business_id = p_business_id
       and d.estado = 'activo' and d.tipo <> 'faq'
       and length(w) >= 4
       and extensions.word_similarity(w, c.texto_plano) >= 0.5
     group by c.id, c.doc_id, d.titulo, c.titulos, c.contenido, c.orden
     order by rango desc, d.titulo, c.orden, c.id
     limit greatest(1, least(p_limite, 10));
end;
$$;

comment on function app.buscar_conocimiento(uuid, text, integer) is
  'PB-09 (la A): los trozos de los documentos ACTIVOS de un negocio que mejor responden a la consulta. Texto completo en español sin tildes (palabras con «o»); si no hay nada, parecido de letras (pg_trgm). Filtra por p_business_id (T-03).';

-- -----------------------------------------------------------------------------
-- usage_events.concepto — preparar un documento, fuera de los topes (PB-07)
-- -----------------------------------------------------------------------------
alter table public.usage_events
  add column concepto text not null default 'conversacion'
    constraint usage_events_concepto_valido check (concepto in ('conversacion', 'preparar_documento'));

comment on column public.usage_events.concepto is
  'PB-07: conversacion (lo de siempre: clientas, pruebas y chat del portal, según su conversación) o preparar_documento (leer un documento al subirlo: lo paga MAZZMKT y no cuenta ni para el tope de las clientas ni para el del chat del portal, D-99).';

-- -----------------------------------------------------------------------------
-- businesses.tope_portal_usd — el tope del chat del portal (PC-22)
-- -----------------------------------------------------------------------------
alter table public.businesses
  add column tope_portal_usd numeric(10,2) not null default 5
    constraint businesses_tope_portal_valido check (tope_portal_usd >= 0);

comment on column public.businesses.tope_portal_usd is
  'PC-22 (23/11/2026): tope mensual del chat del portal (el alta y los cambios), en US$, aparte del de las clientas. De serie 5 US$ (unos 100 mensajes). Lo cambia Mariana en su panel; el cliente no lo ve (PC-09). Al llegar, el chat se pausa hasta el mes siguiente y Configuración a mano sigue.';

-- -----------------------------------------------------------------------------
-- portal.adjuntos — al guardarse como documento, el archivo sale del chat (PB-06)
-- -----------------------------------------------------------------------------
alter table portal.adjuntos
  add column documento_titulo text check (documento_titulo is null or length(documento_titulo) <= 200),
  add column guardado_at      timestamptz,
  drop constraint adjuntos_bytes_cuadran,
  add constraint adjuntos_bytes_cuadran check (octet_length(datos) = bytes or (guardado_at is not null and octet_length(datos) = 0)),
  add constraint adjuntos_guardado_coherente check ((guardado_at is null) = (documento_titulo is null));

comment on column portal.adjuntos.guardado_at is
  'PB-06 / D-97: cuándo se guardó como documento. Desde ese momento el archivo ya no se guarda (datos vacío) y la IA ya no lo vuelve a leer en ese chat: ve «guardado en Documentos como …».';

-- -----------------------------------------------------------------------------
-- RLS en lo nuevo (maestro §3.3), igual que en …120600_rls.sql
-- -----------------------------------------------------------------------------
do $do$
declare
  v_tabla text;
begin
  foreach v_tabla in array array['knowledge_valores'] loop
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
