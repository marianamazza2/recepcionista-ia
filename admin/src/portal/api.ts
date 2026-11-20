// =============================================================================
// Cliente de la API del portal (Fase 9 · 9.4)
// =============================================================================
// El portal solo habla con nuestra API (/api/portal/…), en el mismo origen.
// Su sesión NO es la del panel: es un token propio del portal (PC-11) que se
// guarda en sessionStorage (se pierde al cerrar la pestaña) y viaja en
// `Authorization`, nunca en una cookie (sin CSRF). Un 401 devuelve a "Entrar".
//
// El negocio no viaja NUNCA en la dirección: sale de la sesión en el servidor
// (PC-02). Por eso los caminos de aquí son 'negocio/…', sin ningún id.
// =============================================================================

import { ErrorApi } from '../error-api';

export interface SesionPortal {
  sessionToken: string;
  email: string;
  negocio: { id: string; nombre: string; estado: 'activo' | 'pausado' | 'trial' };
  alta: EstadoAlta;
}

/** PC-18: qué secciones del alta están hechas y cuáles faltan. */
export interface EstadoAlta {
  seccion: number;
  terminada: boolean;
  hechas: string[];
  faltan: string[];
}

/** PC-17: un chat del historial. */
export interface ChatResumido {
  id: string;
  titulo: string;
  actualizado: string;
  /** El último mensaje, en una línea (la línea gris de la búsqueda del móvil). */
  ultimo: string | null;
}

export interface Historial {
  chats: ChatResumido[];
  /** PC-19: «Buenas tardes, Clínica Aurora. ¿En qué te puedo ayudar?», con la hora del negocio. */
  saludo: string;
  alta: EstadoAlta;
  negocio: { id: string; nombre: string; estado: string };
  email: string;
}

const CLAVE = 'recepcionista-portal:sesion';

export function sesionGuardada(): SesionPortal | null {
  try {
    const s = sessionStorage.getItem(CLAVE);
    return s ? (JSON.parse(s) as SesionPortal) : null;
  } catch {
    return null;
  }
}

let sesion: SesionPortal | null = sesionGuardada();
let caducada = false;
const oyentes = new Set<(s: SesionPortal | null) => void>();

export function sesionCaducada(): boolean {
  return caducada;
}

export function alCambiarSesion(f: (s: SesionPortal | null) => void): () => void {
  oyentes.add(f);
  return () => oyentes.delete(f);
}

export function guardarSesion(s: SesionPortal | null): void {
  try {
    if (s) sessionStorage.setItem(CLAVE, JSON.stringify(s));
    else sessionStorage.removeItem(CLAVE);
  } catch {
    // Sin almacenamiento, la sesión vive solo en memoria.
  }
  sesion = s;
  for (const f of oyentes) f(s);
}

// La MISMA clase que el panel (admin/src/error-api.ts): así `mensajeDe()`
// reconoce el error y se enseña la frase que mandó la API, no la genérica.
export { ErrorApi } from '../error-api';

async function crudo(metodo: string, ruta: string, body?: unknown, token?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(`/api/portal/${ruta}`, { method: metodo, headers, credentials: 'omit', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}

async function leer<T>(r: Response): Promise<T> {
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new ErrorApi(r.status, typeof j.mensaje === 'string' ? j.mensaje : 'No se ha podido completar. Inténtalo de nuevo.', j);
  return j as T;
}

/** Sin sesión todavía: abrir el enlace de invitación (PC-02). */
export async function abrirInvitacion(token: string): Promise<{ negocio: string; email: string; codigoEstado: string }> {
  return leer(await crudo('POST', 'invitacion', { token }));
}

/** Sin sesión todavía: con el código del email y una contraseña, la cuenta. */
export async function crearCuenta(token: string, codigo: string, password: string): Promise<void> {
  const s = await leer<SesionPortal>(await crudo('POST', 'cuenta', { token, codigo, password }));
  caducada = false;
  guardarSesion(s);
}

export async function entrar(email: string, password: string): Promise<void> {
  const s = await leer<SesionPortal>(await crudo('POST', 'sesion', { email, password }));
  caducada = false;
  guardarSesion(s);
}

export async function salir(): Promise<void> {
  const t = sesion?.sessionToken;
  guardarSesion(null);
  caducada = false;
  if (t) await crudo('POST', 'salir', {}, t).catch(() => undefined);
}

export async function api<T>(metodo: 'GET' | 'POST' | 'PUT' | 'DELETE', ruta: string, body?: unknown): Promise<T> {
  const r = await crudo(metodo, ruta, body, sesion?.sessionToken);
  if (r.status === 401) {
    caducada = sesion !== null;
    guardarSesion(null);
    throw new ErrorApi(401, 'Tu sesión ha caducado. Vuelve a entrar.');
  }
  return leer<T>(r);
}

export interface MensajeChat {
  rol: 'cliente' | 'asistente';
  texto: string;
}

/** El bloque que el chat devuelve para confirmar antes de guardar (PC-03). */
export interface Resumen {
  seccion: string;
  titulo: string;
  lineas: { etiqueta: string; valor: string }[];
  tabla?: { columnas: string[]; filas: string[][] };
}

export interface RespuestaChat {
  respuesta: string;
  resumen: Resumen | null;
  altaTerminada: boolean;
  seccion: number;
  faltan: string[];
  modo: 'alta' | 'portal';
  chat: { id: string; titulo: string };
  aviso?: string;
}
