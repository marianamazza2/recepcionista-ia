-- =============================================================================
-- Adjuntos del chat del portal: imágenes y PDF (Fase 9b · PC-21)
-- =============================================================================
-- Mariana, 21/11/2026: el chat del portal lleva el «+» para subir fotos y
-- documentos («si un cliente ya tiene los horarios escritos, tiene una foto,
-- lo tira ahí»). El agente los lee y propone lo que encontró; nada se guarda
-- sin confirmar (PC-03).
--
-- Dónde viven: aquí, en la base, y no en un servicio de ficheros aparte. La
-- clave de servicio de Supabase no sale de la Terminal de Mariana (§6 del
-- AGENTS.md raíz), así que Supabase Storage no se puede usar desde Vercel, y
-- contratar otro servicio necesita su visto bueno. Con los límites de PC-21
-- (fotos achicadas en el navegador, PDF de hasta 4 MB) y la caducidad de 6
-- meses, el volumen es pequeño.
--
--   · portal.adjuntos   un archivo: de qué negocio, en qué conversación (null
--                       hasta que se manda con un mensaje), su nombre, su tipo
--                       y sus bytes. Tipos cerrados por CHECK.
--   · Caducidad (PD-13): app.borrar_conversaciones_vencidas también borra los
--     adjuntos de las conversaciones vencidas y los que se subieron y nunca
--     se mandaron (más de un día).
--
-- Mismo negocio siempre: la conversación va con clave compuesta
-- (business_id, conversation_id). RLS activo y sin política, como el resto
-- de `portal`: solo el servidor lo lee.
-- =============================================================================

create table portal.adjuntos (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  conversation_id uuid,
  nombre          text not null check (char_length(nombre) between 1 and 200),
  tipo            text not null check (tipo in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf')),
  bytes           integer not null check (bytes between 1 and 5242880),
  datos           bytea not null,
  created_at      timestamptz not null default now(),
  foreign key (business_id, conversation_id) references public.conversations (business_id, id) on delete cascade,
  constraint adjuntos_bytes_cuadran check (octet_length(datos) = bytes)
);

create index adjuntos_conversacion on portal.adjuntos (business_id, conversation_id);
create index adjuntos_sueltos on portal.adjuntos (created_at) where conversation_id is null;

alter table portal.adjuntos enable row level security;

comment on table portal.adjuntos is
  'PC-21: imágenes y PDF que el negocio sube al chat del portal. conversation_id es null hasta que se mandan con un mensaje. Caducan con el texto del chat (PD-13).';

-- -----------------------------------------------------------------------------
-- PD-13 + PC-21: el borrado de lo vencido se lleva también los adjuntos
-- -----------------------------------------------------------------------------
-- Igual que en …20261113130000_borrado_y_avisos, con dos borrados más. La
-- firma no cambia (npm run borrado la sigue llamando igual).
create or replace function app.borrar_conversaciones_vencidas(p_meses int default 6)
returns table (conversaciones int, mensajes int)
language plpgsql
set search_path = ''
as $$
declare
  v_corte timestamptz := now() - make_interval(months => p_meses);
  v_convs uuid[];
  v_mensajes int;
begin
  if p_meses < 1 then
    raise exception 'Los meses de retención tienen que ser 1 o más (PD-13)'
      using errcode = 'RA009';
  end if;

  -- Las conversaciones que ya vencieron Y todavía tienen texto (o adjuntos) que borrar.
  select coalesce(array_agg(c.id), '{}')
    into v_convs
    from public.conversations c
   where c.ultimo_mensaje_at < v_corte
     and (exists (select 1 from public.messages m where m.conversation_id = c.id)
          or exists (select 1 from portal.adjuntos a where a.conversation_id = c.id));

  delete from public.messages m where m.conversation_id = any(v_convs);
  get diagnostics v_mensajes = row_count;

  -- PC-21: sus adjuntos, y los que se subieron y nunca se mandaron.
  delete from portal.adjuntos a where a.conversation_id = any(v_convs);
  delete from portal.adjuntos a where a.conversation_id is null and a.created_at < now() - interval '1 day';

  -- Los códigos de verificación (PA-16) duran 10 minutos: los vencidos no
  -- hacen falta para nada. Se limpian con la misma pasada.
  delete from public.codigos_verificacion where expira_at < now() - interval '30 days';

  return query select cardinality(v_convs), v_mensajes;
end;
$$;

comment on function app.borrar_conversaciones_vencidas(int) is
  'PD-13: borra el TEXTO (messages) de las conversaciones sin actividad desde hace p_meses (6 de serie), y (PC-21) sus adjuntos y los adjuntos que nunca se mandaron. La conversación y la ficha de la clienta se quedan. Devuelve cuántas conversaciones y cuántos mensajes.';
