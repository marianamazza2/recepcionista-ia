-- =============================================================================
-- Fase 1 · PR-07 — Cancelación dentro del plazo: ajuste por negocio
-- =============================================================================
-- Decidido por Mariana el 16/10/2026: qué hace el agente cuando una clienta
-- quiere cancelar (o reprogramar) con menos antelación que la que pide la
-- política del negocio lo define CADA negocio.
--
--   · informar (de serie): cancela igual y le recuerda la política.
--   · bloquear: dentro del plazo no cancela ni reprograma; la pasa con una
--     persona.
--
-- Como `asignacion_profesional`, no cambia el motor de reservas: lo aplica el
-- agente (Fase 2). Recepción (panel, Fase 4) puede cancelar siempre. Se crea
-- ahora para que la configuración del negocio quede completa.
--
-- `politica_cancelacion` sigue siendo el TEXTO que el agente explica; el
-- número de horas vive acá para que el agente pueda comparar sin leer texto.
-- =============================================================================

set search_path = public;

-- Enum en su propia sentencia (D-04).
create type public.cancelacion_modo as enum ('informar', 'bloquear');

alter table public.businesses
  add column cancelacion_modo        public.cancelacion_modo not null default 'informar',
  add column cancelacion_plazo_horas integer not null default 24
    constraint businesses_cancelacion_plazo_valido check (cancelacion_plazo_horas >= 0);

comment on column public.businesses.cancelacion_modo is
  'PR-07: dentro del plazo, el agente solo informa la política (de serie) o bloquea y deriva a una persona. También aplica a reprogramar.';
comment on column public.businesses.cancelacion_plazo_horas is
  'PR-07: horas antes de la cita a partir de las cuales aplica la política de cancelación. De serie 24.';
