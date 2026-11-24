// =============================================================================
// Rutas del portal del cliente: /api/portal/… (Fase 9 · 9.2, 9.4 y 9.5)
// =============================================================================
// El portal es la herramienta del NEGOCIO (el panel de /api/admin es la de
// Mariana). Reglas propias, además de las del README de esta carpeta:
//
//   · Sin sesión del portal → 401 en todo, salvo entrar, abrir la invitación y
//     crear la cuenta. Ni la clave del widget ni un token del panel valen aquí.
//   · **El negocio sale SIEMPRE de la sesión** (PC-02, PC-11). Ninguna ruta
//     recibe un business_id: cambiar la dirección o pedírselo al chat no
//     sirve de nada, porque no hay por dónde entrar.
//   · Mismo origen, sin CORS: el portal se sirve junto a la API. El token va
//     en `Authorization`, nunca en una cookie (sin CSRF).
//   · Las respuestas no distinguen: un enlace inventado, usado, caducado o
//     anulado, y un email que no existe, contestan igual que uno que sí.
//   · La configuración (datos, servicios, horario, festivos, turnos sueltos,
//     la agenda) son LAS MISMAS rutas del panel (admin/negocio.ts) montadas
//     bajo `negocio/…` con el business_id de la sesión: PC-05 se cumple solo.
//   · PC-09: el tope no se ve ni se cambia desde aquí (lo quita `ver: portal`).
//   · Los chats (PC-17, Fase 9b): un chat de otro negocio, o borrado, da 404
//     igual que uno que no existe.
//   · Los adjuntos (PC-21): se suben de uno en uno, en binario (no en JSON),
//     hasta 4 MB; el tipo se mira en los bytes. Un adjunto de otro negocio da
//     404. Se mandan después con el mensaje, por su id.
// =============================================================================

import { randomUUID } from 'node:crypto';

import { AdjuntosNoValidos, ChatNoEncontrado, turnoDelPortal, type PortalChatDeps } from '../../alta/agente.js';
import { saludoDelPortal } from '../../alta/prompt.js';
import { utcToLocal } from '../../core/time.js';
import { normalizarEmail } from '../../core/email.js';
import { guardarAdjunto, leerAdjunto, limpiarNombre, MAX_BYTES_ADJUNTO, tipoPorContenido } from '../../db/adjuntos.js';
import {
  abrirSesion,
  cadenaDelChat,
  cerrarSesion,
  chatsDelPortal,
  comprobarCodigoPortal,
  crearCuentaConInvitacion,
  cuentaPorEmail,
  estadoDelAlta,
  guardarCodigoPortal,
  invitacionPorToken,
  mensajesDelChat,
  ocultarChat,
  renombrarChat,
  sesionPorToken,
  type SesionPortal,
} from '../../db/portal.js';
import { leerNegocio } from '../../db/negocios.js';
import { enviarCodigoPortal } from '../../portal/email.js';
import { hashPassword, problemaConPassword, verificarPassword } from '../../portal/password.js';
import { json, leerJson, PeticionNoValida } from '../http.js';
import { Entrada } from '../admin/entrada.js';
import { aErrorPanel, ErrorPanel } from '../admin/errores.js';
import { cuerpoDeNegocio, despacharRutaDeNegocio, rutasDeNegocio } from '../admin/negocio.js';
import type { AdminDeps } from '../admin/rutas.js';

export type PortalDeps = AdminDeps;

export interface ContextoPortalApi {
  ip: string | null;
}

/** Un código de seis dígitos, como el de PA-16. */
function nuevoCodigo(): string {
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
}

const TOKEN_INVITACION = /^[A-Za-z0-9_-]{20,128}$/;

/** Lo mismo diga lo que diga: un enlace que no sirve no cuenta por qué (PC-02). */
const TEXTO_ENLACE_MAL = 'Este enlace ya no sirve. Pídele uno nuevo a MAZZMKT.';
const TEXTO_ENTRAR_MAL = 'Email o contraseña incorrectos.';

export function createPortalApi(deps: PortalDeps): (req: Request, ctx: ContextoPortalApi) => Promise<Response> {
  const onError = deps.onError ?? (() => {});
  const chatDeps: PortalChatDeps = {
    sql: deps.sql,
    model: deps.model,
    settings: deps.settings,
    email: deps.email,
    baseUrl: deps.baseUrl,
    ...(deps.now ? { now: deps.now } : {}),
    ...(deps.titulador ? { titulador: deps.titulador } : {}),
    onError,
  };
  // PC-05: las mismas rutas de configuración que el panel, con `ver: portal`.
  const deNegocio = rutasDeNegocio(deps, 'portal');

  /** Lo que el portal necesita saber nada más entrar. */
  async function yo(sesion: SesionPortal) {
    const n = await leerNegocio(deps.sql, sesion.businessId);
    if (!n) throw new ErrorPanel(404, 'Ese negocio ya no existe. Habla con MAZZMKT.');
    const alta = await estadoDelAlta(deps.sql, sesion.businessId);
    return {
      email: sesion.email,
      negocio: { id: n.id, nombre: n.nombre, estado: n.estado },
      // PC-19 (Fase 9b): el portal se ve siempre; esto le dice qué falta del alta.
      alta: { seccion: alta.seccion, terminada: alta.terminadaAt !== null, hechas: alta.seccionesHechas, faltan: alta.faltan },
    };
  }

  return async (req, _ctx) => {
    const url = new URL(req.url);
    const ruta = url.pathname.replace(/^\/api\/portal\/?/, '').replace(/\/+$/, '');
    try {
      // --- Sin sesión todavía ---------------------------------------------------------
      if (ruta === 'invitacion') {
        if (req.method !== 'POST') return json({ error: 'metodo_no_permitido' }, 405);
        const e = new Entrada(await leerJson(req));
        const token = e.texto('token', 'el enlace', 200);
        if (!TOKEN_INVITACION.test(token)) return json({ error: 'enlace_no_valido', mensaje: TEXTO_ENLACE_MAL }, 404);
        const r = await invitacionPorToken(deps.sql, token, deps.now?.());
        if (!r.ok) return json({ error: 'enlace_no_valido', mensaje: TEXTO_ENLACE_MAL }, 404);
        const n = await leerNegocio(deps.sql, r.invitacion.businessId);
        if (!n) return json({ error: 'enlace_no_valido', mensaje: TEXTO_ENLACE_MAL }, 404);
        // PC-02: el código va al email de la invitación, no al que se escriba aquí.
        const codigo = nuevoCodigo();
        const guardado = await guardarCodigoPortal(deps.sql, r.invitacion, codigo, deps.now?.());
        if (!guardado) {
          return json({ error: 'demasiados_codigos', mensaje: 'Te hemos mandado varios códigos ya. Espera un rato y vuelve a intentarlo.' }, 429);
        }
        let estado = 'fallido';
        try {
          estado = await enviarCodigoPortal({ sql: deps.sql, email: deps.email, onError }, { id: n.id, nombre: n.nombre }, r.invitacion.email, codigo);
        } catch (err) {
          onError(err);
        }
        return json({ negocio: n.nombre, email: taparEmail(r.invitacion.email), codigoEstado: estado });
      }

      if (ruta === 'cuenta') {
        if (req.method !== 'POST') return json({ error: 'metodo_no_permitido' }, 405);
        const e = new Entrada(await leerJson(req));
        const token = e.texto('token', 'el enlace', 200);
        const codigo = e.texto('codigo', 'el código', 20);
        const password = e.texto('password', 'la contraseña', 300);
        if (!TOKEN_INVITACION.test(token)) return json({ error: 'enlace_no_valido', mensaje: TEXTO_ENLACE_MAL }, 404);
        const problema = problemaConPassword(password);
        if (problema) return json({ error: 'password_corta', mensaje: problema }, 400);
        const r = await invitacionPorToken(deps.sql, token, deps.now?.());
        if (!r.ok) return json({ error: 'enlace_no_valido', mensaje: TEXTO_ENLACE_MAL }, 404);
        const comprobado = await comprobarCodigoPortal(deps.sql, r.invitacion, codigo, deps.now?.());
        if (comprobado.resultado !== 'correcto') {
          return json({ error: `codigo_${comprobado.resultado}`, mensaje: textoDelCodigo(comprobado.resultado, comprobado.quedan) }, 400);
        }
        const cuenta = await crearCuentaConInvitacion(deps.sql, r.invitacion, await hashPassword(password), deps.now?.());
        if (!cuenta) return json({ error: 'enlace_no_valido', mensaje: TEXTO_ENLACE_MAL }, 404);
        const sessionToken = await abrirSesion(deps.sql, cuenta, deps.now?.());
        return json({ sessionToken, ...(await yo({ cuentaId: cuenta.id, businessId: cuenta.businessId, email: cuenta.email })) }, 201);
      }

      if (ruta === 'sesion') {
        if (req.method !== 'POST') return json({ error: 'metodo_no_permitido' }, 405);
        const e = new Entrada(await leerJson(req));
        const email = normalizarEmail(e.texto('email', 'el email', 254));
        const password = e.texto('password', 'la contraseña', 300);
        const cuenta = email ? await cuentaPorEmail(deps.sql, email) : null;
        // Se comprueba la contraseña aunque la cuenta no exista: así tarda lo
        // mismo y no se puede averiguar qué emails tienen portal.
        const vale = cuenta
          ? await verificarPassword(password, cuenta.passwordHash)
          : await verificarPassword(password, 'scrypt$16384$8$1$c2FsdGVkc2FsdGVk$bm9wZW5vcGVub3Blbm9wZW5vcGVub3Blbm8');
        if (!cuenta || !cuenta.activa || !vale) return json({ error: 'no_autorizado', mensaje: TEXTO_ENTRAR_MAL }, 401);
        const sessionToken = await abrirSesion(deps.sql, cuenta, deps.now?.());
        return json({ sessionToken, ...(await yo({ cuentaId: cuenta.id, businessId: cuenta.businessId, email: cuenta.email })) });
      }

      // --- Con sesión ------------------------------------------------------------------
      const token = /^Bearer (.+)$/.exec(req.headers.get('authorization') ?? '')?.[1]?.trim();
      const sesion = token && token.length <= 500 ? await sesionPorToken(deps.sql, token, deps.now?.()) : null;
      if (!sesion) return json({ error: 'no_autorizado', mensaje: 'Tu sesión no es válida o ha caducado. Vuelve a entrar.' }, 401);

      if (ruta === 'salir') {
        if (req.method !== 'POST') return json({ error: 'metodo_no_permitido' }, 405);
        await cerrarSesion(deps.sql, token!);
        return json({ fuera: true });
      }

      if (ruta === 'yo') {
        if (req.method !== 'GET') return json({ error: 'metodo_no_permitido' }, 405);
        return json(await yo(sesion));
      }

      // --- Los chats del portal (PC-17, PC-19) ------------------------------------------
      if (ruta === 'chats') {
        if (req.method !== 'GET') return json({ error: 'metodo_no_permitido' }, 405);
        const n = await leerNegocio(deps.sql, sesion.businessId);
        if (!n) throw new ErrorPanel(404, 'Ese negocio ya no existe. Habla con MAZZMKT.');
        const hora = utcToLocal(deps.now?.() ?? new Date(), n.timezone).hora;
        const chats = await chatsDelPortal(deps.sql, sesion.businessId);
        return json({ chats, saludo: saludoDelPortal(n.nombre, hora), ...(await yo(sesion)) });
      }

      const deChat = /^chats\/([0-9a-f-]{36})$/.exec(ruta);
      if (deChat) {
        const chatId = deChat[1]!;
        if (req.method === 'GET') {
          const cadena = await cadenaDelChat(deps.sql, sesion.businessId, chatId);
          if (cadena.length === 0) return json({ error: 'no_encontrado', mensaje: 'Ese chat no existe.' }, 404);
          return json({ mensajes: await mensajesDelChat(deps.sql, sesion.businessId, cadena) });
        }
        if (req.method === 'PUT') {
          const e = new Entrada(await leerJson(req));
          const titulo = e.texto('titulo', 'el título', 200);
          if (!titulo.trim()) return json({ error: 'no_valido', mensaje: 'Escribe un título.' }, 400);
          const ok = await renombrarChat(deps.sql, sesion.businessId, chatId, titulo);
          return ok ? json({ renombrado: true }) : json({ error: 'no_encontrado', mensaje: 'Ese chat no existe.' }, 404);
        }
        if (req.method === 'DELETE') {
          const ok = await ocultarChat(deps.sql, sesion.businessId, chatId, deps.now?.());
          return ok ? json({ borrado: true }) : json({ error: 'no_encontrado', mensaje: 'Ese chat no existe.' }, 404);
        }
        return json({ error: 'metodo_no_permitido' }, 405);
      }

      // --- Adjuntos del chat (PC-21) ---------------------------------------------------
      if (ruta === 'adjuntos') {
        if (req.method !== 'POST') return json({ error: 'metodo_no_permitido' }, 405);
        const declarado = Number(req.headers.get('content-length'));
        if (Number.isFinite(declarado) && declarado > MAX_BYTES_ADJUNTO) return json({ error: 'demasiado_grande', mensaje: 'Ese archivo pasa de 4 MB.' }, 413);
        const datos = Buffer.from(await req.arrayBuffer());
        if (datos.length === 0) return json({ error: 'vacio', mensaje: 'El archivo está vacío.' }, 400);
        if (datos.length > MAX_BYTES_ADJUNTO) return json({ error: 'demasiado_grande', mensaje: 'Ese archivo pasa de 4 MB.' }, 413);
        const tipo = tipoPorContenido(datos);
        if (!tipo) return json({ error: 'tipo_no_valido', mensaje: 'Solo se pueden adjuntar imágenes (JPG, PNG, WebP) y PDF.' }, 415);
        let nombre = 'archivo';
        try {
          nombre = limpiarNombre(decodeURIComponent(req.headers.get('x-nombre') ?? 'archivo'));
        } catch {
          nombre = 'archivo';
        }
        return json(await guardarAdjunto(deps.sql, sesion.businessId, { nombre, tipo, datos }), 201);
      }

      const deAdjunto = /^adjuntos\/([0-9a-f-]{36})$/.exec(ruta);
      if (deAdjunto) {
        if (req.method !== 'GET') return json({ error: 'metodo_no_permitido' }, 405);
        const a = await leerAdjunto(deps.sql, sesion.businessId, deAdjunto[1]!);
        if (!a) return json({ error: 'no_encontrado', mensaje: 'Ese archivo no existe.' }, 404);
        // Fase 5 (PB-06): guardado como documento, el archivo ya no se guarda aquí.
        if (a.documentoTitulo !== null) return json({ error: 'guardado', mensaje: `Guardado en Documentos como «${a.documentoTitulo}».`, titulo: a.documentoTitulo }, 410);
        return new Response(new Uint8Array(a.datos), {
          status: 200,
          headers: {
            'content-type': a.tipo,
            'content-length': String(a.bytes),
            // Solo para quien lo pidió con su sesión; nada de cachés compartidas.
            'cache-control': 'private, max-age=3600',
            'x-content-type-options': 'nosniff',
            'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(a.nombre)}`,
          },
        });
      }

      // --- Un mensaje al chat (PC-03, PC-04, PC-17) --------------------------------------
      if (ruta === 'chat') {
        if (req.method !== 'POST') return json({ error: 'metodo_no_permitido' }, 405);
        const e = new Entrada(await leerJson(req));
        try {
          const adjuntos = e.valor('adjuntos');
          if (adjuntos !== undefined && (!Array.isArray(adjuntos) || adjuntos.some((x) => typeof x !== 'string' || !/^[0-9a-f-]{36}$/.test(x)))) {
            return json({ error: 'no_valido', mensaje: 'Los archivos no son válidos.' }, 400);
          }
          const r = await turnoDelPortal(chatDeps, {
            businessId: sesion.businessId,
            // PC-21: con archivos, el texto puede ir vacío.
            texto: Array.isArray(adjuntos) && adjuntos.length ? (e.textoOpcional('texto', 'el mensaje', 5000) ?? '') : e.texto('texto', 'el mensaje', 5000),
            ...(Array.isArray(adjuntos) ? { adjuntos: adjuntos as string[] } : {}),
            clientMessageId: e.valor('clientMessageId') === undefined ? randomUUID() : e.uuid('clientMessageId', 'el id del mensaje'),
            chatId: e.uuidOpcional('chatId', 'el chat'),
          });
          return json(r);
        } catch (err) {
          if (err instanceof ChatNoEncontrado) return json({ error: 'no_encontrado', mensaje: 'Ese chat ya no existe. Abre uno nuevo.' }, 404);
          if (err instanceof AdjuntosNoValidos) return json({ error: 'adjuntos_no_validos', mensaje: err.message }, 400);
          throw err;
        }
      }

      // --- Su configuración: las mismas rutas del panel (PC-05) -------------------------
      const deNegocioRuta = /^negocio(?:\/(.*))?$/.exec(ruta);
      if (deNegocioRuta) {
        const sub = deNegocioRuta[1] ?? '';
        const r = await despacharRutaDeNegocio(deNegocio, sub, { req, businessId: sesion.businessId, url });
        return r ?? json({ error: 'no_encontrado' }, 404);
      }

      return json({ error: 'no_encontrado' }, 404);
    } catch (e) {
      if (e instanceof PeticionNoValida) return json({ error: e.codigo, mensaje: 'La petición no es válida.' }, e.status);
      const p = aErrorPanel(e);
      if (p) return json({ error: 'no_valido', mensaje: p.message, ...p.extra }, p.status);
      onError(e);
      return json({ error: 'error_interno', mensaje: 'Algo ha fallado y no se ha guardado. Inténtalo de nuevo.' }, 500);
    }
  };
}

/** "contacto@clinicaolea.es" → "c******@clinicaolea.es": se ve a dónde va sin enseñarlo entero. */
export function taparEmail(email: string): string {
  const [usuario = '', dominio = ''] = email.split('@');
  const visible = usuario.slice(0, 1);
  return `${visible}${'*'.repeat(Math.max(1, usuario.length - 1))}@${dominio}`;
}

function textoDelCodigo(resultado: string, quedan?: number): string {
  switch (resultado) {
    case 'incorrecto':
      return `Ese código no es. Te ${quedan === 1 ? 'queda 1 intento' : `quedan ${quedan ?? 2} intentos`}.`;
    case 'agotado':
      return 'Has fallado el código tres veces. Vuelve a abrir el enlace para que te mandemos otro.';
    case 'caducado':
      return 'Ese código ha caducado. Vuelve a abrir el enlace para que te mandemos otro.';
    default:
      return 'No hay ningún código pendiente. Vuelve a abrir el enlace para que te mandemos uno.';
  }
}

/** Para `cuerpoDeNegocio` desde fuera (el panel y el portal comparten el límite). */
export { cuerpoDeNegocio };
