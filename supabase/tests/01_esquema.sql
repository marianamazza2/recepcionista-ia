-- =============================================================================
-- Test 01 — El esquema está completo (spec de fase, DoD punto 1)
-- =============================================================================
-- Verifica que existe todo lo que la sección 5 del maestro pide: extensiones,
-- tablas, tipos, la restricción anti-solapamiento y el RPC.
-- =============================================================================

\set ON_ERROR_STOP on

begin;
\ir _helpers.sql

\echo '01 — esquema completo'

-- --- Extensiones -------------------------------------------------------------
select test.ok(
  exists (select 1 from pg_extension where extname = 'btree_gist'),
  'la extensión btree_gist está instalada'
);

select test.ok(
  exists (select 1 from pg_extension where extname = 'vector'),
  'la extensión vector (pgvector) está instalada'
);

-- --- Tablas del modelo de datos (maestro §5) ---------------------------------
select test.ok(
  not exists (
    select unnest(array[
      'businesses', 'services', 'staff', 'staff_services', 'business_hours', 'time_off',
      'customers', 'appointments',
      'conversations', 'messages', 'escalations',
      'knowledge_docs', 'knowledge_chunks',
      'integrations', 'usage_events'
    ]) as t
    except
    select table_name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'
  ),
  'existen las 15 tablas del modelo de datos'
);

-- --- Toda tabla operativa lleva business_id (maestro §3.3) -------------------
select test.ok(
  not exists (
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and c.relname <> 'businesses'
       and not exists (
         select 1 from information_schema.columns col
          where col.table_schema = 'public'
            and col.table_name = c.relname
            and col.column_name = 'business_id'
       )
  ),
  'todas las tablas salvo businesses llevan business_id'
);

-- --- Tipos enumerados --------------------------------------------------------
select test.ok(
  not exists (
    select unnest(array[
      'business_estado', 'appointment_estado', 'appointment_origen',
      'conversation_canal', 'conversation_estado', 'message_rol',
      'knowledge_doc_tipo', 'integration_tipo', 'usage_tipo'
    ]) as t
    except
    select typname from pg_type where typtype = 'e'
  ),
  'existen todos los tipos enumerados'
);

-- --- La restricción anti-solapamiento (0.3) ----------------------------------
select test.ok(
  exists (
    select 1
      from pg_constraint
     where conname = 'no_overlap'
       and conrelid = 'public.appointments'::regclass
       and contype = 'x'          -- 'x' = EXCLUDE
  ),
  'appointments tiene la restricción de exclusión no_overlap'
);

-- Que ignore las canceladas es parte del contrato, no un detalle.
select test.ok(
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'no_overlap')
    like '%estado <> ''cancelada''%',
  'no_overlap excluye del índice las citas canceladas'
);

-- --- Unicidad del cliente por negocio ----------------------------------------
select test.ok(
  exists (
    select 1 from pg_constraint
     where conname = 'customers_telefono_unico_por_negocio'
       and conrelid = 'public.customers'::regclass
  ),
  'customers tiene UNIQUE (business_id, telefono)'
);

-- --- Embedding de 1024 dimensiones (maestro §5.4) ----------------------------
select test.ok(
  (select format_type(a.atttypid, a.atttypmod)
     from pg_attribute a
    where a.attrelid = 'public.knowledge_chunks'::regclass
      and a.attname  = 'embedding') like '%vector(1024)',
  'knowledge_chunks.embedding es vector(1024)'
);

-- --- El RPC de reserva (0.5) --------------------------------------------------
select test.ok(
  exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'book_appointment'
  ),
  'existe el RPC public.book_appointment'
);

-- --- Motor de reservas (Fase 1) ---------------------------------------------
select test.ok(
  to_regprocedure('public.available_slots(uuid, uuid, timestamptz, timestamptz, uuid)') is not null
  and to_regprocedure('public.ultima_profesional(uuid, uuid)') is not null
  and to_regprocedure('app.slot_es_valido(uuid, uuid, uuid, timestamptz)') is not null,
  'existen available_slots, ultima_profesional y app.slot_es_valido'
);

select test.ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname, p.proname) in (('public', 'available_slots'), ('public', 'book_appointment'),
                                      ('public', 'ultima_profesional'), ('app', 'slot_es_valido'))
       and p.prosecdef),
  'las funciones del motor son SECURITY INVOKER (D-17)'
);

select test.ok(
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'businesses'
      and column_name in ('antelacion_min_horas', 'intervalo_huecos_min',
                          'margen_dentro_horario', 'asignacion_profesional',
                          'cancelacion_modo', 'cancelacion_plazo_horas')) = 6,
  'businesses tiene los 6 ajustes por negocio de la Fase 1'
);

-- --- Índices que pide el spec de fase (0.2) ----------------------------------
select test.ok(
  exists (select 1 from pg_indexes where tablename = 'appointments' and indexdef like '%start_at%'),
  'appointments está indexada por start_at'
);

select test.ok(
  exists (select 1 from pg_indexes where tablename = 'appointments' and indexdef like '%staff_id%'),
  'appointments está indexada por staff_id'
);

select test.resumen();
rollback;
