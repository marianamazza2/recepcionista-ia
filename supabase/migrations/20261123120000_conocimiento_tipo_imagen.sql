-- =============================================================================
-- Fase 5 · 5.1 — Un tipo más de documento: 'imagen' (PB-02)
-- =============================================================================
-- PB-02 (23/11/2026): el negocio sube PDF (también escaneados), fotos
-- (folletos, carteles) y texto escrito en el portal. `knowledge_doc_tipo`
-- tenía 'pdf', 'texto' y 'faq' desde la Fase 0; falta la foto.
--
-- En su propia migración (T-04): un valor nuevo de un enum no se puede usar en
-- la misma transacción en que se crea, y la siguiente migración ya lo usa.
-- No se toca ninguna migración anterior.
-- =============================================================================

set search_path = public;

alter type public.knowledge_doc_tipo add value if not exists 'imagen';
