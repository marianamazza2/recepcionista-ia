// =============================================================================
// El portal del cliente: marco, sesión y rutas (Fase 9 · 9.4; Fase 9b)
// =============================================================================
// Desde la Fase 9b se ve como los chats de IA que todo el mundo conoce
// (Mariana, 20/11/2026):
//
//   · A la izquierda, arriba el nombre del negocio con la lupa que busca
//     chats (como «ChatGPT» en ChatGPT, Mariana 20/11/2026); debajo «Nuevo
//     chat» y el historial (PC-17). En la vista Portal, las secciones del portal.
//   · Arriba en el centro, «Agente | Portal». El portal está SIEMPRE
//     disponible, con o sin datos (PC-19, reemplaza la parte de PC-11 que lo
//     escondía hasta terminar el alta). Lo vacío dice «Todavía no has
//     cargado… Pídeselo al agente», y ese botón abre un chat nuevo con el
//     mensaje ya enviado.
//   · Arriba a la derecha, un círculo con las iniciales del negocio. Al
//     pincharlo: «Cuenta» (icono de perfil) con el nombre del negocio y el
//     email debajo como datos (los dos en gris), «Ajustes» (engranaje) y
//     Cerrar sesión. Nada abre ventanas ni páginas aparte (Mariana,
//     20/11/2026): de momento no hay más que enseñar.
//   · En el móvil, como ChatGPT (Mariana, 20/11/2026): ☰ a la izquierda y el
//     círculo a la derecha, sin selector arriba. El menú ☰: el nombre del
//     negocio en negrita, su email y la lupa para buscar chats; Agente y
//     Portal; la raya; el historial; y «Nuevo chat» abajo del todo.
//
//   #/invitacion/:token   crear la cuenta con el enlace (PC-02)
//   #/                    un chat nuevo: el saludo y las sugerencias
//   #/chat/:id            un chat del historial
//   #/nuevo/:pedido       un chat nuevo con ese mensaje ya enviado (pedir.ts)
//   #/portal              el inicio del portal: lo que falta del alta
//   #/agenda              su agenda visual (PC-16)
//   #/configuracion       su configuración (la MISMA ficha que ve Mariana)
// =============================================================================

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { api, alCambiarSesion, guardarSesion, salir, sesionGuardada, type ChatResumido, type Historial, type SesionPortal } from './api';
import { Chat } from './Chat';
import { CrearCuenta, Entrar } from './Entrar';
import { esPedido, NOMBRE_SECCION, PEDIDOS, SECCIONES_ALTA, sugerencias, VACIO, type Pedido, type SeccionAlta } from './pedir';
import type { Negocio } from '../api';
import { ProveedorNegocio } from '../negocio-api';
import { Agenda } from '../paginas/Agenda';
import { Ficha } from '../paginas/Ficha';
import { Aviso, Cargando, ir, useCarga, useRuta } from '../ui';

export function App() {
  const [sesion, setSesion] = useState<SesionPortal | null>(sesionGuardada());
  useEffect(() => alCambiarSesion(setSesion), []);
  const ruta = useRuta();

  // Con la cuenta ya creada, el enlace deja de llevar a ninguna parte.
  useEffect(() => {
    if (sesion && ruta[0] === 'invitacion') ir('');
  }, [sesion, ruta]);

  // PC-02: la única puerta para crear la cuenta.
  if (ruta[0] === 'invitacion' && ruta[1] && !sesion) return <CrearCuenta token={ruta[1]} />;
  if (!sesion) return <Entrar />;
  if (ruta[0] === 'invitacion') return <Cargando />;
  return <Dentro sesion={sesion} ruta={ruta} />;
}

const VISTA_PORTAL = new Set(['portal', 'agenda', 'configuracion']);

function Dentro({ sesion, ruta }: { sesion: SesionPortal; ruta: string[] }) {
  const pantalla = ruta[0] ?? '';
  const vista: 'agente' | 'portal' = VISTA_PORTAL.has(pantalla) ? 'portal' : 'agente';
  const [historial, setHistorial] = useState<Historial | null>(null);
  const [errorHistorial, setErrorHistorial] = useState<string | null>(null);
  const [menuMovil, setMenuMovil] = useState(false);

  const cargarHistorial = () =>
    api<Historial>('GET', 'chats').then(
      (h) => {
        setHistorial(h);
        // El nombre del negocio, al día: si se cambia, el círculo y el menú lo enseñan sin volver a entrar.
        guardarSesion({ ...sesion, alta: h.alta, negocio: { ...sesion.negocio, nombre: h.negocio.nombre } });
      },
      (e: unknown) => setErrorHistorial(e instanceof Error ? e.message : 'No se ha podido cargar el historial.'),
    );
  useEffect(() => {
    void cargarHistorial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => setMenuMovil(false), [ruta.join('/')]);

  // El chat se vuelve a montar al cambiar de chat, salvo cuando el chat nuevo
  // que está en pantalla acaba de recibir su id (sigue siendo el mismo).
  const [vez, setVez] = useState(0);
  const recienCreado = useRef<string | null>(null);
  const claveNueva = useRef('');
  const chatId = pantalla === 'chat' ? (ruta[1] ?? null) : null;
  let claveChat: string;
  if (chatId && chatId === recienCreado.current) {
    claveChat = claveNueva.current;
  } else {
    recienCreado.current = null;
    claveChat = chatId ? `chat-${chatId}` : `nuevo-${vez}-${ruta.join('/')}`;
    if (!chatId) claveNueva.current = claveChat;
  }
  const nuevoChat = () => {
    recienCreado.current = null;
    setVez((v) => v + 1);
    ir('');
  };

  // La configuración y la agenda son las del panel, contra /api/portal/negocio/… (PC-05).
  const { datos: n, error, poner } = useCarga(() => (vista === 'portal' ? api<Negocio>('GET', 'negocio') : Promise.resolve(null)), [vista, pantalla]);
  const apiDelPortal = {
    ver: 'portal' as const,
    pedir: <T,>(metodo: 'GET' | 'POST' | 'PUT' | 'DELETE', camino: string, body?: unknown) => api<T>(metodo, `negocio${camino ? `/${camino}` : ''}`, body),
    // PC-19: «Pídeselo al agente» abre un chat nuevo con el mensaje ya enviado.
    pedirAlAgente: (p: Pedido) => ir(`nuevo/${p}`),
  };

  const alta = historial?.alta ?? sesion.alta;
  const pedido = pantalla === 'nuevo' && esPedido(ruta[1]) ? ruta[1] : undefined;

  let contenido: ReactNode;
  if (vista === 'agente') {
    contenido = !historial ? (
      errorHistorial ? <div className="p-6"><Aviso error={errorHistorial} /></div> : <p className="p-6 text-center text-sm text-slate-400">Cargando…</p>
    ) : (
      <Chat
        key={claveChat}
        chatId={chatId === recienCreado.current ? null : chatId}
        saludo={historial.saludo}
        sugerencias={sugerencias(alta)}
        mensajeInicial={pedido ? PEDIDOS[pedido].mensaje : undefined}
        alCrear={(id) => {
          recienCreado.current = id;
          window.history.replaceState(null, '', `#/chat/${id}`);
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        }}
        alResponder={() => void cargarHistorial()}
      />
    );
  } else {
    contenido = error ? (
      <Aviso error={error} />
    ) : !n ? (
      <Cargando />
    ) : (
      <ProveedorNegocio valor={apiDelPortal}>
        {pantalla === 'agenda' ? (
          <>
            <VolverAlInicio aqui="Agenda" />
            {n.profesionales.filter((p) => p.activo).length === 0 ? <Pidelo seccion="profesionales" /> : null}
            <Agenda negocio={n} />
          </>
        ) : pantalla === 'configuracion' ? (
          <>
            <VolverAlInicio aqui="Configuración" />
            <Ficha negocio={n} poner={poner} />
          </>
        ) : (
          <InicioPortal negocio={n} alta={alta} />
        )}
      </ProveedorNegocio>
    );
  }

  const propsBarra = {
    vista,
    pantalla,
    chatId,
    chats: historial?.chats ?? [],
    recargar: () => void cargarHistorial(),
  };

  return (
    <div className="flex h-dvh bg-[#f9f9f9] text-slate-900">
      <aside aria-label="Barra lateral" className="hidden w-64 shrink-0 border-r border-slate-200/70 bg-[#f3f3f3] md:flex md:flex-col">
        <BarraLateral {...propsBarra} sesion={sesion} nuevoChat={nuevoChat} />
      </aside>
      {menuMovil ? (
        <div className="fixed inset-0 z-30 md:hidden">
          <button type="button" aria-label="Cerrar el menú" className="absolute inset-0 bg-black/30" onClick={() => setMenuMovil(false)} />
          <aside aria-label="Menú" className="relative flex h-full w-72 max-w-[85%] flex-col bg-[#f3f3f3] shadow-xl">
            <BarraLateral {...propsBarra} sesion={sesion} movil cerrar={() => setMenuMovil(false)} nuevoChat={() => { setMenuMovil(false); nuevoChat(); }} />
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 px-3">
          <div className="flex w-24 items-center">
            <button type="button" aria-label="Abrir el menú" className="rounded-lg p-2 text-slate-600 hover:bg-slate-200/60 md:hidden" onClick={() => setMenuMovil(true)}>
              <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M3 6h14M3 10h14M3 14h14" /></svg>
            </button>
          </div>
          {/* En el móvil, «Agente | Portal» va dentro del menú ☰ (Mariana, 20/11/2026). */}
          <div className="hidden flex-1 justify-center md:flex">
            <Selector vista={vista} />
          </div>
          <div className="flex-1 md:hidden" />
          <div className="flex w-24 justify-end">
            <MenuPerfil sesion={sesion} />
          </div>
        </header>
        <main className={`min-h-0 flex-1 ${vista === 'agente' ? '' : 'overflow-y-auto'}`}>
          {vista === 'agente' ? contenido : <div className="mx-auto max-w-6xl px-4 py-6">{contenido}</div>}
        </main>
      </div>
    </div>
  );
}

/**
 * «⌂ Inicio › Agenda»: en Agenda y Configuración, la vuelta al inicio del
 * portal a la vista, no solo en la barra de la izquierda (que en el móvil está
 * escondida). Mariana, 20/11/2026.
 */
function VolverAlInicio({ aqui }: { aqui: string }) {
  return (
    <nav aria-label="Dónde estás" className="mb-4 flex items-center gap-1.5 text-sm">
      <a href="#/portal" className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 -ml-1.5 text-slate-500 hover:bg-slate-200/60 hover:text-slate-800">
        <IconoInicio />Inicio
      </a>
      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 text-slate-300" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 5l5 5-5 5" /></svg>
      <span aria-current="page" className="text-slate-800">{aqui}</span>
    </nav>
  );
}

function IconoInicio() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 9.2L10 3.5l7 5.7" />
      <path d="M5 8v7.5a1 1 0 0 0 1 1h2.8v-4.5h2.4v4.5H14a1 1 0 0 0 1-1V8" />
    </svg>
  );
}

/** «Agente | Portal», arriba en el centro. */
function Selector({ vista }: { vista: 'agente' | 'portal' }) {
  const boton = (activo: boolean) =>
    `rounded-full px-4 py-1.5 text-sm font-medium transition ${activo ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`;
  return (
    <nav className="flex rounded-full bg-slate-200/70 p-1" aria-label="Agente o portal">
      <a href="#/" className={boton(vista === 'agente')} aria-current={vista === 'agente' ? 'page' : undefined}>Agente</a>
      <a href="#/portal" className={boton(vista === 'portal')} aria-current={vista === 'portal' ? 'page' : undefined}>Portal</a>
    </nav>
  );
}

/** Las iniciales del negocio: «Clínica Aurora» → «CA». Sin «de», «la»…: «Centro de Estética» → «CE». */
export function iniciales(nombre: string): string {
  const palabras = nombre
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s+/)
    .filter((p) => p && !/^(de|del|la|las|el|los|y|e|i)$/i.test(p) && /\p{L}|\d/u.test(p));
  const letras = palabras.slice(0, 2).map((p) => (p.match(/[\p{L}\d]/u)?.[0] ?? '').toUpperCase());
  return letras.join('') || '·';
}

function Circulo({ nombre }: { nombre: string }) {
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full bg-violet-600 font-semibold text-white h-8 w-8 text-xs`} aria-hidden="true">
      {iniciales(nombre)}
    </span>
  );
}

function MenuPerfil({ sesion }: { sesion: SesionPortal }) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false);
    };
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && setAbierto(false);
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('mousedown', fuera);
      document.removeEventListener('keydown', tecla);
    };
  }, [abierto]);
  const opcion = 'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100';
  return (
    <div ref={caja} className="relative">
      <button type="button" aria-label="Tu perfil" aria-expanded={abierto} className="cursor-pointer rounded-full p-0.5 hover:ring-4 hover:ring-slate-200" onClick={() => setAbierto((a) => !a)}>
        <Circulo nombre={sesion.negocio.nombre} />
      </button>
      {abierto ? (
        <div role="menu" aria-label="Tu cuenta" className="absolute right-0 top-11 z-40 w-64 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-lg">
          <CuentaYAjustes sesion={sesion} />
          <div className="my-1 border-t border-slate-100" />
          <button role="menuitem" type="button" className={opcion} onClick={() => void salir()}><IconoSalir />Cerrar sesión</button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * «Cuenta» (el nombre y el email como datos: no se pinchan ni abren nada) y
 * «Ajustes» (todavía no hay ninguno, así que no abre nada; se decide qué
 * lleva más adelante). En el desplegable del círculo, en el ordenador y en el
 * móvil (PC-17, Mariana, 20/11/2026).
 */
function CuentaYAjustes({ sesion }: { sesion: SesionPortal }) {
  return (
    <>
      <section aria-label="Cuenta" className="px-3 py-2">
        <p className="flex items-center gap-3 text-sm text-slate-700"><IconoPerfil />Cuenta</p>
        <div className="min-w-0 pl-[30px] pt-1">
          <p className="truncate text-xs text-slate-500">{sesion.negocio.nombre}</p>
          <p className="truncate text-xs text-slate-500">{sesion.email}</p>
        </div>
      </section>
      <p aria-disabled="true" className="flex items-center gap-3 px-3 py-2 text-sm text-slate-700">
        <IconoAjustes />Ajustes
      </p>
    </>
  );
}

function BarraLateral({
  vista,
  pantalla,
  chatId,
  chats,
  nuevoChat,
  recargar,
  sesion,
  movil,
  cerrar,
}: {
  vista: 'agente' | 'portal';
  pantalla: string;
  chatId: string | null;
  chats: ChatResumido[];
  nuevoChat: () => void;
  recargar: () => void;
  sesion: SesionPortal;
  /**
   * Como ChatGPT (Mariana, 20/11/2026), arriba siempre el nombre del negocio
   * en negrita y, a su derecha, la lupa que busca chats. En el ordenador,
   * debajo «Nuevo chat», las secciones del portal y el historial. En el menú
   * ☰ del móvil, además el email; luego Agente y Portal, la raya, el
   * historial y «Nuevo chat» abajo del todo.
   */
  movil?: boolean;
  cerrar?: () => void;
}) {
  const [buscando, setBuscando] = useState(false);
  const fila = (activo: boolean) => `flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${activo ? 'bg-slate-200/80 text-slate-900' : 'text-slate-700 hover:bg-slate-200/50'}`;
  const botonNuevo = (
    <button type="button" className={`${fila(false)} font-medium ${movil ? '' : 'mt-2'}`} onClick={nuevoChat}>
      <IconoNuevoChat />
      Nuevo chat
    </button>
  );
  const secciones = (
    [
      ['portal', 'Inicio'],
      ['agenda', 'Agenda'],
      ['configuracion', 'Configuración'],
    ] as const
  ).map(([clave, texto]) => (
    <a key={clave} href={`#/${clave}`} className={`${fila(pantalla === clave)} ${movil ? 'pl-7' : ''}`} onClick={cerrar}>{texto}</a>
  ));
  return (
    <div className="flex h-full flex-col p-2">
      <div className="pt-1">
        <div className={`flex gap-2 pl-3 pt-1 ${movil ? 'items-start' : 'items-center'}`}>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-900" title={sesion.negocio.nombre}>{sesion.negocio.nombre}</p>
            {movil ? <p className="truncate text-xs text-slate-500">{sesion.email}</p> : null}
          </div>
          <button
            type="button"
            aria-label="Buscar chats"
            className={`rounded-lg p-2 text-slate-600 hover:bg-slate-200/60 ${movil ? '-mt-1' : ''}`}
            onClick={() => setBuscando(true)}
          >
            <IconoBuscar />
          </button>
        </div>
        {/* La lupa abre la búsqueda como ChatGPT (Mariana, 20/11/2026): en el ordenador, una ventana en el centro; en el móvil, a pantalla completa. */}
        {buscando ? <BuscarChats chats={chats} movil={movil} cerrar={() => setBuscando(false)} alAbrir={cerrar} /> : null}
        {movil ? (
          <>
            <nav className="mt-3" aria-label="Ir a">
              <a href="#/" className={fila(vista === 'agente')} onClick={cerrar}>Agente</a>
              <a href="#/portal" className={fila(vista === 'portal' && pantalla === 'portal')} onClick={cerrar}>Portal</a>
              {vista === 'portal' ? secciones.slice(1) : null}
            </nav>
            <div className="mx-3 mt-2 border-t border-slate-200" />
          </>
        ) : (
          botonNuevo
        )}
      </div>
      {vista === 'portal' && !movil ? (
        <nav className="mt-4" aria-label="Secciones del portal">
          <p className="px-3 pb-1 text-xs font-medium text-slate-400">Portal</p>
          {secciones}
        </nav>
      ) : null}
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
        <p className="px-3 pb-1 text-xs font-medium text-slate-400">Chats</p>
        {chats.length === 0 ? <p className="px-3 py-2 text-sm text-slate-400">Todavía no hay ninguno.</p> : null}
        <ul aria-label="Tus chats">
          {chats.map((c) => <FilaChat key={c.id} chat={c} activo={vista === 'agente' && c.id === chatId} recargar={recargar} />)}
        </ul>
      </div>
      {movil ? <div className="border-t border-slate-200 pt-2">{botonNuevo}</div> : null}
    </div>
  );
}

/** La lupa busca por el título del chat, sin mirar mayúsculas ni tildes. */
function filtrarChats(chats: ChatResumido[], busqueda: string): ChatResumido[] {
  const plano = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const buscado = plano(busqueda.trim());
  return buscado ? chats.filter((c) => plano(c.titulo).includes(buscado)) : chats;
}

/**
 * La búsqueda de chats, como ChatGPT (Mariana, 20/11/2026). Busca por el
 * título, sin mirar mayúsculas ni tildes; pinchar un chat lo abre e Intro
 * abre el primero.
 *   · En el ordenador, una ventana en el centro: «Buscar…» y la ✕ arriba,
 *     «Chats recientes» y los chats que coinciden. Esc, la ✕ o pinchar fuera
 *     la cierran.
 *   · En el móvil, a pantalla completa: «Últimos abiertos» arriba, cada chat
 *     con su icono, su título y su último mensaje en gris, y abajo la caja
 *     «Buscar» con la ✕ al lado (vuelve al menú).
 */
function BuscarChats({ chats, movil, cerrar, alAbrir }: { chats: ChatResumido[]; movil?: boolean; cerrar: () => void; alAbrir?: () => void }) {
  const [busqueda, setBusqueda] = useState('');
  const encontrados = filtrarChats(chats, busqueda);
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && cerrar();
    document.addEventListener('keydown', tecla);
    return () => document.removeEventListener('keydown', tecla);
  }, [cerrar]);
  const abrir = (id: string) => {
    cerrar();
    alAbrir?.();
    ir(`chat/${id}`);
  };
  const vacio = busqueda.trim() === '';
  const avisos = (
    <>
      {chats.length === 0 ? <p className="px-3 py-2 text-sm text-slate-400">Todavía no hay ninguno.</p> : null}
      {chats.length > 0 && encontrados.length === 0 ? <p className="px-3 py-2 text-sm text-slate-400">Ningún chat con «{busqueda.trim()}».</p> : null}
    </>
  );
  const campo = (clase: string) => (
    <input
      type="search"
      aria-label="Buscar en tus chats"
      placeholder={movil ? 'Buscar' : 'Buscar…'}
      autoFocus
      enterKeyHint="search"
      value={busqueda}
      onChange={(e) => setBusqueda(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && encontrados[0]) abrir(encontrados[0].id);
      }}
      className={`min-w-0 flex-1 bg-transparent text-slate-900 placeholder:text-slate-400 focus:outline-none [&::-webkit-search-cancel-button]:hidden ${clase}`}
    />
  );
  const equis = (
    <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" /></svg>
  );

  if (movil) {
    return (
      <div role="dialog" aria-modal="true" aria-label="Buscar chats" className="fixed inset-0 z-50 flex h-dvh flex-col bg-white">
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-6">
          {vacio && chats.length > 0 ? <h2 className="pb-3 text-lg font-medium text-slate-900">Últimos abiertos</h2> : null}
          {avisos}
          <ul aria-label="Chats encontrados" className="space-y-1">
            {encontrados.map((c) => (
              <li key={c.id}>
                <button type="button" className="flex w-full items-center gap-4 rounded-xl py-2.5 text-left active:bg-slate-100" onClick={() => abrir(c.id)}>
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200"><IconoChat /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] text-slate-900">{c.titulo}</span>
                    {c.ultimo ? <span className="block truncate text-sm text-slate-500">{c.ultimo}</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex items-center gap-2 px-3 pb-4 pt-2">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-slate-100 px-4 py-2.5">
            <span className="text-slate-500"><IconoBuscar /></span>
            {campo('text-base')}
          </label>
          <button type="button" aria-label="Cerrar la búsqueda" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700" onClick={cerrar}>
            {equis}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[18vh]">
      <button type="button" aria-label="Cerrar la búsqueda" tabIndex={-1} className="absolute inset-0 cursor-default bg-black/5" onClick={cerrar} />
      <div role="dialog" aria-modal="true" aria-label="Buscar chats" className="relative flex max-h-[60vh] min-h-[320px] w-full max-w-2xl flex-col rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center gap-3 px-6 pb-2 pt-5">
          {campo('text-[15px]')}
          <button type="button" aria-label="Cerrar" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" onClick={cerrar}>
            {equis}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-3">
          {vacio ? <p className="px-3 pb-2 text-sm text-slate-500">Chats recientes</p> : null}
          {avisos}
          <ul aria-label="Chats encontrados">
            {encontrados.map((c) => (
              <li key={c.id}>
                <button type="button" className="flex w-full items-center gap-4 rounded-xl px-3 py-3 text-left text-sm text-slate-800 hover:bg-slate-100" onClick={() => abrir(c.id)}>
                  <IconoChat />
                  <span className="min-w-0 truncate">{c.titulo}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function IconoChat() {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5 shrink-0 text-slate-700" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 3.5c3.9 0 7 2.7 7 6s-3.1 6-7 6c-.9 0-1.8-.1-2.6-.4L4 16.5l1-3c-1.2-1.1-2-2.5-2-4 0-3.3 3.1-6 7-6z" />
    </svg>
  );
}

function IconoBuscar() {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
      <circle cx="8.75" cy="8.75" r="5.25" />
      <path d="M12.75 12.75L16.5 16.5" />
    </svg>
  );
}

function IconoNuevoChat() {
  return (
    <svg viewBox="0 0 20 20" className="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11.5 3.5h-6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-6" />
      <path d="M14.5 2.5l3 3-7 7H7.5v-3z" />
    </svg>
  );
}

/** Un chat del historial; con «…» se renombra o se borra (PC-17). */
function FilaChat({ chat, activo, recargar }: { chat: ChatResumido; activo: boolean; recargar: () => void }) {
  const [menu, setMenu] = useState(false);
  const [editando, setEditando] = useState(false);
  const [titulo, setTitulo] = useState(chat.titulo);
  const renombrar = async () => {
    setEditando(false);
    if (titulo.trim() && titulo.trim() !== chat.titulo) await api('PUT', `chats/${chat.id}`, { titulo: titulo.trim() }).catch(() => undefined);
    recargar();
  };
  const borrar = async () => {
    setMenu(false);
    if (!window.confirm(`¿Borrar el chat «${chat.titulo}»? Lo que se guardó desde él no se borra.`)) return;
    await api('DELETE', `chats/${chat.id}`).catch(() => undefined);
    if (activo) ir('');
    recargar();
  };
  return (
    <li className={`group relative flex items-center rounded-lg ${activo ? 'bg-slate-200/80' : 'hover:bg-slate-200/50'}`}>
      {editando ? (
        <input
          className="m-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
          aria-label="Nuevo título"
          value={titulo}
          autoFocus
          maxLength={80}
          onChange={(e) => setTitulo(e.target.value)}
          onBlur={() => void renombrar()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void renombrar();
            if (e.key === 'Escape') {
              setTitulo(chat.titulo);
              setEditando(false);
            }
          }}
        />
      ) : (
        <a href={`#/chat/${chat.id}`} className="min-w-0 flex-1 truncate px-3 py-2 text-sm text-slate-700" title={chat.titulo}>{chat.titulo}</a>
      )}
      {!editando ? (
        <button
          type="button"
          aria-label={`Opciones de ${chat.titulo}`}
          className={`mr-1 rounded-md px-1.5 py-1 text-slate-500 hover:bg-slate-300/60 ${menu || activo ? 'visible' : 'invisible group-hover:visible'}`}
          onClick={() => setMenu((m) => !m)}
        >
          ⋯
        </button>
      ) : null}
      {menu ? (
        <div role="menu" className="absolute right-0 top-9 z-20 w-40 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
          <button role="menuitem" type="button" className="w-full rounded-lg px-3 py-1.5 text-left text-sm hover:bg-slate-100" onClick={() => { setMenu(false); setEditando(true); }}>Renombrar</button>
          <button role="menuitem" type="button" className="w-full rounded-lg px-3 py-1.5 text-left text-sm text-red-700 hover:bg-red-50" onClick={() => void borrar()}>Borrar</button>
        </div>
      ) : null}
    </li>
  );
}

/** PC-19: «Todavía no has cargado… Pídeselo al agente». */
function Pidelo({ seccion }: { seccion: SeccionAlta }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <span>{VACIO[seccion]}</span>
      <a className="boton" href={`#/nuevo/${seccion}`}>Pídeselo al agente</a>
    </div>
  );
}

/** El inicio del portal: lo que falta del alta, con un botón para pedírselo al agente. */
function InicioPortal({ negocio: n, alta }: { negocio: Negocio; alta: { terminada: boolean; hechas: string[]; faltan: string[] } }) {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Tu portal</h1>
        <p className="mt-1 text-sm text-slate-600">
          Aquí ves y cambias todo lo de tu recepcionista: a mano, en <a className="underline" href="#/configuracion">Configuración</a>, o pidiéndoselo al agente.
        </p>
      </div>
      <section className="tarjeta" aria-label="Tu alta">
        <h2 className="text-base font-semibold">{alta.terminada ? 'Tu alta está completa' : 'Tu alta'}</h2>
        {!alta.terminada ? <p className="mt-1 text-sm text-slate-500">Puedes hacerla en el orden que quieras.</p> : null}
        <ul className="mt-4 divide-y divide-slate-100">
          {SECCIONES_ALTA.map((s) => {
            const hecha = alta.terminada || alta.hechas.includes(s);
            return (
              <li key={s} className="flex items-center justify-between gap-3 py-3">
                <span className="flex min-w-0 flex-1 items-center gap-3 text-sm">
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${hecha ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`} aria-hidden="true">{hecha ? '✓' : '·'}</span>
                  <span className="min-w-0">
                    <span className={`block ${hecha ? 'text-slate-900' : 'text-slate-700'}`}>{NOMBRE_SECCION[s]}</span>
                    {!hecha ? <span className="block text-xs text-slate-400">{VACIO[s]}</span> : null}
                  </span>
                </span>
                {!hecha ? <a className="boton-suave shrink-0" href={`#/nuevo/${s}`}>Pídeselo al agente</a> : null}
              </li>
            );
          })}
        </ul>
      </section>
      <div className="grid gap-4 sm:grid-cols-2">
        <a href="#/agenda" className="tarjeta block hover:border-slate-300">
          <h2 className="text-base font-semibold">Agenda</h2>
          <p className="mt-1 text-sm text-slate-600">Las citas del día y de la semana. Pincha un hueco para cargar una cita.</p>
        </a>
        <a href="#/configuracion" className="tarjeta block hover:border-slate-300">
          <h2 className="text-base font-semibold">Configuración</h2>
          <p className="mt-1 text-sm text-slate-600">Servicios, equipo, horarios, festivos, preguntas frecuentes y el chat en tu web.</p>
        </a>
      </div>
      {alta.terminada ? (
        n.loQueFalta.length > 0 ? (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-semibold">Falta algo antes de que tu chat salga en tu web</p>
            <ul className="mt-1 list-disc pl-5">{n.loQueFalta.map((f) => <li key={f.codigo}>{f.texto}</li>)}</ul>
            <p className="mt-1">Lo arreglas en <a className="underline" href="#/configuracion">Configuración</a>.</p>
          </div>
        ) : (
          <p className="text-sm text-emerald-700">No falta nada: MAZZMKT revisa tu configuración y publica tu chat.</p>
        )
      ) : null}
    </div>
  );
}

function IconoPerfil() {
  return (
    <svg viewBox="0 0 20 20" className="h-[18px] w-[18px] shrink-0 text-slate-500" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="10" cy="7" r="3.2" />
      <path d="M3.8 16.5c1.2-2.8 3.5-4.2 6.2-4.2s5 1.4 6.2 4.2" strokeLinecap="round" />
    </svg>
  );
}

function IconoAjustes() {
  return (
    // Un engranaje (el de Heroicons, MIT), no un sol (Mariana, 20/11/2026).
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0 text-slate-500" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
      <path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  );
}

function IconoSalir() {
  return (
    <svg viewBox="0 0 20 20" className="h-[18px] w-[18px] text-slate-500" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 4H5a1.5 1.5 0 0 0-1.5 1.5v9A1.5 1.5 0 0 0 5 16h3M12.5 13.5 16 10l-3.5-3.5M16 10H8" />
    </svg>
  );
}
