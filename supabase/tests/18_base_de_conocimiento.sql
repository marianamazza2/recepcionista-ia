-- =============================================================================
-- Test 18 — La base de conocimiento (Fase 5 · 5.1: PB-01, PB-04, PB-06, PB-07,
--           PB-09, PC-22)
-- =============================================================================
--   · La búsqueda en español encuentra por las palabras que la IA añadió al
--     subir («lo del bótox»), sin tildes, con frases enteras, y por parecido de
--     letras cuando hay faltas («pelinn»).
--   · Aislamiento: la búsqueda de un negocio nunca devuelve trozos de otro; un
--     trozo o un valor no se puede colgar del documento de otro negocio.
--   · Un borrador (PC-03: el chat lo leyó, el negocio no confirmó) no se busca
--     ni cuenta para los límites.
--   · PB-06: 20 documentos y 100 páginas por negocio (RA011, con detail);
--     las preguntas frecuentes no cuentan.
--   · Cascada: borrar el documento se lleva trozos y valores; borrar el negocio,
--     todo.
--   · knowledge_valores: tipos, servicio solo en precio/duración, días válidos.
--   · PC-22 y PB-07: tope del chat del portal de serie 5 US$; concepto del
--     consumo.
--   · PB-06: un adjunto guardado como documento se queda sin bytes.
--   · RLS activo en la tabla nueva.
-- =============================================================================

\set ON_ERROR_STOP on

begin;
\ir _helpers.sql

\echo '18 — base de conocimiento'

\set aurora '\'18181818-1818-4818-8818-000000000001\''
\set olea   '\'18181818-1818-4818-8818-000000000002\''
\set doc_a  '\'18181818-1818-4818-8818-0000000000d1\''
\set doc_o  '\'18181818-1818-4818-8818-0000000000d2\''
\set borr   '\'18181818-1818-4818-8818-0000000000d3\''
\set serv_a '\'18181818-1818-4818-8818-0000000000b1\''
\set serv_o '\'18181818-1818-4818-8818-0000000000b2\''

insert into public.businesses (id, nombre, slug, timezone) values
  (:aurora, 'Aurora 18', 'aurora-18', 'Europe/Madrid'),
  (:olea,   'Olea 18',   'olea-18',   'Europe/Madrid');

insert into public.services (id, business_id, nombre, duracion_min, precio) values
  (:serv_a, :aurora, 'Limpieza facial', 60, 60),
  (:serv_o, :olea,   'Hilos tensores',  60, 400);

insert into public.knowledge_docs (id, business_id, titulo, tipo, contenido_raw, origen, paginas, resumen) values
  (:doc_a, :aurora, 'Carta de tratamientos', 'pdf', 'Toxina botulínica… Peeling químico…', 'portal', 3, 'Precios y descripción de los tratamientos'),
  (:doc_o, :olea,   'Carta Olea',            'pdf', 'Hilos tensores…',                      'panel',  2, 'Tratamientos de Olea');
insert into public.knowledge_docs (id, business_id, titulo, tipo, contenido_raw, origen, paginas, estado) values
  (:borr, :aurora, 'Folleto sin confirmar', 'imagen', 'Mesoterapia capilar…', 'chat', 1, 'borrador');

insert into public.knowledge_chunks (business_id, doc_id, orden, contenido, titulos, palabras) values
  (:aurora, :doc_a, 1, 'Toxina botulínica: relaja la musculatura de la frente y el entrecejo.', 'Carta de tratamientos · Inyectables', 'bótox botox arrugas frente patas de gallo'),
  (:aurora, :doc_a, 2, 'Peeling químico. Después: no tomar el sol en 48 horas y no maquillarse.', 'Carta de tratamientos · Cuidados', 'pelin quimico manchas cuidados despues'),
  (:olea,   :doc_o, 1, 'Hilos tensores de polidioxanona para el óvalo facial.', 'Carta Olea · Hilos', 'hilos lifting sin cirugia'),
  (:aurora, :borr,  1, 'Mesoterapia capilar para la caída del pelo.', 'Folleto · Capilar', 'caida pelo calvicie');

-- --- PB-09: la búsqueda ---------------------------------------------------------
select test.ok(
  (select count(*) = 1 and bool_and(contenido like 'Toxina%') from app.buscar_conocimiento(:aurora, 'lo del bótox')),
  'PB-09: «lo del bótox» encuentra la toxina botulínica por las palabras de la clienta'
);
select test.ok(
  (select contenido like 'Peeling%' from app.buscar_conocimiento(:aurora, '¿Qué cuidados hay después del peeling?') limit 1),
  'PB-09: una frase entera encuentra el trozo de los cuidados (palabras con «o»)'
);
select test.ok(
  (select count(*) >= 1 from app.buscar_conocimiento(:aurora, 'TOXINA BOTULINICA')),
  'PB-09: sin tildes y en mayúsculas también'
);
select test.ok(
  (select contenido like 'Peeling%' from app.buscar_conocimiento(:aurora, 'pelinn kimico') limit 1),
  'PB-09: con faltas, por parecido de letras (pg_trgm)'
);
select test.ok(
  (select count(*) = 0 from app.buscar_conocimiento(:aurora, 'tatuajes de henna')),
  'PB-05: lo que no está no devuelve nada (el agente lo dice y deriva)'
);
select test.ok(
  (select count(*) = 0 from app.buscar_conocimiento(:aurora, '')),
  'una consulta vacía no devuelve nada'
);
select test.ok(
  (select count(*) <= 2 from app.buscar_conocimiento(:aurora, 'tratamientos carta', 2)),
  'el límite de trozos se respeta'
);

-- --- Aislamiento ----------------------------------------------------------------
select test.ok(
  (select count(*) = 0 from app.buscar_conocimiento(:aurora, 'hilos tensores')),
  'PB-03/G: Aurora no encuentra los hilos tensores de Olea'
);
select test.ok(
  (select count(*) = 1 from app.buscar_conocimiento(:olea, 'hilos tensores')),
  'y Olea sí encuentra los suyos'
);
select test.throws(
  format('insert into public.knowledge_chunks (business_id, doc_id, contenido) values (%L, %L, ''x'')', :aurora, :doc_o),
  '23503', 'un trozo no se puede colgar del documento de otro negocio'
);
select test.throws(
  format('insert into public.knowledge_valores (business_id, doc_id, tipo, valor, estado) values (%L, %L, ''precio'', ''{}'', ''aceptado'')', :aurora, :doc_o),
  '23503', 'un valor no se puede colgar del documento de otro negocio'
);
select test.throws(
  format('insert into public.knowledge_valores (business_id, doc_id, tipo, service_id, valor, estado) values (%L, %L, ''precio'', %L, ''{}'', ''aceptado'')', :aurora, :doc_a, :serv_o),
  '23503', 'ni del servicio de otro negocio'
);

-- --- Borradores (PC-03) ---------------------------------------------------------
select test.ok(
  (select count(*) = 0 from app.buscar_conocimiento(:aurora, 'mesoterapia capilar caida del pelo') where doc_id = :borr::uuid),
  'PC-03: un borrador del chat no se busca'
);

-- --- knowledge_valores ----------------------------------------------------------
select test.succeeds(
  format($q$insert into public.knowledge_valores (business_id, doc_id, tipo, service_id, etiqueta, valor, fragmento, texto_valor, estado)
            values (%L, %L, 'precio', %L, 'Limpieza facial', '{"euros":55}', 'Limpieza facial … 55 €', '55 €', 'pendiente')$q$, :aurora, :doc_a, :serv_a),
  'PB-04: un precio del documento, ligado a su servicio'
);
select test.throws(
  format($q$insert into public.knowledge_valores (business_id, doc_id, tipo, service_id, valor, estado) values (%L, %L, 'horario', %L, '{}', 'aceptado')$q$, :aurora, :doc_a, :serv_a),
  '23514', 'un horario no va ligado a un servicio'
);
select test.throws(
  format($q$insert into public.knowledge_valores (business_id, doc_id, tipo, dias, valor, estado) values (%L, %L, 'horario', '{7}', '{}', 'aceptado')$q$, :aurora, :doc_a),
  '23514', 'los días van de 0 a 6'
);
select test.throws(
  format($q$insert into public.knowledge_valores (business_id, doc_id, tipo, valor, estado) values (%L, %L, 'color', '{}', 'aceptado')$q$, :aurora, :doc_a),
  '23514', 'solo se comparan precio, duración, horario, dirección y teléfono'
);

-- --- PB-06: límites -------------------------------------------------------------
-- Aurora tiene 1 activo (3 páginas). Hasta 20 activos.
insert into public.knowledge_docs (business_id, titulo, tipo, contenido_raw, origen, paginas)
  select :aurora, 'Doc ' || n, 'texto', 'texto ' || n, 'portal', 1 from generate_series(2, 20) n;
select test.ok(
  (select count(*) = 20 from public.knowledge_docs where business_id = :aurora::uuid and tipo <> 'faq' and estado = 'activo'),
  'PB-06: 20 documentos caben'
);
select test.throws(
  format($q$insert into public.knowledge_docs (business_id, titulo, tipo, contenido_raw, origen, paginas) values (%L, 'El 21', 'texto', 'x', 'portal', 1)$q$, :aurora),
  'RA011', 'PB-06: el documento 21 no'
);
select test.succeeds(
  format($q$insert into public.knowledge_docs (business_id, titulo, tipo, contenido_raw, origen, paginas, estado) values (%L, 'Borrador 22', 'texto', 'x', 'chat', 1, 'borrador')$q$, :aurora),
  'PC-03: un borrador no cuenta para el límite'
);
select test.throws(
  format($q$update public.knowledge_docs set estado = 'activo' where business_id = %L and titulo = 'Borrador 22'$q$, :aurora),
  'RA011', 'pero al confirmarlo sí'
);
select test.succeeds(
  format($q$insert into public.knowledge_docs (business_id, titulo, tipo, contenido_raw, orden) values (%L, '¿Hay parking?', 'faq', 'Sí', 1)$q$, :aurora),
  'las preguntas frecuentes no cuentan como documentos'
);
-- 100 páginas: Olea tiene 2.
select test.succeeds(
  format($q$insert into public.knowledge_docs (business_id, titulo, tipo, contenido_raw, origen, paginas) values (%L, 'Manual', 'pdf', 'x', 'panel', 98)$q$, :olea),
  'PB-06: hasta 100 páginas caben'
);
select test.throws(
  format($q$insert into public.knowledge_docs (business_id, titulo, tipo, contenido_raw, origen, paginas) values (%L, 'Una más', 'imagen', 'x', 'portal', 1)$q$, :olea),
  'RA011', 'PB-06: la página 101 no'
);
create temp table detalle_ra011 (detail text) on commit drop;
do $$
declare v_detail text;
begin
  insert into public.knowledge_docs (business_id, titulo, tipo, contenido_raw, origen, paginas)
    values ('18181818-1818-4818-8818-000000000002', 'Otra', 'pdf', 'x', 'portal', 5);
exception when sqlstate 'RA011' then
  get stacked diagnostics v_detail = pg_exception_detail;
  insert into detalle_ra011 values (v_detail);
end;
$$;
select test.ok((select detail = 'paginas:0' from detalle_ra011), 'RA011 dice cuántas páginas quedan (detail paginas:0)');
select test.throws(
  format($q$update public.knowledge_docs set paginas = 99 where business_id = %L and titulo = 'Carta Olea'$q$, :olea),
  'RA011', 'PB-06: reemplazar por una versión más larga también cuenta'
);

-- --- Forma de un documento ------------------------------------------------------
select test.throws(
  format($q$insert into public.knowledge_docs (business_id, titulo, tipo, contenido_raw) values (%L, 'Sin origen', 'pdf', 'x')$q$, :olea),
  '23514', 'un documento necesita origen (portal, panel o chat)'
);
select test.throws(
  format($q$insert into public.knowledge_docs (business_id, titulo, tipo, contenido_raw, origen) values (%L, 'Vacío', 'pdf', '  ', 'portal')$q$, :olea),
  '23514', 'y texto'
);
select test.throws(
  format($q$insert into public.knowledge_docs (business_id, titulo, tipo, contenido_raw, origen, estado) values (%L, 'Raro', 'pdf', 'x', 'portal', 'publicado')$q$, :olea),
  '23514', 'el estado es borrador o activo'
);

-- --- Cascadas -------------------------------------------------------------------
delete from public.knowledge_docs where id = :doc_a::uuid;
select test.ok(
  (select count(*) = 0 from public.knowledge_chunks where doc_id = :doc_a::uuid)
  and (select count(*) = 0 from public.knowledge_valores where doc_id = :doc_a::uuid),
  'PB-03: borrar un documento se lleva sus trozos y sus valores'
);
select test.ok(
  (select count(*) = 0 from app.buscar_conocimiento(:aurora, 'lo del bótox')),
  'PB-03: y el agente deja de encontrarlo al momento'
);
delete from public.businesses where id = :olea::uuid;
select test.ok(
  (select count(*) = 0 from public.knowledge_docs where business_id = :olea::uuid)
  and (select count(*) = 0 from public.knowledge_chunks where business_id = :olea::uuid),
  'borrar el negocio borra sus documentos'
);

-- --- PC-22 y PB-07 --------------------------------------------------------------
select test.ok(
  (select tope_portal_usd = 5 from public.businesses where id = :aurora::uuid),
  'PC-22: el chat del portal tiene su tope, 5 US$ de serie'
);
select test.throws(
  format('update public.businesses set tope_portal_usd = -1 where id = %L', :aurora),
  '23514', 'PC-22: el tope no puede ser negativo'
);
select test.throws(
  format($q$insert into public.usage_events (business_id, tipo, cantidad, concepto) values (%L, 'token', 1, 'otra_cosa')$q$, :aurora),
  '23514', 'PB-07: el concepto del consumo es conversacion o preparar_documento'
);

-- --- PB-06: el archivo sale del chat --------------------------------------------
insert into public.conversations (id, business_id, canal, alta) values ('18181818-1818-4818-8818-0000000000c1', :aurora, 'web', true);
insert into portal.adjuntos (id, business_id, conversation_id, nombre, tipo, bytes, datos)
  values ('18181818-1818-4818-8818-0000000000a1', :aurora, '18181818-1818-4818-8818-0000000000c1', 'carta.pdf', 'application/pdf', 3, '\x010203');
select test.throws(
  $q$update portal.adjuntos set datos = '' where id = '18181818-1818-4818-8818-0000000000a1'$q$,
  '23514', 'un adjunto no se queda sin bytes si no se guardó como documento'
);
select test.succeeds(
  $q$update portal.adjuntos set datos = '', guardado_at = now(), documento_titulo = 'Carta 2026' where id = '18181818-1818-4818-8818-0000000000a1'$q$,
  'PB-06: al guardarse como documento, el archivo sale del chat (sin bytes)'
);

-- --- RLS ------------------------------------------------------------------------
select test.ok(
  (select relrowsecurity from pg_class where oid = 'public.knowledge_valores'::regclass)
  and exists (select 1 from pg_policies where tablename = 'knowledge_valores' and policyname = 'tenant_isolation'),
  'RLS y política de tenant en knowledge_valores'
);

select test.resumen();
rollback;
