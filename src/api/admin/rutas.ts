// =============================================================================
// Rutas del panel interno: /api/admin/… (Fase 4 · 4.2)
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
//     db/negocios, db/visor, citas/manual, db/usage o al canal web.
// =============================================================================

import { randomUUID } from 'node:crypto';

import { procesarMensajeWeb, type WebChatDeps } from '../../adapters/channels/web-widget.js';
import { cancelarCitaManual, cargarCitaManual, agendaDelDia } from '../../citas/manual.js';
import { inicioDelDia, localToUtc, sumarDias, utcToLocal } from '../../core/time.js';
import {
  borrarFestivo,
  borrarPregunta,
  cambiarEstado,
  crearFestivo,
  crearNegocio,
  crearPregunta,
  crearProfesional,
  crearServicio,
  guardarChat,
  guardarDatos,
  guardarHorario,
  guardarPregunta,
  guardarProfesional,
  guardarReglas,
  guardarServicio,
  leerNegocio,
  listarNegocios,
  rotarClave,
  type ServicioPanel,
  type ProfesionalPanel,
  type PreguntaPanel,
} from '../../db/negocios.js';
import { personaPanel, type PersonaPanel } from '../../db/personas.js';
import { informeConsumoTodos } from '../../db/usage.js';
import { derivacionesPendientes, leerConversacion, listarConversaciones, resolverDerivacion, type FiltroConversaciones } from '../../db/visor.js';
import { businessParaProbar } from '../../db/widget.js';
import { json, leerJson, PeticionNoValida } from '../http.js';
import type { AuthPanel } from './auth.js';
import { Entrada, horaDeTramo, normalizarDominio, UUID } from './entrada.js';
import { aErrorPanel, ErrorPanel, TEXTO_LO_QUE_FALTA } from './errores.js';

/** El logo viaja en el cuerpo (hasta 200.000 caracteres): el panel admite más que el widget. */
const MAX_CUERPO_PANEL = 512 * 1024;

const ZONAS = new Set(Intl.supportedValuesOf('timeZone'));
const TOKEN_SESION = /^[A-Za-z0-9_-]{20,128}$/;

export interface AdminDeps extends WebChatDeps {
  /** Sin proveedor de cuentas el panel no responde (503): no se abre sin login. */
  auth?: AuthPanel | null;
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

export function createAdminApi(deps: AdminDeps): (req: Request, ctx: ContextoAdmin) => Promise<Response> {
  const onError = deps.onError ?? (() => {});
  const cuerpo = async (req: Request) => new Entrada(await leerJson(req, MAX_CUERPO_PANEL));

  /** El negocio de la URL tiene que existir (404 si no). */
  const negocio = async (id: string) => {
    const n = await leerNegocio(deps.sql, id);
    if (!n) throw new ErrorPanel(404, 'Ese negocio no existe.');
    return n;
  };

  const detalle = async (id: string) => {
    const n = await negocio(id);
    return json({
      ...n,
      festivos: n.festivos.map((f) => ({ ...f, ...festivoLocal(f.desde, f.hasta, n.timezone) })),
      loQueFalta: n.loQueFalta.map((codigo) => ({ codigo, texto: TEXTO_LO_QUE_FALTA[codigo] })),
      widgetJs: `${deps.baseUrl.replace(/\/+$/, '')}/widget.js`,
    });
  };

  const rutas: Ruta[] = [
    { metodo: 'GET', patron: /^yo$/, handler: async ({ persona }) => json({ email: persona.email }) },

    // --- Negocios -------------------------------------------------------------
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
        const e = await cuerpo(req);
        const r = await crearNegocio(deps.sql, {
          nombre: e.texto('nombre', 'el nombre del negocio', 120),
          sector: e.textoOpcional('sector', 'el sector', 120),
          timezone: zona(e),
        });
        return json(r, 201);
      },
    },
    { metodo: 'GET', patron: new RegExp(`^negocios/${ID}$`), handler: async ({ params }) => detalle(params[0]!) },
    {
      metodo: 'PUT',
      patron: new RegExp(`^negocios/${ID}/datos$`),
      handler: async ({ req, params }) => {
        const e = await cuerpo(req);
        await guardarDatos(deps.sql, params[0]!, {
          nombre: e.texto('nombre', 'el nombre del negocio', 120),
          sector: e.textoOpcional('sector', 'el sector', 120),
          timezone: zona(e),
          direccion: e.textoOpcional('direccion', 'la dirección', 300),
          telefonoHumano: e.textoOpcional('telefonoHumano', 'el teléfono del local', 30),
          tonoDeVoz: e.textoOpcional('tonoDeVoz', 'el tono de voz', 500),
          mensajeBienvenida: e.textoOpcional('mensajeBienvenida', 'el mensaje de bienvenida', 500),
        });
        return detalle(params[0]!);
      },
    },
    {
      metodo: 'PUT',
      patron: new RegExp(`^negocios/${ID}/reglas$`),
      handler: async ({ req, params }) => {
        const e = await cuerpo(req);
        await guardarReglas(deps.sql, params[0]!, {
          antelacionMinHoras: e.entero('antelacionMinHoras', 'la antelación mínima', 0, 720),
          intervaloHuecosMin: e.entero('intervaloHuecosMin', 'cada cuánto se ofrecen horarios', 1, 240),
          margenDentroHorario: e.booleano('margenDentroHorario', 'si el margen cuenta dentro del horario'),
          asignacionProfesional: e.opcion('asignacionProfesional', 'cómo se elige profesional', ['preguntar', 'automatica'] as const),
          politicaCancelacion: e.textoOpcional('politicaCancelacion', 'la política de cancelación', 1000),
          cancelacionModo: e.opcion('cancelacionModo', 'el modo de cancelación', ['informar', 'bloquear'] as const),
          cancelacionPlazoHoras: e.entero('cancelacionPlazoHoras', 'el plazo de cancelación', 0, 720),
        });
        return detalle(params[0]!);
      },
    },
    {
      metodo: 'PUT',
      patron: new RegExp(`^negocios/${ID}/chat$`),
      handler: async ({ req, params }) => {
        const e = await cuerpo(req);
        const crudos = e.valor('dominios');
        if (!Array.isArray(crudos) || crudos.length > 20 || crudos.some((d) => typeof d !== 'string')) throw new ErrorPanel(400, 'Los dominios tienen que ser una lista (como mucho 20).');
        const dominios: string[] = [];
        for (const d of crudos as string[]) {
          if (d.trim() === '') continue;
          const n = normalizarDominio(d);
          if (!n) throw new ErrorPanel(400, `"${d}" no es un dominio (por ejemplo, www.esteticaaurora.es).`);
          if (!dominios.includes(n)) dominios.push(n);
        }
        const logo = e.textoOpcional('logo', 'el logo', 200_000);
        await guardarChat(deps.sql, params[0]!, {
          dominios,
          color: e.texto('color', 'el color', 7),
          logo,
          privacidadUrl: e.textoOpcional('privacidadUrl', 'la política de privacidad', 500),
          topeMensualUsd: e.numero('topeMensualUsd', 'el tope mensual', 0, 100_000),
        });
        return detalle(params[0]!);
      },
    },
    {
      metodo: 'POST',
      patron: new RegExp(`^negocios/${ID}/(activar|pausar)$`),
      handler: async ({ params }) => {
        await negocio(params[0]!);
        await cambiarEstado(deps.sql, params[0]!, params[1] === 'activar' ? 'activo' : 'pausado');
        return detalle(params[0]!);
      },
    },
    {
      metodo: 'POST',
      patron: new RegExp(`^negocios/${ID}/clave$`),
      handler: async ({ params }) => {
        await rotarClave(deps.sql, params[0]!);
        return detalle(params[0]!);
      },
    },

    // --- Servicios y profesionales (PI-04) ------------------------------------------
    {
      metodo: 'POST',
      patron: new RegExp(`^negocios/${ID}/servicios$`),
      handler: async ({ req, params }) => {
        await negocio(params[0]!);
        await crearServicio(deps.sql, params[0]!, servicio(await cuerpo(req)));
        return detalle(params[0]!);
      },
    },
    {
      metodo: 'PUT',
      patron: new RegExp(`^negocios/${ID}/servicios/${ID}$`),
      handler: async ({ req, params }) => {
        await guardarServicio(deps.sql, params[0]!, params[1]!, servicio(await cuerpo(req)));
        return detalle(params[0]!);
      },
    },
    {
      metodo: 'POST',
      patron: new RegExp(`^negocios/${ID}/profesionales$`),
      handler: async ({ req, params }) => {
        await negocio(params[0]!);
        await crearProfesional(deps.sql, params[0]!, profesional(await cuerpo(req)));
        return detalle(params[0]!);
      },
    },
    {
      metodo: 'PUT',
      patron: new RegExp(`^negocios/${ID}/profesionales/${ID}$`),
      handler: async ({ req, params }) => {
        await guardarProfesional(deps.sql, params[0]!, params[1]!, profesional(await cuerpo(req)));
        return detalle(params[0]!);
      },
    },

    // --- Horario (PD-01), festivos (PI-12) y preguntas (PI-08) --------------------
    {
      metodo: 'PUT',
      patron: new RegExp(`^negocios/${ID}/horario$`),
      handler: async ({ req, params }) => {
        await negocio(params[0]!);
        const e = await cuerpo(req);
        const staffId = e.uuidOpcional('staffId', 'la profesional');
        const tramos = e.lista('tramos', 'los tramos', 42, (t) => ({
          weekday: t.entero('weekday', 'el día de la semana', 0, 6),
          apertura: t.hora('apertura', 'la apertura'),
          cierre: horaDeTramo(t, 'cierre', 'el cierre'),
        }));
        await guardarHorario(deps.sql, params[0]!, staffId, tramos);
        return detalle(params[0]!);
      },
    },
    {
      metodo: 'POST',
      patron: new RegExp(`^negocios/${ID}/festivos$`),
      handler: async ({ req, params }) => {
        const n = await negocio(params[0]!);
        const e = await cuerpo(req);
        const staffId = e.uuidOpcional('staffId', 'la profesional');
        const fechaDesde = e.fecha('fechaDesde', 'el día');
        const horaDesde = e.valor('horaDesde') ? e.hora('horaDesde', 'la hora de inicio') : null;
        const horaHasta = e.valor('horaHasta') ? horaDeTramo(e, 'horaHasta', 'la hora de fin') : null;
        let desde: Date;
        let hasta: Date;
        if (horaDesde || horaHasta) {
          // PI-12: unas horas de un día.
          if (!horaDesde || !horaHasta) throw new ErrorPanel(400, 'Para unas horas, indica la hora de inicio y la de fin.');
          desde = localToUtc(fechaDesde, horaDesde, n.timezone);
          hasta = horaHasta === '24:00' ? inicioDelDia(sumarDias(fechaDesde, 1), n.timezone) : localToUtc(fechaDesde, horaHasta, n.timezone);
        } else {
          // Días enteros, de fechaDesde a fechaHasta incluidos.
          const fechaHasta = e.valor('fechaHasta') ? e.fecha('fechaHasta', 'el último día') : fechaDesde;
          if (fechaHasta < fechaDesde) throw new ErrorPanel(400, 'El último día tiene que ser igual o posterior al primero.');
          desde = inicioDelDia(fechaDesde, n.timezone);
          hasta = inicioDelDia(sumarDias(fechaHasta, 1), n.timezone);
        }
        await crearFestivo(deps.sql, params[0]!, { staffId, desde, hasta, motivo: e.textoOpcional('motivo', 'el motivo', 200) });
        return detalle(params[0]!);
      },
    },
    {
      metodo: 'DELETE',
      patron: new RegExp(`^negocios/${ID}/festivos/${ID}$`),
      handler: async ({ params }) => {
        await borrarFestivo(deps.sql, params[0]!, params[1]!);
        return detalle(params[0]!);
      },
    },
    {
      metodo: 'POST',
      patron: new RegExp(`^negocios/${ID}/preguntas$`),
      handler: async ({ req, params }) => {
        await negocio(params[0]!);
        await crearPregunta(deps.sql, params[0]!, pregunta(await cuerpo(req)));
        return detalle(params[0]!);
      },
    },
    {
      metodo: 'PUT',
      patron: new RegExp(`^negocios/${ID}/preguntas/${ID}$`),
      handler: async ({ req, params }) => {
        await guardarPregunta(deps.sql, params[0]!, params[1]!, pregunta(await cuerpo(req)));
        return detalle(params[0]!);
      },
    },
    {
      metodo: 'DELETE',
      patron: new RegExp(`^negocios/${ID}/preguntas/${ID}$`),
      handler: async ({ params }) => {
        await borrarPregunta(deps.sql, params[0]!, params[1]!);
        return detalle(params[0]!);
      },
    },

    // --- Conversaciones y derivaciones (PI-06, PI-07) ------------------------------------
    {
      metodo: 'GET',
      patron: new RegExp(`^negocios/${ID}/conversaciones$`),
      handler: async ({ params, url }) => {
        await negocio(params[0]!);
        const f = url.searchParams.get('filtro') ?? 'todas';
        if (!['todas', 'derivadas', 'pruebas'].includes(f)) throw new ErrorPanel(400, 'Filtro no válido.');
        return json(await listarConversaciones(deps.sql, params[0]!, f as FiltroConversaciones));
      },
    },
    {
      metodo: 'GET',
      patron: new RegExp(`^negocios/${ID}/conversaciones/${ID}$`),
      handler: async ({ params }) => {
        const c = await leerConversacion(deps.sql, params[0]!, params[1]!);
        if (!c) throw new ErrorPanel(404, 'Esa conversación no existe en este negocio.');
        return json(c);
      },
    },
    {
      metodo: 'GET',
      patron: new RegExp(`^negocios/${ID}/derivaciones$`),
      handler: async ({ params }) => {
        await negocio(params[0]!);
        return json(await derivacionesPendientes(deps.sql, params[0]!));
      },
    },
    {
      metodo: 'POST',
      patron: new RegExp(`^negocios/${ID}/derivaciones/${ID}/resolver$`),
      handler: async ({ params }) => {
        if (!(await resolverDerivacion(deps.sql, params[0]!, params[1]!))) throw new ErrorPanel(404, 'Esa derivación no existe en este negocio.');
        return json(await derivacionesPendientes(deps.sql, params[0]!));
      },
    },

    // --- Agenda y citas a mano (PR-04, PI-14) -------------------------------------------
    {
      metodo: 'GET',
      patron: new RegExp(`^negocios/${ID}/agenda$`),
      handler: async ({ params, url }) => {
        const n = await negocio(params[0]!);
        const fecha = url.searchParams.get('fecha') ?? utcToLocal(new Date(), n.timezone).fecha;
        const e = new Entrada({ fecha });
        return json({ fecha: e.fecha('fecha', 'el día'), citas: await agendaDelDia(deps.sql, params[0]!, fecha) });
      },
    },
    {
      metodo: 'POST',
      patron: new RegExp(`^negocios/${ID}/citas$`),
      handler: async ({ req, params }) => {
        await negocio(params[0]!);
        const e = await cuerpo(req);
        const r = await cargarCitaManual(citasDeps(), params[0]!, {
          serviceId: e.uuid('serviceId', 'el servicio'),
          staffId: e.uuid('staffId', 'la profesional'),
          fecha: e.fecha('fecha', 'el día'),
          hora: e.hora('hora', 'la hora'),
          telefono: e.texto('telefono', 'el teléfono de la clienta', 30),
          nombre: e.texto('nombre', 'el nombre de la clienta', 120),
          notas: e.textoOpcional('notas', 'las notas', 500),
        });
        return json({ id: r.cita.id, sms: r.sms?.estado ?? null }, 201);
      },
    },
    {
      metodo: 'POST',
      patron: new RegExp(`^negocios/${ID}/citas/${ID}/cancelar$`),
      handler: async ({ params }) => {
        await negocio(params[0]!);
        return json({ cancelada: await cancelarCitaManual(citasDeps(), params[0]!, params[1]!) });
      },
    },

    // --- Probar el chat (PI-13) ------------------------------------------------------------
    {
      metodo: 'POST',
      patron: new RegExp(`^negocios/${ID}/probar$`),
      handler: async ({ req, params, ctx }) => {
        const n = await businessParaProbar(deps.sql, params[0]!);
        if (!n) throw new ErrorPanel(409, 'El negocio no existe o está pausado: actívalo para probar el chat.');
        const e = await cuerpo(req);
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

  function citasDeps() {
    return { sql: deps.sql, sms: deps.sms, baseUrl: deps.baseUrl, onError };
  }

  return async (req, ctx) => {
    const url = new URL(req.url);
    const ruta = url.pathname.replace(/^\/api\/admin\/?/, '').replace(/\/+$/, '');
    try {
      if (!deps.auth) return json({ error: 'panel_no_configurado', mensaje: 'Falta configurar las cuentas del panel (SUPABASE_PROJECT_REF y SUPABASE_ANON_KEY).' }, 503);

      // --- Entrar y renovar (sin cuenta todavía) --------------------------------------
      if (ruta === 'sesion' || ruta === 'sesion/renovar') {
        if (req.method !== 'POST') return json({ error: 'metodo_no_permitido' }, 405);
        const e = await cuerpo(req);
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

// -----------------------------------------------------------------------------

function zona(e: Entrada): string {
  const tz = e.textoOpcional('timezone', 'la zona horaria', 64) ?? 'Europe/Madrid';
  if (!ZONAS.has(tz)) throw new ErrorPanel(400, `"${tz}" no es una zona horaria (por ejemplo, Europe/Madrid).`);
  return tz;
}

function servicio(e: Entrada): ServicioPanel {
  return {
    nombre: e.texto('nombre', 'el nombre del servicio', 120),
    descripcion: e.textoOpcional('descripcion', 'la descripción', 1000),
    duracionMin: e.entero('duracionMin', 'la duración', 1, 720),
    bufferMin: e.entero('bufferMin', 'el margen', 0, 240),
    precio: e.numeroOpcional('precio', 'el precio', 0, 100_000),
    precioVisible: e.booleano('precioVisible', 'si el precio se dice'),
    activo: e.booleano('activo', 'si está activo'),
  };
}

function profesional(e: Entrada): ProfesionalPanel {
  return {
    nombre: e.texto('nombre', 'el nombre de la profesional', 120),
    activo: e.booleano('activo', 'si está activa'),
    servicioIds: e.listaDeUuid('servicioIds', 'los servicios'),
  };
}

function pregunta(e: Entrada): PreguntaPanel {
  return {
    pregunta: e.texto('pregunta', 'la pregunta', 200),
    respuesta: e.texto('respuesta', 'la respuesta', 1000),
    orden: e.valor('orden') === undefined ? 0 : e.entero('orden', 'el orden', 0, 1000),
  };
}

/** PI-12: un festivo en hora del negocio, para enseñarlo sin hacer cuentas en el navegador. */
function festivoLocal(desde: Date, hasta: Date, tz: string) {
  const d = utcToLocal(desde, tz);
  const h = utcToLocal(hasta, tz);
  const diaEntero = d.hora === '00:00' && h.hora === '00:00';
  return {
    fechaDesde: d.fecha,
    horaDesde: diaEntero ? null : d.hora,
    // Un día entero termina a las 00:00 del día siguiente: se enseña el último día incluido.
    fechaHasta: diaEntero ? sumarDias(h.fecha, -1) : h.fecha,
    horaHasta: diaEntero ? null : h.hora === '00:00' ? '24:00' : h.hora,
    diaEntero,
  };
}
