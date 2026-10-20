-- =============================================================================
-- Consultas de la skill consultar-base. SOLO LECTURA.
-- =============================================================================
-- Cada bloque empieza con "-- @nombre" y pide variables de psql (negocio, conv,
-- tel). Cómo ejecutarlas: ver SKILL.md (@ consulta.sh).
-- Horas siempre en la zona del negocio.
-- =============================================================================

-- @conversaciones  (variables: negocio = slug)
-- Las últimas 15 conversaciones del negocio.
select v.id, v.canal, v.estado,
       coalesce(c.nombre, '(sin identificar)') as clienta,
       v.ultimo_mensaje_at at time zone b.timezone as ultimo_mensaje,
       (select count(*) from public.messages m where m.business_id = v.business_id and m.conversation_id = v.id and m.rol = 'user') as mensajes_clienta,
       (select sum(m.tokens_in + m.tokens_out) from public.messages m where m.business_id = v.business_id and m.conversation_id = v.id) as tokens
  from public.conversations v
  join public.businesses b on b.id = v.business_id
  left join public.customers c on c.business_id = v.business_id and c.id = v.customer_id
 where b.slug = :'negocio'
 order by v.ultimo_mensaje_at desc
 limit 15;

-- @conversacion  (variables: conv = id de la conversación)
-- La conversación entera, en orden: qué dijo la clienta, qué herramientas
-- llamó el agente, qué devolvieron y qué respondió. respuesta_fija = texto del
-- código, sin IA (límite, tope, error, derivada).
select to_char(m.created_at at time zone b.timezone, 'DD/MM HH24:MI:SS') as cuando,
       m.rol,
       m.contenido,
       m.tool_calls->'herramientas' as herramientas,
       m.tool_calls->>'respuesta_fija' as respuesta_fija,
       m.tool_calls->>'stop_reason' as stop_reason,
       m.tokens_in, m.tokens_out
  from public.messages m
  join public.businesses b on b.id = m.business_id
 where m.conversation_id = :'conv'
 order by m.created_at;

-- @resultados  (variables: conv)
-- Lo que devolvió cada herramienta (entrada del modelo y resultado), para
-- entender por qué el agente dijo lo que dijo.
select to_char(m.created_at at time zone b.timezone, 'HH24:MI:SS') as cuando,
       bloque->>'type' as tipo,
       coalesce(bloque->>'name', '') as herramienta,
       left(coalesce(bloque->'input', bloque->'content')::text, 600) as detalle
  from public.messages m
  join public.businesses b on b.id = m.business_id
  cross join lateral jsonb_array_elements(m.tool_calls->'mensajes') as msg
  cross join lateral jsonb_array_elements(case jsonb_typeof(msg->'content') when 'array' then msg->'content' else '[]'::jsonb end) as bloque
 where m.conversation_id = :'conv'
   and bloque->>'type' in ('tool_use', 'tool_result')
 order by m.created_at;

-- @clienta  (variables: negocio, tel = teléfono +34…)
-- Una clienta por teléfono: sus citas y sus conversaciones.
select 'cita' as que, a.id, s.nombre as profesional, sv.nombre as servicio,
       a.start_at at time zone b.timezone as cuando, a.estado::text as estado
  from public.customers c
  join public.businesses b on b.id = c.business_id
  join public.appointments a on a.business_id = c.business_id and a.customer_id = c.id
  join public.staff s on s.business_id = a.business_id and s.id = a.staff_id
  join public.services sv on sv.business_id = a.business_id and sv.id = a.service_id
 where b.slug = :'negocio' and c.telefono = :'tel'
union all
select 'conversación', v.id, null, v.canal::text, v.ultimo_mensaje_at at time zone b.timezone, v.estado::text
  from public.customers c
  join public.businesses b on b.id = c.business_id
  join public.conversations v on v.business_id = c.business_id and v.customer_id = c.id
 where b.slug = :'negocio' and c.telefono = :'tel'
 order by 5 desc;

-- @citas  (variables: negocio)
-- Las últimas 15 citas creadas, en hora local.
select a.id, c.nombre as clienta, s.nombre as profesional, sv.nombre as servicio,
       a.start_at at time zone b.timezone as cuando, a.estado, a.origen,
       a.created_at at time zone b.timezone as creada
  from public.appointments a
  join public.businesses b on b.id = a.business_id
  join public.customers c on c.business_id = a.business_id and c.id = a.customer_id
  join public.staff s on s.business_id = a.business_id and s.id = a.staff_id
  join public.services sv on sv.business_id = a.business_id and sv.id = a.service_id
 where b.slug = :'negocio'
 order by a.created_at desc
 limit 15;

-- @derivaciones  (variables: negocio)
-- Lo que se pasó al equipo y sigue sin resolver.
select e.created_at at time zone b.timezone as cuando, e.motivo, e.conversation_id
  from public.escalations e
  join public.businesses b on b.id = e.business_id
 where b.slug = :'negocio' and not e.resuelta
 order by e.created_at desc;

-- @consumo  (variables: negocio)
-- Consumo del mes en curso (zona del negocio) frente al tope (PW-04). US$.
select e.tipo, sum(e.cantidad) as cantidad, round(sum(e.coste_estimado), 4) as coste_usd,
       max(b.tope_mensual_usd) as tope_usd
  from public.usage_events e
  join public.businesses b on b.id = e.business_id
 where b.slug = :'negocio'
   and e.created_at >= date_trunc('month', now() at time zone b.timezone) at time zone b.timezone
 group by e.tipo
 order by e.tipo;

-- @sms  (variables: negocio)
-- Los últimos SMS de confirmación (PW-07). El enlace se guarda tapado.
select m.created_at at time zone b.timezone as cuando, m.estado, m.proveedor, m.texto, m.error
  from public.sms_messages m
  join public.businesses b on b.id = m.business_id
 where b.slug = :'negocio'
 order by m.created_at desc
 limit 10;
