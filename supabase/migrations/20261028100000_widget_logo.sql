-- =============================================================================
-- Fase 3 · 3.1 — Logo del negocio en el widget (PW-17)
-- =============================================================================
-- Mariana pidió (28/10/2026) un círculo antes del nombre del negocio en la
-- cabecera del chat, con su logo o isotipo (PW-17).
--
--   · businesses.widget_logo: la imagen, guardada en la base como data URL
--     (PNG, JPEG, WebP o SVG, en base64, hasta ~150 KB). Así el widget no
--     carga nada de otra web (widget/AGENTS.md, regla 1): llega con la config.
--     NULL = sin logo: el círculo muestra la inicial del negocio.
--
-- No se toca ninguna migración anterior. businesses ya tiene RLS.
-- =============================================================================

set search_path = public;

alter table public.businesses
  add column widget_logo text
    constraint businesses_widget_logo_formato check (
      widget_logo ~ '^data:image/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$'
      and length(widget_logo) <= 200000
    );

comment on column public.businesses.widget_logo is
  'PW-17: logo o isotipo del negocio para el círculo de la cabecera del widget, como data URL base64 (png, jpeg, webp o svg+xml; hasta 200.000 caracteres). NULL = la inicial del nombre.';
