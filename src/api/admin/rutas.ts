// =============================================================================
// Rutas del panel interno: /api/admin/… (Fase 4 · 4.2; Fase 9 · 9.6)
// =============================================================================
// Handlers estándar (Request) => Response, como los del widget (D-61). El
// contrato de cada ruta está en src/api/README.md.
//
//   · Sin cuenta válida (token de Supabase Auth verificado + persona del
//     panel activa, PI-01) → 401 en todas, salvo POST /sesion y /sesion/renovar.
//     Ninguna responde a la clave del widget.
//   · Sin CORS: el panel se sirve desde el mismo origen que la API. El token va
//     en una cabecera (no en una cookie), así que no hay CSRF.
//   · Toda consulta va al negocio de la URL (inTenant + business_id, T-03).
//   · Errores → una frase para el panel (errores.ts); el interno, a onError.
//   · Los handlers son delgados: validan la forma (entrada.ts) y llaman a
//     db/negocios, db/visor, db/portal, citas/manual, db/usage o al canal web.
//
// Fase 9 (PC-05): TODO lo que edita la configuración de un negocio
// (negocios/:id/datos, servicios, horario, festivos, turnos sueltos, la
// agenda…) vive en negocio.ts y lo comparten este panel y el portal del
// cliente. Aquí quedan solo las rutas que son de Mariana:
// activar/pausar, la clave del widget, probar el chat, el visor, las
// derivaciones, el consumo, los enlaces de invitación (PC-02) y el aviso de
// alta terminada (PC-13).
// =============================================================================

import { randomUUID } from 'node:crypto';

import { procesarMensajeWeb, type WebChatDeps } from '../../adapters/channels/web-widget.js';
import {
  altasPendientesDeRevisar,
  anularInvitaciones,
  crearInvitacion,
  invitacionDelNegocio,
  marcarAltaRevisada,
  estadoDelAlta,
} from '../../db/portal.js';
import { cambiarEstado, crearNegocio, leerNegocio, listarNegocios, rotarClave } from '../../db/negocios.js';
import { personaPanel, type PersonaPanel } from '../../db/personas.js';
import { informeConsumoTodos } from '../../db/usage.js';
import { derivacionesPendientes, leerConversacion, listarConversaciones, resolverDerivacion, type FiltroConversaciones } from '../../db/visor.js';
import { businessParaProbar } from '../../db/widget.js';
import { enviarEmailInvitacion } from '../../portal/email.js';
import { json, leerJson, PeticionNoValida } from '../http.js';
import type { AuthPanel } from './auth.js';
import { Entrada, UUID } from './entrada.js';
import { aErrorPanel, ErrorPanel, TEXTO_LO_QUE_FALTA } from './errores.js';
import {
  cuerpoDeNegocio,
  despacharRutaDeNegocio,
  detalleNegocio,
  leerNegocioO404,
  rutasDeNegocio,
  zona,
} from './negocio.js';

const TOKEN_SESION = /^[A-Za-z0-9_-]{20,128}$/;

export interface AdminDeps extends WebChatDeps {
  /** Sin proveedor de cuentas el panel no responde (503): no se abre sin login. */
  auth?: AuthPanel | null;
  /** PC-02: a dónde apunta el enlace de invitación (la web del portal). De serie, baseUrl. */
  portalUrl?: string;
  /** PC-17: título de los chats nuevos del portal (src/alta/agente.ts, tituladorConIA). */
  titulador?: (texto: string) => Promise<string>;
}

export interface ContextoAdmin {
  ip: string | null;
}

type Handler = (p: { req: Request; persona: PersonaPanel; params: string[]; url: URL; ctx: ContextoAdmin }) => Promise<Response>;

interface Ruta {
  metodo: string;
  patron: RegExp;
  handler: Handler;
}

const ID = '([0-9a-fA-F-]{36})';

/** PC-02: el enlace que se le pasa al cliente. */
export function enlaceDeInvitacion(portalUrl: string, token: string): string {
  return `${portalUrl.replace(/\/+$/, '')}/portal/#/invitacion/${token}`;
}

export function createAdminApi(deps: AdminDeps): (req: Request, ctx: ContextoAdmin) => Promise<Response> {
  const onError = deps.onError ?? (() => {});
  const portalUrl = deps.portalUrl ?? deps.baseUrl;
  // PC-05: las mismas rutas de configuración que usa el portal del cliente.
  const deNegocio = rutasDeNegocio(deps, 'panel');

  /** Rutas del panel que cuelgan de un negocio pero NO son del portal. */
  const soloDelPanel: { metodo: string; patron: RegExp; handler: (p: { req: Request; businessId: string; params: string[]; url: URL; ctx: ContextoAdmin }) => Promise<Response> }[] = [
    {
      metodo: 'POST',
      patron: /^(activar|pausar)$/,
      handler: async ({ businessId, params }) => {
        await leerNegocioO404(deps, businessId);
        await cambiarEstado(deps.sql, businessId, params[0] === 'activar' ? 'activo' : 'pausado');
        return detalleNegocio(deps, businessId, 'panel');
      },
    },
    {
      metodo: 'POST',
      patron: /^clave$/,
      handler: async ({ businessId }) => {
        await rotarClave(deps.sql, businessId);
        return detalleNegocio(deps, businessId, 'panel');
      },
    },

    // --- Conversaciones y derivaciones (PI-06, PI-07) ------------------------------------
    {
      metodo: 'GET',
      patron: /^conversaciones$/,
      handler: async ({ businessId, url }) => {
        await leerNegocioO404(deps, businessId);
        const f = url.searchParams.get('filtro') ?? 'todas';
        if (!['todas', 'derivadas', 'pruebas'].includes(f)) throw new ErrorPanel(400, 'Filtro no válido.');
        return json(await listarConversaciones(deps.sql, businessId, f as FiltroConversaciones));
      },
    },
    {
      metodo: 'GET',
      patron: new RegExp(`^conversaciones/${ID}$`),
      handler: async ({ businessId, params }) => {
        const c = await leerConversacion(deps.sql, businessId, params[0]!);
        if (!c) throw new ErrorPanel(404, 'Esa conversación no existe en este negocio.');
        return json(c);
      },
    },
    {
      metodo: 'GET',
      patron: /^derivaciones$/,
      handler: async ({ businessId }) => {
        await leerNegocioO404(deps, businessId);
        return json(await derivacionesPendientes(deps.sql, businessId));
      },
    },
    {
      metodo: 'POST',
      patron: new RegExp(`^derivaciones/${ID}/resolver$`),
      handler: async ({ businessId, params }) => {
        if (!(await resolverDerivacion(deps.sql, businessId, params[0]!))) throw new ErrorPanel(404, 'Esa derivación no existe en este negocio.');
        return json(await derivacionesPendientes(deps.sql, businessId));
      },
    },

    // --- Probar el chat (PI-13) ------------------------------------------------------------
    {
      metodo: 'POST',
      patron: /^probar$/,
      handler: async ({ req, businessId, ctx }) => {
        const n = await businessParaProbar(deps.sql, businessId);
        if (!n) throw new ErrorPanel(409, 'El negocio no existe o está pausado: actívalo para probar el chat.');
        const e = await cuerpoDeNegocio(req);
        const token = e.valor('sessionToken');
        if (token !== undefined && token !== null && (typeof token !== 'string' || !TOKEN_SESION.test(token))) throw new ErrorPanel(400, 'Sesión de prueba no válida.');
        const r = await procesarMensajeWeb(deps, n, {
          sessionToken: typeof token === 'string' ? token : undefined,
          clientMessageId: e.valor('clientMessageId') === undefined ? randomUUID() : e.uuid('clientMessageId', 'el id del mensaje'),
          texto: e.texto('texto', 'el mensaje', 5000),
          ip: ctx.ip,
          prueba: true,
        });
        return json(r);
      },
    },

    // --- El enlace de invitación del portal (PC-02) -------------------------------------
    {
      metodo: 'GET',
      patron: /^invitacion$/,
      handler: async ({ businessId }) => json(await estadoDeInvitacion(businessId)),
    },
    {
      metodo: 'POST',
      patron: /^invitacion$/,
      handler: async ({ req, businessId }) => {
        const n = await leerNegocioO404(deps, businessId);
        const e = await cuerpoDeNegocio(req);
        const email = (e.textoOpcional('email', 'el email del contacto', 254) ?? '').toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ErrorPanel(400, 'Escribe el email del contacto (por ejemplo, nombre@clinicaolea.es).');
        const { token } = await crearInvitacion(deps.sql, businessId, email, deps.now?.());
        const enlace = enlaceDeInvitacion(portalUrl, token);
        // El email es un extra: el enlace se enseña igual, para dárselo a mano.
        let email_estado: string | null = null;
        try {
          email_estado = await enviarEmailInvitacion({ sql: deps.sql, email: deps.email, onError }, { id: n.id, nombre: n.nombre }, email, enlace);
        } catch (err) {
          onError(err);
          email_estado = 'fallido';
        }
        return json({ ...(await estadoDeInvitacion(businessId)), enlace, emailEstado: email_estado }, 201);
      },
    },
    {
      metodo: 'DELETE',
      patron: /^invitacion$/,
      handler: async ({ businessId }) => {
        await anularInvitaciones(deps.sql, businessId, deps.now?.());
        return json(await estadoDeInvitacion(businessId));
      },
    },

    // --- PC-13: el alta terminada, revisada --------------------------------------------
    {
      metodo: 'POST',
      patron: /^alta\/revisada$/,
      handler: async ({ businessId }) => {
        await marcarAltaRevisada(deps.sql, businessId, deps.now?.());
        return json(await altasPendientesDeRevisar(deps.sql));
      },
    },
  ];

  /** PC-02: lo que el panel enseña del enlace (nunca el token: ya no se puede). */
  async function estadoDeInvitacion(businessId: string) {
    const inv = await invitacionDelNegocio(deps.sql, businessId);
    const alta = await estadoDelAlta(deps.sql, businessId);
    return {
      invitacion: inv ? { email: inv.email, expiraAt: inv.expiraAt, creadaAt: inv.createdAt } : null,
      alta: { seccion: alta.seccion, terminadaAt: alta.terminadaAt, revisadaAt: alta.revisadaAt },
    };
  }

  /** Rutas que no cuelgan de un negocio. */
  const rutas: Ruta[] = [
    { metodo: 'GET', patron: /^yo$/, handler: async ({ persona }) => json({ email: persona.email }) },

    {
      metodo: 'GET',
      patron: /^negocios$/,
      handler: async () => {
        const lista = await listarNegocios(deps.sql);
        return json(lista.map((n) => ({ ...n, loQueFalta: n.loQueFalta.map((codigo) => ({ codigo, texto: TEXTO_LO_QUE_FALTA[codigo] })) })));
      },
    },
    {
      metodo: 'POST',
      patron: /^negocios$/,
      handler: async ({ req }) => {
        const e = await cuerpoDeNegocio(req);
        const r = await crearNegocio(deps.sql, {
          nombre: e.texto('nombre', 'el nombre del negocio', 120),
          sector: e.textoOpcional('sector', 'el sector', 120),
          timezone: zona(e),
        });
        return json(r, 201);
      },
    },

    // --- PC-13: las altas terminadas que faltan por revisar -----------------------------
    { metodo: 'GET', patron: /^altas$/, handler: async () => json(await altasPendientesDeRevisar(deps.sql)) },

    // --- Consumo (PI-11) --------------------------------------------------------------------
    {
      metodo: 'GET',
      patron: /^consumo$/,
      handler: async ({ url }) => {
        const mes = url.searchParams.get('mes');
        if (mes !== null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new ErrorPanel(400, 'El mes tiene que ser AAAA-MM.');
        return json(await informeConsumoTodos(deps.sql, mes ?? undefined));
      },
    },
  ];

  return async (req, ctx) => {
    const url = new URL(req.url);
    const ruta = url.pathname.replace(/^\/api\/admin\/?/, '').replace(/\/+$/, '');
    try {
      if (!deps.auth) return json({ error: 'panel_no_configurado', mensaje: 'Falta configurar las cuentas del panel (SUPABASE_PROJECT_REF y SUPABASE_ANON_KEY).' }, 503);

      // --- Entrar y renovar (sin cuenta todavía) --------------------------------------
      if (ruta === 'sesion' || ruta === 'sesion/renovar') {
        if (req.method !== 'POST') return json({ error: 'metodo_no_permitido' }, 405);
        const e = await cuerpoDeNegocio(req);
        const sesion =
          ruta === 'sesion'
            ? await deps.auth.entrar(e.texto('email', 'el email', 200).toLowerCase(), e.texto('password', 'la contraseña', 200))
            : await deps.auth.renovar(e.texto('refreshToken', 'la sesión', 4000));
        // PI-01: además de una cuenta válida, tiene que estar en la lista del panel.
        const usuario = sesion ? await deps.auth.usuario(sesion.accessToken) : null;
        const persona = usuario ? await personaPanel(deps.sql, usuario.id) : null;
        if (!sesion || !persona) return json({ error: 'no_autorizado', mensaje: 'Email o contraseña incorrectos, o esa cuenta no tiene acceso al panel.' }, 401);
        return json({ ...sesion, email: persona.email });
      }

      // --- Todo lo demás: con cuenta ----------------------------------------------------
      const persona = await autenticar(deps, req);
      if (!persona) return json({ error: 'no_autorizado', mensaje: 'Tu sesión no es válida o ha caducado. Vuelve a entrar.' }, 401);

      // --- Un negocio concreto: lo compartido con el portal y lo del panel --------------
      const deUnNegocio = new RegExp(`^negocios/${ID}(?:/(.*))?$`).exec(ruta);
      if (deUnNegocio) {
        const businessId = deUnNegocio[1]!.toLowerCase();
        if (!UUID.test(businessId)) return json({ error: 'no_encontrado' }, 404);
        const sub = deUnNegocio[2] ?? '';
        const propia = soloDelPanel.filter((r) => r.patron.test(sub));
        if (propia.length > 0) {
          const r = propia.find((x) => x.metodo === req.method);
          if (!r) return json({ error: 'metodo_no_permitido' }, 405);
          const params = (r.patron.exec(sub) ?? []).slice(1).map((p) => p.toLowerCase());
          if (params.some((p) => p.length === 36 && !UUID.test(p))) return json({ error: 'no_encontrado' }, 404);
          return await r.handler({ req, businessId, params, url, ctx });
        }
        if (/[0-9a-fA-F-]{36}/.test(sub) && !sub.split('/').every((p) => p.length !== 36 || UUID.test(p))) {
          return json({ error: 'no_encontrado' }, 404);
        }
        const r = await despacharRutaDeNegocio(deNegocio, sub, { req, businessId, url });
        return r ?? json({ error: 'no_encontrado' }, 404);
      }

      const coinciden = rutas.filter((r) => r.patron.test(ruta));
      if (coinciden.length === 0) return json({ error: 'no_encontrado' }, 404);
      const r = coinciden.find((x) => x.metodo === req.method);
      if (!r) return json({ error: 'metodo_no_permitido' }, 405);
      const params = (r.patron.exec(ruta) ?? []).slice(1).map((p) => p.toLowerCase());
      if (params.some((p) => p.length === 36 && !UUID.test(p))) return json({ error: 'no_encontrado' }, 404);
      return await r.handler({ req, persona, params, url, ctx });
    } catch (e) {
      if (e instanceof PeticionNoValida) return json({ error: e.codigo, mensaje: 'La petición no es válida.' }, e.status);
      const p = aErrorPanel(e);
      if (p) return json({ error: 'no_valido', mensaje: p.message, ...p.extra }, p.status);
      onError(e);
      return json({ error: 'error_interno', mensaje: 'Algo ha fallado y no se ha guardado. Inténtalo de nuevo.' }, 500);
    }
  };
}

/** PI-01: token de Supabase válido y persona del panel activa. Null si no. */
async function autenticar(deps: AdminDeps, req: Request): Promise<PersonaPanel | null> {
  const token = /^Bearer (.+)$/.exec(req.headers.get('authorization') ?? '')?.[1]?.trim();
  if (!token || token.length > 4000 || !deps.auth) return null;
  const usuario = await deps.auth.usuario(token);
  return usuario ? personaPanel(deps.sql, usuario.id) : null;
}

/** Lo usa src/api/app.ts para saber si una ruta existe sin repetir la lista. */
export { leerNegocio };
