-- =============================================================================
-- Test 16 — Varios chats en el portal y el alta por temas (Fase 9b: PC-17, PC-18)
-- =============================================================================
--   · El título de un chat tiene entre 1 y 80 caracteres.
--   · Un chat solo puede continuar otro chat del MISMO negocio, nunca a sí
--     mismo, y cada chat tiene como mucho una continuación.
--   · Borrar la conversación vieja no se lleva la nueva: solo suelta el enlace.
--   · secciones_hechas solo acepta las cinco secciones del alta.
-- =============================================================================

\set ON_ERROR_STOP on

begin;
\ir _helpers.sql

\echo '16 — chats del portal y alta por temas'

\set clinica '\'16161616-1616-4616-8616-000000000001\''
\set otra    '\'16161616-1616-4616-8616-000000000002\''
\set c1      '\'16161616-1616-4616-8616-0000000000c1\''
\set c2      '\'16161616-1616-4616-8616-0000000000c2\''
\set c3      '\'16161616-1616-4616-8616-0000000000c3\''
\set ajena   '\'16161616-1616-4616-8616-0000000000c9\''

insert into public.businesses (id, nombre, slug, timezone) values
  (:clinica, 'Clínica 16', 'clinica-16', 'Europe/Madrid'),
  (:otra,    'Otra 16',    'otra-16',    'Europe/Madrid');

insert into public.conversations (id, business_id, canal, alta, titulo) values
  (:c1,    :clinica, 'web', true, 'Horarios del local'),
  (:ajena, :otra,    'web', true, 'Chat de otro negocio');

select test.throws(
  format('insert into public.conversations (business_id, canal, alta, titulo) values (%L, ''web'', true, '''')', :clinica),
  '23514', 'PC-17: un título vacío no vale'
);
select test.throws(
  format('insert into public.conversations (business_id, canal, alta, titulo) values (%L, ''web'', true, %L)', :clinica, repeat('x', 81)),
  '23514', 'PC-17: un título de más de 80 caracteres no vale'
);

-- Continuar: el mismo negocio sí; otro negocio no; a sí mismo no; dos veces no.
insert into public.conversations (id, business_id, canal, alta, titulo, continua_de)
  values (:c2, :clinica, 'web', true, 'Horarios del local', :c1);
select test.ok((select continua_de = :c1::uuid from public.conversations where id = :c2::uuid), 'un chat largo sigue en otra conversación del mismo negocio');
select test.throws(
  format('insert into public.conversations (business_id, canal, alta, continua_de) values (%L, ''web'', true, %L)', :clinica, :ajena),
  '23503', 'no puede continuar un chat de otro negocio'
);
select test.throws(
  format('insert into public.conversations (business_id, canal, alta, continua_de) values (%L, ''web'', true, %L)', :clinica, :c1),
  '23505', 'un chat tiene como mucho una continuación'
);
select test.throws(
  format('update public.conversations set continua_de = id where id = %L', :c1),
  '23514', 'un chat no se continúa a sí mismo'
);

-- Ocultar no borra.
update public.conversations set oculta_at = now() where id = :c2::uuid;
select test.ok((select count(*) = 1 from public.conversations where id = :c2::uuid), 'PC-17: «borrar» un chat lo oculta, la fila se queda');

-- Borrar la vieja suelta el enlace de la nueva, sin llevársela.
delete from public.conversations where id = :c1::uuid;
select test.ok(
  (select continua_de is null and business_id = :clinica::uuid from public.conversations where id = :c2::uuid),
  'al borrar la conversación vieja, la nueva se queda (solo pierde el enlace)'
);

-- PC-18: las secciones hechas.
insert into portal.alta (business_id, secciones_hechas) values (:clinica, array['profesionales', 'negocio']);
select test.ok((select secciones_hechas = array['profesionales', 'negocio'] from portal.alta where business_id = :clinica::uuid), 'PC-18: el alta guarda las secciones hechas en cualquier orden');
select test.throws(
  format('update portal.alta set secciones_hechas = array[''festivos''] where business_id = %L', :clinica),
  '23514', 'PC-18: solo las cinco secciones del alta'
);
select test.ok((select secciones_hechas = '{}' from portal.alta where business_id = :otra::uuid) is not false, 'de serie, ninguna');
insert into portal.alta (business_id) values (:otra);
select test.ok((select secciones_hechas = '{}' from portal.alta where business_id = :otra::uuid), 'un alta nueva empieza sin secciones hechas');

select test.resumen();
rollback;
