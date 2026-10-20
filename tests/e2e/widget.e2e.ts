// Prueba de punta a punta con el navegador (Fase 3 · 3.7) — npm run test:e2e
//
// Levanta los dos servidores de la demo (src/dev/server.ts) con el modelo
// SIMULADO (sin coste) y abre la web de Estética Aurora en Google Chrome sin
// ventana (playwright-core con el Chrome instalado: no descarga navegadores).
// Comprueba lo que haría Mariana a mano: escribir, reservar, ver el SMS de
// prueba, abrir su enlace y cancelar; recargar y seguir la conversación;
// abrir otro navegador y no verla; y que en un dominio no permitido el widget
// no aparece.
//
// Escribe en Aurora con una clienta de test (+34999…) en 2030, y lo borra al
// terminar (D-37).

import { randomUUID } from 'node:crypto';

import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SmsDePrueba } from '../../src/adapters/sms/prueba.js';
import { AJUSTES_DE_SERIE } from '../../src/core/agent.js';
import { localToUtc } from '../../src/core/time.js';
import { createSql } from '../../src/db/client.js';
import { sha256 } from '../../src/db/widget.js';
import { iniciarServidores } from '../../src/dev/server.js';
import { AURORA, deleteTestCustomers, telefonoDeTest } from '../helpers/fixtures.js';
import { herramientas, ModeloSimulado, texto } from '../helpers/modelo-simulado.js';

const sql = createSql(undefined, { max: 6 });
const AHORA = localToUtc('2030-10-14', '10:00', 'Europe/Madrid');
const CLAVE_ALMACEN = 'recepcionista:wk_demo_estetica_aurora_0001:sesion';
const telefono = telefonoDeTest();

const modelo = new ModeloSimulado([
  texto('¡Hola! Para el martes 15 a las 10:00 tengo a Marta. ¿Te la reservo? Dime tu nombre y tu teléfono.'),
  herramientas({ name: 'identificar_cliente', input: { telefono, nombre: 'Clienta E2E' } }),
  herramientas({ name: 'crear_reserva', input: { servicio: 'Limpieza facial profunda', fecha: '2030-10-15', hora: '10:00', profesional: 'Marta' } }),
  texto('¡Hecho! Tienes cita el martes 15 de octubre a las 10:00 con Marta.'),
]);
const sms = new SmsDePrueba({ silencioso: true });
const tokens: string[] = [];
const PRIMER_MENSAJE = 'Quiero una limpieza facial el martes 15 a las 10';
let inicio: Date;

let servidores: Awaited<ReturnType<typeof iniciarServidores>>;
let navegador: Browser;
const puertoApi = 3900 + Math.floor(Math.random() * 50);
/** Contra la nube cada mensaje hace varias consultas a Frankfurt: se espera con margen. */
const ESPERA = { timeout: 30_000 };

beforeAll(async () => {
  const [r] = await sql<{ inicio: Date }[]>`select now() as inicio`;
  inicio = r!.inicio;
  await deleteTestCustomers(sql, AURORA.businessId);
  servidores = await iniciarServidores({
    sql,
    model: modelo,
    settings: { ...AJUSTES_DE_SERIE, limits: { maxVueltas: 4, maxTokensConversacion: 1_000_000 } },
    sms,
    apiPort: puertoApi,
    demoPort: puertoApi + 100,
    now: () => AHORA,
  });
  try {
    navegador = await chromium.launch({ channel: 'chrome', headless: true });
  } catch (e) {
    throw new Error(`Hace falta Google Chrome instalado para la prueba con el navegador: ${(e as Error).message}`);
  }
});

afterAll(async () => {
  await navegador?.close();
  await servidores?.cerrar();
  if (tokens.length) {
    // Primero su consumo: al borrar la conversación quedaría suelto y contaría
    // en el informe de Aurora.
    await sql`
      delete from public.usage_events u using public.conversations c
       where c.id = u.conversation_id and c.session_token_hash = any(${tokens.map(sha256)})`;
    await sql`delete from public.conversations where session_token_hash = any(${tokens.map(sha256)})`;
  }
  // Y las que se empezaron sin llegar a guardar el token (si un paso falló).
  const sueltas = sql`
    select conversation_id from public.messages
     where business_id = ${AURORA.businessId} and contenido = ${PRIMER_MENSAJE} and created_at >= ${inicio}`;
  await sql`delete from public.usage_events where conversation_id in (${sueltas})`;
  await sql`delete from public.conversations where id in (${sueltas})`;
  await deleteTestCustomers(sql, AURORA.businessId);
  await sql.end();
});

const widget = (page: Page, sel: string) => page.locator(`[data-recepcionista-widget] ${sel}`);

async function abrirWidget(page: Page) {
  await page.goto(servidores.demoUrl);
  await widget(page, '.boton').click();
  await expect.poll(() => widget(page, '.panel').isVisible(), ESPERA).toBe(true);
}

async function guardarToken(page: Page) {
  const t = await page.evaluate((k) => localStorage.getItem(k), CLAVE_ALMACEN);
  if (t && !tokens.includes(t)) tokens.push(t);
  return t;
}

describe('la demo en el navegador', () => {
  let pagina: Page;

  it('el widget aparece con la marca del negocio y el aviso de privacidad', async () => {
    const ctx = await navegador.newContext();
    pagina = await ctx.newPage();
    await abrirWidget(pagina);
    expect(await widget(pagina, '.cabecera h2').textContent()).toBe('Estética Aurora');
    expect(await widget(pagina, '.aviso').textContent()).toBe(
      'Asistente virtual. Al escribir aceptas la política de privacidad de Estética Aurora.',
    );
    // La de la base: en la nube apunta a la demo publicada (PW-08).
    const [n] = await sql<{ url: string }[]>`select privacidad_url as url from public.businesses where id = ${AURORA.businessId}`;
    expect(await widget(pagina, '.aviso a').getAttribute('href')).toBe(n!.url);
    expect(await widget(pagina, '.m.asistente').first().textContent()).toContain('asistente virtual de Estética Aurora');
  });

  it('se escribe, responde y acaba con una cita real en la base y su SMS de prueba', async () => {
    const entrada = widget(pagina, 'textarea');
    await entrada.fill(PRIMER_MENSAJE);
    await entrada.press('Enter');
    await expect.poll(() => widget(pagina, '.m.asistente').count(), ESPERA).toBe(2);
    expect(await widget(pagina, '.m.asistente').nth(1).textContent()).toContain('tengo a Marta');
    await guardarToken(pagina);

    await entrada.fill(`Sí. Clienta E2E, ${telefono}`);
    await entrada.press('Enter');
    await expect.poll(() => widget(pagina, '.m.asistente').count(), ESPERA).toBe(3);
    expect(await widget(pagina, '.m.asistente').nth(2).textContent()).toContain('¡Hecho!');

    const citas = await sql<{ id: string; estado: string }[]>`
      select a.id, a.estado from public.appointments a join public.customers c on c.id = a.customer_id
       where a.business_id = ${AURORA.businessId} and c.telefono = ${telefono}`;
    expect(citas).toHaveLength(1);
    expect(citas[0]!.estado).toBe('confirmada');
    expect(sms.enviados).toHaveLength(1);
    expect(sms.enviados[0]!.texto).toContain('Estética Aurora: cita confirmada el martes 15 de octubre a las 10:00 con Marta.');
  });

  it('al recargar la página la conversación sigue', async () => {
    await abrirWidget(pagina);
    await expect.poll(() => widget(pagina, '.m').count(), ESPERA).toBe(5); // bienvenida + 2 de la clienta + 2 respuestas
    expect(await widget(pagina, '.m.clienta').first().textContent()).toBe(PRIMER_MENSAJE);
  });

  it('desde otro navegador no se ve', async () => {
    const otro = await (await navegador.newContext()).newPage();
    await abrirWidget(otro);
    await expect.poll(() => widget(otro, '.m').count(), ESPERA).toBe(1); // solo la bienvenida
    expect(await widget(otro, '.m.clienta').count()).toBe(0);
  });

  it('el enlace del SMS abre la cita y permite cancelarla', async () => {
    const enlace = sms.enviados[0]!.texto.split(' ').at(-1)!;
    expect(enlace.startsWith(`${servidores.apiUrl}/cita/`)).toBe(true);
    const p = await (await navegador.newContext()).newPage();
    await p.goto(enlace);
    expect(await p.locator('h1').textContent()).toBe('Tu cita en Estética Aurora');
    await p.getByRole('button', { name: 'Cancelar la cita' }).click();
    await p.getByRole('button', { name: 'Sí, cancelar la cita' }).click();
    expect(await p.locator('h1').textContent()).toBe('Tu cita está cancelada');
    const [c] = await sql<{ estado: string }[]>`
      select a.estado from public.appointments a join public.customers c on c.id = a.customer_id
       where a.business_id = ${AURORA.businessId} and c.telefono = ${telefono}`;
    expect(c!.estado).toBe('cancelada');
  });

  it('en un dominio que no es del negocio el widget no aparece (PW-06)', async () => {
    // 127.0.0.1 no está en los dominios de Aurora (sí "localhost").
    const p = await (await navegador.newContext()).newPage();
    // Sin cabeceras CORS, Chrome bloquea la respuesta (403): para la página es
    // una petición fallida y el widget no se monta.
    const fallidas: string[] = [];
    p.on('requestfailed', (r) => {
      if (r.url().includes('/api/widget/config')) fallidas.push(r.url());
    });
    await p.goto(servidores.demoUrl.replace('localhost', '127.0.0.1') + `/?${randomUUID()}`);
    await expect.poll(() => fallidas.length, ESPERA).toBe(1);
    await p.waitForLoadState('networkidle');
    expect(await p.locator('[data-recepcionista-widget]').count()).toBe(0);
  });
});
