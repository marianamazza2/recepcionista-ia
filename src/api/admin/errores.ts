// =============================================================================
// Errores del panel en palabras (Fase 4 · 4.2)
// =============================================================================
// Las validaciones viven en la base (horarios, color, dominios, logo, límites
// de las preguntas, lo que falta para activar…) y en el motor de reservas.
// Aquí solo se traducen a una frase para el panel. Nunca sale el error
// interno: lo que no se reconoce va a onError y el panel recibe un mensaje
// genérico.
// =============================================================================

import { BookingError } from '../../adapters/booking/errors.js';
import { BusinessNotFoundError } from '../../config/business.js';
import { InvalidLocalTimeError } from '../../core/time.js';
import { NoEncontrado, type LoQueFalta } from '../../db/negocios.js';
import { TelefonoNoValido } from '../../citas/manual.js';

/** Un error que el panel puede enseñar tal cual. */
export class ErrorPanel extends Error {
  constructor(
    readonly status: number,
    mensaje: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(mensaje);
    this.name = 'ErrorPanel';
  }
}

/** PI-03: lo que falta, en palabras ("Falta: horario del local · un dominio para el chat"). */
export const TEXTO_LO_QUE_FALTA: Record<LoQueFalta, string> = {
  servicio: 'un servicio activo',
  profesional: 'una profesional activa que haga algún servicio',
  horario: 'horario del local',
  telefono: 'teléfono del local',
  dominio: 'un dominio para el chat',
};

/** Restricciones de la base → qué decirle a Mariana. */
const POR_RESTRICCION: Record<string, string> = {
  businesses_slug_key: 'Ya hay un negocio con esa dirección (slug).',
  businesses_slug_check: 'La dirección (slug) solo puede tener minúsculas, números y guiones.',
  businesses_nombre_check: 'El negocio necesita un nombre.',
  businesses_widget_color_hex: 'El color tiene que ser del tipo #8a5a63.',
  businesses_widget_dominios_minusculas: 'Los dominios van en minúsculas.',
  businesses_privacidad_url_http: 'La política de privacidad tiene que ser un enlace que empiece por https://.',
  businesses_tope_valido: 'El tope mensual no puede ser negativo.',
  businesses_widget_logo_formato: 'El logo tiene que ser PNG, JPG, SVG o WebP de hasta ~150 KB.',
  businesses_antelacion_valida: 'La antelación mínima no puede ser negativa.',
  businesses_intervalo_valido: 'Los horarios tienen que ofrecerse cada 1 a 240 minutos.',
  businesses_cancelacion_plazo_valido: 'El plazo de cancelación no puede ser negativo.',
  services_nombre_check: 'El servicio necesita un nombre.',
  services_duracion_min_check: 'La duración tiene que ser de al menos 1 minuto.',
  services_buffer_min_check: 'El margen no puede ser negativo.',
  services_precio_check: 'El precio no puede ser negativo.',
  staff_nombre_check: 'La profesional necesita un nombre.',
  business_hours_tramo_valido: 'En cada tramo, el cierre tiene que ser después de la apertura.',
  business_hours_tramo_unico: 'Hay un tramo repetido.',
  time_off_rango_valido: 'El final tiene que ser después del inicio.',
  knowledge_docs_faq_corta: 'Cada pregunta frecuente es corta: pregunta de hasta 200 caracteres y respuesta de hasta 1.000.',
  knowledge_docs_titulo_check: 'La pregunta no puede estar vacía.',
  staff_services_pkey: 'Ese servicio está repetido.',
};

const POR_MOTIVO_RESERVA: Record<string, string> = {
  slot_taken: 'La profesional ya tiene otra cita a esa hora.',
  outside_hours: 'Esa hora está fuera del horario del local o de la profesional (o el servicio no acaba antes del cierre).',
  time_off: 'Ese día u hora es festivo o la profesional está ausente.',
  too_soon: 'Es antes de la antelación mínima.',
  buffer_conflict: 'No respeta el margen con otra cita de la profesional.',
  no_staff_available: 'Ninguna profesional tiene libre esa hora.',
  customer_busy: 'La clienta ya tiene otra cita a esa hora.',
  staff_does_not_provide_service: 'Esa profesional no hace ese servicio.',
  invalid_reference: 'El servicio o la profesional no existen o están desactivados.',
  booking_not_found: 'Esa cita no existe en este negocio.',
  booking_not_cancellable: 'Esa cita ya no se puede cancelar (está completada o no se presentó).',
};

interface ErrorPostgres {
  code?: string;
  constraint_name?: string;
  detail?: string;
}

/** El error (de la base, del motor o de validación) como ErrorPanel. Null si no se reconoce. */
export function aErrorPanel(e: unknown): ErrorPanel | null {
  if (e instanceof ErrorPanel) return e;
  if (e instanceof NoEncontrado) return new ErrorPanel(404, `${e.message}.`);
  if (e instanceof TelefonoNoValido) return new ErrorPanel(400, 'El teléfono no es válido. Escríbelo con prefijo (+34…) o con sus 9 cifras.');
  if (e instanceof InvalidLocalTimeError) return new ErrorPanel(400, 'Esa fecha u hora no es válida (o no existe ese día por el cambio de hora).');
  if (e instanceof BusinessNotFoundError) return new ErrorPanel(409, 'El negocio está pausado: actívalo para cargar o cancelar citas desde el panel.');
  if (e instanceof BookingError) {
    return new ErrorPanel(e.reason === 'booking_not_found' ? 404 : 409, POR_MOTIVO_RESERVA[e.reason] ?? 'No se ha podido guardar la cita.', { motivo: e.reason });
  }
  const pg = e as ErrorPostgres;
  if (typeof pg?.code !== 'string') return null;
  if (pg.code === 'RA007') {
    return new ErrorPanel(409, 'Hay demasiadas preguntas frecuentes: como mucho 20 o 4.000 caracteres entre todas. Lo largo irá en la base de conocimiento (Fase 5).');
  }
  if (pg.code === 'RA008') {
    const falta = (pg.detail ?? '').split(',').filter(Boolean) as LoQueFalta[];
    return new ErrorPanel(409, `Falta: ${falta.map((f) => TEXTO_LO_QUE_FALTA[f] ?? f).join(' · ')}`, { falta });
  }
  if (pg.constraint_name && POR_RESTRICCION[pg.constraint_name]) {
    return new ErrorPanel(409, POR_RESTRICCION[pg.constraint_name]!);
  }
  if (pg.code === '23503') return new ErrorPanel(409, 'Algo de lo que eliges no existe en este negocio.');
  if (pg.code === '22P02' || pg.code === '22007' || pg.code === '22008' || pg.code === '22023') {
    return new ErrorPanel(400, 'Algún dato no tiene el formato correcto.');
  }
  if (pg.code === '23514' || pg.code === '23505') return new ErrorPanel(409, 'La base no acepta esos datos. Revísalos.');
  return null;
}
