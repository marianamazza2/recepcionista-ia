// Un negocio: cabecera con su estado y las secciones del panel.
//
// Fase 9 (PC-05): la ficha y la agenda son las MISMAS pantallas que ve el
// cliente en su portal. Aquí se les da la API del panel con
// <ProveedorNegocio>, con `ver: panel` (Mariana sí ve el tope, activa/pausa y
// la clave del widget). La pestaña "Portal" le enseña su portal tal cual.

import { api, type Negocio } from '../api';
import { ProveedorNegocio } from '../negocio-api';
import { Aviso, Cargando, EtiquetaEstado, useCarga } from '../ui';
import { Invitacion } from './Invitacion';
import { Agenda } from './Agenda';
import { Conversaciones, Derivaciones } from './Conversaciones';
import { Ficha } from './Ficha';
import { Probar } from './Probar';

const SECCIONES = [
  ['ficha', 'Ficha'],
  ['agenda', 'Agenda'],
  ['probar', 'Probar el chat'],
  ['conversaciones', 'Conversaciones'],
  ['derivaciones', 'Derivaciones'],
  ['portal', 'Su portal'],
] as const;

export function NegocioPagina({ id, seccion, sub }: { id: string; seccion: string; sub: string | null }) {
  const { datos: n, error, poner, recargar } = useCarga(() => api<Negocio>('GET', `negocios/${id}`), [id]);
  if (error) return <Aviso error={error} />;
  if (!n) return <Cargando />;
  const partes = [seccion, sub];
  // PC-05: la ficha y la agenda del panel hablan con /api/admin/negocios/:id/…
  const apiDelPanel = {
    ver: 'panel' as const,
    pedir: <T,>(metodo: 'GET' | 'POST' | 'PUT' | 'DELETE', camino: string, body?: unknown) =>
      api<T>(metodo, `negocios/${id}${camino ? `/${camino}` : ''}`, body),
  };
  return (
    <div className="space-y-6">
      <div>
        <a href="#/" className="text-sm text-slate-500 hover:text-slate-800">← Negocios</a>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">{n.nombre}</h1>
          <EtiquetaEstado estado={n.estado} />
          <span className="text-xs text-slate-400">{n.slug}</span>
        </div>
        <nav className="mt-4 flex flex-wrap gap-1 border-b border-slate-200">
          {SECCIONES.map(([clave, texto]) => (
            <a
              key={clave}
              href={`#/negocios/${id}/${clave}`}
              className={`-mb-px border-b-2 px-3 py-2 text-sm ${partes[0] === clave ? 'border-slate-900 font-medium text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
            >
              {texto}
            </a>
          ))}
        </nav>
      </div>
      <ProveedorNegocio valor={apiDelPanel}>
        {partes[0] === 'probar' ? (
          <Probar negocio={n} />
        ) : partes[0] === 'conversaciones' ? (
          <Conversaciones negocio={n} abierta={sub} />
        ) : partes[0] === 'derivaciones' ? (
          <Derivaciones negocio={n} onCambio={recargar} />
        ) : partes[0] === 'agenda' ? (
          <Agenda negocio={n} />
        ) : partes[0] === 'portal' ? (
          <Invitacion negocio={n} poner={poner} />
        ) : (
          <Ficha negocio={n} poner={poner} />
        )}
      </ProveedorNegocio>
    </div>
  );
}
