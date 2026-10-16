-- =============================================================================
-- Fase 0 · 0.2 — Conocimiento / RAG (maestro §5.4)
-- =============================================================================
-- knowledge_docs · knowledge_chunks
--
-- Las tablas se crean AHORA y quedan vacías. La ingesta, el chunking, los
-- embeddings y la búsqueda semántica son de la Fase 5.
-- =============================================================================

-- El tipo `vector` vive en el esquema `extensions`.
set search_path = public, extensions;

create type public.knowledge_doc_tipo as enum ('pdf', 'texto', 'faq');

-- -----------------------------------------------------------------------------
-- knowledge_docs — el documento tal cual entró
-- -----------------------------------------------------------------------------
create table public.knowledge_docs (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  titulo        text not null check (length(trim(titulo)) > 0),
  tipo          public.knowledge_doc_tipo not null default 'texto',
  contenido_raw text,
  created_at    timestamptz not null default now(),
  unique (business_id, id)
);

create index knowledge_docs_business_idx on public.knowledge_docs (business_id);

-- -----------------------------------------------------------------------------
-- knowledge_chunks — los trozos indexados que consulta el agente
-- -----------------------------------------------------------------------------
create table public.knowledge_chunks (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  doc_id      uuid not null,
  contenido   text not null check (length(trim(contenido)) > 0),
  embedding   extensions.vector(1024),
  created_at  timestamptz not null default now(),
  foreign key (business_id, doc_id)
    references public.knowledge_docs (business_id, id) on delete cascade
);

create index knowledge_chunks_business_idx on public.knowledge_chunks (business_id);
create index knowledge_chunks_doc_idx      on public.knowledge_chunks (doc_id);

comment on column public.knowledge_chunks.embedding is
  'Embedding de 1024 dimensiones. NULL hasta que la Fase 5 lo calcule.';

-- El índice vectorial (HNSW) se crea en la Fase 5, junto con la ingesta: hay que
-- elegir antes el operador de distancia según el modelo de embeddings, y sobre
-- una tabla vacía no aporta nada. Para referencia, será algo como:
--
--   create index knowledge_chunks_embedding_idx on public.knowledge_chunks
--     using hnsw (embedding extensions.vector_cosine_ops);
