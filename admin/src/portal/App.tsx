// =============================================================================
// El portal del cliente: marco, sesión y rutas (Fase 9 · 9.4; Fase 9b)
// =============================================================================
// Desde la Fase 9b se ve como los chats de IA que todo el mundo conoce
// (Mariana, 20/11/2026):
//
//   · A la izquierda, «Nuevo chat» y el historial de chats (PC-17). En la
//     vista Portal, las secciones del portal.
//   · Arriba en el centro, «Agente | Portal». El portal está SIEMPRE
//     disponible, con o sin datos (PC-19, reemplaza la parte de PC-11 que lo
//     escondía hasta terminar el alta). Lo vacío dice «Todavía no has
//     cargado… Pídeselo al agente», y ese botón abre un chat nuevo con el
//     mensaje ya enviado.
//   · Arriba a la derecha, un círculo con las iniciales del negocio. Al
//     pincharlo: el nombre completo, Perfil, Ajustes y Cerrar sesión. Perfil
//     y Ajustes se abren en una VENTANA encima (como ChatGPT, Mariana
//     20/11/2026): al cerrarla sigue donde estaba; ni el selector ni la barra
//     de la izquierda se mueven.
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
            {n.profesionales.filter((p) => p.activo).length === 0 ? <Pidelo seccion="profesionales" /> : null}
            <Agenda negocio={n} />
          </>
        ) : pantalla === 'configuracion' ? (
          <Ficha negocio={n} poner={poner} />
        ) : (
          <InicioPortal negocio={n} alta={alta} />
        )}
      </ProveedorNegocio>
    );
  }

  const barraLateral = (
    <BarraLateral
      vista={vista}
      pantalla={pantalla}
      chatId={chatId}
      chats={historial?.chats ?? []}
      nuevoChat={nuevoChat}
      recargar={() => void cargarHistorial()}
    />
  );

  return (
    <div className="flex h-dvh bg-[#f9f9f9] text-slate-900">
      <aside className="hidden w-64 shrink-0 border-r border-slate-200/70 bg-[#f3f3f3] md:flex md:flex-col">{barraLateral}</aside>
      {menuMovil ? (
        <div className="fixed inset-0 z-30 md:hidden">
          <button type="button" aria-label="Cerrar el menú" className="absolute inset-0 bg-black/30" onClick={() => setMenuMovil(false)} />
          <aside className="relative flex h-full w-72 max-w-[85%] flex-col bg-[#f3f3f3] shadow-xl">{barraLateral}</aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 px-3">
          <div className="flex w-24 items-center">
            <button type="button" aria-label="Abrir el menú" className="rounded-lg p-2 text-slate-600 hover:bg-slate-200/60 md:hidden" onClick={() => setMenuMovil(true)}>
              <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M3 6h14M3 10h14M3 14h14" /></svg>
            </button>
          </div>
          <div className="flex flex-1 justify-center">
            <Selector vista={vista} />
          </div>
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

function Circulo({ nombre, grande }: { nombre: string; grande?: boolean }) {
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full bg-violet-600 font-semibold text-white ${grande ? 'h-9 w-9 text-sm' : 'h-8 w-8 text-xs'}`} aria-hidden="true">
      {iniciales(nombre)}
    </span>
  );
}

function MenuPerfil({ sesion }: { sesion: SesionPortal }) {
  const [abierto, setAbierto] = useState(false);
  const [ventana, setVentana] = useState<'perfil' | 'ajustes' | null>(null);
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
      <button type="button" aria-label="Tu perfil" aria-expanded={abierto} className="rounded-full p-0.5 hover:ring-4 hover:ring-slate-200" onClick={() => setAbierto((a) => !a)}>
        <Circulo nombre={sesion.negocio.nombre} />
      </button>
      {abierto ? (
        <div role="menu" className="absolute right-0 top-11 z-40 w-64 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-lg">
          <div className="flex items-center gap-3 px-3 py-2.5">
            <Circulo nombre={sesion.negocio.nombre} grande />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-900">{sesion.negocio.nombre}</p>
              <p className="truncate text-xs text-slate-500">{sesion.email}</p>
            </div>
          </div>
          <div className="my-1 border-t border-slate-100" />
          <button role="menuitem" type="button" className={opcion} onClick={() => { setAbierto(false); setVentana('perfil'); }}><IconoPerfil />Perfil</button>
          <button role="menuitem" type="button" className={opcion} onClick={() => { setAbierto(false); setVentana('ajustes'); }}><IconoAjustes />Ajustes</button>
          <div className="my-1 border-t border-slate-100" />
          <button role="menuitem" type="button" className={opcion} onClick={() => void salir()}><IconoSalir />Cerrar sesión</button>
        </div>
      ) : null}
      {ventana === 'perfil' ? <Ventana titulo="Perfil" cerrar={() => setVentana(null)}><Perfil sesion={sesion} /></Ventana> : null}
      {ventana === 'ajustes' ? <Ventana titulo="Ajustes" cerrar={() => setVentana(null)}><Ajustes /></Ventana> : null}
    </div>
  );
}

/**
 * Una ventana encima de todo (Perfil, Ajustes). Se cierra con la ✕, con Esc o
 * pinchando fuera, y quien la abrió sigue exactamente donde estaba.
 */
function Ventana({ titulo, cerrar, children }: { titulo: string; cerrar: () => void; children: ReactNode }) {
  const caja = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && cerrar();
    document.addEventListener('keydown', tecla);
    caja.current?.focus();
    return () => document.removeEventListener('keydown', tecla);
  }, [cerrar]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Cerrar" tabIndex={-1} className="absolute inset-0 cursor-default bg-black/40" onClick={cerrar} />
      <div ref={caja} tabIndex={-1} role="dialog" aria-modal="true" aria-label={titulo} className="relative w-full max-w-lg rounded-2xl bg-white shadow-xl focus:outline-none">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-lg font-semibold">{titulo}</h2>
          <button type="button" aria-label={`Cerrar ${titulo.toLowerCase()}`} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" onClick={cerrar}>
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" /></svg>
          </button>
        </div>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

function BarraLateral({
  vista,
  pantalla,
  chatId,
  chats,
  nuevoChat,
  recargar,
}: {
  vista: 'agente' | 'portal';
  pantalla: string;
  chatId: string | null;
  chats: ChatResumido[];
  nuevoChat: () => void;
  recargar: () => void;
}) {
  const fila = (activo: boolean) => `flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${activo ? 'bg-slate-200/80 text-slate-900' : 'text-slate-700 hover:bg-slate-200/50'}`;
  return (
    <div className="flex h-full flex-col p-2">
      <button type="button" className={`${fila(false)} mt-1 font-medium`} onClick={nuevoChat}>
        <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M11.5 3.5h-6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-6" />
          <path d="M14.5 2.5l3 3-7 7H7.5v-3z" />
        </svg>
        Nuevo chat
      </button>
      {vista === 'portal' ? (
        <nav className="mt-4" aria-label="Secciones del portal">
          <p className="px-3 pb-1 text-xs font-medium text-slate-400">Portal</p>
          {[
            ['portal', 'Inicio'],
            ['agenda', 'Agenda'],
            ['configuracion', 'Configuración'],
          ].map(([clave, texto]) => (
            <a key={clave} href={`#/${clave}`} className={fila(pantalla === clave)}>{texto}</a>
          ))}
        </nav>
      ) : null}
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
        <p className="px-3 pb-1 text-xs font-medium text-slate-400">Chats</p>
        {chats.length === 0 ? <p className="px-3 py-2 text-sm text-slate-400">Todavía no hay ninguno.</p> : null}
        <ul aria-label="Tus chats">
          {chats.map((c) => <FilaChat key={c.id} chat={c} activo={vista === 'agente' && c.id === chatId} recargar={recargar} />)}
        </ul>
      </div>
    </div>
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

function Perfil({ sesion }: { sesion: SesionPortal }) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <Circulo nombre={sesion.negocio.nombre} grande />
        <div className="min-w-0">
          <p className="truncate font-semibold">{sesion.negocio.nombre}</p>
          <p className="text-sm text-slate-500">{sesion.email}</p>
        </div>
      </div>
      <p className="mt-4 text-sm text-slate-600">Entras con <strong>{sesion.email}</strong> y tu contraseña.</p>
      <p className="mt-2 text-sm text-slate-500">¿Necesitas cambiar el email o la contraseña, o que entre otra persona de tu equipo? Escríbele a MAZZMKT y te lo resuelven.</p>
      <button type="button" className="boton-suave mt-4" onClick={() => void salir()}>Cerrar sesión</button>
    </div>
  );
}

function Ajustes() {
  return <p className="text-sm text-slate-500">Próximamente.</p>;
}

function IconoPerfil() {
  return (
    <svg viewBox="0 0 20 20" className="h-[18px] w-[18px] text-slate-500" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="10" cy="7" r="3.2" />
      <path d="M3.8 16.5c1.2-2.8 3.5-4.2 6.2-4.2s5 1.4 6.2 4.2" strokeLinecap="round" />
    </svg>
  );
}

function IconoAjustes() {
  return (
    <svg viewBox="0 0 20 20" className="h-[18px] w-[18px] text-slate-500" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="10" cy="10" r="2.6" />
      <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" strokeLinecap="round" />
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
