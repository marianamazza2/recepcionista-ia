// =============================================================================
// El widget de chat embebible (Fase 3 · 3.4)
// =============================================================================
// Se pega en la web del negocio con una línea:
//
//   <script src="https://…/widget.js" data-key="CLAVE_PUBLICA" async></script>
//
// · Pide al servidor lo público del negocio (nombre, color, bienvenida, aviso
//   de privacidad). Si la web no está en los dominios del negocio (PW-06), el
//   servidor dice que no y el widget no aparece.
// · Todo vive dentro de un Shadow DOM: los estilos de la web no lo rompen y
//   los suyos no tocan la web.
// · El token de la conversación se guarda en localStorage (PW-03). Sin
//   localStorage funciona igual, solo que no retoma la conversación al volver.
// · Sin dependencias, sin cookies, sin analítica.
// · La bienvenida saluda según la hora (PW-02, saludo.ts) y, si la conversación
//   anterior caducó (PW-03), se avisa antes de empezar otra (PW-12).
// =============================================================================

import { conSaludo } from './saludo.js';

interface ConfigWidget {
  nombre: string;
  color: string;
  /** PW-17: data URL del logo, o null (se pinta la inicial). */
  logo: string | null;
  bienvenida: string | null;
  aviso: { texto: string; enlace: string | null };
  maxCaracteres: number;
}

interface RespuestaChat {
  sessionToken: string | null;
  respuesta: string;
  escalada: boolean;
  nuevaConversacion: boolean;
  aviso?: string;
}

interface MensajeVisible {
  rol: 'clienta' | 'asistente';
  texto: string;
}

/** Más de esto esperando, se ofrece reintentar (el servidor sigue con el mensaje). */
const ESPERA_MAXIMA_MS = 60_000;

/** PW-12: cuando la conversación anterior caducó (PW-03) y empieza otra. */
const CONVERSACION_TERMINADA = 'Tu conversación anterior ha terminado. Empezamos una nueva.';

(function iniciar() {
  const script = document.currentScript as HTMLScriptElement | null;
  const key = script?.dataset.key;
  if (!script || !key || (window as unknown as Record<string, unknown>).__recepcionistaWidget) return;
  (window as unknown as Record<string, unknown>).__recepcionistaWidget = true;
  const api = new URL(script.src).origin;
  const almacen = `recepcionista:${key}:sesion`;

  // --- localStorage, a prueba de navegadores que lo bloquean ------------------
  const guardarToken = (t: string | null) => {
    try {
      if (t) localStorage.setItem(almacen, t);
      else localStorage.removeItem(almacen);
    } catch {
      /* sin localStorage: no se retoma, nada más */
    }
  };
  const leerToken = (): string | null => {
    try {
      return localStorage.getItem(almacen);
    } catch {
      return null;
    }
  };

  const uuid = (): string =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
        });

  fetch(`${api}/api/widget/config?key=${encodeURIComponent(key)}`, { credentials: 'omit' })
    .then((r) => (r.ok ? (r.json() as Promise<ConfigWidget>) : null))
    .then((config) => {
      if (config) montar(config);
    })
    .catch(() => {
      /* sin servidor o dominio no permitido: el widget no aparece */
    });

  function montar(config: ConfigWidget): void {
    let sessionToken = leerToken();
    let historialCargado = false;
    let esperando = false;
    let pendiente: { id: string; texto: string } | null = null;

    const host = document.createElement('div');
    host.setAttribute('data-recepcionista-widget', '');
    const root = host.attachShadow({ mode: 'open' });
    const textoSobreColor = contraste(config.color);

    root.innerHTML = `
<style>
  :host { all: initial; }
  * { box-sizing: border-box; }
  .w { --c: ${config.color}; --sobre-c: ${textoSobreColor}; --fondo: #fff; --texto: #1f1f1f; --suave: #6b6b6b; --borde: #e4e4e4; --burbuja: #f2f2f2;
       font: 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--texto); }
  @media (prefers-color-scheme: dark) {
    .w { --fondo: #1e1e1e; --texto: #eee; --suave: #a8a8a8; --borde: #333; --burbuja: #2b2b2b; }
  }
  .boton { position: fixed; right: 20px; bottom: 20px; z-index: 2147483000; width: 60px; height: 60px; border-radius: 50%;
           border: none; background: var(--c); color: var(--sobre-c); cursor: pointer; box-shadow: 0 6px 20px rgba(0,0,0,.25);
           display: grid; place-items: center; transition: transform .15s; }
  .boton:hover { transform: scale(1.05); }
  .boton:focus-visible, button:focus-visible, textarea:focus-visible, a:focus-visible { outline: 3px solid var(--c); outline-offset: 2px; }
  .boton svg { width: 28px; height: 28px; }
  .panel { position: fixed; right: 20px; bottom: 92px; z-index: 2147483000; width: 370px; height: min(600px, calc(100vh - 120px));
           background: var(--fondo); border-radius: 16px; box-shadow: 0 12px 40px rgba(0,0,0,.28); display: flex; flex-direction: column;
           overflow: hidden; border: 1px solid var(--borde); }
  .panel[hidden] { display: none; }
  .cabecera { background: var(--c); color: var(--sobre-c); padding: 14px 16px; display: flex; align-items: center; gap: 12px; }
  .logo { flex: none; width: 36px; height: 36px; border-radius: 50%; background: #fff; color: var(--c); overflow: hidden;
          display: grid; place-items: center; font-weight: 700; font-size: 17px; box-shadow: 0 0 0 2px rgba(255,255,255,.35); }
  .logo img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .cabecera h2 { font-size: 16px; margin: 0; font-weight: 600; flex: 1; }
  .cabecera small { display: block; font-size: 12px; opacity: .85; font-weight: 400; }
  .cerrar { background: transparent; border: none; color: inherit; cursor: pointer; padding: 6px; border-radius: 8px; display: grid; }
  .cerrar svg { width: 20px; height: 20px; }
  .mensajes { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 8px; }
  .m { max-width: 85%; padding: 9px 13px; border-radius: 16px; white-space: pre-wrap; overflow-wrap: anywhere; }
  .m.asistente { background: var(--burbuja); align-self: flex-start; border-bottom-left-radius: 4px; }
  .m.clienta { background: var(--c); color: var(--sobre-c); align-self: flex-end; border-bottom-right-radius: 4px; }
  .m.sistema { align-self: center; background: transparent; color: var(--suave); font-size: 13px; text-align: center; }
  .escribiendo { align-self: flex-start; color: var(--suave); font-size: 13px; padding: 4px 2px; }
  .escribiendo span { animation: p 1.2s infinite; } .escribiendo span:nth-child(2) { animation-delay: .2s; } .escribiendo span:nth-child(3) { animation-delay: .4s; }
  @keyframes p { 0%, 60%, 100% { opacity: .2; } 30% { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .escribiendo span { animation: none; } .boton { transition: none; } }
  .reintentar { align-self: flex-start; font: inherit; font-size: 13px; background: transparent; border: 1px solid var(--c); color: var(--texto);
                padding: 5px 12px; border-radius: 999px; cursor: pointer; }
  .aviso { padding: 8px 16px; font-size: 12px; color: var(--suave); border-top: 1px solid var(--borde); }
  .aviso a { color: inherit; }
  form { display: flex; gap: 8px; padding: 10px 12px 12px; border-top: 1px solid var(--borde); align-items: flex-end; }
  textarea { flex: 1; resize: none; font: inherit; color: var(--texto); background: var(--fondo); border: 1px solid var(--borde);
             border-radius: 12px; padding: 9px 12px; max-height: 120px; min-height: 40px; }
  .enviar { flex: none; width: 40px; height: 40px; border-radius: 50%; border: none; background: var(--c); color: var(--sobre-c); cursor: pointer; display: grid; place-items: center; }
  .enviar:disabled { opacity: .45; cursor: default; }
  .enviar svg { width: 18px; height: 18px; }
  .solo-lector { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  @media (max-width: 480px) {
    .panel { inset: 0; width: auto; height: auto; border-radius: 0; border: none; }
    .panel:not([hidden]) ~ .boton { display: none; }
  }
</style>
<div class="w">
  <div class="panel" role="dialog" aria-modal="false" hidden>
    <div class="cabecera">
      <span class="logo" aria-hidden="true"></span>
      <h2></h2>
      <button class="cerrar" type="button" aria-label="Cerrar el chat">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>
    <div class="mensajes" role="log" aria-live="polite" aria-relevant="additions"></div>
    <p class="aviso"></p>
    <form>
      <label class="solo-lector" for="rcp-texto">Escribe tu mensaje</label>
      <textarea id="rcp-texto" rows="1" placeholder="Escribe tu mensaje…"></textarea>
      <button class="enviar" type="submit" aria-label="Enviar">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3.4 20.4l17.45-7.48a1 1 0 000-1.84L3.4 3.6a.99.99 0 00-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z"/></svg>
      </button>
    </form>
  </div>
  <button class="boton" type="button" aria-expanded="false">
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3C6.5 3 2 6.8 2 11.5c0 2.4 1.2 4.6 3.1 6.1L4.5 21l3.8-2c1.1.3 2.4.5 3.7.5 5.5 0 10-3.8 10-8.5S17.5 3 12 3z"/></svg>
  </button>
</div>`;

    const $ = <T extends Element>(sel: string) => root.querySelector(sel) as T;
    const panel = $<HTMLDivElement>('.panel');
    const boton = $<HTMLButtonElement>('.boton');
    const cerrar = $<HTMLButtonElement>('.cerrar');
    const lista = $<HTMLDivElement>('.mensajes');
    const form = $<HTMLFormElement>('form');
    const entrada = $<HTMLTextAreaElement>('textarea');
    const enviar = $<HTMLButtonElement>('.enviar');
    const aviso = $<HTMLParagraphElement>('.aviso');

    $<HTMLHeadingElement>('h2').textContent = config.nombre;
    pintarLogo($<HTMLSpanElement>('.logo'));
    panel.setAttribute('aria-label', `Chat con ${config.nombre}`);
    boton.setAttribute('aria-label', `Abrir el chat de ${config.nombre}`);
    entrada.maxLength = config.maxCaracteres;
    pintarAviso();

    function pintarLogo(circulo: HTMLSpanElement): void {
      // PW-17: el logo del negocio llega dentro de la config (data URL), así
      // que no se carga nada de otra web. Sin logo, la inicial del nombre.
      if (config.logo && config.logo.startsWith('data:image/')) {
        const img = document.createElement('img');
        img.src = config.logo;
        img.alt = '';
        circulo.append(img);
      } else {
        circulo.textContent = config.nombre.trim().charAt(0).toUpperCase();
      }
    }

    function pintarAviso(): void {
      // PW-02: "Soy la asistente virtual de {negocio}, al escribir aceptas nuestra política de privacidad."
      aviso.textContent = '';
      const frase = 'política de privacidad';
      const i = config.aviso.texto.indexOf(frase);
      if (config.aviso.enlace && i >= 0) {
        const a = document.createElement('a');
        a.href = config.aviso.enlace;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = frase;
        aviso.append(config.aviso.texto.slice(0, i), a, config.aviso.texto.slice(i + frase.length));
      } else {
        aviso.textContent = config.aviso.texto;
      }
    }

    function burbuja(rol: 'clienta' | 'asistente' | 'sistema', texto: string): HTMLElement {
      const d = document.createElement('div');
      d.className = `m ${rol}`;
      d.textContent = texto; // siempre texto, nunca HTML
      lista.append(d);
      lista.scrollTop = lista.scrollHeight;
      return d;
    }

    function bienvenida(): void {
      if (config.bienvenida) burbuja('asistente', conSaludo(config.bienvenida, new Date().getHours()));
    }

    async function cargarHistorial(): Promise<void> {
      historialCargado = true;
      if (!sessionToken) return bienvenida();
      try {
        const r = await fetch(`${api}/api/chat/historial?key=${encodeURIComponent(key!)}`, {
          headers: { authorization: `Bearer ${sessionToken}` },
          credentials: 'omit',
        });
        if (!r.ok) {
          // Caducada (PW-03) o no válida: se empieza de cero, y se dice (PW-12).
          sessionToken = null;
          guardarToken(null);
          if (r.status === 401) burbuja('sistema', CONVERSACION_TERMINADA);
          return bienvenida();
        }
        const h = (await r.json()) as { mensajes: MensajeVisible[] };
        bienvenida();
        for (const m of h.mensajes) burbuja(m.rol, m.texto);
      } catch {
        bienvenida();
      }
    }

    function abrir(): void {
      panel.hidden = false;
      boton.setAttribute('aria-expanded', 'true');
      if (!historialCargado) void cargarHistorial();
      entrada.focus();
    }

    function cerrarPanel(): void {
      panel.hidden = true;
      boton.setAttribute('aria-expanded', 'false');
      boton.focus();
    }

    function ajustarAltura(): void {
      entrada.style.height = 'auto';
      entrada.style.height = `${Math.min(entrada.scrollHeight, 120)}px`;
    }

    function actualizarBoton(): void {
      enviar.disabled = esperando || entrada.value.trim() === '';
    }

    async function mandar(m: { id: string; texto: string }): Promise<void> {
      esperando = true;
      actualizarBoton();
      const escribiendo = document.createElement('div');
      escribiendo.className = 'escribiendo';
      escribiendo.setAttribute('aria-label', 'Escribiendo');
      escribiendo.innerHTML = 'Escribiendo<span>.</span><span>.</span><span>.</span>';
      lista.append(escribiendo);
      lista.scrollTop = lista.scrollHeight;

      const control = new AbortController();
      const reloj = setTimeout(() => control.abort(), ESPERA_MAXIMA_MS);
      try {
        const r = await fetch(`${api}/api/chat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ key, sessionToken, clientMessageId: m.id, texto: m.texto }),
          credentials: 'omit',
          signal: control.signal,
        });
        if (!r.ok) throw new Error(String(r.status));
        const d = (await r.json()) as RespuestaChat;
        // Tenía una conversación abierta y el servidor empezó otra: caducó
        // mientras el panel seguía abierto (PW-12).
        if (sessionToken && d.nuevaConversacion) burbuja('sistema', CONVERSACION_TERMINADA);
        if (d.sessionToken) {
          sessionToken = d.sessionToken;
          guardarToken(d.sessionToken);
        }
        pendiente = null;
        escribiendo.remove();
        burbuja('asistente', d.respuesta);
      } catch {
        escribiendo.remove();
        // Mismo clientMessageId al reintentar: si el servidor ya lo procesó,
        // devuelve la misma respuesta y no reserva dos veces.
        pendiente = m;
        const nota = burbuja('sistema', 'Está tardando más de lo normal o se ha cortado la conexión.');
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'reintentar';
        b.textContent = 'Reintentar';
        b.addEventListener('click', () => {
          nota.remove();
          b.remove();
          if (pendiente) void mandar(pendiente);
        });
        lista.append(b);
        lista.scrollTop = lista.scrollHeight;
      } finally {
        clearTimeout(reloj);
        esperando = false;
        actualizarBoton();
      }
    }

    boton.addEventListener('click', () => (panel.hidden ? abrir() : cerrarPanel()));
    cerrar.addEventListener('click', cerrarPanel);
    panel.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') cerrarPanel();
    });
    entrada.addEventListener('input', () => {
      ajustarAltura();
      actualizarBoton();
    });
    entrada.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
        ev.preventDefault();
        form.requestSubmit();
      }
    });
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const texto = entrada.value.trim();
      if (!texto || esperando || pendiente) return;
      entrada.value = '';
      ajustarAltura();
      burbuja('clienta', texto);
      void mandar({ id: uuid(), texto });
    });
    actualizarBoton();

    document.body.append(host);
  }
})();

/** Blanco o casi negro sobre el color del negocio, el que se lea mejor (WCAG). */
function contraste(hex: string): string {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const l = 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  return (1.05 / (l + 0.05) >= (l + 0.05) / 0.05) ? '#ffffff' : '#1a1a1a';
}
