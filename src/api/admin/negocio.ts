// =============================================================================
// Las rutas de LA CONFIGURACIÓN de un negocio (Fase 4 · 4.2, Fase 9 · 9.4)
// =============================================================================
// Un solo sitio para los datos (PC-05). Estas rutas son exactamente las
// mismas en los dos sitios que editan un negocio:
//
//   · el panel interno de Mariana, bajo /api/admin/negocios/:id/… (el negocio
//     sale de la URL, PI-01);
//   · el portal del cliente, bajo /api/portal/negocio/… (el negocio sale de
//     SU SESIÓN, nunca de la URL ni del chat, PC-02/PC-11).
//
// Por eso viven aquí y no en rutas.ts: así una regla nueva (una validación,
// PI-21, PI-22) vale a la vez en el panel, en el portal y en el chat del
// alta, que llama a las mismas funciones de db/negocios.
//
// Lo único que cambia entre los dos es `ver`:
//   · PC-09: el cliente no ve ni cambia su tope mensual. Con ver = 'portal'
//     la ficha no lo trae y, al guardar el chat de su web, se conserva el que
//     puso Mariana.
//   · PC-22 (Fase 5): lo mismo con el tope del chat del portal.
// Fase 5: las rutas de Documentos (subir, listar, renombrar, reemplazar,
// borrar y «¿cuál es el correcto?») también están aquí, para los dos, y
// llaman al único camino de src/conocimiento/documentos.ts.
// Lo que NO está aquí (activar, pausar, cambiar la clave, probar el chat, el
// visor, las derivaciones, el consumo y las invitaciones) es del panel y se
// queda en rutas.ts.
// =============================================================================

import { cancelarCitaManual, cargarCitaManual, agendaDelRango } from '../../citas/manual.js';
import { inicioDelDia, localToUtc, sumarDias, utcToLocal } from '../../core/time.js';
import {
  borrarFestivo,
  borrarPregunta,
  borrarTurnoSuelto,
  crearFestivo,
  crearPregunta,
  crearProfesional,
  crearServicio,
  crearTurnoSuelto,
  guardarChat,
  guardarDatos,
  guardarHorario,
  guardarPregunta,
  guardarProfesional,
  guardarReglas,
  guardarServicio,
  leerNegocio,
  type NegocioPanel,
  type PreguntaPanel,
  type ProfesionalPanel,
  type QueHacerConCitas,
  type ServicioPanel,
  type TurnoSueltoPanel,
} from '../../db/negocios.js';
import {
  documentosDeLaFicha,
  ErrorDocumento,
  LIMITES_DOCUMENTOS,
  resolverValor,
  subirDocumento,
  TEXTOS,
  type DocumentosDeps,
  type Subida,
} from '../../conocimiento/documentos.js';
import { limpiarNombre } from '../../db/adjuntos.js';
import { borrarDocumento, renombrarDocumento } from '../../db/conocimiento.js';
import { json, leerJson } from '../http.js';
import { Entrada, horaDeTramo, normalizarDominio } from './entrada.js';
import { aErrorPanel, ErrorPanel, TEXTO_LO_QUE_FALTA } from './errores.js';
import { comprobarVersion, versiones } from './versiones.js';
import type { AdminDeps } from './rutas.js';

/** El logo viaja en el cuerpo (hasta 200.000 caracteres): el panel admite más que el widget. */
export const MAX_CUERPO_PANEL = 512 * 1024;

export const ZONAS = new Set(Intl.supportedValuesOf('timeZone'));

/** Quién está editando: cambia qué se ve, no qué se valida. */
export type VistaNegocio = 'panel' | 'portal';

export interface RutaNegocio {
  metodo: string;
  /** Relativa al negocio: '' es la ficha, 'datos', 'servicios/:id'… */
  patron: RegExp;
  handler: (p: { req: Request; businessId: string; params: string[]; url: URL }) => Promise<Response>;
}

const ID = '([0-9a-fA-F-]{36})';

export async function cuerpoDeNegocio(req: Request): Promise<Entrada> {
  return new Entrada(await leerJson(req, MAX_CUERPO_PANEL));
}

/** El negocio de la URL o de la sesión tiene que existir (404 si no). */
export async function leerNegocioO404(deps: AdminDeps, id: string): Promise<NegocioPanel> {
  const n = await leerNegocio(deps.sql, id);
  if (!n) throw new ErrorPanel(404, 'Ese negocio no existe.');
  return n;
}

/**
 * La ficha entera del negocio, igual para el panel y para el portal salvo el
 * tope (PC-09). Es lo que devuelve cualquier guardado, para que las dos
 * pantallas se queden con lo último sin pedirlo otra vez.
 */
export async function detalleNegocio(deps: AdminDeps, id: string, ver: VistaNegocio): Promise<Response> {
  const n = await leerNegocioO404(deps, id);
  // PC-09 / PC-22: el cliente no ve ninguno de sus dos topes.
  const { topeMensualUsd, topePortalUsd, ...chatSinTope } = n.chat;
  return json({
    ...n,
    chat: ver === 'panel' ? n.chat : chatSinTope,
    festivos: n.festivos.map((f) => ({ ...f, ...festivoLocal(f.desde, f.hasta, n.timezone) })),
    loQueFalta: n.loQueFalta.map((codigo) => ({ codigo, texto: TEXTO_LO_QUE_FALTA[codigo] })),
    widgetJs: `${deps.baseUrl.replace(/\/+$/, '')}/widget.js`,
    // PI-22: la huella de cada sección, para que la segunda que guarde no pise a la primera.
    versiones: versiones(n),
  });
}

/**
 * Las rutas de configuración, relativas al negocio. El llamador decide de
 * dónde sale el `businessId` (la URL en el panel, la sesión en el portal) y
 * las monta donde le toque.
 */
export function rutasDeNegocio(deps: AdminDeps, ver: VistaNegocio): RutaNegocio[] {
  const onError = deps.onError ?? (() => {});
  const detalle = (id: string) => detalleNegocio(deps, id, ver);

  /** PI-22: la versión de ahora de una sección (404 si el negocio no existe). */
  const versionDe = async (id: string, seccion: (v: ReturnType<typeof versiones>) => string | undefined) =>
    seccion(versiones(await leerNegocioO404(deps, id)));

  function citasDeps() {
    return { sql: deps.sql, email: deps.email, baseUrl: deps.baseUrl, onError };
  }

  /** PI-21: lo que se decidió con las citas afectadas (de serie, preguntar). */
  function queHacerConCitas(e: Entrada): QueHacerConCitas {
    return e.valor('citas') === undefined ? 'preguntar' : e.opcion('citas', 'qué hacer con las citas', ['preguntar', 'dejar', 'cancelar'] as const);
  }

  /** Fase 5: la lista de Documentos, con sus avisos (PB-04, PB-01) y lo que ocupa (PB-06). */
  async function documentosDe(businessId: string, extra: Record<string, unknown> = {}, status = 200): Promise<Response> {
    const n = await leerNegocioO404(deps, businessId);
    return json({ ...(await documentosDeLaFicha(deps.sql, businessId, n)), ...extra }, status);
  }

  /** PI-21: se cancelan una a una, como desde la agenda: cada clienta con email recibe su aviso. */
  async function cancelarAfectadas(businessId: string, ids: string[]): Promise<void> {
    for (const citaId of ids) await cancelarCitaManual(citasDeps(), businessId, citaId);
  }

  return [
    { metodo: 'GET', patron: /^$/, handler: async ({ businessId }) => detalle(businessId) },

    {
      metodo: 'PUT',
      patron: /^datos$/,
      handler: async ({ req, businessId }) => {
        const e = await cuerpoDeNegocio(req);
        comprobarVersion(e, await versionDe(businessId, (v) => v.datos));
        await guardarDatos(deps.sql, businessId, {
          nombre: e.texto('nombre', 'el nombre del negocio', 120),
          sector: e.textoOpcional('sector', 'el sector', 120),
          timezone: zona(e),
          direccion: e.textoOpcional('direccion', 'la dirección', 300),
          telefonoHumano: e.telefonoOpcional('telefonoHumano', 'teléfono del local'),
          tonoDeVoz: e.textoOpcional('tonoDeVoz', 'el tono de voz', 500),
          mensajeBienvenida: e.textoOpcional('mensajeBienvenida', 'el mensaje de bienvenida', 500),
        });
        return detalle(businessId);
      },
    },

    {
      metodo: 'PUT',
      patron: /^reglas$/,
      handler: async ({ req, businessId }) => {
        const e = await cuerpoDeNegocio(req);
        comprobarVersion(e, await versionDe(businessId, (v) => v.reglas));
        await guardarReglas(deps.sql, businessId, {
          antelacionMinHoras: e.entero('antelacionMinHoras', 'la antelación mínima', 0, 720),
          intervaloHuecosMin: e.entero('intervaloHuecosMin', 'cada cuánto se ofrecen horarios', 1, 240),
          margenDentroHorario: e.booleano('margenDentroHorario', 'si el margen cuenta dentro del horario'),
          asignacionProfesional: e.opcion('asignacionProfesional', 'cómo se elige profesional', ['preguntar', 'automatica'] as const),
          politicaCancelacion: e.textoOpcional('politicaCancelacion', 'la política de cancelación', 1000),
          cancelacionModo: e.opcion('cancelacionModo', 'el modo de cancelación', ['informar', 'bloquear'] as const),
          cancelacionPlazoHoras: e.entero('cancelacionPlazoHoras', 'el plazo de cancelación', 0, 720),
        });
        return detalle(businessId);
      },
    },

    {
      metodo: 'PUT',
      patron: /^chat$/,
      handler: async ({ req, businessId }) => {
        const n = await leerNegocioO404(deps, businessId);
        const e = await cuerpoDeNegocio(req);
        comprobarVersion(e, versiones(n).chat);
        const crudos = e.valor('dominios');
        if (!Array.isArray(crudos) || crudos.length > 20 || crudos.some((d) => typeof d !== 'string')) throw new ErrorPanel(400, 'Los dominios tienen que ser una lista (como mucho 20).');
        const dominios: string[] = [];
        for (const d of crudos as string[]) {
          if (d.trim() === '') continue;
          const nd = normalizarDominio(d);
          if (!nd) throw new ErrorPanel(400, `"${d}" no es un dominio (por ejemplo, www.esteticaaurora.es).`);
          if (!dominios.includes(nd)) dominios.push(nd);
        }
        await guardarChat(deps.sql, businessId, {
          dominios,
          color: e.texto('color', 'el color', 7),
          logo: e.textoOpcional('logo', 'el logo', 200_000),
          privacidadUrl: e.textoOpcional('privacidadUrl', 'la política de privacidad', 500),
          // PC-09: el cliente no ve ni cambia su tope; se conserva el de Mariana.
          topeMensualUsd: ver === 'panel' ? e.numero('topeMensualUsd', 'el tope mensual', 0, 100_000) : n.chat.topeMensualUsd,
          // PC-22: el del chat del portal, igual (si el panel no lo manda, se queda el que había).
          topePortalUsd:
            ver === 'panel' && e.valor('topePortalUsd') !== undefined ? e.numero('topePortalUsd', 'el tope del chat del portal', 0, 100_000) : n.chat.topePortalUsd,
        });
        return detalle(businessId);
      },
    },

    // --- Servicios y profesionales (PI-04) ------------------------------------------
    {
      metodo: 'POST',
      patron: /^servicios$/,
      handler: async ({ req, businessId }) => {
        await leerNegocioO404(deps, businessId);
        await crearServicio(deps.sql, businessId, servicio(await cuerpoDeNegocio(req)));
        return detalle(businessId);
      },
    },
    {
      metodo: 'PUT',
      patron: new RegExp(`^servicios/${ID}$`),
      handler: async ({ req, businessId, params }) => {
        const e = await cuerpoDeNegocio(req);
        comprobarVersion(e, await versionDe(businessId, (v) => v.servicios[params[0]!]));
        await guardarServicio(deps.sql, businessId, params[0]!, servicio(e));
        return detalle(businessId);
      },
    },
    {
      metodo: 'POST',
      patron: /^profesionales$/,
      handler: async ({ req, businessId }) => {
        await leerNegocioO404(deps, businessId);
        await crearProfesional(deps.sql, businessId, profesional(await cuerpoDeNegocio(req)));
        return detalle(businessId);
      },
    },
    {
      metodo: 'PUT',
      patron: new RegExp(`^profesionales/${ID}$`),
      handler: async ({ req, businessId, params }) => {
        const e = await cuerpoDeNegocio(req);
        comprobarVersion(e, await versionDe(businessId, (v) => v.profesionales[params[0]!]));
        await guardarProfesional(deps.sql, businessId, params[0]!, profesional(e));
        return detalle(businessId);
      },
    },

    // --- Horario (PD-01), festivos (PI-12) y turnos sueltos (PC-06) ----------------
    {
      metodo: 'PUT',
      patron: /^horario$/,
      handler: async ({ req, businessId }) => {
        await leerNegocioO404(deps, businessId);
        const e = await cuerpoDeNegocio(req);
        const staffId = e.uuidOpcional('staffId', 'la profesional');
        comprobarVersion(e, await versionDe(businessId, (v) => v.horario[staffId ?? 'local']));
        const tramos = e.lista('tramos', 'los tramos', 42, (t) => ({
          weekday: t.entero('weekday', 'el día de la semana', 0, 6),
          apertura: t.hora('apertura', 'la apertura'),
          cierre: horaDeTramo(t, 'cierre', 'el cierre'),
        }));
        // PI-19: los días que la profesional no trabaja (solo en un horario propio).
        const crudos = e.valor('diasLibres') ?? [];
        if (!Array.isArray(crudos) || crudos.some((w) => !Number.isInteger(w) || (w as number) < 0 || (w as number) > 6)) {
          throw new ErrorPanel(400, 'Los días que no trabaja tienen que ser días de la semana (0 = domingo … 6 = sábado).');
        }
        const diasLibres = [...new Set(crudos as number[])].sort();
        if (staffId === null && diasLibres.length > 0) throw new ErrorPanel(400, 'El local no tiene días "no trabaja": un día sin tramos es un día cerrado.');
        const choca = diasLibres.find((w) => tramos.some((t) => t.weekday === w));
        if (choca !== undefined) {
          throw new ErrorPanel(400, `El ${['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][choca]} no puede tener horas propias y "no trabaja" a la vez.`);
        }
        const cancelar = await guardarHorario(deps.sql, businessId, staffId, tramos, diasLibres, queHacerConCitas(e));
        await cancelarAfectadas(businessId, cancelar);
        return detalle(businessId);
      },
    },
    {
      metodo: 'POST',
      patron: /^festivos$/,
      handler: async ({ req, businessId }) => {
        const n = await leerNegocioO404(deps, businessId);
        const e = await cuerpoDeNegocio(req);
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
        const { cancelar } = await crearFestivo(deps.sql, businessId, { staffId, desde, hasta, motivo: e.textoOpcional('motivo', 'el motivo', 200) }, queHacerConCitas(e));
        await cancelarAfectadas(businessId, cancelar);
        return detalle(businessId);
      },
    },
    {
      metodo: 'DELETE',
      patron: new RegExp(`^festivos/${ID}$`),
      handler: async ({ businessId, params }) => {
        await borrarFestivo(deps.sql, businessId, params[0]!);
        return detalle(businessId);
      },
    },
    {
      metodo: 'POST',
      patron: /^turnos-sueltos$/,
      handler: async ({ req, businessId }) => {
        await leerNegocioO404(deps, businessId);
        const e = await cuerpoDeNegocio(req);
        await crearTurnoSuelto(deps.sql, businessId, turnoSuelto(e));
        return detalle(businessId);
      },
    },
    {
      metodo: 'DELETE',
      patron: new RegExp(`^turnos-sueltos/${ID}$`),
      handler: async ({ businessId, params }) => {
        await borrarTurnoSuelto(deps.sql, businessId, params[0]!);
        return detalle(businessId);
      },
    },

    // --- Preguntas frecuentes (PI-08) --------------------------------------------
    {
      metodo: 'POST',
      patron: /^preguntas$/,
      handler: async ({ req, businessId }) => {
        await leerNegocioO404(deps, businessId);
        await crearPregunta(deps.sql, businessId, pregunta(await cuerpoDeNegocio(req)));
        return detalle(businessId);
      },
    },
    {
      metodo: 'PUT',
      patron: new RegExp(`^preguntas/${ID}$`),
      handler: async ({ req, businessId, params }) => {
        const e = await cuerpoDeNegocio(req);
        comprobarVersion(e, await versionDe(businessId, (v) => v.preguntas[params[0]!]));
        await guardarPregunta(deps.sql, businessId, params[0]!, pregunta(e));
        return detalle(businessId);
      },
    },
    {
      metodo: 'DELETE',
      patron: new RegExp(`^preguntas/${ID}$`),
      handler: async ({ businessId, params }) => {
        await borrarPregunta(deps.sql, businessId, params[0]!);
        return detalle(businessId);
      },
    },

    // --- Documentos: lo que sabe el negocio (Fase 5 · 5.4, PB-02 a PB-08) ------------
    // Todas devuelven la lista entera, con los avisos ya comparados con la
    // configuración de ahora (D-98). Subir y reemplazar aceptan un archivo en
    // binario (como los adjuntos de PC-21, con el nombre en x-nombre) o un
    // texto escrito en JSON ({ texto, titulo }).
    { metodo: 'GET', patron: /^documentos$/, handler: async ({ businessId }) => documentosDe(businessId) },
    {
      metodo: 'POST',
      patron: /^documentos$/,
      handler: async ({ req, businessId }) => {
        await leerNegocioO404(deps, businessId);
        const r = await subirDocumento(depsDocumentos(deps), businessId, await subidaDe(req), { origen: ver });
        return documentosDe(businessId, { subido: r.id }, 201);
      },
    },
    {
      metodo: 'PUT',
      patron: new RegExp(`^documentos/${ID}$`),
      handler: async ({ req, businessId, params }) => {
        const e = await cuerpoDeNegocio(req);
        if (!(await renombrarDocumento(deps.sql, businessId, params[0]!, e.texto('titulo', 'el título', 200)))) throw new ErrorPanel(404, 'Ese documento no existe.');
        return documentosDe(businessId);
      },
    },
    {
      metodo: 'DELETE',
      patron: new RegExp(`^documentos/${ID}$`),
      handler: async ({ businessId, params }) => {
        if (!(await borrarDocumento(deps.sql, businessId, params[0]!))) throw new ErrorPanel(404, 'Ese documento no existe.');
        return documentosDe(businessId);
      },
    },
    {
      metodo: 'POST',
      patron: new RegExp(`^documentos/${ID}/reemplazar$`),
      handler: async ({ req, businessId, params }) => {
        await leerNegocioO404(deps, businessId);
        const r = await subirDocumento(depsDocumentos(deps), businessId, await subidaDe(req), { origen: ver, reemplaza: params[0]! });
        return documentosDe(businessId, { subido: r.id });
      },
    },
    {
      // PB-04 / PB-01: «¿cuál es el correcto?». usar = configuracion (el
      // documento se corrige) o documento (la configuración cambia, con las
      // validaciones de siempre; un horario con citas afectadas pregunta, PI-21).
      metodo: 'POST',
      patron: new RegExp(`^documentos/${ID}/valores/${ID}$`),
      handler: async ({ req, businessId, params }) => {
        const e = await cuerpoDeNegocio(req);
        const usar = e.opcion('usar', 'qué valor vale', ['configuracion', 'documento'] as const);
        const r = await resolverValor(deps.sql, businessId, { docId: params[0]!, valorId: params[1]!, usar, citas: queHacerConCitas(e) });
        await cancelarAfectadas(businessId, r.cancelar);
        return documentosDe(businessId);
      },
    },

    // --- La agenda y las citas a mano (PR-04, PI-14, PC-16) -----------------------
    {
      metodo: 'GET',
      patron: /^agenda$/,
      handler: async ({ businessId, url }) => {
        const n = await leerNegocioO404(deps, businessId);
        const fecha = url.searchParams.get('fecha') ?? utcToLocal(new Date(), n.timezone).fecha;
        const e = new Entrada({ fecha });
        const desde = e.fecha('fecha', 'el día');
        const crudoDias = url.searchParams.get('dias');
        if (crudoDias !== null && !/^(1|7)$/.test(crudoDias)) throw new ErrorPanel(400, 'La agenda se pide de 1 o de 7 días.');
        const dias = Number(crudoDias ?? 1);
        return json({ ...(await agendaDelRango(deps.sql, businessId, desde, dias)), hoy: utcToLocal(new Date(), n.timezone).fecha, timezone: n.timezone });
      },
    },
    {
      metodo: 'POST',
      patron: /^citas$/,
      handler: async ({ req, businessId }) => {
        await leerNegocioO404(deps, businessId);
        const e = await cuerpoDeNegocio(req);
        const r = await cargarCitaManual(citasDeps(), businessId, {
          serviceId: e.uuid('serviceId', 'el servicio'),
          staffId: e.uuid('staffId', 'la profesional'),
          fecha: e.fecha('fecha', 'el día'),
          hora: e.hora('hora', 'la hora'),
          telefono: e.texto('telefono', 'el teléfono de la clienta', 30),
          nombre: e.texto('nombre', 'el nombre de la clienta', 120),
          email: e.textoOpcional('email', 'el email de la clienta', 254),
          notas: e.textoOpcional('notas', 'las notas', 500),
        });
        return json({ id: r.cita.id, email: r.email?.estado ?? null }, 201);
      },
    },
    {
      metodo: 'POST',
      patron: new RegExp(`^citas/${ID}/cancelar$`),
      handler: async ({ businessId, params }) => {
        await leerNegocioO404(deps, businessId);
        return json({ cancelada: await cancelarCitaManual(citasDeps(), businessId, params[0]!) });
      },
    },
  ];
}

/**
 * Busca la ruta que casa con `sub` (la parte de detrás del negocio) y la
 * ejecuta. Devuelve null si ninguna ruta casa con esa dirección: el llamador
 * decide si eso es un 404 suyo o sigue buscando entre las suyas.
 */
export async function despacharRutaDeNegocio(
  rutas: RutaNegocio[],
  sub: string,
  p: { req: Request; businessId: string; url: URL },
): Promise<Response | null> {
  const coinciden = rutas.filter((r) => r.patron.test(sub));
  if (coinciden.length === 0) return null;
  const r = coinciden.find((x) => x.metodo === p.req.method);
  if (!r) return json({ error: 'metodo_no_permitido' }, 405);
  const params = (r.patron.exec(sub) ?? []).slice(1).map((x) => x.toLowerCase());
  return r.handler({ ...p, params });
}

// -----------------------------------------------------------------------------
// Lectura de los bloques del cuerpo (lo mismo en el panel y en el portal)
// -----------------------------------------------------------------------------

export function zona(e: Entrada): string {
  const tz = e.textoOpcional('timezone', 'la zona horaria', 64) ?? 'Europe/Madrid';
  if (!ZONAS.has(tz)) throw new ErrorPanel(400, `"${tz}" no es una zona horaria (por ejemplo, Europe/Madrid).`);
  return tz;
}

export function servicio(e: Entrada): ServicioPanel {
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

export function profesional(e: Entrada): ProfesionalPanel {
  return {
    nombre: e.texto('nombre', 'el nombre de la profesional', 120),
    activo: e.booleano('activo', 'si está activa'),
    servicioIds: e.listaDeUuid('servicioIds', 'los servicios'),
  };
}

export function pregunta(e: Entrada): PreguntaPanel {
  return {
    pregunta: e.texto('pregunta', 'la pregunta', 200),
    respuesta: e.texto('respuesta', 'la respuesta', 1000),
    orden: e.valor('orden') === undefined ? 0 : e.entero('orden', 'el orden', 0, 1000),
  };
}

/** PC-06: un turno suelto tal como lo manda el portal o el panel. */
export function turnoSuelto(e: Entrada): TurnoSueltoPanel {
  const apertura = e.hora('apertura', 'la hora de entrada');
  const cierre = horaDeTramo(e, 'cierre', 'la hora de salida');
  if (cierre <= apertura) throw new ErrorPanel(400, 'La hora de salida tiene que ser posterior a la de entrada.');
  return {
    staffId: e.uuid('staffId', 'la profesional'),
    fecha: e.fecha('fecha', 'el día'),
    apertura,
    cierre,
    motivo: e.textoOpcional('motivo', 'el motivo', 200),
  };
}

/** PI-12: un festivo en hora del negocio, para enseñarlo sin hacer cuentas en el navegador. */
export function festivoLocal(desde: Date, hasta: Date, tz: string) {
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

/**
 * Fase 5: quién lee los documentos. De serie, el mismo cliente y modelo del
 * chat; el servidor puede pasar uno propio con más tiempo de espera
 * (`lector`, CONOCIMIENTO_MODEL).
 */
export function depsDocumentos(deps: AdminDeps): DocumentosDeps {
  return {
    sql: deps.sql,
    model: deps.lector?.model ?? deps.model,
    modelo: deps.lector?.modelo ?? deps.settings.model,
    ...(deps.onError ? { onError: deps.onError } : {}),
  };
}

/**
 * Lo que llega para subir un documento: un archivo en binario (PDF o foto,
 * con el nombre en la cabecera x-nombre, como los adjuntos de PC-21) o un
 * texto escrito en JSON ({ texto, titulo }).
 */
export async function subidaDe(req: Request): Promise<Subida> {
  const tipo = req.headers.get('content-type') ?? '';
  if (tipo.includes('application/json')) {
    const e = new Entrada(await leerJson(req, LIMITES_DOCUMENTOS.caracteresTexto * 4 + 4096));
    return { texto: e.texto('texto', 'el texto', LIMITES_DOCUMENTOS.caracteresTexto), titulo: e.textoOpcional('titulo', 'el título', 200) ?? null };
  }
  const declarado = Number(req.headers.get('content-length'));
  if (Number.isFinite(declarado) && declarado > LIMITES_DOCUMENTOS.bytes) throw new ErrorDocumento('demasiado_grande', TEXTOS.demasiado_grande, 413);
  const archivo = Buffer.from(await req.arrayBuffer());
  let nombre = 'documento';
  try {
    nombre = limpiarNombre(decodeURIComponent(req.headers.get('x-nombre') ?? 'documento'));
  } catch {
    nombre = 'documento';
  }
  return { archivo, nombre };
}

/** Lo que el panel y el portal responden cuando algo no se pudo guardar. */
export function respuestaDeError(e: unknown, onError: (e: unknown) => void): Response | null {
  const p = aErrorPanel(e);
  if (!p) {
    onError(e);
    return null;
  }
  return json({ error: 'no_valido', mensaje: p.message, ...p.extra }, p.status);
}
