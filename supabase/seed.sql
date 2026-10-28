-- =============================================================================
-- Fase 0 · 0.6 — Seeds: negocio de prueba "Estética Aurora"
-- =============================================================================
-- Negocio ficticio para trabajar en las fases siguientes. Lo carga
-- `supabase db reset` automáticamente (config.toml → [db.seed]).
--
-- Los UUID son FIJOS y legibles a propósito: así los tests, los ejemplos y las
-- pruebas manuales pueden referirse a ellos sin buscarlos antes.
--   a0…  negocio        c0…  profesionales    e0…  citas
--   b0…  servicios      d0…  clientes
--
-- Es re-ejecutable: el DELETE inicial arrastra en cascada todo lo del negocio.
--
-- Nota: el seed corre como `postgres`/`service_role`, que hace BYPASSRLS, así
-- que no necesita declarar tenant con app.set_business_id().
--
-- Zona horaria: el negocio está en Europe/Madrid. En septiembre y octubre de
-- 2026 rige CEST (+02), por eso los literales llevan el desfase explícito. En
-- la base todo queda guardado en UTC (maestro §9).
-- =============================================================================

begin;

delete from public.businesses where id = 'a0000000-0000-4000-8000-000000000001';

-- -----------------------------------------------------------------------------
-- El negocio
-- -----------------------------------------------------------------------------
insert into public.businesses (
  id, nombre, slug, timezone, sector, estado, plan,
  tono_de_voz, mensaje_bienvenida, politica_cancelacion,
  direccion, telefono_humano,
  antelacion_min_horas, intervalo_huecos_min, margen_dentro_horario, asignacion_profesional,
  cancelacion_modo, cancelacion_plazo_horas,
  widget_key, widget_dominios, widget_color, privacidad_url, tope_mensual_usd,
  widget_logo
) values (
  'a0000000-0000-4000-8000-000000000001',
  'Estética Aurora',
  'estetica-aurora',
  'Europe/Madrid',
  'estetica',
  'activo',
  'mensual_400',
  'Cercano y profesional. Trata de tú. Frases cortas, nada de tecnicismos ni promesas de resultados.',
  '¡Hola! Soy la asistente virtual de Estética Aurora, ¿cómo puedo ayudarte?',
  'Puedes cancelar o cambiar tu cita sin coste hasta 24 h antes. Por debajo de 24 h se cobra el 50 % del tratamiento.',
  'Calle Mayor 14, bajo. 28013 Madrid',
  '+34910000000',
  -- Ajustes por negocio (Fase 1): los valores de serie, escritos a la vista
  -- para que el seed documente la configuración completa.
  2,            -- antelacion_min_horas   (PD-05)
  30,           -- intervalo_huecos_min   (PR-01)
  false,        -- margen_dentro_horario  (PR-02)
  'preguntar',  -- asignacion_profesional (PD-03)
  'informar',   -- cancelacion_modo       (PR-07)
  24,           -- cancelacion_plazo_horas (PR-07): el "24 h" de su política
  -- Widget web (Fase 3). Clave fija para que la demo (demo/index.html) la
  -- lleve escrita; en un negocio real la genera la base.
  'wk_demo_estetica_aurora_0001',            -- widget_key
  array['localhost'],                        -- widget_dominios (PW-06): la demo local
  '#8a5a63',                                 -- widget_color (PW-01)
  'http://localhost:4310/privacidad.html',   -- privacidad_url (PW-02): la de la demo
  100,                                       -- tope_mensual_usd (PW-04)
  -- widget_logo (PW-17): el isotipo inventado de demo/aurora-isotipo.svg, en base64.
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiBmaWxsPSIjZjdlY2U5Ii8+PGcgc3Ryb2tlPSIjOGE1YTYzIiBzdHJva2Utd2lkdGg9IjMiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgZmlsbD0ibm9uZSI+PHBhdGggZD0iTTE4IDQwYTE0IDE0IDAgMCAxIDI4IDAiLz48cGF0aCBkPSJNMzIgMTR2Nk0xNyAyMmw0IDRNNDcgMjJsLTQgNE0xMCAzNGg1TTQ5IDM0aDUiLz48cGF0aCBkPSJNMTIgNDZoNDAiLz48L2c+PC9zdmc+Cg=='
);

-- -----------------------------------------------------------------------------
-- Servicios — duraciones distintas a propósito, para que el cálculo de huecos
-- de la Fase 1 tenga casos de verdad
-- -----------------------------------------------------------------------------
insert into public.services (id, business_id, nombre, descripcion, duracion_min, buffer_min, precio, precio_visible, activo) values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
   'Limpieza facial profunda',
   'Higiene facial completa con extracción, exfoliación y mascarilla adaptada al tipo de piel.',
   60, 10, 55.00, true, true),

  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001',
   'Depilación láser (zona pequeña)',
   'Sesión de láser diodo en zonas pequeñas: axilas, labio superior o mentón.',
   30, 5, 40.00, true, true),

  ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001',
   'Tratamiento corporal reafirmante',
   'Sesión corporal completa con maderoterapia y aparatología reafirmante.',
   90, 15, 85.00, true, true),

  ('b0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001',
   'Consulta de valoración',
   'Primera visita sin coste para valorar la piel y recomendar un plan de tratamiento.',
   20, 5, 0.00, true, true);

-- -----------------------------------------------------------------------------
-- Profesionales
-- -----------------------------------------------------------------------------
insert into public.staff (id, business_id, nombre, activo) values
  ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Marta', true),
  ('c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'Lucía', true);

-- Quién hace qué. Marta no hace láser y Lucía no hace corporal: así el agente
-- tiene que elegir profesional según el servicio, no al azar.
insert into public.staff_services (business_id, staff_id, service_id) values
  -- Marta: facial, corporal y valoración
  ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003'),
  ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000004'),
  -- Lucía: facial, láser y valoración
  ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002'),
  ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000004');

-- -----------------------------------------------------------------------------
-- Horario de atención — de lunes a viernes, con dos días distintos para que el
-- cálculo de huecos no sea trivial (weekday: 0 = domingo … 6 = sábado)
-- -----------------------------------------------------------------------------
insert into public.business_hours (business_id, staff_id, weekday, hora_apertura, hora_cierre) values
  -- Lunes, martes y miércoles: partido 9–14 y 16–20
  ('a0000000-0000-4000-8000-000000000001', null, 1, '09:00', '14:00'),
  ('a0000000-0000-4000-8000-000000000001', null, 1, '16:00', '20:00'),
  ('a0000000-0000-4000-8000-000000000001', null, 2, '09:00', '14:00'),
  ('a0000000-0000-4000-8000-000000000001', null, 2, '16:00', '20:00'),
  ('a0000000-0000-4000-8000-000000000001', null, 3, '09:00', '14:00'),
  ('a0000000-0000-4000-8000-000000000001', null, 3, '16:00', '20:00'),
  -- Jueves: abre más tarde y cierra más tarde
  ('a0000000-0000-4000-8000-000000000001', null, 4, '10:00', '14:00'),
  ('a0000000-0000-4000-8000-000000000001', null, 4, '16:00', '21:00'),
  -- Viernes: jornada continua, sin tarde
  ('a0000000-0000-4000-8000-000000000001', null, 5, '09:00', '15:00');

-- Horario propio (PD-01): los jueves Lucía solo trabaja por la tarde. Ese día
-- su tramo REEMPLAZA al del local, así que el jueves por la mañana solo está
-- Marta. El resto de días Lucía hereda el horario del local.
insert into public.business_hours (business_id, staff_id, weekday, hora_apertura, hora_cierre) values
  ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 4, '16:00', '21:00');

-- -----------------------------------------------------------------------------
-- Festivos y bloqueos
-- -----------------------------------------------------------------------------
insert into public.time_off (business_id, staff_id, desde, hasta, motivo) values
  -- Festivo: cierra el negocio entero (staff_id NULL)
  ('a0000000-0000-4000-8000-000000000001', null,
   '2026-10-21 00:00:00+02', '2026-10-22 00:00:00+02', 'Festivo local'),
  -- Vacaciones de Lucía: una semana completa
  ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
   '2026-09-21 00:00:00+02', '2026-09-26 00:00:00+02', 'Vacaciones'),
  -- Bloqueo puntual de media tarde: Marta en formación
  ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
   '2026-09-16 16:00:00+02', '2026-09-16 20:00:00+02', 'Formación aparatología');

-- -----------------------------------------------------------------------------
-- Clientes finales
-- -----------------------------------------------------------------------------
insert into public.customers (id, business_id, telefono, nombre, email, notas) values
  ('d0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
   '+34600111222', 'Ana Torres', 'ana.torres@example.com', 'Piel sensible, evitar ácidos fuertes.'),
  ('d0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001',
   '+34600333444', 'Carlos Ruiz', 'carlos.ruiz@example.com', null);

-- -----------------------------------------------------------------------------
-- Citas de ejemplo (lunes 19 y martes 20 de octubre de 2026, hora de Madrid)
-- -----------------------------------------------------------------------------
insert into public.appointments (
  id, business_id, staff_id, service_id, customer_id, start_at, end_at, estado, origen, notas
) values
  -- Ana con Marta: limpieza facial, lunes 10:00–11:00
  ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-000000000001',
   '2026-10-19 10:00:00+02', '2026-10-19 11:00:00+02', 'confirmada', 'agente',
   'Reservada por el widget web.'),

  -- Carlos con Lucía: láser, lunes 10:00–10:30. MISMA hora que la de arriba,
  -- distinta profesional: convive, y no es solape.
  ('e0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002',
   'd0000000-0000-4000-8000-000000000002',
   '2026-10-19 10:00:00+02', '2026-10-19 10:30:00+02', 'confirmada', 'manual',
   'Alta manual desde recepción.'),

  -- Cita CANCELADA de Marta, martes 12:00–13:30. Su hueco vuelve a estar libre:
  -- la restricción no_overlap deja pasar una cita nueva encima de esta.
  ('e0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003',
   'd0000000-0000-4000-8000-000000000001',
   '2026-10-20 12:00:00+02', '2026-10-20 13:30:00+02', 'cancelada', 'agente',
   'Cancelada por la clienta con 48 h de antelación.');

-- -----------------------------------------------------------------------------
-- Preguntas frecuentes (Fase 4, PI-08): van dentro del prompt del agente
-- -----------------------------------------------------------------------------
insert into public.knowledge_docs (id, business_id, tipo, titulo, contenido_raw, orden) values
  ('f0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'faq',
   '¿Hay aparcamiento cerca?',
   'No tenemos parking propio, pero el parking público de la Plaza de la Fuente está a 2 minutos andando.', 1),
  ('f0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'faq',
   '¿Cómo se puede pagar?',
   'Con tarjeta, Bizum o en efectivo, en el local al terminar el tratamiento.', 2),
  ('f0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'faq',
   '¿Tenéis bonos regalo?',
   'Sí. Se compran en recepción y valen para cualquier servicio durante un año.', 3);

-- -----------------------------------------------------------------------------
-- La agenda vive en nuestra propia base (maestro §7: SupabaseAdapter en v1)
-- -----------------------------------------------------------------------------
insert into public.integrations (business_id, tipo, config, activa) values
  ('a0000000-0000-4000-8000-000000000001', 'supabase', '{}'::jsonb, true);

commit;
