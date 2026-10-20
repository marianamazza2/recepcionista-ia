// =============================================================================
// Rutas del widget (Fase 3 · 3.2)
// =============================================================================
//   GET  /api/widget/config?key=…        lo público del negocio para pintar el widget
//   POST /api/chat                        { key, sessionToken?, clientMessageId, texto }
//   GET  /api/chat/historial?key=…        con Authorization: Bearer <sessionToken>
//
// Orden en las tres: clave → negocio (404) → origen (403, sin cabeceras CORS:
// el navegador ni deja leer la respuesta) → lo demás. Nunca sale un error
// interno hacia el navegador: si algo falla con el negocio ya resuelto, se
// responde con el texto fijo que da el teléfono del local.
// =============================================================================

import { historialWeb, LIMITES_WIDGET, procesarMensajeWeb, textoFijo, type WebChatDeps } from '../adapters/channels/web-widget.js';
import { businessByWidgetKey, type WidgetBusiness } from '../db/widget.js';
import { cors, json, leerJson, origenPermitido, PeticionNoValida } from './http.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLAVE = /^wk_[A-Za-z0-9_]{16,64}$/;
const TOKEN_SESION = /^[A-Za-z0-9_-]{20,128}$/;

export interface Contexto {
  /** IP de quien llama (PW-05). En Vercel sale de x-forwarded-for; en local, del socket. */
  ip: string | null;
}

/** Resuelve el negocio y comprueba el origen. Devuelve el negocio o la respuesta de error. */
async function negocioYOrigen(deps: WebChatDeps, req: Request, key: unknown): Promise<{ negocio: WidgetBusiness; origin: string } | Response> {
  if (typeof key !== 'string' || !CLAVE.test(key)) return json({ error: 'clave_desconocida' }, 404);
  const negocio = await businessByWidgetKey(deps.sql, key);
  if (!negocio) return json({ error: 'clave_desconocida' }, 404);
  const origin = req.headers.get('origin');
  if (!origenPermitido(origin, negocio.dominios)) return json({ error: 'origen_no_permitido' }, 403);
  return { negocio, origin: origin! };
}

/** PW-02 */
export function avisoPrivacidad(negocio: Pick<WidgetBusiness, 'nombre' | 'privacidadUrl'>): { texto: string; enlace: string | null } {
  return {
    texto: `Asistente virtual. Al escribir aceptas la política de privacidad de ${negocio.nombre}.`,
    enlace: negocio.privacidadUrl,
  };
}

export async function widgetConfig(deps: WebChatDeps, req: Request): Promise<Response> {
  try {
    const r = await negocioYOrigen(deps, req, new URL(req.url).searchParams.get('key'));
    if (r instanceof Response) return r;
    const { negocio, origin } = r;
    // Solo lo público (PW-01, PW-02): nada de ids, ajustes internos ni tope.
    return json(
      {
        nombre: negocio.nombre,
        color: negocio.color,
        bienvenida: negocio.mensajeBienvenida,
        aviso: avisoPrivacidad(negocio),
        maxCaracteres: { ...LIMITES_WIDGET, ...deps.limites }.maxCaracteres,
      },
      200,
      { ...cors(origin), 'cache-control': 'public, max-age=300' },
    );
  } catch (e) {
    deps.onError?.(e);
    return json({ error: 'no_disponible' }, 503);
  }
}

export async function chat(deps: WebChatDeps, req: Request, ctx: Contexto): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await leerJson(req);
  } catch (e) {
    if (e instanceof PeticionNoValida) return json({ error: e.codigo }, e.status);
    throw e;
  }
  let resuelto: { negocio: WidgetBusiness; origin: string } | Response;
  try {
    resuelto = await negocioYOrigen(deps, req, body.key);
  } catch (e) {
    deps.onError?.(e);
    return json({ error: 'no_disponible' }, 503);
  }
  if (resuelto instanceof Response) return resuelto;
  const { negocio, origin } = resuelto;

  const { sessionToken, clientMessageId, texto } = body;
  if (
    typeof clientMessageId !== 'string' ||
    !UUID.test(clientMessageId) ||
    typeof texto !== 'string' ||
    texto.trim() === '' ||
    (sessionToken !== undefined && sessionToken !== null && (typeof sessionToken !== 'string' || !TOKEN_SESION.test(sessionToken)))
  ) {
    return json({ error: 'peticion_no_valida' }, 400, cors(origin));
  }

  try {
    const r = await procesarMensajeWeb(deps, negocio, {
      sessionToken: typeof sessionToken === 'string' ? sessionToken : undefined,
      clientMessageId: clientMessageId.toLowerCase(),
      texto,
      ip: ctx.ip,
    });
    return json(r, 200, cors(origin));
  } catch (e) {
    // Lo que falle antes del turno (la base, al abrir la sesión): sin detalles.
    deps.onError?.(e);
    return json(
      { sessionToken: typeof sessionToken === 'string' ? sessionToken : null, respuesta: textoFijo(negocio, 'error'), escalada: false, nuevaConversacion: false, aviso: 'error' },
      200,
      cors(origin),
    );
  }
}

export async function historial(deps: WebChatDeps, req: Request): Promise<Response> {
  try {
    const r = await negocioYOrigen(deps, req, new URL(req.url).searchParams.get('key'));
    if (r instanceof Response) return r;
    const { negocio, origin } = r;
    const token = /^Bearer (.+)$/.exec(req.headers.get('authorization') ?? '')?.[1];
    if (!token || !TOKEN_SESION.test(token)) return json({ error: 'sesion_no_valida' }, 401, cors(origin));
    const h = await historialWeb(deps, negocio, token);
    // Un token de otro negocio, inventado o caducado (PW-03): lo mismo.
    if (!h) return json({ error: 'sesion_no_valida' }, 401, cors(origin));
    return json(h, 200, cors(origin));
  } catch (e) {
    deps.onError?.(e);
    return json({ error: 'no_disponible' }, 503);
  }
}
