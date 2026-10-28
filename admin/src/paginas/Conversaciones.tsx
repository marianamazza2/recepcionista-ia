// Visor de conversaciones (PI-06) y derivaciones pendientes (PI-07).

import { useState } from 'react';

import { api, type ConversacionDetalle, type ConversacionResumen, type Derivacion, type Linea, type Negocio } from '../api';
import { Aviso, Cargando, fechaHora, ir, motivo, useAccion, useCarga, usd } from '../ui';

const FILTROS = [
  ['todas', 'Todas'],
  ['derivadas', 'Derivadas'],
  ['pruebas', 'Pruebas'],
] as const;

export function Conversaciones({ negocio: n, abierta }: { negocio: Negocio; abierta: string | null }) {
  const [filtro, setFiltro] = useState<string>('todas');
  const { datos, error } = useCarga(() => api<ConversacionResumen[]>('GET', `negocios/${n.id}/conversaciones?filtro=${filtro}`), [n.id, filtro]);
  if (abierta) return <Detalle negocio={n} id={abierta} />;
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {FILTROS.map(([f, t]) => (
          <button key={f} type="button" onClick={() => setFiltro(f)} className={filtro === f ? 'boton' : 'boton-suave'}>{t}</button>
        ))}
      </div>
      {error ? <Aviso error={error} /> : !datos ? <Cargando /> : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr><th className="px-3 py-2">Último mensaje</th><th className="px-3 py-2">Clienta</th><th className="px-3 py-2">Canal</th><th className="px-3 py-2">Estado</th><th className="px-3 py-2 text-right">Mensajes</th><th className="px-3 py-2 text-right">Coste</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {datos.map((c) => (
                <tr key={c.id} className="cursor-pointer hover:bg-slate-50" onClick={() => ir(`negocios/${n.id}/conversaciones/${c.id}`)}>
                  <td className="px-3 py-2 whitespace-nowrap">{fechaHora(c.ultimoMensaje, n.timezone)}</td>
                  <td className="px-3 py-2">{c.clienta ? `${c.clienta.nombre ?? ''} ${c.clienta.telefono}` : <span className="text-slate-400">sin identificar</span>}</td>
                  <td className="px-3 py-2">{c.canal}{c.prueba ? <span className="ml-2 rounded bg-violet-100 px-1.5 text-xs text-violet-800">prueba</span> : null}</td>
                  <td className="px-3 py-2">
                    {c.estado}
                    {c.derivacionesPendientes > 0 ? <span className="ml-2 rounded bg-red-100 px-1.5 text-xs text-red-800">derivación pendiente</span> : c.derivaciones > 0 ? <span className="ml-2 text-xs text-slate-400">derivada</span> : null}
                  </td>
                  <td className="px-3 py-2 text-right">{c.mensajes}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{usd(c.costeUsd)}</td>
                </tr>
              ))}
              {datos.length === 0 ? <tr><td colSpan={6} className="px-3 py-6 text-slate-500">No hay conversaciones.</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Detalle({ negocio: n, id }: { negocio: Negocio; id: string }) {
  const { datos: c, error } = useCarga(() => api<ConversacionDetalle>('GET', `negocios/${n.id}/conversaciones/${id}`), [n.id, id]);
  if (error) return <Aviso error={error} />;
  if (!c) return <Cargando />;
  return (
    <div className="space-y-4">
      <a href={`#/negocios/${n.id}/conversaciones`} className="text-sm text-slate-500 hover:text-slate-800">← Conversaciones</a>
      <div className="tarjeta flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <span><strong>Clienta:</strong> {c.clienta ? `${c.clienta.nombre ?? ''} ${c.clienta.telefono}` : 'sin identificar'}</span>
        <span><strong>Empezó:</strong> {fechaHora(c.creada, n.timezone)}</span>
        <span><strong>Estado:</strong> {c.estado}{c.prueba ? ' · prueba' : ''}</span>
        <span><strong>Coste:</strong> {usd(c.costeUsd)} · {c.tokens.toLocaleString('es-ES')} tokens</span>
      </div>
      {c.derivaciones.map((d) => (
        <p key={d.id} className={`rounded-md px-3 py-2 text-sm ${d.resuelta ? 'bg-slate-100 text-slate-600' : 'bg-red-50 text-red-900'}`}>
          <strong>{motivo(d.motivo).titulo}</strong> {motivo(d.motivo).resumen} · {fechaHora(d.creada, n.timezone)} · {d.resuelta ? 'resuelta' : 'pendiente'}
        </p>
      ))}
      <div className="space-y-2">{c.lineas.map((l, i) => <LineaVista key={i} l={l} />)}</div>
    </div>
  );
}

function LineaVista({ l }: { l: Linea }) {
  if (l.tipo === 'clienta') return <p className="ml-auto max-w-[75%] whitespace-pre-wrap rounded-2xl bg-slate-900 px-3 py-2 text-sm text-white">{l.texto}</p>;
  if (l.tipo === 'asistente') {
    return (
      <p className="max-w-[75%] whitespace-pre-wrap rounded-2xl bg-white px-3 py-2 text-sm shadow-xs ring-1 ring-slate-200">
        {l.texto}
        {l.respuestaFija ? <span className="mt-1 block text-xs text-amber-700">Respuesta fija ({l.respuestaFija})</span> : null}
      </p>
    );
  }
  return (
    <details className={`max-w-[85%] rounded-md border px-3 py-1.5 text-xs ${l.error ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-slate-50'}`}>
      <summary className="cursor-pointer font-mono text-slate-700">🔧 {l.nombre}{l.error ? ' · error' : ''}</summary>
      <p className="mt-2 font-medium text-slate-500">Pidió</p>
      <pre className="overflow-x-auto whitespace-pre-wrap text-slate-800">{JSON.stringify(l.entrada, null, 2)}</pre>
      <p className="mt-2 font-medium text-slate-500">Le devolvió</p>
      <pre className="overflow-x-auto whitespace-pre-wrap text-slate-800">{typeof l.resultado === 'string' ? l.resultado : JSON.stringify(l.resultado, null, 2)}</pre>
    </details>
  );
}

export function Derivaciones({ negocio: n, onCambio }: { negocio: Negocio; onCambio: () => void }) {
  const { datos, error, poner } = useCarga(() => api<Derivacion[]>('GET', `negocios/${n.id}/derivaciones`), [n.id]);
  const a = useAccion();
  if (error) return <Aviso error={error} />;
  if (!datos) return <Cargando />;
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">Las conversaciones que el agente pasó a una persona. Márcalas como resueltas cuando el equipo las haya atendido.</p>
      {datos.length === 0 ? <p className="tarjeta text-sm text-slate-500">No hay derivaciones pendientes.</p> : null}
      {datos.map((d) => (
        <div key={d.id} className="tarjeta flex flex-wrap items-center gap-3 text-sm">
          <div className="min-w-0 flex-1">
            <p className="font-medium">{motivo(d.motivo).titulo}{d.prueba ? <span className="ml-2 rounded bg-violet-100 px-1.5 text-xs text-violet-800">prueba</span> : null}</p>
            <p className="text-slate-600">{motivo(d.motivo).resumen}</p>
            <p className="text-xs text-slate-400">{fechaHora(d.creada, n.timezone)} · {d.clienta ? `${d.clienta.nombre ?? ''} ${d.clienta.telefono}` : 'sin identificar'}</p>
          </div>
          <a className="boton-suave" href={`#/negocios/${n.id}/conversaciones/${d.conversationId}`}>Ver conversación</a>
          <button
            type="button"
            className="boton"
            disabled={a.ocupado}
            onClick={() => void a.hacer(async () => { poner(await api('POST', `negocios/${n.id}/derivaciones/${d.id}/resolver`)); onCambio(); }, 'Marcada como resuelta.')}
          >
            Resuelta
          </button>
        </div>
      ))}
      <Aviso error={a.error} ok={a.ok} />
    </div>
  );
}
