// =============================================================================
// Adjuntos del chat del portal (Fase 9b · PC-21), con el modelo simulado
// =============================================================================
//   · El tipo se mira en los bytes: un «.jpg» que no es una imagen no entra.
//   · Hasta 4 MB; vacío no.
//   · Con un mensaje, el modelo recibe la imagen (o el PDF) de verdad, y la
//     sigue viendo en el mensaje siguiente del mismo chat («cárgalos»).
//   · En el historial guardado va una marca, no los bytes.
//   · Solo con archivos, sin texto, también se puede mandar.
//   · Otro negocio no puede ni ver ni mandar un adjunto que no es suyo.
//   · El chat enseña los archivos de cada mensaje.
// =============================================================================

import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it, vi } from 'vitest';

import { EmailDePrueba } from '../src/adapters/email/prueba.js';
import { createApi } from '../src/api/app.js';
import { AJUSTES_DE_SERIE } from '../src/core/agent.js';
import { localToUtc } from '../src/core/time.js';
import { tipoPorContenido } from '../src/db/adjuntos.js';
import { createSql } from '../src/db/client.js';
import { crearNegocio } from '../src/db/negocios.js';
import { abrirSesion, crearCuentaConInvitacion, crearInvitacion, invitacionPorToken } from '../src/db/portal.js';
import { hashPassword } from '../src/portal/password.js';
import { ModeloSimulado, texto } from './helpers/modelo-simulado.js';

vi.setConfig({ testTimeout: 120_000 });

const sql = createSql(undefined, { max: 6 });
const AHORA = localToUtc('2030-10-14', '10:00', 'Europe/Madrid');
const email = new EmailDePrueba({ silencioso: true });
const creados: string[] = [];

// Un PNG de 1×1 y un PDF mínimo: lo que cuenta son sus primeros bytes.
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4a00000000049454e44ae426082', 'hex');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

afterAll(async () => {
  for (const id of creados) await sql`delete from public.businesses where id = ${id}`;
  await sql.end();
});

async function negocioConSesion(nombre: string): Promise<{ id: string; token: string }> {
  const { id } = await crearNegocio(sql, { nombre: `${nombre} ${randomUUID().slice(0, 6)}`, sector: null, timezone: 'Europe/Madrid' });
  creados.push(id);
  const { token: inv } = await crearInvitacion(sql, id, `adj-${randomUUID().slice(0, 8)}@ejemplo.test`);
  const r = (await invitacionPorToken(sql, inv)) as { invitacion: Parameters<typeof crearCuentaConInvitacion>[1] };
  const cuenta = await crearCuentaConInvitacion(sql, r.invitacion, await hashPassword('una-contraseña-larga'));
  return { id, token: await abrirSesion(sql, cuenta!, AHORA) };
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
    const tipo = res.headers.get('content-type') ?? '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const respuesta: any = tipo.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, body: respuesta, tipo };
  };
}

describe('adjuntos del chat del portal (PC-21)', () => {
  it('el tipo se mira en los bytes', () => {
    expect(tipoPorContenido(PNG)).toBe('image/png');
    expect(tipoPorContenido(PDF)).toBe('application/pdf');
    expect(tipoPorContenido(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(tipoPorContenido(Buffer.from('MZ\x90\x00 no soy una imagen'))).toBeNull();
    expect(tipoPorContenido(Buffer.from('PK\x03\x04 un docx'))).toBeNull();
  });

  it('subir: imágenes y PDF sí; otra cosa, vacío o más de 4 MB, no', async () => {
    const { token } = await negocioConSesion('Subir');
    const p = api(new ModeloSimulado([]));
    const ok = await p('POST', 'adjuntos', token, PNG, 'horario local.png');
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ nombre: 'horario local.png', tipo: 'image/png', bytes: PNG.length });
    expect((await p('POST', 'adjuntos', token, PDF, 'carta.pdf')).status).toBe(201);
    const exe = await p('POST', 'adjuntos', token, Buffer.from('MZ\x90\x00 ejecutable'), 'foto.jpg');
    expect(exe.status).toBe(415);
    expect(exe.body.mensaje).toContain('Solo se pueden adjuntar imágenes');
    expect((await p('POST', 'adjuntos', token, Buffer.alloc(0), 'vacio.png')).status).toBe(400);
    const grande = Buffer.concat([PDF, Buffer.alloc(4 * 1024 * 1024)]);
    expect((await p('POST', 'adjuntos', token, grande, 'enorme.pdf')).status).toBe(413);
    // Sin sesión, nada.
    expect((await p('POST', 'adjuntos', 'inventado', PNG, 'x.png')).status).toBe(401);
  });

  it('el modelo recibe la imagen con el mensaje y la sigue viendo en el siguiente; el historial guarda solo la marca', async () => {
    const { id, token } = await negocioConSesion('Modelo');
    const modelo = new ModeloSimulado([texto('He reconocido el horario del local. ¿Qué quieres que haga?'), texto('Te propongo este horario…')]);
    const p = api(modelo);
    const a = (await p('POST', 'adjuntos', token, PNG, 'horario.png')).body as { id: string };
    // Solo con el archivo, sin texto.
    const r1 = await p('POST', 'chat', token, { texto: '', adjuntos: [a.id], clientMessageId: randomUUID() });
    expect(r1.status).toBe(200);
    expect(r1.body.respuesta).toContain('He reconocido');
    const primera = JSON.stringify(modelo.peticiones[0]!.messages);
    expect(primera).toContain('"type":"image"');
    expect(primera).toContain(PNG.toString('base64'));
    expect(primera).toContain('Archivo adjunto: «horario.png»');
    // «Cárgalos»: el modelo vuelve a tener la imagen delante.
    await p('POST', 'chat', token, { texto: 'Cárgalo, por favor', chatId: r1.body.chat.id, clientMessageId: randomUUID() });
    expect(JSON.stringify(modelo.peticiones[1]!.messages)).toContain(PNG.toString('base64'));
    // En la base, la marca; los bytes no se duplican en el historial.
    const [m] = await sql<{ tc: string }[]>`select tool_calls::text as tc from public.messages where business_id = ${id} and rol = 'user' order by created_at limit 1`;
    expect(m!.tc).toContain(`⟦adjunto:${a.id}|image/png|horario.png⟧`);
    expect(m!.tc).not.toContain(PNG.toString('base64'));
    // El chat enseña el archivo con su mensaje, y se puede ver.
    const chat = await p('GET', `chats/${r1.body.chat.id}`, token);
    expect(chat.body.mensajes[0]).toMatchObject({ rol: 'cliente', texto: '', adjuntos: [{ id: a.id, nombre: 'horario.png', tipo: 'image/png' }] });
    const ver = await p('GET', `adjuntos/${a.id}`, token);
    expect(ver.status).toBe(200);
    expect(ver.tipo).toBe('image/png');
    expect(Buffer.compare(ver.body as Buffer, PNG)).toBe(0);
  });

  it('un PDF llega al modelo como documento', async () => {
    const { token } = await negocioConSesion('PDF');
    const modelo = new ModeloSimulado([texto('He leído tu carta de precios.')]);
    const p = api(modelo);
    const a = (await p('POST', 'adjuntos', token, PDF, 'carta.pdf')).body as { id: string };
    await p('POST', 'chat', token, { texto: 'Aquí tienes mis precios', adjuntos: [a.id], clientMessageId: randomUUID() });
    const enviado = JSON.stringify(modelo.peticiones[0]!.messages);
    expect(enviado).toContain('"type":"document"');
    expect(enviado).toContain('"title":"carta.pdf"');
  });

  it('otro negocio no ve ni manda un adjunto que no es suyo; uno ya mandado no se reutiliza; más de 5, no', async () => {
    const mio = await negocioConSesion('Mío');
    const ajeno = await negocioConSesion('Ajeno');
    const p = api(new ModeloSimulado([texto('Vale.')]));
    const a = (await p('POST', 'adjuntos', mio.token, PNG, 'mio.png')).body as { id: string };
    expect((await p('GET', `adjuntos/${a.id}`, ajeno.token)).status).toBe(404);
    const robo = await p('POST', 'chat', ajeno.token, { texto: 'Mira esto', adjuntos: [a.id], clientMessageId: randomUUID() });
    expect(robo.status).toBe(400);
    const [sigue] = await sql<{ conversation_id: string | null }[]>`select conversation_id from portal.adjuntos where id = ${a.id}`;
    expect(sigue!.conversation_id).toBeNull();
    // El dueño sí lo manda; después ya no se puede volver a mandar.
    expect((await p('POST', 'chat', mio.token, { texto: 'Mira', adjuntos: [a.id], clientMessageId: randomUUID() })).status).toBe(200);
    expect((await p('POST', 'chat', mio.token, { texto: 'Otra vez', adjuntos: [a.id], clientMessageId: randomUUID() })).status).toBe(400);
    const seis = Array.from({ length: 6 }, () => randomUUID());
    expect((await p('POST', 'chat', mio.token, { texto: 'Muchos', adjuntos: seis, clientMessageId: randomUUID() })).status).toBe(400);
    // Ni texto ni archivos: no.
    expect((await p('POST', 'chat', mio.token, { texto: '', clientMessageId: randomUUID() })).status).toBe(400);
  });
});
