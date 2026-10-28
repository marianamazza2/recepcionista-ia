// =============================================================================
// Panel interno: marco, sesión y rutas (Fase 4 · 4.3)
// =============================================================================
//   #/                       negocios
//   #/consumo                consumo del mes (PI-11)
//   #/negocios/:id/:seccion  ficha · probar · conversaciones(/:cid) · derivaciones · agenda
// Sin sesión, solo "Entrar" (PI-01).
// =============================================================================

import { useEffect, useState } from 'react';

import { alCambiarSesion, salir, sesionGuardada, type Sesion } from './api';
import { Consumo } from './paginas/Consumo';
import { Entrar } from './paginas/Entrar';
import { NegocioPagina } from './paginas/Negocio';
import { Negocios } from './paginas/Negocios';
import { useRuta } from './ui';

export function App() {
  const [sesion, setSesion] = useState<Sesion | null>(sesionGuardada());
  useEffect(() => alCambiarSesion(setSesion), []);
  const ruta = useRuta();

  if (!sesion) return <Entrar />;

  const [primera, id, seccion, sub] = ruta;
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
          <a href="#/" className="font-semibold">Recepcionista IA · Panel</a>
          <nav className="flex gap-4 text-sm text-slate-600">
            <a href="#/" className={primera !== 'consumo' ? 'text-slate-900 font-medium' : 'hover:text-slate-900'}>Negocios</a>
            <a href="#/consumo" className={primera === 'consumo' ? 'text-slate-900 font-medium' : 'hover:text-slate-900'}>Consumo</a>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-slate-500">
            <span className="hidden sm:inline">{sesion.email}</span>
            <button type="button" className="boton-suave" onClick={salir}>Salir</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        {primera === 'consumo' ? <Consumo /> : primera === 'negocios' && id ? <NegocioPagina id={id} seccion={seccion ?? 'ficha'} sub={sub ?? null} /> : <Negocios />}
      </main>
    </div>
  );
}
