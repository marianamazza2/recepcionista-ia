// =============================================================================
// Configuración del negocio para el agente (Fase 2 · 2.1)
// =============================================================================
// Todo lo que el agente necesita saber de UN negocio, leído de la base. Es lo
// único que cambia de un negocio a otro: el núcleo (src/core/) no tiene texto
// propio de ningún negocio (regla de oro del maestro).
//
// Guardrail de código (2.5): un precio con `precio_visible = false` se descarta
// AQUÍ, al cargar. Ni el system prompt ni las herramientas lo reciben, así que
// no puede llegar al modelo por ningún camino.
//
// Las listas salen siempre en el mismo orden: la misma configuración tiene que
// producir exactamente el mismo system prompt, o la caché no funciona.
// =============================================================================

import type { Sql } from 'postgres';

import { inTenant } from '../db/tenant.js';

export type AsignacionProfesional = 'preguntar' | 'automatica';
export type CancelacionModo = 'informar' | 'bloquear';

export interface ServicioConfig {
  id: string;
  nombre: string;
  descripcion: string | null;
  duracionMin: number;
  /** null si el negocio no quiere que el agente lo diga (o no tiene precio). */
  precio: number | null;
  precioVisible: boolean;
}

export interface ProfesionalConfig {
  id: string;
  nombre: string;
  /** Ids de los servicios que hace, en el orden de `servicios`. */
  servicioIds: string[];
}

/** Un tramo de horario en hora LOCAL del negocio. weekday: 0 = domingo … 6 = sábado (D-10). */
export interface TramoHorario {
  weekday: number;
  apertura: string; // 'HH:MM'
  cierre: string; // 'HH:MM'
}

export interface HorarioPropio extends TramoHorario {
  staffId: string;
}

export interface BusinessConfig {
  id: string;
  nombre: string;
  slug: string;
  sector: string | null;
  timezone: string;
  tonoDeVoz: string | null;
  mensajeBienvenida: string | null;
  direccion: string | null;
  telefonoHumano: string | null;
  politicaCancelacion: string | null;
  /** PR-07 */
  cancelacionModo: CancelacionModo;
  cancelacionPlazoHoras: number;
  /** PD-03 */
  asignacionProfesional: AsignacionProfesional;
  /** PD-05 */
  antelacionMinHoras: number;
  /** PR-01 */
  intervaloHuecosMin: number;
  servicios: ServicioConfig[];
  profesionales: ProfesionalConfig[];
  /** Horario del local (tramos sin profesional). */
  horario: TramoHorario[];
  /** Horarios propios de profesionales (PD-01: reemplazan al del local ese día). */
  horariosPropios: HorarioPropio[];
}

export type BusinessRef = { slug: string } | { id: string };

interface BusinessRow {
  id: string;
  nombre: string;
  slug: string;
  sector: string | null;
  timezone: string;
  tono_de_voz: string | null;
  mensaje_bienvenida: string | null;
  direccion: string | null;
  telefono_humano: string | null;
  politica_cancelacion: string | null;
  cancelacion_modo: CancelacionModo;
  cancelacion_plazo_horas: number;
  asignacion_profesional: AsignacionProfesional;
  antelacion_min_horas: number;
  intervalo_huecos_min: number;
}

export class BusinessNotFoundError extends Error {
  constructor(ref: BusinessRef) {
    super(`No existe ningún negocio activo con ${'slug' in ref ? `slug "${ref.slug}"` : `id ${ref.id}`}`);
    this.name = 'BusinessNotFoundError';
  }
}

export async function loadBusinessConfig(sql: Sql, ref: BusinessRef): Promise<BusinessConfig> {
  // Primero se resuelve el negocio (todavía no hay tenant que declarar); el
  // resto se lee ya dentro de su transacción. Un negocio pausado no atiende.
  const [b] =
    'slug' in ref
      ? await sql<BusinessRow[]>`
          select * from public.businesses
           where slug = ${ref.slug} and estado in ('activo', 'trial')`
      : await sql<BusinessRow[]>`
          select * from public.businesses
           where id = ${ref.id}::uuid and estado in ('activo', 'trial')`;
  if (!b) {
    throw new BusinessNotFoundError(ref);
  }

  return inTenant(sql, b.id, async (tx) => {
    const servicios = await tx<
      { id: string; nombre: string; descripcion: string | null; duracion_min: number; precio: string | null; precio_visible: boolean }[]
    >`
      select id, nombre, descripcion, duracion_min, precio, precio_visible
        from public.services
       where business_id = ${b.id}::uuid and activo
       order by nombre, id`;

    const profesionales = await tx<{ id: string; nombre: string }[]>`
      select id, nombre
        from public.staff
       where business_id = ${b.id}::uuid and activo
       order by nombre, id`;

    const quienHaceQue = await tx<{ staff_id: string; service_id: string }[]>`
      select ss.staff_id, ss.service_id
        from public.staff_services ss
       where ss.business_id = ${b.id}::uuid`;

    const tramos = await tx<{ staff_id: string | null; weekday: number; apertura: string; cierre: string }[]>`
      select staff_id, weekday,
             to_char(hora_apertura, 'HH24:MI') as apertura,
             -- '24:00' se guarda como time '24:00:00' y to_char lo da como '24:00'
             to_char(hora_cierre, 'HH24:MI') as cierre
        from public.business_hours
       where business_id = ${b.id}::uuid
       order by staff_id nulls first, weekday, hora_apertura`;

    const ordenServicios = servicios.map((s) => s.id);
    const servicioActivo = new Set(ordenServicios);

    return {
      id: b.id,
      nombre: b.nombre,
      slug: b.slug,
      sector: b.sector,
      timezone: b.timezone,
      tonoDeVoz: b.tono_de_voz,
      mensajeBienvenida: b.mensaje_bienvenida,
      direccion: b.direccion,
      telefonoHumano: b.telefono_humano,
      politicaCancelacion: b.politica_cancelacion,
      cancelacionModo: b.cancelacion_modo,
      cancelacionPlazoHoras: b.cancelacion_plazo_horas,
      asignacionProfesional: b.asignacion_profesional,
      antelacionMinHoras: b.antelacion_min_horas,
      intervaloHuecosMin: b.intervalo_huecos_min,
      servicios: servicios.map((s) => ({
        id: s.id,
        nombre: s.nombre,
        descripcion: s.descripcion,
        duracionMin: s.duracion_min,
        // Guardrail: el precio no visible no sale de este módulo.
        precio: s.precio_visible && s.precio !== null ? Number(s.precio) : null,
        precioVisible: s.precio_visible,
      })),
      profesionales: profesionales.map((p) => ({
        id: p.id,
        nombre: p.nombre,
        servicioIds: ordenServicios.filter((sid) =>
          quienHaceQue.some((q) => q.staff_id === p.id && q.service_id === sid && servicioActivo.has(sid)),
        ),
      })),
      horario: tramos
        .filter((t) => t.staff_id === null)
        .map((t) => ({ weekday: t.weekday, apertura: t.apertura, cierre: t.cierre })),
      horariosPropios: tramos
        .filter((t): t is typeof t & { staff_id: string } => t.staff_id !== null)
        .map((t) => ({ staffId: t.staff_id, weekday: t.weekday, apertura: t.apertura, cierre: t.cierre })),
    };
  });
}
