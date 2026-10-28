// Consumo del mes de todos los negocios (PI-11): lo mismo que `npm run
// consumo`, con las pruebas del panel aparte (PI-13) y el aviso del 80 %.

import { useState } from 'react';

import { api, type InformeConsumo } from '../api';
import { Aviso, Cargando, useCarga, usd } from '../ui';

export function Consumo() {
  const [mes, setMes] = useState('');
  const { datos, error } = useCarga(() => api<InformeConsumo[]>('GET', `consumo${mes ? `?mes=${mes}` : ''}`), [mes]);
  const n = (x: number) => x.toLocaleString('es-ES');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-xl font-semibold">Consumo</h1>
          <p className="text-sm text-slate-500">Coste de la IA del mes por negocio, en dólares. Las pruebas del panel van aparte, pero cuentan para el tope.</p>
        </div>
        <label className="ml-auto"><span className="etiqueta">Mes</span><input type="month" className="campo" value={mes} onChange={(e) => setMes(e.target.value)} /></label>
      </div>
      {error ? <Aviso error={error} /> : !datos ? <Cargando /> : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Negocio</th><th className="px-3 py-2 text-right">Mensajes</th><th className="px-3 py-2 text-right">Conversaciones</th>
                <th className="px-3 py-2 text-right">Citas</th><th className="px-3 py-2 text-right">Coste</th><th className="px-3 py-2 text-right">Pruebas</th><th className="px-3 py-2 text-right">% del tope</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {datos.map((r) => {
                const pct = r.fraccionTope === null ? null : r.fraccionTope * 100;
                const color = pct === null ? '' : pct >= 100 ? 'bg-red-100 text-red-900' : r.aviso ? 'bg-amber-100 text-amber-900' : '';
                return (
                  <tr key={r.businessId}>
                    <td className="px-3 py-2"><a className="font-medium hover:underline" href={`#/negocios/${r.businessId}/conversaciones`}>{r.negocio}</a> <span className="text-xs text-slate-400">{r.mes}</span></td>
                    <td className="px-3 py-2 text-right">{n(r.mensajes)}</td>
                    <td className="px-3 py-2 text-right">{n(r.conversaciones)}</td>
                    <td className="px-3 py-2 text-right">{n(r.citas)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{usd(r.costeUsd)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap text-slate-500">{r.pruebas.conversaciones ? `${n(r.pruebas.conversaciones)} · ${usd(r.pruebas.costeUsd)}` : '—'}</td>
                    <td className="px-3 py-2 text-right">
                      <span className={`rounded px-1.5 py-0.5 ${color}`}>{pct === null ? 'tope 0' : `${pct.toLocaleString('es-ES', { maximumFractionDigits: 1 })} % de ${usd(r.topeUsd, 0)}`}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {datos?.some((r) => r.modelosSinPrecio.length) ? <p className="text-xs text-amber-700">Hay modelos sin precio en core/costes.ts (contados a 0).</p> : null}
    </div>
  );
}
