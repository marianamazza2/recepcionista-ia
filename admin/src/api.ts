// =============================================================================
// Cliente de la API del panel (Fase 4 · 4.3)
// =============================================================================
// El panel solo habla con nuestra API (/api/admin/…), en el mismo origen. La
// sesión de Supabase Auth (token de acceso y de renovación) se guarda en
// sessionStorage: se pierde al cerrar la pestaña. Si una petición da 401, se
// intenta renovar una vez; si no, vuelta a "Entrar".
// =============================================================================

export interface Sesion {
  accessToken: string;
  refreshToken: string;
  email: string;
}

const CLAVE = 'recepcionista-panel:sesion';

export function sesionGuardada(): Sesion | null {
  try {
    const s = sessionStorage.getItem(CLAVE);
    return s ? (JSON.parse(s) as Sesion) : null;
  } catch {
    return null;
  }
}

function guardar(s: Sesion | null): void {
  try {
    if (s) sessionStorage.setItem(CLAVE, JSON.stringify(s));
    else sessionStorage.removeItem(CLAVE);
  } catch {
    // Sin almacenamiento la sesión vive solo en memoria.
  }
  sesion = s;
  for (const f of oyentes) f(s);
}

let sesion: Sesion | null = sesionGuardada();
const oyentes = new Set<(s: Sesion | null) => void>();

export function alCambiarSesion(f: (s: Sesion | null) => void): () => void {
  oyentes.add(f);
  return () => oyentes.delete(f);
}

/** Un error que la API explicó con palabras. */
export class ErrorApi extends Error {
  constructor(
    readonly status: number,
    mensaje: string,
    readonly datos: Record<string, unknown> = {},
  ) {
    super(mensaje);
  }
}

async function crudo(metodo: string, ruta: string, body?: unknown, token?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(`/api/admin/${ruta}`, { method: metodo, headers, credentials: 'omit', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}

async function leer<T>(r: Response): Promise<T> {
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new ErrorApi(r.status, typeof j.mensaje === 'string' ? j.mensaje : 'No se ha podido completar. Inténtalo de nuevo.', j);
  return j as T;
}

export async function entrar(email: string, password: string): Promise<void> {
  const s = await leer<Sesion>(await crudo('POST', 'sesion', { email, password }));
  guardar({ accessToken: s.accessToken, refreshToken: s.refreshToken, email: s.email });
}

export function salir(): void {
  guardar(null);
}

let renovando: Promise<boolean> | null = null;

async function renovar(): Promise<boolean> {
  const actual = sesion;
  if (!actual) return false;
  renovando ??= (async () => {
    try {
      const r = await crudo('POST', 'sesion/renovar', { refreshToken: actual.refreshToken });
      if (!r.ok) return false;
      const s = (await r.json()) as Sesion;
      guardar({ accessToken: s.accessToken, refreshToken: s.refreshToken, email: s.email });
      return true;
    } catch {
      return false;
    } finally {
      renovando = null;
    }
  })();
  return renovando;
}

export async function api<T>(metodo: 'GET' | 'POST' | 'PUT' | 'DELETE', ruta: string, body?: unknown): Promise<T> {
  let r = await crudo(metodo, ruta, body, sesion?.accessToken);
  if (r.status === 401 && (await renovar())) r = await crudo(metodo, ruta, body, sesion?.accessToken);
  if (r.status === 401) {
    guardar(null);
    throw new ErrorApi(401, 'Tu sesión ha caducado. Vuelve a entrar.');
  }
  return leer<T>(r);
}

// -----------------------------------------------------------------------------
// Tipos de lo que devuelve la API (src/api/README.md)
// -----------------------------------------------------------------------------

export type Estado = 'activo' | 'pausado' | 'trial';
export interface Falta {
  codigo: string;
  texto: string;
}

export interface NegocioResumen {
  id: string;
  nombre: string;
  slug: string;
  estado: Estado;
  loQueFalta: Falta[];
  derivacionesPendientes: number;
}

export interface Servicio {
  id: string;
  nombre: string;
  descripcion: string | null;
  duracionMin: number;
  bufferMin: number;
  precio: number | null;
  precioVisible: boolean;
  activo: boolean;
  citasFuturas: number;
}

export interface Profesional {
  id: string;
  nombre: string;
  activo: boolean;
  servicioIds: string[];
  citasFuturas: number;
}

export interface Tramo {
  staffId: string | null;
  weekday: number;
  apertura: string;
  cierre: string;
}

export interface Festivo {
  id: string;
  staffId: string | null;
  motivo: string | null;
  fechaDesde: string;
  fechaHasta: string;
  horaDesde: string | null;
  horaHasta: string | null;
  diaEntero: boolean;
}

export interface Pregunta {
  id: string;
  pregunta: string;
  respuesta: string;
  orden: number;
}

export interface Negocio {
  id: string;
  nombre: string;
  slug: string;
  estado: Estado;
  sector: string | null;
  timezone: string;
  direccion: string | null;
  telefonoHumano: string | null;
  tonoDeVoz: string | null;
  mensajeBienvenida: string | null;
  widgetKey: string;
  widgetJs: string;
  reglas: {
    antelacionMinHoras: number;
    intervaloHuecosMin: number;
    margenDentroHorario: boolean;
    asignacionProfesional: 'preguntar' | 'automatica';
    politicaCancelacion: string | null;
    cancelacionModo: 'informar' | 'bloquear';
    cancelacionPlazoHoras: number;
  };
  chat: { dominios: string[]; color: string; logo: string | null; privacidadUrl: string | null; topeMensualUsd: number };
  servicios: Servicio[];
  profesionales: Profesional[];
  horario: Tramo[];
  festivos: Festivo[];
  preguntas: Pregunta[];
  loQueFalta: Falta[];
}

export interface Clienta {
  nombre: string | null;
  telefono: string;
}

export interface ConversacionResumen {
  id: string;
  creada: string;
  ultimoMensaje: string;
  canal: string;
  estado: 'activa' | 'escalada' | 'cerrada';
  prueba: boolean;
  clienta: Clienta | null;
  mensajes: number;
  costeUsd: number;
  derivaciones: number;
  derivacionesPendientes: number;
}

export type Linea =
  | { tipo: 'clienta'; fecha: string; texto: string }
  | { tipo: 'asistente'; fecha: string; texto: string; respuestaFija: string | null }
  | { tipo: 'herramienta'; fecha: string; nombre: string; entrada: unknown; resultado: unknown; error: boolean };

export interface ConversacionDetalle extends Omit<ConversacionResumen, 'mensajes' | 'derivaciones' | 'derivacionesPendientes'> {
  lineas: Linea[];
  derivaciones: { id: string; motivo: string | null; resuelta: boolean; creada: string; resueltaAt: string | null }[];
  tokens: number;
}

export interface Derivacion {
  id: string;
  conversationId: string;
  motivo: string | null;
  creada: string;
  prueba: boolean;
  clienta: Clienta | null;
}

export interface CitaAgenda {
  id: string;
  horaInicio: string;
  horaFin: string;
  estado: 'confirmada' | 'cancelada' | 'completada' | 'no_show';
  origen: 'agente' | 'manual' | 'externo';
  servicio: string;
  profesional: string;
  staffId: string;
  clienta: Clienta;
  notas: string | null;
}

export interface InformeConsumo {
  businessId: string;
  negocio: string;
  mes: string;
  mensajes: number;
  conversaciones: number;
  citas: number;
  tokens: number;
  costeUsd: number;
  pruebas: { mensajes: number; conversaciones: number; citas: number; costeUsd: number };
  topeUsd: number;
  fraccionTope: number | null;
  aviso: boolean;
  modelosSinPrecio: string[];
}

export interface RespuestaChat {
  sessionToken: string | null;
  respuesta: string;
  escalada: boolean;
  nuevaConversacion: boolean;
  aviso?: string;
}
