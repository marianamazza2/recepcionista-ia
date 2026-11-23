-- =============================================================================
-- Test 17 — Adjuntos del chat del portal (Fase 9b: PC-21, PD-13)
-- =============================================================================
--   · Solo imágenes y PDF, con tamaño y bytes que cuadran.
--   · Un adjunto no puede ir a la conversación de otro negocio.
--   · Se van con su conversación y con el negocio (cascada).
--   · El borrado de PD-13 se lleva los de conversaciones vencidas y los que
--     se subieron y nunca se mandaron; los recientes se quedan.
--   · RLS activo.
-- =============================================================================

\set ON_ERROR_STOP on

begin;
\ir _helpers.sql

\echo '17 — adjuntos del chat del portal'

\set clinica '\'17171717-1717-4717-8717-000000000001\''
\set otra    '\'17171717-1717-4717-8717-000000000002\''
\set c_vieja '\'17171717-1717-4717-8717-0000000000c1\''
\set c_nueva '\'17171717-1717-4717-8717-0000000000c2\''
\set c_ajena '\'17171717-1717-4717-8717-0000000000c9\''

insert into public.businesses (id, nombre, slug, timezone) values
  (:clinica, 'Clínica 17', 'clinica-17', 'Europe/Madrid'),
  (:otra,    'Otra 17',    'otra-17',    'Europe/Madrid');

insert into public.conversations (id, business_id, canal, alta, titulo, ultimo_mensaje_at) values
  (:c_vieja, :clinica, 'web', true, 'Horarios viejos', now() - interval '7 months'),
  (:c_nueva, :clinica, 'web', true, 'Horarios',        now()),
  (:c_ajena, :otra,    'web', true, 'De otro',         now());

-- Tipos y tamaños.
insert into portal.adjuntos (business_id, conversation_id, nombre, tipo, bytes, datos)
  values (:clinica, :c_nueva, 'horario.jpg', 'image/jpeg', 3, '\x010203');
select test.ok((select count(*) = 1 from portal.adjuntos where business_id = :clinica::uuid), 'PC-21: una imagen se guarda');
select test.throws(
  format('insert into portal.adjuntos (business_id, nombre, tipo, bytes, datos) values (%L, ''x.docx'', ''application/msword'', 1, ''\x01'')', :clinica),
  '23514', 'PC-21: un Word no vale (solo imágenes y PDF)'
);
select test.throws(
  format('insert into portal.adjuntos (business_id, nombre, tipo, bytes, datos) values (%L, ''x.pdf'', ''application/pdf'', 9, ''\x01'')', :clinica),
  '23514', 'los bytes declarados tienen que cuadrar con los guardados'
);
select test.throws(
  format('insert into portal.adjuntos (business_id, nombre, tipo, bytes, datos) values (%L, '''', ''application/pdf'', 1, ''\x01'')', :clinica),
  '23514', 'sin nombre no vale'
);

-- Otro negocio no.
select test.throws(
  format('insert into portal.adjuntos (business_id, conversation_id, nombre, tipo, bytes, datos) values (%L, %L, ''x.png'', ''image/png'', 1, ''\x01'')', :clinica, :c_ajena),
  '23503', 'un adjunto no puede ir a la conversación de otro negocio'
);

-- PD-13: vencidos y sueltos.
insert into portal.adjuntos (business_id, conversation_id, nombre, tipo, bytes, datos, created_at) values
  (:clinica, :c_vieja, 'viejo.pdf',  'application/pdf', 1, '\x01', now() - interval '7 months'),
  (:clinica, null,     'suelto.png', 'image/png',       1, '\x01', now() - interval '2 days'),
  (:clinica, null,     'recien.png', 'image/png',       1, '\x01', now());
insert into public.messages (business_id, conversation_id, rol, contenido, created_at)
  values (:clinica, :c_vieja, 'user', 'Te mando el horario', now() - interval '7 months');

select * from app.borrar_conversaciones_vencidas(6);
select test.ok(
  (select array_agg(nombre order by nombre) from portal.adjuntos where business_id = :clinica::uuid) = array['horario.jpg', 'recien.png'],
  'PD-13 + PC-21: se borran los de conversaciones vencidas y los sueltos de más de un día; los recientes se quedan'
);

-- Cascadas.
delete from public.conversations where id = :c_nueva::uuid;
select test.ok((select count(*) = 0 from portal.adjuntos where nombre = 'horario.jpg'), 'se van con su conversación');
delete from public.businesses where id = :clinica::uuid;
select test.ok((select count(*) = 0 from portal.adjuntos where business_id = :clinica::uuid), 'y con el negocio');

select test.ok(
  (select relrowsecurity from pg_class where oid = 'portal.adjuntos'::regclass),
  'RLS activo en portal.adjuntos'
);

select test.resumen();
rollback;
