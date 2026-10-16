// =============================================================================
// Piezas compartidas por las herramientas
// =============================================================================
//   · Buscar servicios y profesionales por nombre (los esquemas usan `enum`
//     con los nombres de la configuración: el modelo no puede inventarse uno).
//   · Buscar huecos y ordenarlos por cercanía a lo que pidió la clienta (PA-03).
//   · Convertir los errores tipados del motor en un resultado que el modelo
//     entienda, con las alternativas ya buscadas (PD-04, PD-05).
// =============================================================================

import { BookingError } from '../../adapters/booking/errors.js';
import type { Booking, TimeSlot } from '../../adapters/booking/types.js';
import type { BusinessConfig, ProfesionalConfig, ServicioConfig } from '../../config/business.js';
import { fechaLarga, inicioDelDia, localToUtc, sumarDias, utcToLocal } from '../time.js';
import type { HuecoOfrecido, ToolContext, ToolError, ToolResult } from './types.js';

/** PA-03: cuántos horarios se ofrecen de una vez. */
export const HUECOS_POR_RESPUESTA = 3;

/** Días alrededor de la fecha pedida en los que se buscan alternativas. */
const ALTERNATIVAS_DIAS_ANTES = 3;
const ALTERNATIVAS_DIAS_DESPUES = 14;

export function ok(data: Record<string, unknown>): ToolResult {
  return { ok: true, data };
}

export function fallo(error: ToolError): ToolResult {
  return { ok: false, error };
}

// -----------------------------------------------------------------------------
// Entrada
// -----------------------------------------------------------------------------

/** Lee un texto del input. Con `strict: true` el esquema ya viene validado; esto cubre el resto. */
export function texto(input: Record<string, unknown>, clave: string): string | undefined {
  const v = input[clave];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

export function buscarServicio(config: BusinessConfig, nombre: string | undefined): ServicioConfig | undefined {
  if (!nombre) return undefined;
  const n = normalizar(nombre);
  return config.servicios.find((s) => normalizar(s.nombre) === n);
}

export function buscarProfesional(config: BusinessConfig, nombre: string | undefined): ProfesionalConfig | undefined {
  if (!nombre) return undefined;
  const n = normalizar(nombre);
  return config.profesionales.find((p) => normalizar(p.nombre) === n);
}

export function nombreProfesional(config: BusinessConfig, staffId: string): string {
  return config.profesionales.find((p) => p.id === staffId)?.nombre ?? 'una profesional del equipo';
}

export function nombreServicio(config: BusinessConfig, serviceId: string): string {
  return config.servicios.find((s) => s.id === serviceId)?.nombre ?? 'servicio';
}

function normalizar(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase();
}

export function servicioDesconocido(config: BusinessConfig): ToolResult {
  return fallo({
    motivo: 'servicio_desconocido',
    mensaje: `Ese servicio no existe en este negocio. Los servicios son: ${config.servicios.map((s) => s.nombre).join(', ')}.`,
  });
}

export function profesionalDesconocida(config: BusinessConfig): ToolResult {
  return fallo({
    motivo: 'profesional_desconocida',
    mensaje: `No hay ninguna profesional con ese nombre. El equipo: ${config.profesionales.map((p) => p.nombre).join(', ')}.`,
  });
}

export function sinClienta(): ToolResult {
  return fallo({
    motivo: 'clienta_no_identificada',
    mensaje: 'Antes hay que identificar a la clienta: pídele su nombre y su teléfono y llama a identificar_cliente.',
  });
}

// -----------------------------------------------------------------------------
// Huecos
// -----------------------------------------------------------------------------

/** Agrupa los huecos por hora de inicio: a la misma hora pueden estar varias profesionales. */
function agrupar(ctx: ToolContext, slots: TimeSlot[]): { inicio: Date; hueco: HuecoOfrecido }[] {
  const tz = ctx.config.timezone;
  const porInicio = new Map<number, { inicio: Date; hueco: HuecoOfrecido }>();
  for (const s of slots) {
    const clave = s.start.getTime();
    let g = porInicio.get(clave);
    if (!g) {
      const l = utcToLocal(s.start, tz);
      g = {
        inicio: s.start,
        hueco: {
          fecha: l.fecha,
          dia: fechaLarga(l.fecha),
          hora: l.hora,
          hora_fin: utcToLocal(s.end, tz).hora,
          profesionales: [],
        },
      };
      porInicio.set(clave, g);
    }
    const nombre = nombreProfesional(ctx.config, s.staffId);
    if (!g.hueco.profesionales.includes(nombre)) {
      g.hueco.profesionales.push(nombre);
    }
  }
  return [...porInicio.values()];
}

/** Un tramo de tiempo [desde, hasta). */
export interface Intervalo {
  desde: Date;
  hasta: Date;
}

export interface BusquedaHuecos {
  servicioId: string;
  staffId?: string | undefined;
  /** Primer día local, incluido. */
  desde: string;
  /** Último día local, incluido. */
  hasta: string;
  /** Si hay hora preferida, los más cercanos a `cerca` primero; si no, por orden. */
  cerca?: Date | undefined;
  /** PR-08: horarios en que la clienta ya está ocupada; no se ofrecen. */
  excluir?: Intervalo[] | undefined;
}

/** Todos los huecos (agrupados por hora) del rango, ordenados según la búsqueda. */
export async function huecos(ctx: ToolContext, b: BusquedaHuecos): Promise<HuecoOfrecido[]> {
  const tz = ctx.config.timezone;
  const slots = await ctx.adapter.getAvailability({
    businessId: ctx.config.id,
    serviceId: b.servicioId,
    ...(b.staffId ? { staffId: b.staffId } : {}),
    from: inicioDelDia(b.desde, tz),
    to: inicioDelDia(sumarDias(b.hasta, 1), tz),
  });
  const libres = b.excluir?.length
    ? slots.filter((s) => !b.excluir!.some((x) => s.start < x.hasta && x.desde < s.end))
    : slots;
  const grupos = agrupar(ctx, libres);
  if (b.cerca) {
    const t = b.cerca.getTime();
    // Más cercano primero; a igual distancia, el anterior (10:00 antes que 10:30).
    grupos.sort(
      (x, y) => Math.abs(x.inicio.getTime() - t) - Math.abs(y.inicio.getTime() - t) || x.inicio.getTime() - y.inicio.getTime(),
    );
  }
  return grupos.map((g) => g.hueco);
}

/** Hoy en el reloj del negocio. */
export function hoyLocal(ctx: ToolContext): string {
  return utcToLocal(ctx.now(), ctx.config.timezone).fecha;
}

/**
 * PD-04: los huecos libres más cercanos a lo que pidió la clienta. Busca unos
 * días antes y después de la fecha (nunca en el pasado). Con hora, los más
 * cercanos a esa hora; sin hora, desde ese día en adelante.
 *
 * Con una profesional concreta (PR-05: mover mantiene profesional) busca solo
 * con ella. Si `cualquieraSiNoHay` y con ella no hay nada, busca con todas.
 */
export async function alternativas(
  ctx: ToolContext,
  opts: {
    servicioId: string;
    staffId?: string | undefined;
    fecha: string;
    hora?: string | undefined;
    cualquieraSiNoHay?: boolean;
    excluir?: Intervalo[] | undefined;
  },
): Promise<HuecoOfrecido[]> {
  const hoy = hoyLocal(ctx);
  const fecha = opts.fecha < hoy ? hoy : opts.fecha;
  let objetivo: Date | undefined;
  if (opts.hora) {
    try {
      objetivo = localToUtc(fecha, opts.hora, ctx.config.timezone);
    } catch {
      objetivo = undefined;
    }
  }
  const desdeConHora = sumarDias(fecha, -ALTERNATIVAS_DIAS_ANTES);
  const desde = objetivo ? (desdeConHora < hoy ? hoy : desdeConHora) : fecha;
  const hasta = sumarDias(fecha, ALTERNATIVAS_DIAS_DESPUES);

  const buscar = (staffId?: string) =>
    huecos(ctx, { servicioId: opts.servicioId, staffId, desde, hasta, cerca: objetivo, excluir: opts.excluir });

  let r = await buscar(opts.staffId);
  if (r.length === 0 && opts.staffId && opts.cualquieraSiNoHay) {
    r = await buscar();
  }
  return r.slice(0, HUECOS_POR_RESPUESTA);
}

// -----------------------------------------------------------------------------
// Citas
// -----------------------------------------------------------------------------

export function describirCita(ctx: ToolContext, b: Booking): Record<string, unknown> {
  const tz = ctx.config.timezone;
  const l = utcToLocal(b.start, tz);
  return {
    id_cita: b.id,
    servicio: nombreServicio(ctx.config, b.serviceId),
    fecha: l.fecha,
    dia: fechaLarga(l.fecha),
    hora: l.hora,
    hora_fin: utcToLocal(b.end, tz).hora,
    profesional: nombreProfesional(ctx.config, b.staffId),
  };
}

/**
 * PR-08: cuándo está ocupada la clienta identificada (sus citas confirmadas
 * futuras), salvo la cita `excepto`. Para no ofrecerle horarios en que ya
 * tiene otra cita.
 */
export async function ocupadoDeLaClienta(ctx: ToolContext, excepto?: string): Promise<Intervalo[]> {
  if (!ctx.state.customerId) return [];
  const ahora = ctx.now().getTime();
  const citas = await ctx.adapter.listBookings({ customerId: ctx.state.customerId });
  return citas
    .filter((c) => c.status === 'confirmada' && c.end.getTime() > ahora && c.id !== excepto)
    .map((c) => ({ desde: c.start, hasta: c.end }));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PA-08: la cita, solo si es de la clienta identificada. Si no existe o es de
 * otra persona, la respuesta es la misma: no se confirma ni que exista.
 */
export async function citaDeLaClienta(ctx: ToolContext, idCita: string | undefined): Promise<Booking | ToolResult> {
  const customerId = ctx.state.customerId;
  if (!customerId) {
    return sinClienta();
  }
  const noEncontrada = fallo({
    motivo: 'cita_no_encontrada',
    mensaje:
      'No hay ninguna cita con ese id entre las citas de esta clienta. Usa buscar_reservas_cliente para ver las suyas.',
  });
  if (!idCita || !UUID.test(idCita)) {
    return noEncontrada;
  }
  const citas = await ctx.adapter.listBookings({ customerId });
  return citas.find((c) => c.id === idCita) ?? noEncontrada;
}

// -----------------------------------------------------------------------------
// Errores del motor → resultado para el modelo
// -----------------------------------------------------------------------------

/** Motivos que llevan alternativas (spec 2.3: RA001, RA002, RA003, 23P01, RA004, RA005). */
const CON_ALTERNATIVAS = new Set([
  'outside_hours',
  'time_off',
  'too_soon',
  'slot_taken',
  'buffer_conflict',
  'no_staff_available',
]);

export function motivoYMensaje(config: BusinessConfig, e: BookingError): { motivo: string; mensaje: string } {
  switch (e.reason) {
    case 'outside_hours':
      return {
        motivo: 'fuera_de_horario',
        mensaje: `Esa hora no se puede reservar: el local o esa profesional no atienden entonces, o no es una de las horas en que empiezan las citas (cada ${config.intervaloHuecosMin} minutos desde la apertura).`,
      };
    case 'time_off':
      return { motivo: 'festivo_o_ausencia', mensaje: 'Ese día u hora el local está cerrado por festivo o la profesional no está.' };
    case 'too_soon':
      return {
        motivo: 'antelacion_insuficiente',
        mensaje: `Las citas se reservan con al menos ${config.antelacionMinHoras} h de antelación.`,
      };
    case 'slot_taken':
    case 'buffer_conflict':
      return { motivo: 'hueco_ocupado', mensaje: 'Ese horario ya no está libre.' };
    case 'no_staff_available':
      return { motivo: 'sin_profesional_libre', mensaje: 'A esa hora no hay ninguna profesional libre para ese servicio.' };
    case 'customer_busy':
      return {
        motivo: 'clienta_ya_tiene_cita',
        mensaje:
          'La clienta ya tiene una cita que se pisa con ese horario (cita_que_choca). No se ha cambiado nada. ' +
          'Díselo: no puedes reservarla porque ya tiene esa cita. No le ofrezcas opciones por tu cuenta. Si te pide ' +
          'quedarse con la nueva hora y mover o anular la anterior, usa reservar_y_cambiar_cita_anterior.',
      };
    case 'staff_does_not_provide_service':
      return { motivo: 'profesional_no_hace_servicio', mensaje: 'Esa profesional no hace ese servicio.' };
    case 'booking_not_found':
      return { motivo: 'cita_no_encontrada', mensaje: 'No se encuentra esa cita.' };
    case 'booking_not_cancellable':
      return { motivo: 'cita_no_modificable', mensaje: 'Esa cita ya está completada o cerrada y no se puede cambiar.' };
    default:
      return {
        motivo: 'error_interno',
        mensaje: 'Algo ha fallado en el sistema de reservas. No lo intentes de nuevo: pasa la conversación a una persona con derivar_a_humano.',
      };
  }
}

/**
 * Convierte un error del motor en un resultado para el modelo, con las
 * alternativas ya buscadas cuando el motivo es de horario u ocupación.
 */
export async function errorDeReserva(
  ctx: ToolContext,
  e: unknown,
  pedido: {
    servicioId: string;
    staffId?: string | undefined;
    fecha: string;
    hora: string;
    soloConEsaProfesional?: boolean;
    excluir?: Intervalo[] | undefined;
  },
): Promise<ToolResult> {
  if (!(e instanceof BookingError)) {
    throw e;
  }
  const { motivo, mensaje } = motivoYMensaje(ctx.config, e);
  const error: ToolError = { motivo, mensaje };
  if (CON_ALTERNATIVAS.has(e.reason)) {
    error.alternativas = await alternativas(ctx, {
      servicioId: pedido.servicioId,
      staffId: pedido.staffId,
      fecha: pedido.fecha,
      hora: pedido.hora,
      cualquieraSiNoHay: !pedido.soloConEsaProfesional,
      excluir: pedido.excluir ?? (await ocupadoDeLaClienta(ctx)),
    });
  }
  if (e.reason === 'customer_busy') {
    const choca = await citaQueChoca(ctx, pedido.servicioId, pedido.fecha, pedido.hora);
    if (choca) error.cita_que_choca = describirCita(ctx, choca);
  }
  if (e.reason === 'staff_does_not_provide_service') {
    error.profesionales_que_lo_hacen = ctx.config.profesionales
      .filter((p) => p.servicioIds.includes(pedido.servicioId))
      .map((p) => p.nombre);
  }
  return fallo(error);
}

/** PR-08: la cita confirmada de la clienta que se pisa con ese servicio a esa hora. */
export async function citaQueChoca(ctx: ToolContext, servicioId: string, fecha: string, hora: string): Promise<Booking | null> {
  if (!ctx.state.customerId) return null;
  const servicio = ctx.config.servicios.find((s) => s.id === servicioId);
  let desde: Date;
  try {
    desde = localToUtc(fecha, hora, ctx.config.timezone);
  } catch {
    return null;
  }
  const hasta = new Date(desde.getTime() + (servicio?.duracionMin ?? 0) * 60_000);
  const citas = await ctx.adapter.listBookings({ customerId: ctx.state.customerId });
  return citas.find((c) => c.status === 'confirmada' && c.start < hasta && desde < c.end) ?? null;
}
