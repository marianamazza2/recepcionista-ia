// =============================================================================
// Consumo por negocio y tope mensual (Fase 3 · 3.3)
// =============================================================================
// Tras cada mensaje del widget se registran en `usage_events`:
//   · `mensaje` (1) — todo mensaje que se procesa, también los que responde el
//     código sin llamar a la IA (límites, tope);
//   · `token` (total de la vuelta) con su coste en US$ — solo si hubo llamadas;
//   · `cita` (1) por cada cita nueva que reservó el agente.
//
// El coste se calcula por llamada con el modelo que de verdad respondió (los
// fallbacks del servidor pueden cambiarlo) y los precios de core/costes.ts, en
// US$ (ver la migración …130000_widget_web).
//
// El mes del tope (PW-04) y del informe es el mes natural en la zona horaria
// del negocio, medido con el reloj de la base.
//
// Fase 4 (PI-11, PI-13): el informe separa las conversaciones de prueba del
// panel ("Probar el chat") de las de clientas. El tope cuenta las dos: es
// gasto real de la API (PI-15, decidida el 29/10/2026).
// =============================================================================

import type { JSONValue, Sql } from 'postgres';

import { costeUsd } from '../core/costes.js';
import type { UsageDetalle } from './conversations.js';
import { inTenant } from './tenant.js';

export type TipoUso = 'mensaje' | 'token' | 'cita';

export interface EventoUso {
  tipo: TipoUso;
  cantidad: number;
  costeUsd: number;
  detalle?: Record<string, unknown>;
}

/** Una llamada a la API tal como quedó guardada en `messages`. */
export interface LlamadaRegistrada {
  modelo: string;
  usage: UsageDetalle;
}

function totalTokens(u: UsageDetalle): number {
  return u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens;
}

/**
 * Los eventos de un turno. Un modelo sin precio en la tabla cuenta los tokens
 * con coste 0 y queda anotado en `detalle.sin_precio` (para verlo en el informe).
 */
export function eventosDelTurno(params: {
  llamadas: LlamadaRegistrada[];
  citasNuevas: string[];
  respuestaFija?: string;
}): EventoUso[] {
  const eventos: EventoUso[] = [
    { tipo: 'mensaje', cantidad: 1, costeUsd: 0, ...(params.respuestaFija ? { detalle: { respuesta_fija: params.respuestaFija } } : {}) },
  ];
  if (params.llamadas.length > 0) {
    const porModelo: Record<string, UsageDetalle & { coste_usd: number | null }> = {};
    let tokens = 0;
    let coste = 0;
    const sinPrecio = new Set<string>();
    for (const { modelo, usage } of params.llamadas) {
      const c = costeUsd(modelo, usage);
      if (c === null) sinPrecio.add(modelo);
      else coste += c;
      tokens += totalTokens(usage);
      const m = (porModelo[modelo] ??= {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        coste_usd: 0,
      });
      m.input_tokens += usage.input_tokens;
      m.output_tokens += usage.output_tokens;
      m.cache_read_input_tokens += usage.cache_read_input_tokens;
      m.cache_creation_input_tokens += usage.cache_creation_input_tokens;
      m.coste_usd = c === null || m.coste_usd === null ? null : m.coste_usd + c;
    }
    eventos.push({
      tipo: 'token',
      cantidad: tokens,
      costeUsd: coste,
      detalle: {
        llamadas: params.llamadas.length,
        por_modelo: porModelo,
        ...(sinPrecio.size > 0 ? { sin_precio: [...sinPrecio] } : {}),
      },
    });
  }
  for (const id of params.citasNuevas) {
    eventos.push({ tipo: 'cita', cantidad: 1, costeUsd: 0, detalle: { appointment_id: id } });
  }
  return eventos;
}

export async function registrarUso(
  sql: Sql,
  businessId: string,
  conversationId: string | null,
  eventos: EventoUso[],
): Promise<void> {
  if (eventos.length === 0) return;
  await inTenant(sql, businessId, async (tx) => {
    for (const e of eventos) {
      await tx`
        insert into public.usage_events (business_id, conversation_id, tipo, cantidad, coste_estimado, detalle)
        values (${businessId}::uuid, ${conversationId}::uuid, ${e.tipo}, ${e.cantidad},
                ${e.costeUsd.toFixed(6)}, ${tx.json((e.detalle ?? {}) as JSONValue)})`;
    }
  });
}

/** Coste del agente en lo que va de mes (mes natural en la zona del negocio), en US$. */
export async function costeDelMes(sql: Sql, businessId: string): Promise<number> {
  const [r] = await inTenant(
    sql,
    businessId,
    (tx) => tx<{ coste: string }[]>`
      select coalesce(sum(u.coste_estimado), 0) as coste
        from public.usage_events u
        join public.businesses b on b.id = u.business_id
       where u.business_id = ${businessId}::uuid
         and u.created_at >= (date_trunc('month', now() at time zone b.timezone) at time zone b.timezone)`,
  );
  return Number(r!.coste);
}

/** PW-04: ¿llegó el negocio a su tope del mes? */
export function topeAlcanzado(costeMes: number, topeUsd: number): boolean {
  return costeMes >= topeUsd;
}

/** PW-04: a partir de qué fracción del tope el informe avisa. */
export const AVISO_TOPE = 0.8;

export interface InformeConsumo {
  businessId: string;
  negocio: string;
  mes: string; // 'AAAA-MM'
  /** Mensajes, conversaciones, citas, tokens y coste: solo los de clientas (sin las pruebas del panel). */
  mensajes: number;
  conversaciones: number;
  citas: number;
  tokens: number;
  costeUsd: number;
  /** PI-13: las conversaciones de "Probar el chat", aparte. */
  pruebas: { mensajes: number; conversaciones: number; citas: number; costeUsd: number };
  topeUsd: number;
  /** (Coste de clientas + pruebas) / tope (0–1+): lo mismo que mira el tope. null si el tope es 0. */
  fraccionTope: number | null;
  aviso: boolean;
  modelosSinPrecio: string[];
}

/** El informe de `npm run consumo` para un mes ('AAAA-MM') del negocio. */
export async function informeConsumo(sql: Sql, businessId: string, mes: string): Promise<InformeConsumo> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) {
    throw new Error(`Mes no válido: "${mes}" (formato AAAA-MM)`);
  }
  return inTenant(sql, businessId, async (tx) => {
    const [b] = await tx<{ nombre: string; tope: string; timezone: string }[]>`
      select nombre, tope_mensual_usd as tope, timezone
        from public.businesses where id = ${businessId}::uuid`;
    if (!b) throw new Error(`No existe el negocio ${businessId}`);
    const filas = await tx<
      { prueba: boolean; mensajes: string; conversaciones: string; citas: string; tokens: string; coste: string; sin_precio: string[] | null }[]
    >`
      with periodo as (
        select (${mes + '-01'}::date::timestamp at time zone ${b.timezone}) as desde,
               ((${mes + '-01'}::date + interval '1 month')::timestamp at time zone ${b.timezone}) as hasta
      ), ev as (
        select u.*, coalesce(c.prueba, false) as prueba
          from public.usage_events u
          cross join periodo p
          left join public.conversations c on c.business_id = u.business_id and c.id = u.conversation_id
         where u.business_id = ${businessId}::uuid
           and u.created_at >= p.desde and u.created_at < p.hasta
      )
      select prueba,
             coalesce(sum(cantidad) filter (where tipo = 'mensaje'), 0) as mensajes,
             count(distinct conversation_id)                            as conversaciones,
             coalesce(sum(cantidad) filter (where tipo = 'cita'), 0)    as citas,
             coalesce(sum(cantidad) filter (where tipo = 'token'), 0)   as tokens,
             coalesce(sum(coste_estimado), 0)                           as coste,
             (select array_agg(distinct m) from ev e2, jsonb_array_elements_text(e2.detalle -> 'sin_precio') m
               where e2.prueba = ev.prueba) as sin_precio
        from ev
       group by prueba`;
    const vacio = { prueba: false, mensajes: '0', conversaciones: '0', citas: '0', tokens: '0', coste: '0', sin_precio: null };
    const r = filas.find((f) => !f.prueba) ?? vacio;
    const p = filas.find((f) => f.prueba) ?? { ...vacio, prueba: true };
    const coste = Number(r.coste);
    const costePruebas = Number(p.coste);
    const tope = Number(b.tope);
    const fraccion = tope > 0 ? (coste + costePruebas) / tope : null;
    return {
      businessId,
      negocio: b.nombre,
      mes,
      mensajes: Number(r.mensajes),
      conversaciones: Number(r.conversaciones),
      citas: Number(r.citas),
      tokens: Number(r.tokens),
      costeUsd: coste,
      pruebas: { mensajes: Number(p.mensajes), conversaciones: Number(p.conversaciones), citas: Number(p.citas), costeUsd: costePruebas },
      topeUsd: tope,
      fraccionTope: fraccion,
      aviso: fraccion === null ? coste + costePruebas > 0 : fraccion >= AVISO_TOPE,
      modelosSinPrecio: [...new Set([...(r.sin_precio ?? []), ...(p.sin_precio ?? [])])],
    };
  });
}

/**
 * PI-11: el informe de todos los negocios (lo mismo que `npm run consumo`,
 * para el panel). Sin mes, el mes en curso de cada negocio en su zona horaria.
 * La lista de negocios se lee sin tenant: el panel los ve todos (PI-01).
 */
export async function informeConsumoTodos(sql: Sql, mes?: string): Promise<InformeConsumo[]> {
  const negocios = await sql<{ id: string; mes_actual: string }[]>`
    select id, to_char(now() at time zone timezone, 'YYYY-MM') as mes_actual
      from public.businesses order by nombre, id`;
  const out: InformeConsumo[] = [];
  for (const n of negocios) out.push(await informeConsumo(sql, n.id, mes ?? n.mes_actual));
  return out;
}
