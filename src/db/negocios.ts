// =============================================================================
// Alta y edición de negocios desde el panel (Fase 4 · 4.2 y 4.3)
// =============================================================================
// Todo lo que el panel lee y guarda de un negocio, por bloques (el orden del
// cuestionario de alta): datos, reglas, el chat en su web, servicios,
// profesionales, horarios, festivos y preguntas frecuentes.
//
//   · Las validaciones que ya están en la base (horarios, solapes, color,
//     dominios, logo, límites de PI-08, lo que falta para activar) se quedan en
//     la base: aquí no se repiten. El panel traduce el error (api/admin/errores).
//   · PI-04: servicios y profesionales no se borran, se desactivan; un negocio
//     no se borra, se pausa. Festivos, tramos de horario y preguntas sí.
//   · Toda escritura va en inTenant y filtra por business_id (T-03). Las únicas
//     lecturas sin tenant son la lista de negocios (el panel los ve todos,
//     PI-01) y nada más.
//   · PI-05: lo que se guarda aquí lo lee el agente en el siguiente mensaje
//     (src/config/business.ts): no hay caché que invalidar.
// =============================================================================

import { randomUUID } from 'node:crypto';

import type { Sql, TransactionSql } from 'postgres';

import type { AsignacionProfesional, CancelacionModo } from '../config/business.js';
import { inTenant } from './tenant.js';

export type EstadoNegocio = 'activo' | 'pausado' | 'trial';

/** PI-03: códigos de app.negocio_lo_que_falta(), en el orden en que los devuelve. */
export type LoQueFalta = 'servicio' | 'profesional' | 'horario' | 'telefono' | 'dominio';

export interface NegocioResumen {
  id: string;
  nombre: string;
  slug: string;
  estado: EstadoNegocio;
  loQueFalta: LoQueFalta[];
  derivacionesPendientes: number;
}

export interface DatosNegocio {
  nombre: string;
  sector: string | null;
  timezone: string;
  direccion: string | null;
  telefonoHumano: string | null;
  tonoDeVoz: string | null;
  mensajeBienvenida: string | null;
}

export interface ReglasNegocio {
  antelacionMinHoras: number;
  intervaloHuecosMin: number;
  margenDentroHorario: boolean;
  asignacionProfesional: AsignacionProfesional;
  politicaCancelacion: string | null;
  cancelacionModo: CancelacionModo;
  cancelacionPlazoHoras: number;
}

export interface ChatNegocio {
  dominios: string[];
  color: string;
  logo: string | null;
  privacidadUrl: string | null;
  topeMensualUsd: number;
}

export interface ServicioPanel {
  nombre: string;
  descripcion: string | null;
  duracionMin: number;
  bufferMin: number;
  precio: number | null;
  precioVisible: boolean;
  activo: boolean;
}

export interface ProfesionalPanel {
  nombre: string;
  activo: boolean;
  servicioIds: string[];
}

export interface TramoPanel {
  weekday: number;
  apertura: string; // 'HH:MM'
  cierre: string; // 'HH:MM' ('24:00' = medianoche)
}

export interface FestivoPanel {
  staffId: string | null;
  desde: Date;
  hasta: Date;
  motivo: string | null;
}

export interface PreguntaPanel {
  pregunta: string;
  respuesta: string;
  orden: number;
}

export interface NegocioPanel extends DatosNegocio {
  id: string;
  slug: string;
  estado: EstadoNegocio;
  widgetKey: string;
  reglas: ReglasNegocio;
  chat: ChatNegocio;
  servicios: (ServicioPanel & { id: string; citasFuturas: number })[];
  profesionales: (ProfesionalPanel & { id: string; citasFuturas: number })[];
  horario: (TramoPanel & { staffId: string | null })[];
  /** PI-19: los días de la semana que cada profesional no trabaja. */
  diasLibres: { staffId: string; weekday: number }[];
  /** PI-12: solo los que no han terminado (los pasados se ocultan). */
  festivos: (FestivoPanel & { id: string })[];
  preguntas: (PreguntaPanel & { id: string })[];
  loQueFalta: LoQueFalta[];
}

/** Error de "no existe en este negocio": el panel responde 404. */
export class NoEncontrado extends Error {
  constructor(que: string) {
    super(`${que} no existe en este negocio`);
    this.name = 'NoEncontrado';
  }
}

// -----------------------------------------------------------------------------
// Lista y alta
// -----------------------------------------------------------------------------

/** Todos los negocios (PI-01: el panel los ve todos). Lectura sin tenant a propósito. */
export async function listarNegocios(sql: Sql): Promise<NegocioResumen[]> {
  const rows = await sql<{ id: string; nombre: string; slug: string; estado: EstadoNegocio; falta: LoQueFalta[]; pendientes: number }[]>`
    select b.id, b.nombre, b.slug, b.estado,
           public.negocio_lo_que_falta(b.id) as falta,
           (select count(*)::int from public.escalations e
             where e.business_id = b.id and not e.resuelta) as pendientes
      from public.businesses b
     order by b.nombre, b.id`;
  return rows.map((r) => ({ id: r.id, nombre: r.nombre, slug: r.slug, estado: r.estado, loQueFalta: r.falta, derivacionesPendientes: r.pendientes }));
}

/** "Estética Aurora" → "estetica-aurora" (el formato que exige businesses.slug). */
export function slugDe(nombre: string): string {
  return (
    nombre
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/g, '') || 'negocio'
  );
}

/**
 * PI-03: un negocio nuevo empieza en prueba y sin dominios (los valores de
 * serie de la base): el widget no aparece en ninguna web. Si el slug ya
 * existe se le añade un número.
 */
export async function crearNegocio(sql: Sql, p: { nombre: string; sector: string | null; timezone: string }): Promise<{ id: string; slug: string }> {
  const id = randomUUID();
  const base = slugDe(p.nombre);
  const [libre] = await sql<{ slug: string }[]>`
    select s as slug
      from (select ${base}::text as s, 0 as n
            union all
            select ${base} || '-' || n, n from generate_series(2, 200) n) c
     where not exists (select 1 from public.businesses b where b.slug = c.s)
     order by n limit 1`;
  if (!libre) throw new Error(`No hay slug libre para "${base}"`);
  await inTenant(
    sql,
    id,
    (tx) => tx`
      insert into public.businesses (id, nombre, slug, sector, timezone, estado)
      values (${id}::uuid, ${p.nombre}, ${libre.slug}, ${p.sector}, ${p.timezone}, 'trial')`,
  );
  return { id, slug: libre.slug };
}

// -----------------------------------------------------------------------------
// Lectura completa
// -----------------------------------------------------------------------------

interface BusinessRow {
  id: string;
  nombre: string;
  slug: string;
  estado: EstadoNegocio;
  sector: string | null;
  timezone: string;
  direccion: string | null;
  telefono_humano: string | null;
  tono_de_voz: string | null;
  mensaje_bienvenida: string | null;
  antelacion_min_horas: number;
  intervalo_huecos_min: number;
  margen_dentro_horario: boolean;
  asignacion_profesional: AsignacionProfesional;
  politica_cancelacion: string | null;
  cancelacion_modo: CancelacionModo;
  cancelacion_plazo_horas: number;
  widget_key: string;
  widget_dominios: string[];
  widget_color: string;
  widget_logo: string | null;
  privacidad_url: string | null;
  tope_mensual_usd: string;
  falta: LoQueFalta[];
}

export async function leerNegocio(sql: Sql, id: string): Promise<NegocioPanel | null> {
  return inTenant(sql, id, async (tx) => {
    const [b] = await tx<BusinessRow[]>`
      select b.*, public.negocio_lo_que_falta(b.id) as falta
        from public.businesses b where b.id = ${id}::uuid`;
    if (!b) return null;

    const servicios = await tx<
      { id: string; nombre: string; descripcion: string | null; duracion_min: number; buffer_min: number; precio: string | null; precio_visible: boolean; activo: boolean; futuras: number }[]
    >`
      select s.id, s.nombre, s.descripcion, s.duracion_min, s.buffer_min, s.precio, s.precio_visible, s.activo,
             (select count(*)::int from public.appointments a
               where a.business_id = s.business_id and a.service_id = s.id
                 and a.estado = 'confirmada' and a.start_at > now()) as futuras
        from public.services s
       where s.business_id = ${id}::uuid
       order by s.activo desc, s.nombre, s.id`;

    const profesionales = await tx<{ id: string; nombre: string; activo: boolean; servicios: string[]; futuras: number }[]>`
      select st.id, st.nombre, st.activo,
             coalesce((select array_agg(ss.service_id::text order by ss.service_id) from public.staff_services ss
                        where ss.business_id = st.business_id and ss.staff_id = st.id), '{}') as servicios,
             (select count(*)::int from public.appointments a
               where a.business_id = st.business_id and a.staff_id = st.id
                 and a.estado = 'confirmada' and a.start_at > now()) as futuras
        from public.staff st
       where st.business_id = ${id}::uuid
       order by st.activo desc, st.nombre, st.id`;

    const horario = await tx<{ staff_id: string | null; weekday: number; apertura: string; cierre: string }[]>`
      select staff_id, weekday, to_char(hora_apertura, 'HH24:MI') as apertura, to_char(hora_cierre, 'HH24:MI') as cierre
        from public.business_hours
       where business_id = ${id}::uuid
       order by staff_id nulls first, weekday, hora_apertura`;

    const libres = await tx<{ staff_id: string; weekday: number }[]>`
      select staff_id, weekday from public.staff_dias_libres
       where business_id = ${id}::uuid
       order by staff_id, weekday`;

    const festivos = await tx<{ id: string; staff_id: string | null; desde: Date; hasta: Date; motivo: string | null }[]>`
      select id, staff_id, desde, hasta, motivo
        from public.time_off
       where business_id = ${id}::uuid and hasta > now()
       order by desde, id`;

    const preguntas = await tx<{ id: string; titulo: string; contenido_raw: string; orden: number }[]>`
      select id, titulo, contenido_raw, orden
        from public.knowledge_docs
       where business_id = ${id}::uuid and tipo = 'faq'
       order by orden, created_at, id`;

    return {
      id: b.id,
      nombre: b.nombre,
      slug: b.slug,
      estado: b.estado,
      sector: b.sector,
      timezone: b.timezone,
      direccion: b.direccion,
      telefonoHumano: b.telefono_humano,
      tonoDeVoz: b.tono_de_voz,
      mensajeBienvenida: b.mensaje_bienvenida,
      widgetKey: b.widget_key,
      reglas: {
        antelacionMinHoras: b.antelacion_min_horas,
        intervaloHuecosMin: b.intervalo_huecos_min,
        margenDentroHorario: b.margen_dentro_horario,
        asignacionProfesional: b.asignacion_profesional,
        politicaCancelacion: b.politica_cancelacion,
        cancelacionModo: b.cancelacion_modo,
        cancelacionPlazoHoras: b.cancelacion_plazo_horas,
      },
      chat: {
        dominios: b.widget_dominios,
        color: b.widget_color,
        logo: b.widget_logo,
        privacidadUrl: b.privacidad_url,
        topeMensualUsd: Number(b.tope_mensual_usd),
      },
      servicios: servicios.map((s) => ({
        id: s.id,
        nombre: s.nombre,
        descripcion: s.descripcion,
        duracionMin: s.duracion_min,
        bufferMin: s.buffer_min,
        precio: s.precio === null ? null : Number(s.precio),
        precioVisible: s.precio_visible,
        activo: s.activo,
        citasFuturas: s.futuras,
      })),
      profesionales: profesionales.map((p) => ({ id: p.id, nombre: p.nombre, activo: p.activo, servicioIds: p.servicios, citasFuturas: p.futuras })),
      horario: horario.map((h) => ({ staffId: h.staff_id, weekday: h.weekday, apertura: h.apertura, cierre: h.cierre })),
      diasLibres: libres.map((l) => ({ staffId: l.staff_id, weekday: l.weekday })),
      festivos: festivos.map((f) => ({ id: f.id, staffId: f.staff_id, desde: f.desde, hasta: f.hasta, motivo: f.motivo })),
      preguntas: preguntas.map((q) => ({ id: q.id, pregunta: q.titulo, respuesta: q.contenido_raw, orden: q.orden })),
      loQueFalta: b.falta,
    };
  });
}

// -----------------------------------------------------------------------------
// Bloques de businesses
// -----------------------------------------------------------------------------

/** Ejecuta fn en el tenant y falla con NoEncontrado si no tocó ninguna fila. */
async function enNegocio(sql: Sql, id: string, que: string, fn: (tx: TransactionSql) => Promise<readonly unknown[]>): Promise<void> {
  const filas = await inTenant(sql, id, fn);
  if (filas.length === 0) throw new NoEncontrado(que);
}

export async function guardarDatos(sql: Sql, id: string, d: DatosNegocio): Promise<void> {
  await enNegocio(sql, id, 'El negocio', (tx) => tx`
    update public.businesses
       set nombre = ${d.nombre}, sector = ${d.sector}, timezone = ${d.timezone}, direccion = ${d.direccion},
           telefono_humano = ${d.telefonoHumano}, tono_de_voz = ${d.tonoDeVoz}, mensaje_bienvenida = ${d.mensajeBienvenida}
     where id = ${id}::uuid
    returning id`);
}

export async function guardarReglas(sql: Sql, id: string, r: ReglasNegocio): Promise<void> {
  await enNegocio(sql, id, 'El negocio', (tx) => tx`
    update public.businesses
       set antelacion_min_horas = ${r.antelacionMinHoras}, intervalo_huecos_min = ${r.intervaloHuecosMin},
           margen_dentro_horario = ${r.margenDentroHorario}, asignacion_profesional = ${r.asignacionProfesional},
           politica_cancelacion = ${r.politicaCancelacion}, cancelacion_modo = ${r.cancelacionModo},
           cancelacion_plazo_horas = ${r.cancelacionPlazoHoras}
     where id = ${id}::uuid
    returning id`);
}

export async function guardarChat(sql: Sql, id: string, c: ChatNegocio): Promise<void> {
  await enNegocio(sql, id, 'El negocio', (tx) => tx`
    update public.businesses
       set widget_dominios = ${c.dominios}::text[], widget_color = ${c.color}, widget_logo = ${c.logo},
           privacidad_url = ${c.privacidadUrl}, tope_mensual_usd = ${c.topeMensualUsd}
     where id = ${id}::uuid
    returning id`);
}

/** PI-03: activar (la base rechaza con RA008 si falta algo) o pausar (PI-04). */
export async function cambiarEstado(sql: Sql, id: string, estado: 'activo' | 'pausado'): Promise<void> {
  await enNegocio(sql, id, 'El negocio', (tx) => tx`
    update public.businesses set estado = ${estado}
     where id = ${id}::uuid
    returning id`);
}

/** PI-09: una clave nueva; la anterior deja de valer al momento. */
export async function rotarClave(sql: Sql, id: string): Promise<string> {
  const [r] = await inTenant(
    sql,
    id,
    (tx) => tx<{ widget_key: string }[]>`
      update public.businesses
         set widget_key = 'wk_' || replace(gen_random_uuid()::text, '-', '')
       where id = ${id}::uuid
      returning widget_key`,
  );
  if (!r) throw new NoEncontrado('El negocio');
  return r.widget_key;
}

// -----------------------------------------------------------------------------
// Servicios y profesionales (PI-04: se desactivan, no se borran)
// -----------------------------------------------------------------------------

export async function crearServicio(sql: Sql, id: string, s: ServicioPanel): Promise<string> {
  const [r] = await inTenant(
    sql,
    id,
    (tx) => tx<{ id: string }[]>`
      insert into public.services (business_id, nombre, descripcion, duracion_min, buffer_min, precio, precio_visible, activo)
      values (${id}::uuid, ${s.nombre}, ${s.descripcion}, ${s.duracionMin}, ${s.bufferMin}, ${s.precio}, ${s.precioVisible}, ${s.activo})
      returning id`,
  );
  return r!.id;
}

export async function guardarServicio(sql: Sql, id: string, servicioId: string, s: ServicioPanel): Promise<void> {
  await enNegocio(sql, id, 'El servicio', (tx) => tx`
    update public.services
       set nombre = ${s.nombre}, descripcion = ${s.descripcion}, duracion_min = ${s.duracionMin}, buffer_min = ${s.bufferMin},
           precio = ${s.precio}, precio_visible = ${s.precioVisible}, activo = ${s.activo}
     where business_id = ${id}::uuid and id = ${servicioId}::uuid
    returning id`);
}

async function ponerServicios(tx: TransactionSql, id: string, staffId: string, servicioIds: string[]): Promise<void> {
  await tx`delete from public.staff_services where business_id = ${id}::uuid and staff_id = ${staffId}::uuid`;
  for (const sid of servicioIds) {
    // La FK compuesta impide un servicio de otro negocio.
    await tx`
      insert into public.staff_services (business_id, staff_id, service_id)
      values (${id}::uuid, ${staffId}::uuid, ${sid}::uuid)`;
  }
}

export async function crearProfesional(sql: Sql, id: string, p: ProfesionalPanel): Promise<string> {
  return inTenant(sql, id, async (tx) => {
    const [r] = await tx<{ id: string }[]>`
      insert into public.staff (business_id, nombre, activo) values (${id}::uuid, ${p.nombre}, ${p.activo})
      returning id`;
    await ponerServicios(tx, id, r!.id, p.servicioIds);
    return r!.id;
  });
}

export async function guardarProfesional(sql: Sql, id: string, staffId: string, p: ProfesionalPanel): Promise<void> {
  await inTenant(sql, id, async (tx) => {
    const r = await tx`
      update public.staff set nombre = ${p.nombre}, activo = ${p.activo}
       where business_id = ${id}::uuid and id = ${staffId}::uuid
      returning id`;
    if (r.length === 0) throw new NoEncontrado('La profesional');
    await ponerServicios(tx, id, staffId, p.servicioIds);
  });
}

// -----------------------------------------------------------------------------
// Horarios (PD-01), festivos (PI-12) y preguntas (PI-08): se borran
// -----------------------------------------------------------------------------

/**
 * Sustituye los tramos del local (staffId null) o el horario propio de una
 * profesional, y (PI-19) los días que esa profesional no trabaja. Todo en una
 * transacción: si un tramo no vale, no cambia nada. Un día no puede tener a
 * la vez horas propias y "no trabaja" (lo comprueba la API antes).
 */
export async function guardarHorario(sql: Sql, id: string, staffId: string | null, tramos: TramoPanel[], diasLibres: number[] = []): Promise<void> {
  await inTenant(sql, id, async (tx) => {
    if (staffId !== null) {
      const [st] = await tx`select 1 from public.staff where business_id = ${id}::uuid and id = ${staffId}::uuid`;
      if (!st) throw new NoEncontrado('La profesional');
    }
    await tx`
      delete from public.business_hours
       where business_id = ${id}::uuid and staff_id is not distinct from ${staffId}::uuid`;
    for (const t of tramos) {
      await tx`
        insert into public.business_hours (business_id, staff_id, weekday, hora_apertura, hora_cierre)
        values (${id}::uuid, ${staffId}::uuid, ${t.weekday}, ${t.apertura}::time, ${t.cierre}::time)`;
    }
    if (staffId !== null) {
      await tx`delete from public.staff_dias_libres where business_id = ${id}::uuid and staff_id = ${staffId}::uuid`;
      for (const w of diasLibres) {
        await tx`
          insert into public.staff_dias_libres (business_id, staff_id, weekday)
          values (${id}::uuid, ${staffId}::uuid, ${w})`;
      }
    }
  });
}

export async function crearFestivo(sql: Sql, id: string, f: FestivoPanel): Promise<string> {
  const [r] = await inTenant(
    sql,
    id,
    (tx) => tx<{ id: string }[]>`
      insert into public.time_off (business_id, staff_id, desde, hasta, motivo)
      values (${id}::uuid, ${f.staffId}::uuid, ${f.desde}, ${f.hasta}, ${f.motivo})
      returning id`,
  );
  return r!.id;
}

export async function borrarFestivo(sql: Sql, id: string, festivoId: string): Promise<void> {
  await enNegocio(sql, id, 'El festivo', (tx) => tx`
    delete from public.time_off where business_id = ${id}::uuid and id = ${festivoId}::uuid returning id`);
}

export async function crearPregunta(sql: Sql, id: string, q: PreguntaPanel): Promise<string> {
  const [r] = await inTenant(
    sql,
    id,
    (tx) => tx<{ id: string }[]>`
      insert into public.knowledge_docs (business_id, tipo, titulo, contenido_raw, orden)
      values (${id}::uuid, 'faq', ${q.pregunta}, ${q.respuesta}, ${q.orden})
      returning id`,
  );
  return r!.id;
}

export async function guardarPregunta(sql: Sql, id: string, preguntaId: string, q: PreguntaPanel): Promise<void> {
  await enNegocio(sql, id, 'La pregunta', (tx) => tx`
    update public.knowledge_docs
       set titulo = ${q.pregunta}, contenido_raw = ${q.respuesta}, orden = ${q.orden}
     where business_id = ${id}::uuid and id = ${preguntaId}::uuid and tipo = 'faq'
    returning id`);
}

export async function borrarPregunta(sql: Sql, id: string, preguntaId: string): Promise<void> {
  await enNegocio(sql, id, 'La pregunta', (tx) => tx`
    delete from public.knowledge_docs
     where business_id = ${id}::uuid and id = ${preguntaId}::uuid and tipo = 'faq'
    returning id`);
}
