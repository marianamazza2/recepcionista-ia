// Lista de negocios con su estado y lo que falta (PI-03), y alta de uno nuevo.

import { useState, type FormEvent } from 'react';

import { api, type NegocioResumen } from '../api';
import { Aviso, Cargando, EtiquetaEstado, ir, useAccion, useCarga } from '../ui';

export function Negocios() {
  const { datos, error } = useCarga(() => api<NegocioResumen[]>('GET', 'negocios'), []);
  const [nombre, setNombre] = useState('');
  const a = useAccion();

  const crear = (e: FormEvent) => {
    e.preventDefault();
    void a.hacer(async () => {
      const r = await api<{ id: string }>('POST', 'negocios', { nombre });
      ir(`negocios/${r.id}/ficha`);
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Negocios</h1>
        <p className="text-sm text-slate-500">Un negocio nuevo empieza en prueba y sin dominios: su chat no aparece en ninguna web hasta que lo actives.</p>
      </div>
      <form onSubmit={crear} className="tarjeta flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <label className="etiqueta" htmlFor="nuevo">Dar de alta un negocio</label>
          <input id="nuevo" className="campo" placeholder="Nombre del negocio" required value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </div>
        <button className="boton" disabled={a.ocupado}>Crear</button>
        <div className="w-full"><Aviso error={a.error} /></div>
      </form>
      {error ? <Aviso error={error} /> : !datos ? <Cargando /> : (
        <ul className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
          {datos.map((n) => (
            <li key={n.id}>
              <a href={`#/negocios/${n.id}/ficha`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-slate-50">
                <span className="font-medium">{n.nombre}</span>
                <EtiquetaEstado estado={n.estado} />
                {n.derivacionesPendientes > 0 ? (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">{n.derivacionesPendientes} derivación{n.derivacionesPendientes > 1 ? 'es' : ''} pendiente{n.derivacionesPendientes > 1 ? 's' : ''}</span>
                ) : null}
                <span className="ml-auto text-xs text-slate-500">
                  {n.loQueFalta.length ? `Falta: ${n.loQueFalta.map((f) => f.texto).join(' · ')}` : 'Completo'}
                </span>
              </a>
            </li>
          ))}
          {datos.length === 0 ? <li className="px-4 py-6 text-sm text-slate-500">Todavía no hay negocios.</li> : null}
        </ul>
      )}
    </div>
  );
}
