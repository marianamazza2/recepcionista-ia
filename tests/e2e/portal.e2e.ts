// =============================================================================
// El portal del cliente en el navegador (Fase 9 · 9.7) — npm run test:e2e
// =============================================================================
// La prueba de verdad del criterio de terminada (punto 12), de punta a punta y
// con un negocio inventado:
//
//   1. Mariana da de alta el negocio en su panel y genera su enlace (PC-02).
//   2. El cliente abre el enlace, recibe el código en su email y crea su
//      cuenta y su contraseña (PC-11).
//   3. Dentro ve SOLO el chat y hace el alta entera: su negocio, su servicio,
//      su profesional, su horario y sus reglas, confirmando cada resumen.
//   4. Al terminar aparece su portal con los datos (PC-11) y a Mariana le
//      llega el aviso en su panel (PC-13).
//   5. Mariana lo activa.
//   6. Su widget le da una cita a una clienta…
//   7. …que el negocio ve en su agenda visual, donde además carga otra a mano
//      pinchando un hueco (PC-16).
//   8. El cliente cambia la duración de su servicio por el chat y el agente de
//      las clientas lo aplica en el mensaje siguiente.
//
// El modelo es SIMULADO (sin coste): el guion de abajo se consume en orden,
// primero el del chat del alta, luego el del widget y luego el del portal.
// Las capturas quedan en PORTAL_CAPTURAS (ordenador y móvil) para repasar el
// aspecto con Mariana (paso 7b del orden de trabajo).
// =============================================================================

import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EmailDePrueba } from '../../src/adapters/email/prueba.js';
import { AJUSTES_DE_SERIE } from '../../src/core/agent.js';
import { localToUtc } from '../../src/core/time.js';
import { loadBusinessConfig } from '../../src/config/business.js';
import { createSql } from '../../src/db/client.js';
import { guardarPersonaPanel } from '../../src/db/personas.js';
import { construirPanel, construirPortal } from '../../src/dev/panel-build.js';
import { iniciarServidores } from '../../src/dev/server.js';
import { AuthFalsa } from '../helpers/auth-falsa.js';
import { telefonoDeTest } from '../helpers/fixtures.js';
import { herramientas, ModeloSimulado, texto, type Guion } from '../helpers/modelo-simulado.js';

const sql = createSql(undefined, { max: 6 });
const AHORA = localToUtc('2030-10-14', '10:00', 'Europe/Madrid'); // lunes
const EMAIL_PANEL = `e2e-portal-${Date.now()}@example.test`;
const PASSWORD_PANEL = 'contraseña-del-e2e';
const NOMBRE = `Clínica Portal ${Date.now() % 100000}`;
const EMAIL_CLIENTE = `contacto-${Date.now() % 100000}@ejemplo.test`;
const PASSWORD_CLIENTE = 'mi-contraseña-larga';
const telefono = telefonoDeTest();
const auth = new AuthFalsa();
const email = new EmailDePrueba({ silencioso: true });
const ESPERA = { timeout: 30_000 };
const CAPTURAS = process.env.PORTAL_CAPTURAS ?? join(tmpdir(), 'recepcionista-portal-e2e');

const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes'];
const resumen = (seccion: string, titulo: string, lineas: { etiqueta: string; valor: string }[], tabla?: { columnas: string[]; filas: string[][] }): Guion =>
  herramientas({ name: 'proponer_resumen', input: { seccion, titulo, lineas, ...(tabla ? { tabla } : {}) } });

const modelo = new ModeloSimulado([
  // --- El chat del alta (el guion de Mariana, sección por sección) ------------
  texto('¡Hola, buenos días! Te damos la bienvenida a tu portal para avanzar con el alta. Te iré haciendo preguntas para que avancemos con la configuración. ¿Empezamos?'),
  texto('Dime de qué sector es tu negocio.'),
  texto('Ahora continuamos con la dirección del local.'),
  texto('¿Y el teléfono del local?'),
  resumen('negocio', 'Te confirmo', [
    { etiqueta: 'Sector', valor: 'medicina estética' },
    { etiqueta: 'Dirección', valor: 'Calle Mayor 12, 28013 Madrid' },
    { etiqueta: 'Teléfono', valor: '910 000 000' },
  ]),
  texto('Te confirmo: medicina estética, Calle Mayor 12, 28013 Madrid, 910 000 000. ¿Está todo bien?'),
  herramientas(
    { name: 'guardar_negocio', input: { sector: 'medicina estética', direccion: 'Calle Mayor 12, 28013 Madrid', telefono: '910000000' } },
    { name: 'avanzar_seccion', input: { seccion: 2 } },
  ),
  texto('Perfecto. Bueno, ahora comencemos con la sección de servicios. ¿Cuál es el servicio que quieres dar de alta?'),
  texto('Perfecto. ¿Tienes más servicios para dar de alta?'),
  resumen('servicios', 'Tus servicios', [], { columnas: ['Servicio', 'Duración', 'Precio'], filas: [['Limpieza facial', '60 min', '45 €']] }),
  texto('Limpieza facial · 60 min · 45 €. ¿Está todo bien?'),
  herramientas(
    { name: 'guardar_servicios', input: { servicios: [{ nombre: 'Limpieza facial', duracion_min: 60, margen_min: 10, precio: 45, descripcion: 'Limpieza profunda con extracción.' }] } },
    { name: 'avanzar_seccion', input: { seccion: 3 } },
  ),
  texto('Bueno, ahora pasamos a la sección de los profesionales que trabajan contigo. Dime el nombre y apellido del profesional.'),
  texto('¿Tienes otro profesional para dar de alta?'),
  resumen('profesionales', 'Tu equipo', [{ etiqueta: 'Núria Puig', valor: 'Limpieza facial' }]),
  texto('Núria Puig hace la limpieza facial. ¿Está todo bien?'),
  herramientas(
    { name: 'guardar_profesionales', input: { profesionales: [{ nombre: 'Núria Puig', servicios: ['Limpieza facial'] }] } },
    { name: 'avanzar_seccion', input: { seccion: 4 } },
  ),
  texto('Bueno, ahora vamos a pasar a la sección de horarios. Dime los días y entre qué horarios está abierto el local.'),
  resumen('horario', 'Así queda tu semana', [], {
    columnas: ['Día', 'Horario'],
    filas: [...DIAS.map((d) => [d, '09:00–18:00']), ['sábado', 'cerrado'], ['domingo', 'cerrado']],
  }),
  texto('Así queda tu semana. ¿Está todo bien?'),
  herramientas(
    { name: 'guardar_horarios', input: { local: DIAS.map((dia) => ({ dia, desde: '09:00', hasta: '18:00' })), profesionales: [] } },
    { name: 'avanzar_seccion', input: { seccion: 6 } },
  ),
  texto('Bueno, ahora vamos con la sección de reservas y cancelación. ¿Una persona necesita reservar con una antelación mínima?'),
  resumen('reglas', 'Reservas y cancelación', [
    { etiqueta: 'Antelación mínima', valor: '2 horas' },
    { etiqueta: 'Cancelar por el chat', valor: 'hasta 24 horas antes' },
  ]),
  texto('Reservas con al menos 2 horas de antelación. Cancelar por el chat, hasta 24 horas antes; después, la cancelo igual y le recuerdo tu política. ¿Está todo bien?'),
  herramientas(
    {
      name: 'guardar_reglas',
      input: { antelacion_min_horas: 2, cancelacion_plazo_horas: 24, quien_elige_profesional: 'preguntar', dentro_del_plazo: 'informar', politica_cancelacion: 'Avísanos con 24 horas de antelación.' },
    },
    { name: 'avanzar_seccion', input: { seccion: 9 } },
  ),
  texto('Ya tengo todo lo imprescindible. ¿Cerramos el alta?'),
  herramientas({ name: 'terminar_alta', input: {} }),
  texto(
    '¡Excelente! Ya tienes tu portal listo. Recuerda que, si quieres cargar preguntas frecuentes, puedes hacerlo en ese apartado dentro de tu portal. También, en la sección "El chat en tu web", recuerda seleccionar el color de tu marca y añadir una imagen para que se muestre en la parte superior izquierda del chat.',
  ),

  // --- El widget: una clienta pide cita --------------------------------------
  texto('El martes 15 tengo a las 10:00 con Núria Puig. ¿Te la reservo? Dime tu nombre y tu email.'),
  herramientas({ name: 'identificar_cliente', input: { email: null, telefono, nombre: 'Clienta del Portal' } }),
  herramientas({ name: 'crear_reserva', input: { servicio: 'Limpieza facial', fecha: '2030-10-15', hora: '10:00', profesional: 'Núria Puig' } }),
  texto('¡Hecho! Tienes cita el martes 15 de octubre a las 10:00 con Núria Puig.'),

  // --- El chat del portal, después del alta ----------------------------------
  resumen('cambio', 'El cambio', [{ etiqueta: 'Limpieza facial', valor: 'pasa a durar 75 minutos' }]),
  texto('La limpieza facial pasaría a durar 75 minutos. ¿Está todo bien?'),
  herramientas({ name: 'cambiar_servicio', input: { nombre: 'Limpieza facial', duracion_min: 75 } }),
  texto('Hecho: la limpieza facial dura ahora 75 minutos.'),

  // --- El widget otra vez: el agente ya lo sabe ------------------------------
  texto('La limpieza facial dura 75 minutos.'),
]);

let servidores: Awaited<ReturnType<typeof iniciarServidores>>;
let navegador: Browser;
let panel: Page;
let portal: Page;
let userId: string;
let negocioId: string | null = null;
let enlace = '';
const puerto = 3900 + Math.floor(Math.random() * 40);

beforeAll(async () => {
  mkdirSync(CAPTURAS, { recursive: true });
  await construirPanel();
  await construirPortal();
  userId = auth.crearUsuario(EMAIL_PANEL, PASSWORD_PANEL);
  await guardarPersonaPanel(sql, userId, EMAIL_PANEL);
  servidores = await iniciarServidores({
    sql,
    model: modelo,
    settings: { ...AJUSTES_DE_SERIE, limits: { maxVueltas: 6, maxTokensConversacion: 1_000_000 } },
    email,
    apiPort: puerto,
    demoPort: puerto + 100,
    panelPort: puerto + 300,
    auth,
    now: () => AHORA,
  });
  navegador = await chromium.launch({ channel: 'chrome', headless: true });
  panel = await (await navegador.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  portal = await (await navegador.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
}, 180_000);

afterAll(async () => {
  await navegador?.close();
  await servidores?.cerrar();
  if (negocioId) await sql`delete from public.businesses where id = ${negocioId}`;
  await sql`delete from panel.personas where user_id = ${userId}`;
  await sql.end();
});

/** El último código de seis dígitos que le llegó al contacto. */
function codigoDelEmail(): string {
  const c = email.ultimoCodigo(EMAIL_CLIENTE);
  expect(c, 'no le ha llegado ningún código').toBeTruthy();
  return c!;
}

/** Escribe en el chat del portal y espera a que conteste. */
async function decir(mensaje: string, respuestasAntes: number): Promise<void> {
  await portal.getByLabel('Escribe tu respuesta').fill(mensaje);
  await portal.getByRole('button', { name: 'Enviar' }).click();
  await expect.poll(() => portal.locator('.bg-slate-100.text-slate-900').count(), ESPERA).toBe(respuestasAntes + 1);
}

describe('de la invitación a la primera cita', () => {
  it('1. Mariana da de alta el negocio y genera su enlace de invitación', async () => {
    await panel.goto(`${servidores.panelUrl}/`);
    await expect.poll(() => panel.getByRole('button', { name: 'Entrar' }).isVisible(), ESPERA).toBe(true);
    await panel.getByLabel('Email').fill(EMAIL_PANEL);
    await panel.getByLabel('Contraseña').fill(PASSWORD_PANEL);
    await panel.getByRole('button', { name: 'Entrar' }).click();
    await panel.getByLabel('Dar de alta un negocio').fill(NOMBRE);
    await panel.getByRole('button', { name: 'Crear' }).click();
    await expect.poll(() => panel.locator('h1').textContent(), ESPERA).toBe(NOMBRE);
    negocioId = /negocios\/([0-9a-f-]{36})/.exec(panel.url())![1]!;

    await panel.goto(`${servidores.panelUrl}/panel/#/negocios/${negocioId}/portal`);
    await expect.poll(() => panel.getByText('No hay ningún enlace vivo.').isVisible(), ESPERA).toBe(true);
    await panel.getByLabel('Email del contacto').fill(EMAIL_CLIENTE);
    await panel.getByRole('button', { name: 'Generar el enlace' }).click();
    await expect.poll(() => panel.locator('pre').first().textContent(), ESPERA).toContain('/portal/#/invitacion/');
    enlace = (await panel.locator('pre').first().textContent())!;
    await panel.screenshot({ path: join(CAPTURAS, '1-panel-invitacion.png'), fullPage: true });
    expect(await panel.textContent('body')).toContain(EMAIL_CLIENTE);
  });

  it('2. el cliente abre el enlace, confirma su email con el código y crea su cuenta', async () => {
    await portal.goto(enlace);
    await expect.poll(() => portal.getByLabel('Código del email').isVisible(), ESPERA).toBe(true);
    expect(await portal.locator('h1').textContent()).toContain(NOMBRE);
    // El email se tapa: se ve a dónde fue el código, no el correo entero.
    expect(await portal.textContent('body')).not.toContain(EMAIL_CLIENTE);
    await portal.screenshot({ path: join(CAPTURAS, '2-portal-crear-cuenta.png'), fullPage: true });

    // Un código que no es: no crea nada y lo dice.
    await portal.getByLabel('Código del email').fill('000000');
    await portal.getByLabel('Tu contraseña').fill(PASSWORD_CLIENTE);
    await portal.getByLabel('Repítela').fill(PASSWORD_CLIENTE);
    await portal.getByRole('button', { name: 'Crear mi cuenta' }).click();
    await expect.poll(() => portal.getByRole('alert').textContent(), ESPERA).toContain('Ese código no es');

    await portal.getByLabel('Código del email').fill(codigoDelEmail());
    await portal.getByRole('button', { name: 'Crear mi cuenta' }).click();
    await expect.poll(() => portal.getByLabel('Escribe tu respuesta').isVisible(), ESPERA).toBe(true);
    // PC-11: dentro, solo el chat; las secciones del portal no están todavía.
    expect(await portal.getByRole('link', { name: 'Agenda', exact: true }).count()).toBe(0);
  });

  it('3. hace el alta entera por el chat, confirmando cada resumen', async () => {
    // El chat saluda él solo (sección 0 del guion).
    await expect.poll(() => portal.locator('.bg-slate-100.text-slate-900').count(), ESPERA).toBe(1);
    expect(await portal.textContent('body')).toContain('¿Empezamos?');
    await portal.screenshot({ path: join(CAPTURAS, '3-portal-chat-alta.png'), fullPage: true });

    await decir('Sí, empezamos', 1);
    await decir('Medicina estética', 2);
    await decir('Calle Mayor 12, 28013 Madrid', 3);
    await decir('910000000', 4);
    // PC-03: el resumen se ve como un bloque, no como texto suelto.
    expect(await portal.textContent('body')).toContain('Te confirmo');
    expect(await portal.textContent('body')).toContain('Calle Mayor 12, 28013 Madrid');
    await portal.screenshot({ path: join(CAPTURAS, '4-portal-resumen.png'), fullPage: true });

    await decir('Sí, está todo bien', 5);
    const [b] = await sql<{ sector: string; direccion: string; telefono: string }[]>`
      select sector, direccion, telefono_humano as telefono from public.businesses where id = ${negocioId}`;
    expect(b).toMatchObject({ sector: 'medicina estética', direccion: 'Calle Mayor 12, 28013 Madrid', telefono: '+34910000000' });

    await decir('Limpieza facial, 60 minutos, 10 de margen, 45 euros', 6);
    await decir('No, ninguno más', 7);
    await decir('Sí', 8);
    const servicios = await sql<{ nombre: string; d: number; b: number }[]>`
      select nombre, duracion_min as d, buffer_min as b from public.services where business_id = ${negocioId}`;
    expect(servicios).toEqual([{ nombre: 'Limpieza facial', d: 60, b: 10 }]);

    await decir('Núria Puig, hace la limpieza facial', 9);
    await decir('No, nadie más', 10);
    await decir('Sí', 11);
    const staff = await sql<{ nombre: string }[]>`select nombre from public.staff where business_id = ${negocioId}`;
    expect(staff).toEqual([{ nombre: 'Núria Puig' }]);

    await decir('De lunes a viernes de 9 a 18', 12);
    expect(await portal.textContent('body')).toContain('Así queda tu semana');
    await decir('Sí', 13);
    const tramos = await sql<{ weekday: number }[]>`
      select weekday from public.business_hours where business_id = ${negocioId} and staff_id is null order by weekday`;
    expect(tramos.map((t) => t.weekday)).toEqual([1, 2, 3, 4, 5]);

    await decir('2 horas de antelación y 24 horas para cancelar', 14);
    await decir('Sí', 15);
    const [reglas] = await sql<{ a: number; c: number }[]>`
      select antelacion_min_horas as a, cancelacion_plazo_horas as c from public.businesses where id = ${negocioId}`;
    expect(reglas).toEqual({ a: 2, c: 24 });
  });

  it('4. al terminar aparece su portal con los datos, y Mariana recibe el aviso', async () => {
    await decir('Sí, cierra el alta', 16);
    // PC-11: ahora sí está el portal.
    await expect.poll(() => portal.getByRole('link', { name: 'Agenda', exact: true }).isVisible(), ESPERA).toBe(true);
    expect(await portal.textContent('body')).toContain('Ya tienes tu portal listo');
    // PC-12: el cierre le recuerda lo que no se preguntó.
    expect(await portal.textContent('body')).toContain('preguntas frecuentes');
    expect(await portal.textContent('body')).toContain('El chat en tu web');
    await portal.screenshot({ path: join(CAPTURAS, '5-portal-portada.png'), fullPage: true });

    // Su configuración, con lo que cargó por el chat.
    await portal.goto(`${servidores.panelUrl}/portal/#/configuracion`);
    // El servicio se ve en su campo editable (el texto suelto no lo incluye).
    await expect.poll(() => portal.locator('#servicios').getByLabel('Nombre').first().inputValue(), ESPERA).toBe('Limpieza facial');
    expect(await portal.locator('#datos').getByLabel('Dirección').inputValue()).toBe('Calle Mayor 12, 28013 Madrid');
    // PC-09: ni el tope, ni activar, ni la clave del widget.
    const texto = (await portal.textContent('body'))!;
    expect(texto).not.toContain('Tope mensual');
    expect(texto).not.toContain('Activar');
    expect(texto).not.toContain('Cambiar la clave');
    await portal.screenshot({ path: join(CAPTURAS, '6-portal-configuracion.png'), fullPage: true });

    // PC-13: el aviso en el panel de Mariana.
    await panel.goto(`${servidores.panelUrl}/panel/#/`);
    await expect.poll(() => panel.getByRole('status').textContent(), ESPERA).toContain('ha terminado su alta');
    expect(await panel.getByRole('status').textContent()).toContain(NOMBRE);
    await panel.screenshot({ path: join(CAPTURAS, '7-panel-aviso.png'), fullPage: true });
  });

  it('5. Mariana ve su portal tal como lo ve él, lo completa y lo activa', async () => {
    await panel.goto(`${servidores.panelUrl}/panel/#/negocios/${negocioId}/portal`);
    await expect.poll(() => panel.getByText('Terminó el alta el', { exact: false }).isVisible(), ESPERA).toBe(true);
    // PC-05: lo que ve él, y editable.
    await expect.poll(() => panel.locator('#servicios').getByLabel('Nombre').first().inputValue(), ESPERA).toBe('Limpieza facial');
    await panel.getByRole('button', { name: 'Marcar como revisada' }).click();
    await expect.poll(() => panel.getByRole('status').first().textContent(), ESPERA).toContain('revisada');
    await panel.screenshot({ path: join(CAPTURAS, '8-panel-su-portal.png'), fullPage: true });

    // El dominio del chat lo pone el cliente en su portal (PC-12); aquí lo
    // ponemos desde el portal, como haría él.
    await portal.goto(`${servidores.panelUrl}/portal/#/configuracion`);
    await portal.locator('#chat').getByLabel('Dominios donde aparece (uno por línea)').fill('localhost');
    await portal.locator('#chat').getByRole('button', { name: 'Guardar' }).click();
    await expect.poll(() => portal.locator('#chat').getByRole('status').textContent(), ESPERA).toBe('Guardado.');

    // Y activar es de Mariana.
    // Recargar: lo que el cliente cambió en su portal se ve al volver a cargar.
    await panel.goto(`${servidores.panelUrl}/panel/#/negocios/${negocioId}/ficha`);
    await panel.reload();
    await expect.poll(() => panel.locator('#publicar').textContent(), ESPERA).toContain('Tiene lo mínimo para atender');
    await panel.locator('#publicar').getByRole('button', { name: 'Activar' }).click();
    await expect.poll(() => panel.locator('#publicar').getByRole('status').textContent(), ESPERA).toBe('Negocio activado.');
  });

  it('6. su widget le da una cita a una clienta', async () => {
    const [b] = await sql<{ key: string }[]>`select widget_key as key from public.businesses where id = ${negocioId}`;
    const web = await (await navegador.newContext()).newPage();
    await web.goto(`${servidores.demoUrl}/prueba.html?key=${b!.key}`);
    const w = (sel: string) => web.locator(`[data-recepcionista-widget] ${sel}`);
    await w('.boton').click();
    await w('textarea').fill('Quiero una limpieza facial el martes 15');
    await w('textarea').press('Enter');
    await expect.poll(() => w('.m.asistente').count(), ESPERA).toBe(1);
    await w('textarea').fill(`Sí, Clienta del Portal, ${telefono}`);
    await w('textarea').press('Enter');
    await expect.poll(() => w('.m.asistente').count(), ESPERA).toBe(2);
    const citas = await sql<{ estado: string }[]>`select estado from public.appointments where business_id = ${negocioId}`;
    expect(citas).toEqual([{ estado: 'confirmada' }]);
    await web.close();
  });

  it('7. el negocio la ve en su agenda y carga otra a mano pinchando un hueco', async () => {
    await portal.goto(`${servidores.panelUrl}/portal/#/agenda`);
    await portal.locator('input[type=date]').fill('2030-10-15');
    await expect.poll(() => portal.getByRole('button', { name: /10:00 Clienta del Portal/ }).isVisible(), ESPERA).toBe(true);
    await portal.screenshot({ path: join(CAPTURAS, '9-portal-agenda-dia.png'), fullPage: true });

    await portal.getByRole('button', { name: /^Abierto de/ }).first().click();
    const dialogo = portal.getByRole('dialog', { name: 'Cargar una cita a mano' });
    await dialogo.waitFor(ESPERA);
    await dialogo.getByLabel('Hora').fill('12:15');
    await dialogo.getByLabel('Teléfono de la clienta').fill(telefonoDeTest());
    await dialogo.getByLabel('Nombre').fill('Clienta en el local');
    await dialogo.getByRole('button', { name: 'Cargar cita' }).click();
    await expect.poll(() => portal.getByRole('button', { name: /12:15 Clienta en el local/ }).isVisible(), ESPERA).toBe(true);
    const [c] = await sql<{ origen: string }[]>`
      select origen from public.appointments where business_id = ${negocioId} and start_at = ${localToUtc('2030-10-15', '12:15', 'Europe/Madrid')}`;
    expect(c!.origen).toBe('manual');

    // La semana y el detalle de una cita.
    await portal.getByRole('button', { name: 'Semana' }).click();
    await expect.poll(() => portal.getByRole('button', { name: /12:15 Clienta en el local/ }).isVisible(), ESPERA).toBe(true);
    await portal.screenshot({ path: join(CAPTURAS, '10-portal-agenda-semana.png'), fullPage: true });
    await portal.getByRole('button', { name: /12:15 Clienta en el local/ }).click();
    await expect.poll(() => portal.getByRole('dialog', { name: 'La cita' }).isVisible(), ESPERA).toBe(true);
    await portal.screenshot({ path: join(CAPTURAS, '11-portal-cita.png'), fullPage: true });
  });

  it('8. cambia la duración por el chat y el agente de las clientas lo aplica', async () => {
    await portal.goto(`${servidores.panelUrl}/portal/#/`);
    await expect.poll(() => portal.getByLabel('Escribe tu respuesta').isVisible(), ESPERA).toBe(true);
    const antes = await portal.locator('.bg-slate-100.text-slate-900').count();
    await decir('La limpieza facial ahora dura 75 minutos', antes);
    await decir('Sí', antes + 1);
    const [s] = await sql<{ d: number }[]>`select duracion_min as d from public.services where business_id = ${negocioId}`;
    expect(s!.d).toBe(75);
    await portal.screenshot({ path: join(CAPTURAS, '12-portal-chat-cambio.png'), fullPage: true });

    // El agente de las clientas lo sabe ya: su configuración y su prompt.
    const config = await loadBusinessConfig(sql, { id: negocioId! });
    expect(config.servicios.find((x) => x.nombre === 'Limpieza facial')!.duracionMin).toBe(75);
    const [b] = await sql<{ key: string }[]>`select widget_key as key from public.businesses where id = ${negocioId}`;
    const web = await (await navegador.newContext()).newPage();
    await web.goto(`${servidores.demoUrl}/prueba.html?key=${b!.key}`);
    const w = (sel: string) => web.locator(`[data-recepcionista-widget] ${sel}`);
    await w('.boton').click();
    await w('textarea').fill('¿Cuánto dura la limpieza facial?');
    await w('textarea').press('Enter');
    await expect.poll(() => w('.m.asistente').count(), ESPERA).toBe(1);
    expect(JSON.stringify(modelo.peticiones.at(-1)!.system)).toContain('75 min');
    await web.close();
  });

  it('9. el portal se ve y se usa en el móvil', async () => {
    const movil = await (await navegador.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
    await movil.goto(`${servidores.panelUrl}/portal/`);
    await movil.getByLabel('Email').fill(EMAIL_CLIENTE);
    await movil.getByLabel('Contraseña').fill(PASSWORD_CLIENTE);
    await movil.getByRole('button', { name: 'Entrar' }).click();
    await expect.poll(() => movil.getByRole('link', { name: 'Agenda', exact: true }).isVisible(), ESPERA).toBe(true);
    await movil.screenshot({ path: join(CAPTURAS, 'movil-1-portada.png'), fullPage: true });

    await movil.getByRole('link', { name: 'Agenda', exact: true }).click();
    await movil.locator('input[type=date]').fill('2030-10-15');
    await expect.poll(() => movil.getByRole('button', { name: /10:00 Clienta del Portal/ }).isVisible(), ESPERA).toBe(true);
    await movil.screenshot({ path: join(CAPTURAS, 'movil-2-agenda.png'), fullPage: true });

    await movil.getByRole('link', { name: 'Configuración' }).click();
    await expect.poll(() => movil.locator('#servicios').getByLabel('Nombre').first().inputValue(), ESPERA).toBe('Limpieza facial');
    await movil.screenshot({ path: join(CAPTURAS, 'movil-3-configuracion.png'), fullPage: true });
    // No se desborda en horizontal.
    const ancho = await movil.evaluate(() => {
      const g = globalThis as unknown as { document: { documentElement: { scrollWidth: number } }; innerWidth: number };
      return { scroll: g.document.documentElement.scrollWidth, ventana: g.innerWidth };
    });
    expect(ancho.scroll).toBeLessThanOrEqual(ancho.ventana + 1);
    await movil.close();
  });

  it('10. ninguna cuenta del portal ve otro negocio, ni cambiando la dirección', async () => {
    // Otro negocio de Mariana, con su propio servicio.
    const otro = await panel.evaluate(async () => {
      const token = JSON.parse(sessionStorage.getItem('recepcionista-panel:sesion')!).accessToken as string;
      const r = await fetch('/api/admin/negocios', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ nombre: `Otro Portal ${Date.now()}` }),
      });
      return (await r.json()) as { id: string };
    });
    try {
      // Desde el portal, pidiendo el otro negocio a mano por la API.
      const resultado = await portal.evaluate(async (id: string) => {
        const token = JSON.parse(sessionStorage.getItem('recepcionista-portal:sesion')!).sessionToken as string;
        const rutas = [`negocio/${id}`, `negocios/${id}`, `negocio/../../admin/negocios/${id}`];
        const out: { ruta: string; status: number; cuerpo: string }[] = [];
        for (const ruta of rutas) {
          const r = await fetch(`/api/portal/${ruta}`, { headers: { authorization: `Bearer ${token}` } });
          out.push({ ruta, status: r.status, cuerpo: (await r.text()).slice(0, 200) });
        }
        return out;
      }, otro.id);
      for (const r of resultado) {
        expect(r.status, r.ruta).toBeGreaterThanOrEqual(400);
        expect(r.cuerpo).not.toContain('Otro Portal');
      }
    } finally {
      await sql`delete from public.businesses where id = ${otro.id}`;
    }
  });
});
