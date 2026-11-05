// =============================================================================
// Visor de conversaciones y derivaciones (Fase 4 · 4.4, PI-06, PI-07)
// =============================================================================
// Lo mismo que hoy da la skill consultar-base, para el panel: la lista de
// conversaciones de un negocio, una conversación entera (lo que dijo cada
// parte y cada herramienta con lo que pidió y lo que devolvió) y las
// derivaciones pendientes.
//
// Las herramientas se leen del log auditable (D-45): la fila del asistente
// guarda sus bloques tool_use en tool_calls.mensajes y la fila `tool` que la
// sigue, los tool_result con el mismo id.
//
// Siempre dentro del negocio (inTenant + business_id, T-03): un negocio no ve
// las conversaciones de otro aunque se pida su id.
// =============================================================================

import type { Sql } from 'postgres';

import { textoParaLaClienta } from '../core/guardrails.js';
import { inTenant } from './tenant.js';

export type FiltroConversaciones = 'todas' | 'derivadas' | 'pruebas';

export interface ConversacionResumen {
  id: string;
  creada: Date;
  ultimoMensaje: Date;
  canal: string;
  estado: 'activa' | 'escalada' | 'cerrada';
  prueba: boolean;
  clienta: { nombre: string | null; telefono: string } | null;
  mensajes: number;
  costeUsd: number;
  derivaciones: number;
  derivacionesPendientes: number;
}

export async function listarConversaciones(
  sql: Sql,
  businessId: string,
  filtro: FiltroConversaciones = 'todas',
  limite = 100,
): Promise<ConversacionResumen[]> {
  const rows = await inTenant(
    sql,
    businessId,
    (tx) => tx<
      {
        id: string; created_at: Date; ultimo_mensaje_at: Date; canal: string; estado: ConversacionResumen['estado']; prueba: boolean;
        nombre: string | null; telefono: string | null; mensajes: number; coste: string; derivaciones: number; pendientes: number;
      }[]
    >`
      select c.id, c.created_at, c.ultimo_mensaje_at, c.canal, c.estado, c.prueba, cu.nombre, cu.telefono,
             (select count(*)::int from public.messages m
               where m.business_id = c.business_id and m.conversation_id = c.id and m.rol = 'user') as mensajes,
             (select coalesce(sum(u.coste_estimado), 0) from public.usage_events u
               where u.business_id = c.business_id and u.conversation_id = c.id) as coste,
             (select count(*)::int from public.escalations e
               where e.business_id = c.business_id and e.conversation_id = c.id) as derivaciones,
             (select count(*)::int from public.escalations e
               where e.business_id = c.business_id and e.conversation_id = c.id and not e.resuelta) as pendientes
        from public.conversations c
        left join public.customers cu on cu.business_id = c.business_id and cu.id = c.customer_id
       where c.business_id = ${businessId}::uuid
         and (${filtro} <> 'pruebas' or c.prueba)
         and (${filtro} <> 'derivadas'
              or exists (select 1 from public.escalations e where e.business_id = c.business_id and e.conversation_id = c.id))
       order by c.ultimo_mensaje_at desc, c.id
       limit ${limite}`,
  );
  return rows.map((r) => ({
    id: r.id,
    creada: r.created_at,
    ultimoMensaje: r.ultimo_mensaje_at,
    canal: r.canal,
    estado: r.estado,
    prueba: r.prueba,
    clienta: r.telefono ? { nombre: r.nombre, telefono: r.telefono } : null,
    mensajes: r.mensajes,
    costeUsd: Number(r.coste),
    derivaciones: r.derivaciones,
    derivacionesPendientes: r.pendientes,
  }));
}

/** Una línea de la conversación, en el orden en que pasó. */
export type LineaConversacion =
  | { tipo: 'clienta'; fecha: Date; texto: string }
  | { tipo: 'asistente'; fecha: Date; texto: string; respuestaFija: string | null }
  | { tipo: 'herramienta'; fecha: Date; nombre: string; entrada: unknown; resultado: unknown; error: boolean };

export interface ConversacionDetalle extends Omit<ConversacionResumen, 'mensajes' | 'derivaciones' | 'derivacionesPendientes'> {
  lineas: LineaConversacion[];
  derivaciones: { id: string; motivo: string | null; resuelta: boolean; creada: Date; resueltaAt: Date | null }[];
  tokens: number;
}

interface Bloque {
  type?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

function bloques(toolCalls: unknown): Bloque[] {
  const mensajes = (toolCalls as { mensajes?: { content?: unknown }[] } | null)?.mensajes ?? [];
  return mensajes.flatMap((m) => (Array.isArray(m.content) ? (m.content as Bloque[]) : []));
}

/** El resultado de una herramienta tal cual lo vio el modelo (JSON si lo es). */
function resultadoLegible(content: unknown): unknown {
  const texto = typeof content === 'string' ? content : Array.isArray(content) ? content.map((c: { text?: string }) => c.text ?? '').join('') : '';
  try {
    return JSON.parse(texto);
  } catch {
    return texto;
  }
}

export async function leerConversacion(sql: Sql, businessId: string, conversationId: string): Promise<ConversacionDetalle | null> {
  return inTenant(sql, businessId, async (tx) => {
    const [c] = await tx<
      { id: string; created_at: Date; ultimo_mensaje_at: Date; canal: string; estado: ConversacionResumen['estado']; prueba: boolean; nombre: string | null; telefono: string | null; coste: string; tokens: string }[]
    >`
      select c.id, c.created_at, c.ultimo_mensaje_at, c.canal, c.estado, c.prueba, cu.nombre, cu.telefono,
             (select coalesce(sum(u.coste_estimado), 0) from public.usage_events u
               where u.business_id = c.business_id and u.conversation_id = c.id) as coste,
             (select coalesce(sum(m.tokens_in + m.tokens_out), 0) from public.messages m
               where m.business_id = c.business_id and m.conversation_id = c.id) as tokens
        from public.conversations c
        left join public.customers cu on cu.business_id = c.business_id and cu.id = c.customer_id
       where c.business_id = ${businessId}::uuid and c.id = ${conversationId}::uuid`;
    if (!c) return null;

    const filas = await tx<{ rol: 'user' | 'assistant' | 'tool'; contenido: string | null; tool_calls: unknown; created_at: Date }[]>`
      select rol, contenido, tool_calls, created_at from public.messages
       where business_id = ${businessId}::uuid and conversation_id = ${conversationId}::uuid
       order by created_at, id`;

    const derivaciones = await tx<{ id: string; motivo: string | null; resuelta: boolean; created_at: Date; resuelta_at: Date | null }[]>`
      select id, motivo, resuelta, created_at, resuelta_at from public.escalations
       where business_id = ${businessId}::uuid and conversation_id = ${conversationId}::uuid
       order by created_at, id`;

    // Las herramientas pedidas en una fila del asistente esperan su resultado
    // en la fila `tool` siguiente.
    const lineas: LineaConversacion[] = [];
    const pendientes = new Map<string, Extract<LineaConversacion, { tipo: 'herramienta' }>>();
    for (const f of filas) {
      const fija = (f.tool_calls as { respuesta_fija?: string } | null)?.respuesta_fija ?? null;
      if (f.rol === 'user') {
        if (f.contenido) lineas.push({ tipo: 'clienta', fecha: f.created_at, texto: f.contenido });
      } else if (f.rol === 'assistant') {
        const texto = f.contenido ? textoParaLaClienta(f.contenido) : '';
        if (texto) lineas.push({ tipo: 'asistente', fecha: f.created_at, texto, respuestaFija: fija });
        for (const b of bloques(f.tool_calls)) {
          if (b.type !== 'tool_use' || !b.id) continue;
          const linea = { tipo: 'herramienta' as const, fecha: f.created_at, nombre: b.name ?? '?', entrada: b.input ?? {}, resultado: null as unknown, error: false };
          pendientes.set(b.id, linea);
          lineas.push(linea);
        }
      } else {
        for (const b of bloques(f.tool_calls)) {
          const linea = b.tool_use_id ? pendientes.get(b.tool_use_id) : undefined;
          if (!linea) continue;
          linea.resultado = resultadoLegible(b.content);
          linea.error = b.is_error === true;
        }
      }
    }

    return {
      id: c.id,
      creada: c.created_at,
      ultimoMensaje: c.ultimo_mensaje_at,
      canal: c.canal,
      estado: c.estado,
      prueba: c.prueba,
      clienta: c.telefono ? { nombre: c.nombre, telefono: c.telefono } : null,
      costeUsd: Number(c.coste),
      tokens: Number(c.tokens),
      lineas,
      derivaciones: derivaciones.map((d) => ({ id: d.id, motivo: d.motivo, resuelta: d.resuelta, creada: d.created_at, resueltaAt: d.resuelta_at })),
    };
  });
}

// -----------------------------------------------------------------------------
// Derivaciones (PI-07)
// -----------------------------------------------------------------------------

export interface DerivacionPendiente {
  id: string;
  conversationId: string;
  motivo: string | null;
  creada: Date;
  prueba: boolean;
  clienta: { nombre: string | null; telefono: string } | null;
}

export async function derivacionesPendientes(sql: Sql, businessId: string): Promise<DerivacionPendiente[]> {
  const rows = await inTenant(
    sql,
    businessId,
    (tx) => tx<{ id: string; conversation_id: string; motivo: string | null; created_at: Date; prueba: boolean; nombre: string | null; telefono: string | null }[]>`
      select e.id, e.conversation_id, e.motivo, e.created_at, c.prueba, cu.nombre, cu.telefono
        from public.escalations e
        join public.conversations c on c.business_id = e.business_id and c.id = e.conversation_id
        left join public.customers cu on cu.business_id = c.business_id and cu.id = c.customer_id
       where e.business_id = ${businessId}::uuid and not e.resuelta
       order by e.created_at desc, e.id`,
  );
  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversation_id,
    motivo: r.motivo,
    creada: r.created_at,
    prueba: r.prueba,
    clienta: r.telefono ? { nombre: r.nombre, telefono: r.telefono } : null,
  }));
}

/** PI-07: se marca resuelta a mano. Devuelve false si no existe en este negocio. */
export async function resolverDerivacion(sql: Sql, businessId: string, escalationId: string): Promise<boolean> {
  const r = await inTenant(
    sql,
    businessId,
    (tx) => tx`
      update public.escalations
         set resuelta = true, resuelta_at = coalesce(resuelta_at, now())
       where business_id = ${businessId}::uuid and id = ${escalationId}::uuid
      returning id`,
  );
  return r.length === 1;
}
