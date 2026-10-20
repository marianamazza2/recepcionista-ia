// =============================================================================
// /cita/:token — la página del enlace del SMS (Fase 3 · 3.5, PW-07)
// =============================================================================
//   GET              la cita y el botón "Cancelar la cita"
//   POST paso=preguntar   "¿Seguro?" (confirmar antes de cancelar, como PA-01)
//   POST paso=cancelar    cancela con PR-07
//
// Cancelar va siempre por POST: un GET no cambia nada (los navegadores y las
// apps de mensajería abren enlaces por su cuenta para previsualizarlos).
// HTML hecho en el servidor, sin JavaScript. Para cambiar la cita, remite al
// chat de la web o al teléfono (PW-07).
// =============================================================================

import type { Sql } from 'postgres';

import { cancelarPorEnlace, citaPorEnlace, type CitaDelEnlace, type ResultadoCancelacion } from '../citas/enlace.js';
import { escaparHtml as e } from './http.js';

export interface CitaDeps {
  sql: Sql;
  now?: () => Date;
  onError?: (e: unknown) => void;
}

const CABECERAS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  // El token va en la URL: que no salga hacia otras webs ni se indexe.
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};

function pagina(titulo: string, cuerpo: string, status = 200): Response {
  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(titulo)}</title>
<style>
  :root { color-scheme: light dark; --fondo:#f6f4f2; --tarjeta:#fff; --texto:#2b2b2b; --suave:#666; --borde:#e2ddd8; --peligro:#b3261e; }
  @media (prefers-color-scheme: dark) { :root { --fondo:#1c1b1a; --tarjeta:#262524; --texto:#eee; --suave:#aaa; --borde:#3a3836; --peligro:#ff8a80; } }
  * { box-sizing: border-box; }
  body { margin:0; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; background: var(--fondo); color: var(--texto); }
  main { max-width: 32rem; margin: 0 auto; padding: 2rem 1rem; }
  .tarjeta { background: var(--tarjeta); border: 1px solid var(--borde); border-radius: 12px; padding: 1.25rem; }
  h1 { font-size: 1.25rem; margin: 0 0 1rem; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: .35rem 1rem; margin: 0 0 1rem; }
  dt { color: var(--suave); } dd { margin: 0; font-weight: 600; }
  p { margin: .75rem 0; } .suave { color: var(--suave); font-size: .925rem; }
  .estado { display:inline-block; padding:.15rem .6rem; border-radius:999px; border:1px solid var(--borde); font-size:.85rem; }
  button { font: inherit; padding: .7rem 1.1rem; border-radius: 8px; border: 1px solid var(--peligro); background: transparent; color: var(--peligro); cursor: pointer; width: 100%; }
  button.fuerte { background: var(--peligro); color: #fff; }
  a { color: inherit; }
</style>
</head>
<body><main>${cuerpo}</main></body>
</html>`;
  return new Response(html, { status, headers: CABECERAS });
}

function noValido(): Response {
  return pagina(
    'Enlace no válido',
    `<div class="tarjeta"><h1>Este enlace no es válido o ha caducado</h1>
     <p class="suave">Si necesitas algo sobre tu cita, escribe en el chat de la web del centro o llámales.</p></div>`,
    404,
  );
}

function telefono(c: CitaDelEnlace): string {
  return c.config.telefonoHumano ? `llama al <a href="tel:${e(c.config.telefonoHumano)}">${e(c.config.telefonoHumano)}</a>` : 'llama al centro';
}

function detalle(c: CitaDelEnlace): string {
  const estado = { confirmada: 'Confirmada', cancelada: 'Cancelada', completada: 'Realizada', no_show: 'No presentada' }[c.estado];
  return `<dl>
    <dt>Servicio</dt><dd>${e(c.servicio)}</dd>
    <dt>Día</dt><dd>${e(c.dia)}</dd>
    <dt>Hora</dt><dd>${e(c.hora)} a ${e(c.horaFin)}</dd>
    <dt>Con</dt><dd>${e(c.profesional)}</dd>
    ${c.config.direccion ? `<dt>Dónde</dt><dd>${e(c.config.direccion)}</dd>` : ''}
    <dt>Estado</dt><dd><span class="estado">${estado}</span></dd>
  </dl>`;
}

function paraCambiarla(c: CitaDelEnlace): string {
  return `<p class="suave">Para cambiarla, escríbenos en el chat de la web o ${telefono(c)}.</p>`;
}

function vista(c: CitaDelEnlace, ahora: Date): Response {
  const futura = c.estado === 'confirmada' && c.inicio.getTime() > ahora.getTime();
  return pagina(
    `Tu cita en ${c.config.nombre}`,
    `<div class="tarjeta"><h1>Tu cita en ${e(c.config.nombre)}</h1>
     ${detalle(c)}
     ${
       futura
         ? `${paraCambiarla(c)}
            <form method="post"><input type="hidden" name="paso" value="preguntar"><button type="submit">Cancelar la cita</button></form>`
         : ''
     }</div>`,
  );
}

function preguntar(c: CitaDelEnlace): Response {
  return pagina(
    'Cancelar la cita',
    `<div class="tarjeta"><h1>¿Seguro que quieres cancelar tu cita?</h1>
     ${detalle(c)}
     ${c.config.politicaCancelacion ? `<p class="suave">${e(c.config.politicaCancelacion)}</p>` : ''}
     <form method="post"><input type="hidden" name="paso" value="cancelar"><button class="fuerte" type="submit">Sí, cancelar la cita</button></form>
     <p class="suave"><a href="">No, volver</a></p></div>`,
  );
}

function resultado(c: CitaDelEnlace, r: ResultadoCancelacion): Response {
  switch (r.resultado) {
    case 'cancelada':
    case 'ya_cancelada':
      return pagina(
        'Cita cancelada',
        `<div class="tarjeta"><h1>Tu cita está cancelada</h1>
         <p>${e(c.servicio)}, ${e(c.dia)} a las ${e(c.hora)}.</p>
         ${r.resultado === 'cancelada' && r.dentroDelPlazo && r.politica ? `<p class="suave">Recuerda la política del centro: ${e(r.politica)}</p>` : ''}
         <p class="suave">Si quieres pedir otra cita, escríbenos en el chat de la web o ${telefono(c)}.</p></div>`,
      );
    case 'bloqueada':
      return pagina(
        'No se puede cancelar por aquí',
        `<div class="tarjeta"><h1>No se puede cancelar por aquí</h1>
         <p>Faltan menos de ${r.plazoHoras} horas para tu cita y el centro no permite cancelarla en línea.</p>
         ${r.politica ? `<p class="suave">${e(r.politica)}</p>` : ''}
         <p>Para cancelarla, ${telefono(c)}.</p>
         ${detalle(c)}</div>`,
      );
    case 'no_modificable':
      return pagina(
        'No se puede cancelar',
        `<div class="tarjeta"><h1>Esta cita ya no se puede cancelar</h1>${detalle(c)}
         <p class="suave">Si necesitas algo, ${telefono(c)}.</p></div>`,
      );
  }
}

export async function paginaCita(deps: CitaDeps, req: Request, token: string): Promise<Response> {
  const ahora = (deps.now ?? (() => new Date()))();
  try {
    const cita = await citaPorEnlace(deps.sql, token);
    if (!cita) return noValido();
    if (req.method === 'GET' || req.method === 'HEAD') return vista(cita, ahora);
    if (req.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'GET, POST' } });

    const paso = new URLSearchParams(await req.text()).get('paso');
    if (paso === 'preguntar' && cita.estado === 'confirmada' && cita.inicio.getTime() > ahora.getTime()) return preguntar(cita);
    if (paso === 'cancelar') return resultado(cita, await cancelarPorEnlace(deps.sql, cita, ahora));
    return vista(cita, ahora);
  } catch (err) {
    deps.onError?.(err);
    return pagina('Algo ha fallado', `<div class="tarjeta"><h1>Algo ha fallado</h1><p class="suave">Inténtalo de nuevo en un momento.</p></div>`, 503);
  }
}
