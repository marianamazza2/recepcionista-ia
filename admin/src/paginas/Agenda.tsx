// Agenda del negocio por día y citas a mano (PR-04, PI-14).

import { useState } from 'react';

import { api, type CitaAgenda, type Negocio } from '../api';
import { Aviso, Cargando, useAccion, useCarga } from '../ui';

function hoyEn(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}

function moverDia(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}

const ESTADO: Record<string, string> = { confirmada: 'Confirmada', cancelada: 'Cancelada', completada: 'Completada', no_show: 'No se presentó' };
const ORIGEN: Record<string, string> = { agente: 'chat', manual: 'a mano', externo: 'externa' };

export function Agenda({ negocio: n }: { negocio: Negocio }) {
  const [fecha, setFecha] = useState(hoyEn(n.timezone));
  const { datos, error, recargar } = useCarga(() => api<{ fecha: string; citas: CitaAgenda[] }>('GET', `negocios/${n.id}/agenda?fecha=${fecha}`), [n.id, fecha]);
  const a = useAccion();
  const dia = new Date(`${fecha}T12:00:00Z`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="boton-suave" onClick={() => setFecha(moverDia(fecha, -1))} aria-label="Día anterior">←</button>
          <input type="date" className="campo w-auto" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} />
          <button type="button" className="boton-suave" onClick={() => setFecha(moverDia(fecha, 1))} aria-label="Día siguiente">→</button>
          <button type="button" className="boton-suave" onClick={() => setFecha(hoyEn(n.timezone))}>Hoy</button>
          <span className="text-sm capitalize text-slate-600">{dia}</span>
        </div>
        {error ? <Aviso error={error} /> : !datos ? <Cargando /> : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm">
            {datos.citas.map((c) => (
              <li key={c.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${c.estado === 'cancelada' ? 'text-slate-400 line-through decoration-slate-300' : ''}`}>
                <span className="w-24 font-mono">{c.horaInicio}–{c.horaFin}</span>
                <span className="font-medium">{c.servicio}</span>
                <span>con {c.profesional}</span>
                <span className="text-slate-600">{c.clienta.nombre ?? ''} {c.clienta.telefono}</span>
                <span className="text-xs text-slate-400">{ESTADO[c.estado]} · {ORIGEN[c.origen]}</span>
                {c.estado === 'confirmada' ? (
                  <button
                    type="button"
                    className="ml-auto text-xs text-red-700 hover:underline"
                    disabled={a.ocupado}
                    onClick={() =>
                      confirm(`¿Cancelar la cita de ${c.clienta.nombre ?? c.clienta.telefono} a las ${c.horaInicio}? Le llegará un SMS de cancelación.`) &&
                      void a.hacer(async () => { await api('POST', `negocios/${n.id}/citas/${c.id}/cancelar`); recargar(); }, 'Cita cancelada.')
                    }
                  >
                    Cancelar
                  </button>
                ) : null}
              </li>
            ))}
            {datos.citas.length === 0 ? <li className="px-4 py-6 text-slate-500">No hay citas este día.</li> : null}
          </ul>
        )}
        <Aviso error={a.error} ok={a.ok} />
      </div>
      <CitaAMano negocio={n} fecha={fecha} onCreada={recargar} />
    </div>
  );
}

function CitaAMano({ negocio: n, fecha, onCreada }: { negocio: Negocio; fecha: string; onCreada: () => void }) {
  const servicios = n.servicios.filter((s) => s.activo);
  const [f, setF] = useState({ serviceId: '', staffId: '', hora: '', telefono: '', nombre: '', notas: '' });
  const a = useAccion();
  const servicio = f.serviceId || servicios[0]?.id || '';
  const quienes = n.profesionales.filter((p) => p.activo && p.servicioIds.includes(servicio));
  const staff = quienes.some((p) => p.id === f.staffId) ? f.staffId : (quienes[0]?.id ?? '');
  const crear = () =>
    a.hacer(async () => {
      const r = await api<{ sms: string | null }>('POST', `negocios/${n.id}/citas`, { serviceId: servicio, staffId: staff, fecha, hora: f.hora, telefono: f.telefono, nombre: f.nombre, notas: f.notas || null });
      setF({ ...f, hora: '', telefono: '', nombre: '', notas: '' });
      onCreada();
      return r;
    }, 'Cita cargada. Se le ha mandado el SMS de confirmación.');
  return (
    <div className="tarjeta h-fit">
      <h2 className="text-base font-semibold">Cargar una cita a mano</h2>
      <p className="mt-1 text-xs text-slate-500">A cualquier hora (fuera de la rejilla) y sin antelación mínima. No se salta el horario, los festivos ni que dos citas se pisen. Llega el mismo SMS que si reservara el agente.</p>
      <div className="mt-4 space-y-3">
        <label className="block"><span className="etiqueta">Servicio</span>
          <select className="campo" value={servicio} onChange={(e) => setF({ ...f, serviceId: e.target.value })}>
            {servicios.map((s) => <option key={s.id} value={s.id}>{s.nombre} ({s.duracionMin} min)</option>)}
          </select>
        </label>
        <label className="block"><span className="etiqueta">Profesional</span>
          <select className="campo" value={staff} onChange={(e) => setF({ ...f, staffId: e.target.value })}>
            {quienes.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </label>
        <label className="block"><span className="etiqueta">Hora ({fecha.split('-').reverse().join('/')})</span><input className="campo" type="time" value={f.hora} onChange={(e) => setF({ ...f, hora: e.target.value })} /></label>
        <label className="block"><span className="etiqueta">Teléfono de la clienta</span><input className="campo" placeholder="+34 600 000 000" value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} /></label>
        <label className="block"><span className="etiqueta">Nombre</span><input className="campo" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></label>
        <label className="block"><span className="etiqueta">Notas (opcional)</span><input className="campo" value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} /></label>
        <button type="button" className="boton w-full" disabled={a.ocupado || !servicio || !staff || !f.hora || !f.telefono || !f.nombre} onClick={() => void crear()}>Cargar cita</button>
      </div>
      <Aviso error={a.error} ok={a.ok} />
    </div>
  );
}
