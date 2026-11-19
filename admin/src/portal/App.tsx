// =============================================================================
// El portal del cliente: marco, sesión y rutas (Fase 9 · 9.4)
// =============================================================================
//   #/invitacion/:token   crear la cuenta con el enlace (PC-02)
//   #/                    el chat; al terminar el alta, el portal (PC-11)
//   #/agenda              su agenda visual (PC-16)
//   #/configuracion       su configuración (la MISMA ficha que ve Mariana)
//   #/cuenta              su email y salir
//
// Mientras el alta no esté terminada se ve SOLO el chat: con el negocio vacío
// las demás secciones serían huecos y botones que no llevan a nada (PC-11).
//
// El aspecto es el del panel a propósito (decisión de Mariana, 19/11/2026):
// primero que funcione; cómo tiene que lucir se repasa con ella después, con
// capturas de cada pantalla.
// =============================================================================

import { useEffect, useState } from 'react';

import { api, alCambiarSesion, guardarSesion, salir, sesionGuardada, type SesionPortal } from './api';
import { Chat } from './Chat';
import { CrearCuenta, Entrar } from './Entrar';
import type { Negocio } from '../api';
import { ProveedorNegocio } from '../negocio-api';
import { Agenda } from '../paginas/Agenda';
import { Ficha } from '../paginas/Ficha';
import { Aviso, Cargando, useCarga, useRuta } from '../ui';

export function App() {
  const [sesion, setSesion] = useState<SesionPortal | null>(sesionGuardada());
  useEffect(() => alCambiarSesion(setSesion), []);
  const ruta = useRuta();

  // PC-02: la única puerta para crear la cuenta.
  if (ruta[0] === 'invitacion' && ruta[1]) return <CrearCuenta token={ruta[1]} />;
  if (!sesion) return <Entrar />;
  return <Dentro sesion={sesion} ruta={ruta} />;
}

function Dentro({ sesion, ruta }: { sesion: SesionPortal; ruta: string[] }) {
  const [terminada, setTerminada] = useState(sesion.alta.terminada);
  const { datos: n, error, poner, recargar } = useCarga(() => (terminada ? api<Negocio>('GET', 'negocio') : Promise.resolve(null)), [terminada]);

  // PC-05: la ficha y la agenda son las del panel, contra /api/portal/negocio/…
  const apiDelPortal = {
    ver: 'portal' as const,
    pedir: <T,>(metodo: 'GET' | 'POST' | 'PUT' | 'DELETE', camino: string, body?: unknown) =>
      api<T>(metodo, `negocio${camino ? `/${camino}` : ''}`, body),
  };

  const alTerminarElAlta = () => {
    setTerminada(true);
    guardarSesion({ ...sesion, alta: { ...sesion.alta, terminada: true } });
    recargar();
  };

  const seccion = ruta[0] ?? '';
  const SECCIONES: [string, string][] = [
    ['', 'Chat'],
    ['agenda', 'Agenda'],
    ['configuracion', 'Configuración'],
    ['cuenta', 'Tu cuenta'],
  ];

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <a href="#/" className="font-semibold">{sesion.negocio.nombre}</a>
          {terminada ? (
            <nav className="flex gap-4 text-sm text-slate-600">
              {SECCIONES.map(([clave, texto]) => (
                <a key={clave} href={`#/${clave}`} className={seccion === clave ? 'font-medium text-slate-900' : 'hover:text-slate-900'}>{texto}</a>
              ))}
            </nav>
          ) : null}
          <div className="ml-auto flex items-center gap-3 text-sm text-slate-500">
            <span className="hidden sm:inline">{sesion.email}</span>
            <button type="button" className="boton-suave" onClick={() => void salir()}>Salir</button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {!terminada ? (
          <>
            <p className="mb-4 text-sm text-slate-500">
              Vamos a configurar tu recepcionista hablando. Te hago una pregunta cada vez y, antes de guardar nada, te enseño un resumen para que lo confirmes.
            </p>
            <Chat alTerminarElAlta={alTerminarElAlta} />
          </>
        ) : error ? (
          <Aviso error={error} />
        ) : !n ? (
          <Cargando />
        ) : (
          <ProveedorNegocio valor={apiDelPortal}>
            {seccion === 'agenda' ? (
              <Agenda negocio={n} />
            ) : seccion === 'configuracion' ? (
              <Ficha negocio={n} poner={poner} />
            ) : seccion === 'cuenta' ? (
              <Cuenta sesion={sesion} />
            ) : (
              <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
                <Bienvenida negocio={n} />
                <div>
                  <h2 className="mb-2 text-sm font-semibold text-slate-500">Pídeme cambios por aquí</h2>
                  <Chat alTerminarElAlta={alTerminarElAlta} compacto />
                </div>
              </div>
            )}
          </ProveedorNegocio>
        )}
      </main>
    </div>
  );
}

/** La portada de después del alta: lo justo para saber dónde está todo. */
function Bienvenida({ negocio: n }: { negocio: Negocio }) {
  return (
    <div className="space-y-4">
      <div className="tarjeta">
        <h1 className="text-lg font-semibold">Ya tienes tu portal listo</h1>
        <p className="mt-2 text-sm text-slate-600">
          Aquí ves y cambias todo lo de tu recepcionista. Puedes hacerlo a mano en <a className="underline" href="#/configuracion">Configuración</a> o pedírmelo por el chat de al lado
          («Núria no viene el jueves», «la limpieza ahora dura 75 minutos»).
        </p>
        <ul className="mt-4 space-y-2 text-sm">
          <li><a className="underline" href="#/agenda">Tu agenda</a>: las citas del día y de la semana. Pincha un hueco para cargar una cita y una cita para verla o cancelarla.</li>
          <li><a className="underline" href="#/configuracion">Preguntas frecuentes</a>: lo que quieras que conteste tal cual.</li>
          <li><a className="underline" href="#/configuracion">El chat en tu web</a>: el color de tu marca, tu logo y los dominios donde aparece.</li>
          <li><a className="underline" href="#/configuracion">Festivos y ausencias</a>: tus cierres y las vacaciones del equipo.</li>
        </ul>
      </div>
      {n.loQueFalta.length > 0 ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="font-semibold">Falta algo antes de que tu chat salga en tu web</p>
          <ul className="mt-1 list-disc pl-5">
            {n.loQueFalta.map((f) => <li key={f.codigo}>{f.texto}</li>)}
          </ul>
          <p className="mt-1">Lo arreglas en <a className="underline" href="#/configuracion">Configuración</a>.</p>
        </div>
      ) : (
        <p className="text-sm text-emerald-700">No falta nada: MAZZMKT revisa tu configuración y publica tu chat.</p>
      )}
    </div>
  );
}

function Cuenta({ sesion }: { sesion: SesionPortal }) {
  return (
    <div className="tarjeta max-w-md">
      <h1 className="text-lg font-semibold">Tu cuenta</h1>
      <p className="mt-2 text-sm text-slate-600">Entras con <strong>{sesion.email}</strong> y tu contraseña.</p>
      <p className="mt-2 text-sm text-slate-500">¿Necesitas cambiar el email o la contraseña, o que entre otra persona de tu equipo? Escríbele a MAZZMKT y te lo resuelven.</p>
      <button type="button" className="boton-suave mt-4" onClick={() => void salir()}>Salir</button>
    </div>
  );
}
