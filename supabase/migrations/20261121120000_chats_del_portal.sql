-- =============================================================================
-- Varios chats en el portal y el alta por temas (Fase 9b · PC-17, PC-18)
-- =============================================================================
-- Hasta ahora el portal tenía UNA conversación por negocio y el alta iba en
-- orden, sección a sección (portal.alta.seccion). Mariana, 20/11/2026: el chat
-- del portal tiene que funcionar como los chats que todos conocemos —un
-- historial a la izquierda, un chat para cada tema— y el cliente puede empezar
-- el alta por donde quiera («quiero dar de alta a mi equipo»).
--
-- Lo que cambia:
--
--   · public.conversations.titulo     el nombre del chat en el historial
--                                     (PC-17). Lo pone la IA con el primer
--                                     mensaje y el cliente lo puede cambiar.
--   · public.conversations.oculta_at  «borrar» un chat lo saca del historial;
--                                     la fila se queda (su gasto ya está
--                                     registrado y el borrado de textos de
--                                     PD-13 sigue igual).
--   · public.conversations.continua_de cuando un chat se hace demasiado largo
--                                     sigue en otra conversación (alta:eval,
--                                     19/11/2026); la nueva apunta a la vieja
--                                     y el historial enseña las dos como un
--                                     solo chat.
--   · portal.alta.secciones_hechas    qué secciones del alta ya están
--                                     guardadas, en cualquier orden (PC-18).
--                                     Lo marcan las herramientas al guardar,
--                                     no el modelo. `seccion` se queda como
--                                     «la siguiente que falta», calculada.
--
-- Mismo negocio siempre (§1 del AGENTS.md raíz): continua_de va con clave
-- compuesta (business_id, id), así un chat no puede continuar el de otro.
-- =============================================================================

alter table public.conversations
  add column titulo      text,
  add column oculta_at   timestamptz,
  add column continua_de uuid,
  add constraint conversations_titulo_largo check (titulo is null or char_length(titulo) between 1 and 80),
  add constraint conversations_continua_de_fk
    foreign key (business_id, continua_de) references public.conversations (business_id, id)
    on delete set null (continua_de),
  add constraint conversations_continua_de_otra check (continua_de is null or continua_de <> id);

comment on column public.conversations.titulo is
  'PC-17: nombre del chat del portal en el historial. Lo pone la IA con el primer mensaje; el cliente lo puede cambiar. Null en las conversaciones de clientas.';
comment on column public.conversations.oculta_at is
  'PC-17: el cliente «borró» este chat del portal. Sale del historial, pero la fila (y su gasto) se queda.';
comment on column public.conversations.continua_de is
  'La conversación anterior del mismo chat del portal, cuando aquella se hizo demasiado larga. El historial las enseña juntas.';

-- Un chat que continúa a otro solo puede haber uno: si no, el historial se partiría.
create unique index conversations_continua_de_unico
  on public.conversations (continua_de) where continua_de is not null;

-- El historial del portal: los chats visibles del negocio.
create index conversations_portal_historial
  on public.conversations (business_id, created_at desc) where alta and oculta_at is null;

alter table portal.alta
  add column secciones_hechas text[] not null default '{}',
  add constraint alta_secciones_validas
    check (secciones_hechas <@ array['negocio', 'servicios', 'profesionales', 'horario', 'reglas']::text[]);

comment on column portal.alta.secciones_hechas is
  'PC-18: las secciones del alta ya guardadas (negocio, servicios, profesionales, horario, reglas), en el orden que sea. Las marcan las herramientas del chat al guardar; el alta termina cuando están las cinco.';

-- Lo que ya había: el alta iba en orden, así que la sección en la que estaba
-- dice cuáles se guardaron. Las terminadas tienen las cinco.
update portal.alta
   set secciones_hechas = case
     when terminada_at is not null then array['negocio', 'servicios', 'profesionales', 'horario', 'reglas']
     else array_remove(array[
       case when seccion >= 2 then 'negocio' end,
       case when seccion >= 3 then 'servicios' end,
       case when seccion >= 4 then 'profesionales' end,
       case when seccion >= 6 then 'horario' end,
       case when seccion >= 9 then 'reglas' end
     ], null)
   end;

-- Los chats del alta que ya existían se llaman así en el historial.
update public.conversations set titulo = 'Alta de tu negocio' where alta and titulo is null;
