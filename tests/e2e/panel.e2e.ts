// El panel interno en el navegador (Fase 4 · 4.8) — npm run test:e2e
//
// Lo que haría Mariana: entrar, dar de alta un negocio mínimo solo con el
// panel (servicio, profesional, horario copiado a los días laborables, un
// horario propio fuera del local con su aviso de PI-18, teléfono, dominio y un
// logo grande que el panel reduce solo, PI-10), activarlo, abrir la web de prueba con su
// widget y reservar (modelo SIMULADO, sin coste), y verlo en el visor y en la
// agenda, donde además se carga una cita a mano a una hora fuera de la rejilla.
//
// Cuentas con el proveedor falso (sin Supabase Auth). El negocio y la persona
// del panel se borran al terminar.

import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SmsDePrueba } from '../../src/adapters/sms/prueba.js';
import { AJUSTES_DE_SERIE } from '../../src/core/agent.js';
import { localToUtc } from '../../src/core/time.js';
import { createSql } from '../../src/db/client.js';
import { guardarPersonaPanel } from '../../src/db/personas.js';
import { construirPanel } from '../../src/dev/panel-build.js';
import { iniciarServidores } from '../../src/dev/server.js';
import { AuthFalsa } from '../helpers/auth-falsa.js';
import { telefonoDeTest } from '../helpers/fixtures.js';
import { herramientas, ModeloSimulado, texto } from '../helpers/modelo-simulado.js';

const sql = createSql(undefined, { max: 6 });
const AHORA = localToUtc('2030-10-14', '10:00', 'Europe/Madrid');
const EMAIL = `e2e-panel-${Date.now()}@example.test`;
const PASSWORD = 'contraseña-del-e2e';
const NOMBRE = `Peluquería E2E ${Date.now() % 100000}`;
const telefono = telefonoDeTest();
const auth = new AuthFalsa();
const sms = new SmsDePrueba({ silencioso: true });
const ESPERA = { timeout: 30_000 };
/** Capturas para revisar el aspecto a mano (no se comparan). */
const CAPTURAS = process.env.PANEL_CAPTURAS ?? join(tmpdir(), 'recepcionista-panel-e2e');

const modelo = new ModeloSimulado([
  texto('El martes 15 tengo a las 10:00 con Nora. ¿Te la reservo? Dime tu nombre y tu teléfono.'),
  herramientas({ name: 'identificar_cliente', input: { telefono, nombre: 'Clienta Panel' } }),
  herramientas({ name: 'crear_reserva', input: { servicio: 'Corte', fecha: '2030-10-15', hora: '10:00', profesional: 'Nora' } }),
  texto('¡Hecho! Tienes cita el martes 15 de octubre a las 10:00 con Nora.'),
]);

let servidores: Awaited<ReturnType<typeof iniciarServidores>>;
let navegador: Browser;
let panel: Page;
let userId: string;
let negocioId: string | null = null;
const puerto = 3800 + Math.floor(Math.random() * 50);

/** Un PNG de ruido (no se comprime): pesa bastante más de 150 KB. */
function pngGrande(lado = 360): Buffer {
  const trozo = (tipo: string, datos: Buffer) => {
    const t = Buffer.concat([Buffer.from(tipo), datos]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(datos.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(t));
    return Buffer.concat([len, t, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lado, 0);
  ihdr.writeUInt32BE(lado, 4);
  ihdr[8] = 8; // bits
  ihdr[9] = 2; // RGB
  const filas = Buffer.alloc(lado * (lado * 3 + 1));
  for (let i = 0; i < filas.length; i++) filas[i] = i % (lado * 3 + 1) === 0 ? 0 : Math.floor(Math.random() * 256);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), trozo('IHDR', ihdr), trozo('IDAT', deflateSync(filas)), trozo('IEND', Buffer.alloc(0))]);
}

beforeAll(async () => {
  mkdirSync(CAPTURAS, { recursive: true });
  await construirPanel();
  userId = auth.crearUsuario(EMAIL, PASSWORD);
  await guardarPersonaPanel(sql, userId, EMAIL);
  servidores = await iniciarServidores({
    sql,
    model: modelo,
    settings: { ...AJUSTES_DE_SERIE, limits: { maxVueltas: 4, maxTokensConversacion: 1_000_000 } },
    sms,
    apiPort: puerto,
    demoPort: puerto + 100,
    // Panel en 4100–4149: fuera de 4045, que Chrome bloquea (ERR_UNSAFE_PORT), y
    // de los 4310–4312 de `npm run dev`.
    panelPort: puerto + 300,
    auth,
    now: () => AHORA,
  });
  navegador = await chromium.launch({ channel: 'chrome', headless: true });
  panel = await (await navegador.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
}, 120_000);

afterAll(async () => {
  await navegador?.close();
  await servidores?.cerrar();
  if (negocioId) await sql`delete from public.businesses where id = ${negocioId}`;
  await sql`delete from panel.personas where user_id = ${userId}`;
  await sql.end();
});

const seccion = (id: string) => panel.locator(`#${id}`);
const filaNueva = (id: string) => seccion(id).locator('.space-y-3 > div').last();

describe('el panel en el navegador', () => {
  it('sin cuenta solo se ve "Entrar"; con una contraseña mala no entra', async () => {
    await panel.goto(`${servidores.panelUrl}/`);
    await expect.poll(() => panel.getByRole('button', { name: 'Entrar' }).isVisible(), ESPERA).toBe(true);
    await panel.getByLabel('Email').fill(EMAIL);
    await panel.getByLabel('Contraseña').fill('mala');
    await panel.getByRole('button', { name: 'Entrar' }).click();
    await expect.poll(() => panel.getByRole('alert').textContent(), ESPERA).toContain('Email o contraseña incorrectos');
  });

  it('entra y da de alta un negocio mínimo solo con el panel', async () => {
    await panel.getByLabel('Contraseña').fill(PASSWORD);
    await panel.getByRole('button', { name: 'Entrar' }).click();
    await panel.getByLabel('Dar de alta un negocio').fill(NOMBRE);
    await panel.getByRole('button', { name: 'Crear' }).click();
    await expect.poll(() => panel.locator('h1').textContent(), ESPERA).toBe(NOMBRE);
    negocioId = /negocios\/([0-9a-f-]{36})/.exec(panel.url())![1]!;
    expect(await seccion('publicar').getByRole('group', { name: 'Falta para activar' }).textContent()).toContain('Un servicio activo');

    await seccion('datos').getByLabel('Teléfono del local').fill('+34910000777');
    await seccion('datos').getByRole('button', { name: 'Guardar' }).click();
    await expect.poll(() => seccion('datos').getByRole('status').textContent(), ESPERA).toBe('Guardado.');

    await filaNueva('servicios').getByLabel('Nombre').fill('Corte');
    await filaNueva('servicios').getByRole('button', { name: 'Añadir' }).click();
    await expect.poll(() => seccion('servicios').locator('.space-y-3 > div').count(), ESPERA).toBe(2);

    await filaNueva('profesionales').getByLabel('Nombre').fill('Nora');
    await filaNueva('profesionales').getByLabel('Corte').check();
    await filaNueva('profesionales').getByRole('button', { name: 'Añadir' }).click();
    await expect.poll(() => seccion('profesionales').locator('.space-y-3 > div').count(), ESPERA).toBe(2);

    // Horario del local: un tramo el martes y "Copiar a…" los días laborables.
    const local = panel.getByRole('group', { name: 'Horario del local' });
    await local.locator('div.flex', { hasText: 'Martes' }).first().getByRole('button', { name: '+ tramo' }).click();
    await local.locator('div.flex', { hasText: 'Martes' }).first().getByRole('button', { name: 'Copiar a…' }).click();
    await local.getByRole('group', { name: 'Copiar el martes a otros días' }).getByRole('button', { name: 'Días laborables' }).click();
    await local.screenshot({ path: join(CAPTURAS, '0-copiar-horario.png') });
    await local.getByRole('group', { name: 'Copiar el martes a otros días' }).getByRole('button', { name: 'Copiar', exact: true }).click();
    await local.getByRole('button', { name: 'Guardar horario' }).click();
    await expect.poll(() => local.getByRole('status').textContent(), ESPERA).toBe('Guardado.');
    const tramosLocal = await sql<{ weekday: number }[]>`
      select weekday from public.business_hours where business_id = ${negocioId} and staff_id is null order by weekday`;
    expect(tramosLocal.map((t) => t.weekday)).toEqual([1, 2, 3, 4, 5]);

    // PI-18: un horario propio el sábado (el local cierra) avisa antes de guardar.
    const propio = panel.getByRole('group', { name: 'Horario propio de Nora' });
    await propio.locator('div.flex', { hasText: 'Sábado' }).first().getByRole('button', { name: '+ tramo' }).click();
    await propio.getByLabel('Sábado, apertura').fill('15:00');
    await propio.getByLabel('Sábado, cierre').fill('20:00');
    // Visible en pantalla antes de guardar, no solo en la confirmación.
    await expect.poll(() => propio.getByRole('note', { name: 'Aviso de horario' }).textContent(), ESPERA).toContain('Fuera del horario del local: sábado 15:00–20:00.');
    const avisos: string[] = [];
    panel.once('dialog', (d) => {
      avisos.push(d.message());
      void d.dismiss();
    });
    await propio.getByRole('button', { name: 'Guardar horario' }).click();
    await expect.poll(() => avisos.length, ESPERA).toBe(1);
    expect(avisos[0]).toBe('Nora trabajaría fuera del horario del local: sábado 15:00–20:00. ¿Guardar igual?');
    const sinGuardar = await sql`select 1 from public.business_hours where business_id = ${negocioId} and staff_id is not null`;
    expect(sinGuardar).toHaveLength(0);
    panel.once('dialog', (d) => void d.accept());
    await propio.getByRole('button', { name: 'Guardar horario' }).click();
    await expect.poll(() => propio.getByRole('status').textContent(), ESPERA).toBe('Guardado.');
    const [sabado] = await sql<{ apertura: string; cierre: string }[]>`
      select to_char(hora_apertura, 'HH24:MI') as apertura, to_char(hora_cierre, 'HH24:MI') as cierre
        from public.business_hours where business_id = ${negocioId} and staff_id is not null and weekday = 6`;
    expect(sabado).toEqual({ apertura: '15:00', cierre: '20:00' });
    // Y sigue visible con lo ya guardado (al volver a la ficha más tarde).
    expect(await propio.getByRole('note', { name: 'Aviso de horario' }).isVisible()).toBe(true);
    await propio.screenshot({ path: join(CAPTURAS, '1-aviso-pi18.png') });
    // Y arriba, en "Publicar", junto a lo que falta: para revisar, sin impedir activar.
    const revisar = panel.getByRole('group', { name: 'Para revisar' });
    await expect.poll(() => revisar.textContent(), ESPERA).toContain('Nora trabaja fuera del horario del local: sábado 15:00–20:00');
    await panel.locator('#publicar').screenshot({ path: join(CAPTURAS, '1-publicar.png') });

    await seccion('chat').getByLabel('Dominios donde aparece (uno por línea)').fill('localhost');
    const png = join(CAPTURAS, 'logo-grande.png');
    writeFileSync(png, pngGrande());
    await seccion('chat').locator('input[type=file]').setInputFiles(png);
    await expect.poll(() => seccion('chat').textContent(), ESPERA).toContain('se ha reducido a 256 × 256');
    await seccion('chat').getByRole('button', { name: 'Guardar' }).click();
    await expect.poll(() => seccion('chat').getByRole('status').textContent(), ESPERA).toBe('Guardado.');

    const [b] = await sql<{ logo: string | null }[]>`select widget_logo as logo from public.businesses where id = ${negocioId}`;
    expect(b!.logo).toMatch(/^data:image\/(png|webp);base64,/);
    expect(b!.logo!.length).toBeLessThanOrEqual(200_000);
    await panel.screenshot({ path: join(CAPTURAS, '1-ficha.png'), fullPage: true });
  });

  it('con lo mínimo completo se activa y da el código del widget', async () => {
    await expect.poll(() => seccion('publicar').textContent(), ESPERA).toContain('Tiene lo mínimo para atender');
    await seccion('publicar').getByRole('button', { name: 'Activar' }).click();
    await expect.poll(() => seccion('publicar').getByRole('status').textContent(), ESPERA).toBe('Negocio activado.');
    const [b] = await sql<{ estado: string; key: string }[]>`select estado, widget_key as key from public.businesses where id = ${negocioId}`;
    expect(b!.estado).toBe('activo');
    expect(await seccion('publicar').locator('pre').textContent()).toBe(`<script src="${servidores.apiUrl}/widget.js" data-key="${b!.key}" async></script>`);
  });

  it('su widget en la web de prueba reserva una cita de verdad', async () => {
    const [b] = await sql<{ key: string }[]>`select widget_key as key from public.businesses where id = ${negocioId}`;
    const web = await (await navegador.newContext()).newPage();
    await web.goto(`${servidores.demoUrl}/prueba.html?key=${b!.key}`);
    const w = (sel: string) => web.locator(`[data-recepcionista-widget] ${sel}`);
    await w('.boton').click();
    expect(await w('.cabecera h2').textContent()).toBe(NOMBRE);
    expect(await w('.cabecera .logo img').getAttribute('src')).toMatch(/^data:image\//);
    await w('textarea').fill('Quiero un corte el martes 15');
    await w('textarea').press('Enter');
    await expect.poll(() => w('.m.asistente').count(), ESPERA).toBe(1);
    await w('textarea').fill(`Sí, Clienta Panel, ${telefono}`);
    await w('textarea').press('Enter');
    await expect.poll(() => w('.m.asistente').count(), ESPERA).toBe(2);
    await web.screenshot({ path: join(CAPTURAS, '2-widget.png') });
    const citas = await sql`select estado from public.appointments where business_id = ${negocioId}`;
    expect(citas).toEqual([{ estado: 'confirmada' }]);
  });

  it('la conversación se ve en el visor con sus herramientas', async () => {
    await panel.goto(`${servidores.panelUrl}/panel/#/negocios/${negocioId}/conversaciones`);
    await expect.poll(() => panel.locator('tbody tr').count(), ESPERA).toBe(1);
    await panel.locator('tbody tr').first().click();
    await expect.poll(() => panel.getByText('🔧 crear_reserva').isVisible(), ESPERA).toBe(true);
    await panel.getByText('🔧 crear_reserva').click();
    expect(await panel.locator('details[open]').textContent()).toContain('2030-10-15');
    await panel.screenshot({ path: join(CAPTURAS, '3-conversacion.png'), fullPage: true });
  });

  it('la agenda muestra la cita y carga otra a mano a las 12:15 (fuera de la rejilla)', async () => {
    await panel.goto(`${servidores.panelUrl}/panel/#/negocios/${negocioId}/agenda`);
    await panel.locator('input[type=date]').fill('2030-10-15');
    await expect.poll(() => panel.getByText('10:00–11:00').isVisible(), ESPERA).toBe(true);
    await panel.getByLabel(/^Hora/).fill('12:15');
    await panel.getByLabel('Teléfono de la clienta').fill(telefonoDeTest());
    await panel.getByLabel('Nombre').fill('Clienta en el local');
    await panel.getByRole('button', { name: 'Cargar cita' }).click();
    await expect.poll(() => panel.getByText('12:15–13:15').isVisible(), ESPERA).toBe(true);
    await panel.screenshot({ path: join(CAPTURAS, '4-agenda.png'), fullPage: true });
    const [c] = await sql<{ origen: string }[]>`
      select origen from public.appointments where business_id = ${negocioId} and start_at = ${localToUtc('2030-10-15', '12:15', 'Europe/Madrid')}`;
    expect(c!.origen).toBe('manual');
  });

  it('el consumo lo cuenta', async () => {
    await panel.goto(`${servidores.panelUrl}/panel/#/consumo`);
    await expect.poll(() => panel.getByRole('row', { name: new RegExp(NOMBRE) }).isVisible(), ESPERA).toBe(true);
    await panel.screenshot({ path: join(CAPTURAS, '5-consumo.png'), fullPage: true });
  });
});
