// =============================================================================
// Pedirle algo al agente con un clic (Fase 9b · PC-19)
// =============================================================================
// Lo usan las sugerencias del inicio del chat y los avisos «Todavía no has
// cargado… Pídeselo al agente» del portal: los dos abren un chat NUEVO con
// el mensaje ya escrito y enviado, así el agente sabe de qué sección viene.
//
// Lo lee el cliente: español de España, de tú.
// =============================================================================

export type Pedido = 'negocio' | 'servicios' | 'profesionales' | 'horario' | 'reglas' | 'festivo' | 'documento' | 'empezar' | 'seguir' | 'cambiar-horario' | 'cambiar-servicio';

/** Las cinco secciones del alta, en el orden del guion (como portal.alta). */
export type SeccionAlta = 'negocio' | 'servicios' | 'profesionales' | 'horario' | 'reglas';
export const SECCIONES_ALTA: SeccionAlta[] = ['negocio', 'servicios', 'profesionales', 'horario', 'reglas'];

export const PEDIDOS: Record<Pedido, { boton: string; mensaje: string }> = {
  empezar: { boton: 'Empezar el alta', mensaje: 'Quiero empezar el alta de mi negocio.' },
  seguir: { boton: 'Seguir con el alta', mensaje: 'Quiero seguir con el alta de mi negocio.' },
  negocio: { boton: 'Cargar los datos de mi negocio', mensaje: 'Quiero cargar los datos de mi negocio.' },
  servicios: { boton: 'Cargar mis servicios', mensaje: 'Quiero empezar a dar de alta mis servicios.' },
  profesionales: { boton: 'Dar de alta a mi equipo', mensaje: 'Quiero dar de alta a las personas que trabajan conmigo.' },
  horario: { boton: 'Cargar los horarios', mensaje: 'Quiero empezar a dar de alta los horarios del negocio.' },
  reglas: { boton: 'Configurar las reservas', mensaje: 'Quiero configurar cómo se reserva y se cancela.' },
  festivo: { boton: 'Cargar un festivo', mensaje: 'Quiero cargar un festivo.' },
  // Fase 5 (PB-03): un documento para que la recepcionista lo sepa.
  documento: { boton: 'Subir un documento', mensaje: 'Quiero que mi recepcionista sepa lo que dice un documento (mi carta de tratamientos, la hoja de cuidados…).' },
  'cambiar-horario': { boton: 'Cambiar un horario', mensaje: 'Quiero cambiar un horario.' },
  'cambiar-servicio': { boton: 'Cambiar un servicio', mensaje: 'Quiero cambiar un servicio.' },
};

/** Lo que dice cada sección del alta cuando todavía está vacía. */
export const VACIO: Record<SeccionAlta, string> = {
  negocio: 'Todavía no has cargado los datos de tu negocio.',
  servicios: 'Todavía no has cargado tus servicios.',
  profesionales: 'Todavía no has dado de alta a tu equipo.',
  horario: 'Todavía no has cargado los horarios.',
  reglas: 'Todavía no has configurado las reservas y cancelaciones.',
};

export const NOMBRE_SECCION: Record<SeccionAlta, string> = {
  negocio: 'Tu negocio',
  servicios: 'Servicios',
  profesionales: 'Tu equipo',
  horario: 'Horarios',
  reglas: 'Reservas y cancelación',
};

/** PC-19: las sugerencias del inicio del chat, según lo que ya está hecho. */
export function sugerencias(alta: { terminada: boolean; hechas: string[]; faltan: string[] }): Pedido[] {
  if (alta.terminada) return ['festivo', 'cambiar-horario', 'cambiar-servicio'];
  const primero: Pedido = alta.hechas.length === 0 ? 'empezar' : 'seguir';
  return [primero, ...(alta.faltan as SeccionAlta[]).slice(alta.hechas.length === 0 ? 1 : 0, 3)];
}

export function esPedido(x: string | undefined): x is Pedido {
  return x !== undefined && x in PEDIDOS;
}
