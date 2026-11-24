// =============================================================================
// La base de conocimiento (Fase 5 · 5.6), con el modelo simulado: sin coste
// =============================================================================
//   · Subir (texto, PDF, foto), listar, renombrar, reemplazar y borrar por las
//     rutas de Documentos (las mismas en el panel y en el portal, PC-05).
//   · Lo que no entra: un Word renombrado, más de 4 MB, un PDF protegido, un
//     documento con datos de clientas (PB-08, y su coste se apunta igual,
//     PB-07), más de 20 documentos (PB-06).
//   · PB-04: un precio distinto se pregunta; «mi configuración» corrige el
//     documento y «el documento» cambia la configuración.
//   · PB-01: si después cambia la configuración, el documento «quedó viejo»; y
//     el agente de las clientas lee siempre el precio de la configuración.
//   · PB-09: la búsqueda encuentra por las palabras de la clienta («bótox»),
//     sin tildes, y nunca en los documentos de otro negocio.
//   · El agente solo tiene buscar_en_conocimiento si hay documentos.
//   · El chat del portal: leer_documento deja un borrador que el agente no
//     ve; guardar_documento no guarda sin el resumen confirmado (PC-03) y, al
//     guardar, el archivo sale del chat (PB-06).
//   · PC-22: el tope del chat del portal pausa el chat; Configuración sigue.
// =============================================================================

import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it, vi } from 'vitest';

import { EmailDePrueba } from '../src/adapters/email/prueba.js';
import { createApi } from '../src/api/app.js';
import { TEXTO_TOPE_PORTAL } from '../src/alta/agente.js';
import { buscarParaElAgente } from '../src/conocimiento/buscar.js';
import { partirEnTrozos } from '../src/conocimiento/trozos.js';
import { loadBusinessConfig } from '../src/config/business.js';
import { AJUSTES_DE_SERIE } from '../src/core/agent.js';
import { buildSystemPrompt } from '../src/core/prompt.js';
import { toolDefinitions } from '../src/core/tools/index.js';
import { localToUtc } from '../src/core/time.js';
import { createSql } from '../src/db/client.js';
import { buscarTrozos, crearDocumento } from '../src/db/conocimiento.js';
import { crearNegocio, crearProfesional, crearServicio, guardarHorario } from '../src/db/negocios.js';
import { abrirSesion, crearCuentaConInvitacion, crearInvitacion, invitacionPorToken } from '../src/db/portal.js';
import { hashPassword } from '../src/portal/password.js';
import { herramientas, ModeloSimulado, texto, type Guion } from './helpers/modelo-simulado.js';

vi.setConfig({ testTimeout: 120_000 });

const sql = createSql(undefined, { max: 6 });
const AHORA = localToUtc('2030-10-14', '10:00', 'Europe/Madrid');
const email = new EmailDePrueba({ silencioso: true });
const creados: string[] = [];

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type /Page>>endobj\ntrailer<<>>\n%%EOF\n');
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4a00000000049454e44ae426082', 'hex');

afterAll(async () => {
  for (const id of creados) await sql`delete from public.businesses where id = ${id}`;
  await sql.end();
});

interface Negocio {
  id: string;
  token: string;
  limpiezaId: string;
}

/** Un negocio con un servicio («Limpieza facial», 60 €, 45 min), su horario y una sesión del portal. */
async function negocio(nombre: string): Promise<Negocio> {
  const { id } = await crearNegocio(sql, { nombre: `${nombre} ${randomUUID().slice(0, 6)}`, sector: null, timezone: 'Europe/Madrid' });
  creados.push(id);
  const limpiezaId = await crearServicio(sql, id, { nombre: 'Limpieza facial', descripcion: null, duracionMin: 45, bufferMin: 0, precio: 60, precioVisible: true, activo: true });
  // Con una profesional que lo hace: si no, el servicio no llega al agente (caso 27 de la Fase 4).
  await crearProfesional(sql, id, { nombre: 'Núria', activo: true, servicioIds: [limpiezaId] });
  await guardarHorario(sql, id, null, [1, 2, 3, 4, 5].map((w) => ({ weekday: w, apertura: '09:00', cierre: '20:00' })), [], 'preguntar');
  const { token: inv } = await crearInvitacion(sql, id, `doc-${randomUUID().slice(0, 8)}@ejemplo.test`);
  const r = (await invitacionPorToken(sql, inv)) as { invitacion: Parameters<typeof crearCuentaConInvitacion>[1] };
  const cuenta = await crearCuentaConInvitacion(sql, r.invitacion, await hashPassword('una-contraseña-larga'));
  return { id, token: await abrirSesion(sql, cuenta!, AHORA), limpiezaId };
}

/** Lo que devolvería la IA al leer un documento (salida estructurada). */
function lectura(p: {
  titulo?: string;
  resumen?: string;
  secciones?: { titulo: string; texto: string; palabras: string[] }[];
  precios?: { servicio: string; etiqueta: string; euros: number; fragmento: string; texto_valor: string }[];
  personas?: string;
  sinServicio?: string[];
  legible?: boolean;
}): Guion {
  return texto(
    JSON.stringify({
      legible: p.legible ?? true,
      titulo: p.titulo ?? 'Carta de tratamientos',
      resumen: p.resumen ?? 'Precios y descripción de los tratamientos faciales',
      paginas: 1,
      paginas_ilegibles: [],
      datos_de_personas: { hay: Boolean(p.personas), que: p.personas ?? '' },
      secciones: p.secciones ?? [
        { titulo: 'Faciales', texto: 'Limpieza facial profunda: 60 €', palabras: ['limpieza de cutis'] },
        {
          titulo: 'Toxina botulínica',
          texto: 'La toxina botulínica relaja los músculos de la expresión. Después: no tumbarse en 4 horas y no hacer deporte ese día.',
          palabras: ['bótox', 'botox', 'arrugas', 'patas de gallo'],
        },
      ],
      precios: p.precios ?? [],
      duraciones: [],
      horarios: [],
      direccion: [],
      telefono: [],
      tratamientos_sin_servicio: p.sinServicio ?? ['Toxina botulínica'],
    }),
  );
}

function api(modelo: ModeloSimulado) {
  const h = createApi({ sql, model: modelo, settings: AJUSTES_DE_SERIE, email, baseUrl: 'http://api.test', now: () => AHORA });
  return async (metodo: string, camino: string, token: string, body?: Buffer | unknown, nombre?: string) => {
    const binario = Buffer.isBuffer(body);
    const res = await h(
      new Request(`http://api.test/api/portal/${camino}`, {
        method: metodo,
        headers: {
          authorization: `Bearer ${token}`,
          ...(binario ? { 'content-type': 'application/octet-stream', 'x-nombre': encodeURIComponent(nombre ?? 'archivo') } : body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: binario ? new Uint8Array(body as Buffer) : JSON.stringify(body) } : {}),
      }),
      { ip: '127.0.0.1' },
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const respuesta: any = await res.json().catch(() => ({}));
    return { status: res.status, body: respuesta };
  };
}

describe('Documentos (Fase 5)', () => {
  it('partir en trozos: el título va en cada trozo y una lista de precios no se corta a la mitad', () => {
    const lineas = Array.from({ length: 60 }, (_, i) => `Tratamiento número ${i + 1} con su descripción corta: ${30 + i} €`);
    const trozos = partirEnTrozos('Carta 2026', [{ titulo: 'Precios', texto: lineas.join('\n'), palabras: ['precios'] }]);
    expect(trozos.length).toBeGreaterThan(1);
    for (const t of trozos) {
      expect(t.titulos).toBe('Carta 2026 · Precios');
      expect(t.contenido.length).toBeLessThanOrEqual(1500);
      for (const l of t.contenido.split('\n')) expect(lineas).toContain(l);
    }
  });

  it('subir un texto: queda en la lista, el agente lo encuentra por «bótox» y tiene la herramienta solo desde entonces', async () => {
    const n = await negocio('Texto');
    const antes = await loadBusinessConfig(sql, { id: n.id });
    expect(toolDefinitions(antes).map((t) => t.name)).not.toContain('buscar_en_conocimiento');
    expect(buildSystemPrompt(antes)).not.toContain('# Documentos del negocio');

    const modelo = new ModeloSimulado([lectura({})]);
    const p = api(modelo);
    const r = await p('POST', 'negocio/documentos', n.token, { texto: 'La toxina botulínica relaja…', titulo: 'Tratamientos' });
    expect(r.status).toBe(201);
    expect(r.body.documentos).toHaveLength(1);
    expect(r.body.documentos[0]).toMatchObject({ titulo: 'Tratamientos', origen: 'portal', tipo: 'texto', sinServicio: ['Toxina botulínica'] });
    expect(r.body.usados).toEqual({ documentos: 1, paginas: 1 });

    const despues = await loadBusinessConfig(sql, { id: n.id });
    expect(toolDefinitions(despues).map((t) => t.name)).toContain('buscar_en_conocimiento');
    expect(buildSystemPrompt(despues)).toContain('- Tratamientos: Precios y descripción de los tratamientos faciales');

    // PB-09: la clienta escribe «botox» (sin tilde) o «patas de gallo».
    for (const q of ['botox', 'qué es el bótox', 'patas de gallo', 'cuidados despues de la toxina']) {
      const res = await buscarParaElAgente(sql, despues, q);
      expect(res.trozos.map((t) => t.seccion), q).toContain('Toxina botulínica');
    }
    expect((await buscarParaElAgente(sql, despues, 'depilación láser')).trozos).toHaveLength(0);

    // PB-07: lo que costó leerlo, aparte y fuera de los topes.
    const [u] = await sql<{ n: number }[]>`select count(*)::int as n from public.usage_events where business_id = ${n.id} and concepto = 'preparar_documento'`;
    expect(u!.n).toBe(1);
  });

  it('lo que no entra: un Word renombrado, más de 4 MB, un PDF protegido, datos de clientas', async () => {
    const n = await negocio('Rechazos');
    const modelo = new ModeloSimulado([lectura({ personas: 'una lista de clientas con teléfonos' })]);
    const p = api(modelo);
    const word = await p('POST', 'negocio/documentos', n.token, Buffer.from('PK\x03\x04 un docx'), 'carta.pdf');
    expect(word.status).toBe(415);
    expect(word.body.mensaje).toContain('Solo se pueden subir PDF y fotos');
    expect((await p('POST', 'negocio/documentos', n.token, Buffer.concat([PDF, Buffer.alloc(4 * 1024 * 1024)]), 'enorme.pdf')).status).toBe(413);
    const protegido = await p('POST', 'negocio/documentos', n.token, Buffer.from('%PDF-1.4\n/Encrypt 5 0 R\n%%EOF'), 'cerrado.pdf');
    expect(protegido.body.mensaje).toContain('protegido con contraseña');
    expect(modelo.peticiones).toHaveLength(0); // nada de eso llegó a la IA

    const personas = await p('POST', 'negocio/documentos', n.token, PNG, 'lista.png');
    expect(personas.status).toBe(422);
    expect(personas.body.mensaje).toContain('tiene datos de clientas');
    expect((await p('GET', 'negocio/documentos', n.token)).body.documentos).toHaveLength(0);
    const [u] = await sql<{ n: number }[]>`select count(*)::int as n from public.usage_events where business_id = ${n.id} and concepto = 'preparar_documento'`;
    expect(u!.n).toBe(1); // PB-07: se gastó en leerlo aunque no se guarde
  });

  it('PB-04: un precio distinto se pregunta; «mi configuración» corrige el documento', async () => {
    const n = await negocio('Precio');
    const p = api(new ModeloSimulado([lectura({ precios: [{ servicio: 'Limpieza facial', etiqueta: 'Limpieza facial profunda', euros: 55, fragmento: 'Limpieza facial profunda: 55 €', texto_valor: '55 €' }], secciones: [{ titulo: 'Faciales', texto: 'Limpieza facial profunda: 55 €', palabras: ['limpieza de cutis'] }] })]));
    const r = await p('POST', 'negocio/documentos', n.token, PDF, 'carta.pdf');
    expect(r.status).toBe(201);
    const doc = r.body.documentos[0];
    expect(doc.preguntas).toEqual([{ valorId: expect.any(String), que: 'el precio de Limpieza facial', documento: '55 €', configuracion: '60 €' }]);

    // Mientras no contesta, el agente ya lee el de la configuración (PB-01).
    const config = await loadBusinessConfig(sql, { id: n.id });
    expect((await buscarParaElAgente(sql, config, 'limpieza facial')).trozos[0]!.texto).toContain('60 €');

    const ok = await p('POST', `negocio/documentos/${doc.id}/valores/${doc.preguntas[0].valorId}`, n.token, { usar: 'configuracion' });
    expect(ok.status).toBe(200);
    expect(ok.body.documentos[0].preguntas).toEqual([]);
    const [texto1] = await sql<{ contenido_raw: string }[]>`select contenido_raw from public.knowledge_docs where id = ${doc.id}`;
    expect(texto1!.contenido_raw).toContain('Limpieza facial profunda: 60 €');
    expect(texto1!.contenido_raw).not.toContain('55 €');
  });

  it('PB-04: «el documento» cambia la configuración; PB-01: si después cambia, el documento quedó viejo', async () => {
    const n = await negocio('Viejo');
    const p = api(new ModeloSimulado([lectura({ precios: [{ servicio: 'Limpieza facial', etiqueta: 'Limpieza facial', euros: 65, fragmento: 'Limpieza facial: 65 €', texto_valor: '65 €' }], secciones: [{ titulo: 'Faciales', texto: 'Limpieza facial: 65 €', palabras: [] }] })]));
    const doc = (await p('POST', 'negocio/documentos', n.token, PDF, 'carta.pdf')).body.documentos[0];
    const r = await p('POST', `negocio/documentos/${doc.id}/valores/${doc.preguntas[0].valorId}`, n.token, { usar: 'documento' });
    expect(r.status).toBe(200);
    const [s] = await sql<{ precio: string }[]>`select precio from public.services where id = ${n.limpiezaId}`;
    expect(Number(s!.precio)).toBe(65);
    expect(r.body.documentos[0]).toMatchObject({ preguntas: [], viejos: [] });

    // El negocio sube el precio en Configuración: el documento queda viejo.
    const ficha = (await p('GET', 'negocio', n.token)).body;
    const servicio = ficha.servicios.find((x: { id: string }) => x.id === n.limpiezaId);
    expect((await p('PUT', `negocio/servicios/${n.limpiezaId}`, n.token, { ...servicio, precio: 70, version: ficha.versiones.servicios[n.limpiezaId] })).status).toBe(200);
    const lista = (await p('GET', 'negocio/documentos', n.token)).body;
    expect(lista.documentos[0].viejos).toEqual([{ valorId: doc.preguntas[0].valorId, que: 'el precio de Limpieza facial', documento: '65 €', configuracion: '70 €' }]);
    // «Lo del documento» ya no vale para un documento viejo: se corrige o se reemplaza.
    expect((await p('POST', `negocio/documentos/${doc.id}/valores/${doc.preguntas[0].valorId}`, n.token, { usar: 'documento' })).status).toBe(409);
    const corregido = await p('POST', `negocio/documentos/${doc.id}/valores/${doc.preguntas[0].valorId}`, n.token, { usar: 'configuracion' });
    expect(corregido.body.documentos[0].viejos).toEqual([]);
  });

  it('renombrar, reemplazar y borrar; otro negocio no lo ve, no lo toca y no lo encuentra', async () => {
    const mio = await negocio('Mío');
    const ajeno = await negocio('Ajeno');
    const p = api(new ModeloSimulado([lectura({}), lectura({ titulo: 'Carta nueva', secciones: [{ titulo: 'Corporales', texto: 'Presoterapia: drenaje de piernas', palabras: ['piernas cansadas'] }], sinServicio: [] })]));
    const doc = (await p('POST', 'negocio/documentos', mio.token, PDF, 'carta.pdf')).body.documentos[0];

    // Otro negocio: 404 en todo y la búsqueda no encuentra nada.
    expect((await p('GET', 'negocio/documentos', ajeno.token)).body.documentos).toEqual([]);
    expect((await p('PUT', `negocio/documentos/${doc.id}`, ajeno.token, { titulo: 'Robado' })).status).toBe(404);
    expect((await p('DELETE', `negocio/documentos/${doc.id}`, ajeno.token)).status).toBe(404);
    expect(await buscarTrozos(sql, ajeno.id, 'botox')).toEqual([]);
    const configAjena = await loadBusinessConfig(sql, { id: ajeno.id });
    expect(toolDefinitions(configAjena).map((t) => t.name)).not.toContain('buscar_en_conocimiento');

    expect((await p('PUT', `negocio/documentos/${doc.id}`, mio.token, { titulo: 'Carta 2026' })).body.documentos[0].titulo).toBe('Carta 2026');
    // Reemplazar: lo viejo deja de existir al momento; el título que puso el negocio se queda.
    const r = await p('POST', `negocio/documentos/${doc.id}/reemplazar`, mio.token, PDF, 'carta-v2.pdf');
    expect(r.body.documentos[0]).toMatchObject({ id: doc.id, titulo: 'Carta 2026', reemplazado: expect.any(String) });
    expect(await buscarTrozos(sql, mio.id, 'botox')).toEqual([]);
    expect((await buscarTrozos(sql, mio.id, 'piernas cansadas')).length).toBe(1);
    // Borrar: el agente deja de saberlo al momento.
    expect((await p('DELETE', `negocio/documentos/${doc.id}`, mio.token)).body.documentos).toEqual([]);
    expect(await buscarTrozos(sql, mio.id, 'piernas')).toEqual([]);
  });

  it('PB-06: con 20 documentos no se gasta en leer otro', async () => {
    const n = await negocio('Lleno');
    for (let i = 0; i < 20; i++) {
      await crearDocumento(sql, n.id, {
        tipo: 'texto', titulo: `Doc ${i}`, resumen: '', origen: 'panel', estado: 'activo', paginas: 1, bytes: null, nombreArchivo: null,
        paginasIlegibles: [], sinServicio: [], contenido: 'Texto', trozos: [], valores: [],
      });
    }
    const modelo = new ModeloSimulado([]);
    const r = await api(modelo)('POST', 'negocio/documentos', n.token, { texto: 'Uno más' });
    expect(r.status).toBe(409);
    expect(r.body.mensaje).toContain('Ya tienes 20 documentos');
    expect(modelo.peticiones).toHaveLength(0);
  });

  it('el chat del portal: leer deja un borrador; guardar pide el resumen confirmado y saca el archivo del chat', async () => {
    const n = await negocio('Chat');
    let docId = '';
    const docIdDe = (params: { messages: unknown }) => {
      const m = /documento_id\\*":\\*"([0-9a-f-]{36})/.exec(JSON.stringify(params.messages));
      docId = m?.[1] ?? docId;
      return docId;
    };
    const modelo = new ModeloSimulado([
      // Turno 1: lee, enseña el resumen e intenta guardar sin esperar el sí.
      herramientas({ name: 'leer_documento', input: { archivo: 'carta.pdf', texto: null, titulo: null } }),
      lectura({}), // la lectura del documento (el lector usa el mismo cliente)
      (params) => herramientas({ name: 'proponer_resumen', input: { seccion: 'documento', titulo: 'Tu documento', lineas: [{ etiqueta: 'Título', valor: 'Carta de tratamientos' }] } }, { name: 'guardar_documento', input: { documento_id: docIdDe(params), titulo: null } }),
      texto('Este es el resumen de tu carta. ¿Está todo bien?'),
      // Turno 2: con su sí, guarda.
      (params) => herramientas({ name: 'guardar_documento', input: { documento_id: docIdDe(params), titulo: null } }),
      texto('Hecho: ya lo tienes en Documentos.'),
      texto('De nada.'),
    ]);
    const p = api(modelo);
    const a = (await p('POST', 'adjuntos', n.token, PDF, 'carta.pdf')).body as { id: string };
    const r1 = await p('POST', 'chat', n.token, { texto: 'Esta es mi carta, que el agente la sepa', adjuntos: [a.id], clientMessageId: randomUUID() });
    expect(r1.status).toBe(200);
    // Antes de confirmar: borrador, invisible para el agente y para la lista.
    const [b] = await sql<{ estado: string; origen: string }[]>`select estado, origen from public.knowledge_docs where id = ${docId}`;
    expect(b).toEqual({ estado: 'borrador', origen: 'chat' });
    expect((await loadBusinessConfig(sql, { id: n.id })).documentos).toEqual([]);
    expect(await buscarTrozos(sql, n.id, 'botox')).toEqual([]);
    const resultados = JSON.stringify(modelo.peticiones[3]!.messages);
    expect(resultados).toContain('falta_confirmacion');

    await p('POST', 'chat', n.token, { texto: 'Sí, perfecto', chatId: r1.body.chat.id, clientMessageId: randomUUID() });
    const [d] = await sql<{ estado: string }[]>`select estado from public.knowledge_docs where id = ${docId}`;
    expect(d!.estado).toBe('activo');
    expect((await buscarTrozos(sql, n.id, 'botox')).length).toBeGreaterThan(0);
    // PB-06: el archivo sale de la conversación.
    const [adj] = await sql<{ bytes_ahora: number; documento_titulo: string }[]>`select octet_length(datos) as bytes_ahora, documento_titulo from portal.adjuntos where id = ${a.id}`;
    expect(adj).toEqual({ bytes_ahora: 0, documento_titulo: 'Carta de tratamientos' });
    // En el mensaje siguiente del chat, la IA ya no recibe el PDF.
    await p('POST', 'chat', n.token, { texto: 'Gracias', chatId: r1.body.chat.id, clientMessageId: randomUUID() });
    expect(JSON.stringify(modelo.peticiones.at(-1)!.messages)).toContain('ya está guardado en Documentos como «Carta de tratamientos»');
    expect(JSON.stringify(modelo.peticiones.at(-1)!.messages)).not.toContain(PDF.toString('base64'));
    expect((await p('GET', `adjuntos/${a.id}`, n.token)).status).toBe(410);
  });

  it('PC-22: llegado el tope del chat del portal, el chat se pausa y Configuración sigue', async () => {
    const n = await negocio('Tope');
    await sql`update public.businesses set tope_portal_usd = 0.01 where id = ${n.id}`;
    const modelo = new ModeloSimulado([texto('Hola, ¿en qué te ayudo?')]);
    const p = api(modelo);
    const r1 = await p('POST', 'chat', n.token, { texto: 'Hola', clientMessageId: randomUUID() });
    expect(r1.body.respuesta).toBe('Hola, ¿en qué te ayudo?');
    // Simula el gasto del mes en el chat del portal.
    await sql`update public.usage_events set coste_estimado = 1 where business_id = ${n.id}`;
    const r2 = await p('POST', 'chat', n.token, { texto: 'Cambia el precio de la limpieza', chatId: r1.body.chat.id, clientMessageId: randomUUID() });
    expect(r2.body).toMatchObject({ respuesta: TEXTO_TOPE_PORTAL, aviso: 'tope_portal' });
    expect(modelo.peticiones).toHaveLength(1); // no se llamó a la IA
    // Configuración a mano sigue.
    const ficha = (await p('GET', 'negocio', n.token)).body;
    expect(ficha.chat.topePortalUsd).toBeUndefined(); // el cliente no lo ve (PC-09)
    const servicio = ficha.servicios[0];
    expect((await p('PUT', `negocio/servicios/${servicio.id}`, n.token, { ...servicio, precio: 62, version: ficha.versiones.servicios[servicio.id] })).status).toBe(200);
  });
});
