// =============================================================================
// La agenda visual (Fase 9 · 9.4b, PC-16) — la misma en el panel y en el portal
// =============================================================================
// Hasta la Fase 9 esto era una lista. Ahora es lo que espera una recepción:
//
//   · vista de DÍA con una columna por profesional y las horas hacia abajo;
//   · vista de SEMANA con una columna por día;
//   · cada cita, un bloque con su hora, su servicio y su clienta;
//   · lo que está fuera de horario o cerrado (festivo, "no trabaja"), sombreado;
//   · pinchar un hueco libre → cargar una cita a mano (PI-14: a cualquier hora,
//     pero nunca fuera de horario, en festivo ni pisando otra; eso lo decide la
//     base, aquí no se repite ninguna regla);
//   · pinchar una cita → verla y cancelarla (con su email de aviso, PW-10).
//
// Sin librería de calendario: una rejilla propia con CSS (D-82). Las que se
// conocen cobran la vista por profesional, y las dependencias se mantienen
// mínimas. Los tramos los calcula la base (app.tramos_efectivos: PD-01, PI-19
// y los turnos sueltos de PC-06) y llegan ya resueltos en la respuesta.
//
// En el móvil la rejilla se desplaza en horizontal: en la recepción a veces se
// mira desde el teléfono.
// =============================================================================

import { useState } from 'react';

import type { Agenda as AgendaDatos, CitaAgenda, DiaAgenda, Negocio } from '../api';
import { useApiNegocio } from '../negocio-api';
import { Aviso, Cargando, fechaCorta, useAccion, useCarga } from '../ui';

const ESTADO: Record<string, string> = { confirmada: 'Confirmada', cancelada: 'Cancelada', completada: 'Completada', no_show: 'No se presentó' };
const ORIGEN: Record<string, string> = { agente: 'la recepcionista', manual: 'a mano', externo: 'fuera' };

/** Alto de la rejilla por minuto (48 px cada hora). */
const PX_POR_MINUTO = 0.8;
const MINUTO_MINIMO = 7 * 60;
const MINUTO_MAXIMO = 22 * 60;

function minutos(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}

function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

function moverDia(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}

/** El lunes de la semana de esa fecha (en España la semana empieza el lunes). */
function lunesDe(fecha: string): string {
  const [y, m, d] = fecha.split('-').map(Number) as [number, number, number];
  const dia = new Date(Date.UTC(y, m - 1, d));
  return moverDia(fecha, -((dia.getUTCDay() + 6) % 7));
}

function diaLargo(fecha: string): string {
  return new Date(`${fecha}T12:00:00Z`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}

function diaCorto(fecha: string): string {
  return new Date(`${fecha}T12:00:00Z`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** De qué hora a qué hora se dibuja: lo que abarcan los tramos y las citas. */
function franja(dias: DiaAgenda[]): { desde: number; hasta: number } {
  let desde = Infinity;
  let hasta = -Infinity;
  for (const d of dias) {
    for (const t of d.tramos) {
      desde = Math.min(desde, minutos(t.desde));
      hasta = Math.max(hasta, t.hasta === '24:00' ? 24 * 60 : minutos(t.hasta));
    }
    for (const c of d.citas) {
      desde = Math.min(desde, minutos(c.horaInicio));
      hasta = Math.max(hasta, minutos(c.horaFin));
    }
  }
  if (!Number.isFinite(desde) || !Number.isFinite(hasta)) return { desde: 9 * 60, hasta: 20 * 60 };
  return {
    desde: Math.max(MINUTO_MINIMO, Math.floor((desde - 30) / 60) * 60),
    hasta: Math.min(MINUTO_MAXIMO, Math.ceil((hasta + 30) / 60) * 60),
  };
}

interface HuecoPinchado {
  fecha: string;
  hora: string;
  staffId: string | null;
}

export function Agenda({ negocio: n }: { negocio: Negocio }) {
  const { pedir } = useApiNegocio();
  const [vista, setVista] = useState<'dia' | 'semana'>('dia');
  const [fecha, setFecha] = useState<string | null>(null);
  const [hueco, setHueco] = useState<HuecoPinchado | null>(null);
  const [abierta, setAbierta] = useState<CitaAgenda | null>(null);
  const a = useAccion();

  const desde = fecha === null ? null : vista === 'semana' ? lunesDe(fecha) : fecha;
  const { datos, error, recargar } = useCarga(
    () => pedir<AgendaDatos>('GET', `agenda${desde ? `?fecha=${desde}` : ''}${vista === 'semana' ? `${desde ? '&' : '?'}dias=7` : ''}`),
    [n.id, desde, vista],
  );

  if (error) return <Aviso error={error} />;
  if (!datos) return <Cargando />;

  const hoy = datos.hoy;
  const actual = desde ?? datos.desde;
  const paso = vista === 'semana' ? 7 : 1;
  const { desde: minDesde, hasta: minHasta } = franja(datos.dias);
  const alto = (minHasta - minDesde) * PX_POR_MINUTO;

  const cancelar = (c: CitaAgenda) =>
    a.hacer(async () => {
      await pedir('POST', `citas/${c.id}/cancelar`);
      setAbierta(null);
      recargar();
    }, 'Cita cancelada. Si la clienta tiene email, le llega el aviso.');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="boton-suave" onClick={() => setFecha(moverDia(actual, -paso))} aria-label="Anterior">←</button>
        <input type="date" className="campo w-auto" value={vista === 'semana' ? lunesDe(actual) : actual} onChange={(e) => e.target.value && setFecha(e.target.value)} />
        <button type="button" className="boton-suave" onClick={() => setFecha(moverDia(actual, paso))} aria-label="Siguiente">→</button>
        <button type="button" className="boton-suave" onClick={() => setFecha(hoy)}>Hoy</button>
        <div className="ml-auto flex overflow-hidden rounded-md border border-slate-200 text-sm">
          {(['dia', 'semana'] as const).map((v) => (
            <button
              key={v}
              type="button"
              className={`px-3 py-1.5 ${vista === v ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              onClick={() => setVista(v)}
            >
              {v === 'dia' ? 'Día' : 'Semana'}
            </button>
          ))}
        </div>
      </div>

      <p className="text-sm capitalize text-slate-600">
        {vista === 'dia' ? diaLargo(actual) : `Semana del ${fechaCorta(lunesDe(actual))} al ${fechaCorta(moverDia(lunesDe(actual), 6))}`}
      </p>

      {vista === 'dia' ? (
        <RejillaDia dia={datos.dias[0]!} profesionales={datos.profesionales} desde={minDesde} hasta={minHasta} alto={alto} onHueco={setHueco} onCita={setAbierta} />
      ) : (
        <RejillaSemana dias={datos.dias} hoy={hoy} desde={minDesde} hasta={minHasta} alto={alto} onHueco={setHueco} onCita={setAbierta} />
      )}

      <Aviso error={a.error} ok={a.ok} />

      {abierta ? <DetalleCita cita={abierta} ocupado={a.ocupado} cerrar={() => setAbierta(null)} cancelar={() => void cancelar(abierta)} /> : null}
      {hueco ? (
        <CitaAMano
          negocio={n}
          hueco={hueco}
          cerrar={() => setHueco(null)}
          onCreada={() => {
            setHueco(null);
            recargar();
          }}
        />
      ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// La rejilla
// -----------------------------------------------------------------------------

function Horas({ desde, hasta }: { desde: number; hasta: number }) {
  const horas: number[] = [];
  for (let m = desde; m <= hasta; m += 60) horas.push(m);
  return (
    <div className="relative w-12 flex-none select-none">
      {horas.map((m) => (
        <div key={m} className="absolute -translate-y-1/2 pr-2 text-right text-xs text-slate-400" style={{ top: (m - desde) * PX_POR_MINUTO, width: '3rem' }}>
          {hhmm(m)}
        </div>
      ))}
    </div>
  );
}

function Lineas({ desde, hasta }: { desde: number; hasta: number }) {
  const horas: number[] = [];
  for (let m = desde; m <= hasta; m += 60) horas.push(m);
  return (
    <>
      {horas.map((m) => (
        <div key={m} className="pointer-events-none absolute inset-x-0 border-t border-slate-100" style={{ top: (m - desde) * PX_POR_MINUTO }} />
      ))}
    </>
  );
}

/**
 * Una columna: lo abierto en blanco (y pinchable), lo cerrado sombreado, y las
 * citas encima. Los tramos vienen de la base, así que el sombreado es
 * exactamente lo que el motor considera cerrado.
 */
function Columna({
  tramos,
  citas,
  desde,
  hasta,
  alto,
  onHueco,
  onCita,
  etiquetaProfesional,
}: {
  tramos: { desde: string; hasta: string; suelto: boolean }[];
  citas: CitaAgenda[];
  desde: number;
  hasta: number;
  alto: number;
  onHueco: (hora: string) => void;
  onCita: (c: CitaAgenda) => void;
  etiquetaProfesional?: boolean;
}) {
  /** Pinchar en el hueco: la hora sale de dónde se pinchó, redondeada a 5 min. */
  const alPinchar = (e: React.MouseEvent<HTMLDivElement>) => {
    const caja = e.currentTarget.getBoundingClientRect();
    const min = desde + Math.round((e.clientY - caja.top) / PX_POR_MINUTO / 5) * 5;
    onHueco(hhmm(Math.max(desde, Math.min(hasta - 5, min))));
  };
  return (
    <div className="relative min-w-0 flex-1 border-l border-slate-200 bg-slate-50" style={{ height: alto }}>
      {tramos.map((t, i) => {
        const d = Math.max(desde, minutos(t.desde));
        const h = Math.min(hasta, t.hasta === '24:00' ? 24 * 60 : minutos(t.hasta));
        if (h <= d) return null;
        return (
          <div
            key={i}
            role="button"
            tabIndex={0}
            aria-label={`Abierto de ${t.desde} a ${t.hasta}. Pincha para cargar una cita`}
            className={`absolute inset-x-0 cursor-pointer ${t.suelto ? 'bg-sky-50' : 'bg-white'} hover:bg-sky-100/60`}
            style={{ top: (d - desde) * PX_POR_MINUTO, height: (h - d) * PX_POR_MINUTO }}
            onClick={alPinchar}
            onKeyDown={(e) => e.key === 'Enter' && onHueco(t.desde)}
          />
        );
      })}
      <Lineas desde={desde} hasta={hasta} />
      {citas.map((c) => {
        const d = Math.max(desde, minutos(c.horaInicio));
        const h = Math.min(hasta, minutos(c.horaFin));
        const cancelada = c.estado === 'cancelada';
        return (
          <button
            key={c.id}
            type="button"
            className={`absolute inset-x-0.5 overflow-hidden rounded-md border px-1.5 py-0.5 text-left text-[11px] leading-tight shadow-sm ${
              cancelada ? 'border-slate-200 bg-slate-100 text-slate-400 line-through' : 'border-slate-900/10 bg-emerald-100 text-emerald-950 hover:bg-emerald-200'
            }`}
            style={{ top: (d - desde) * PX_POR_MINUTO, height: Math.max(18, (h - d) * PX_POR_MINUTO - 2) }}
            onClick={() => onCita(c)}
          >
            <span className="font-medium">{c.horaInicio}</span> {c.clienta.nombre ?? c.clienta.telefono}
            <span className="block truncate opacity-80">{c.servicio}{etiquetaProfesional ? ` · ${c.profesional}` : ''}</span>
          </button>
        );
      })}
    </div>
  );
}

function RejillaDia({
  dia,
  profesionales,
  desde,
  hasta,
  alto,
  onHueco,
  onCita,
}: {
  dia: DiaAgenda;
  profesionales: { id: string; nombre: string }[];
  desde: number;
  hasta: number;
  alto: number;
  onHueco: (h: HuecoPinchado) => void;
  onCita: (c: CitaAgenda) => void;
}) {
  if (profesionales.length === 0) return <p className="text-sm text-slate-500">Todavía no hay ninguna profesional activa.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <div className="min-w-[32rem]">
        <div className="flex border-b border-slate-200 text-sm">
          <div className="w-12 flex-none" />
          {profesionales.map((p) => (
            <div key={p.id} className="min-w-0 flex-1 truncate border-l border-slate-200 px-2 py-2 font-medium">{p.nombre}</div>
          ))}
        </div>
        <div className="flex pt-2">
          <Horas desde={desde} hasta={hasta} />
          {profesionales.map((p) => (
            <Columna
              key={p.id}
              tramos={dia.tramos.filter((t) => t.staffId === p.id)}
              citas={dia.citas.filter((c) => c.staffId === p.id)}
              desde={desde}
              hasta={hasta}
              alto={alto}
              onHueco={(hora) => onHueco({ fecha: dia.fecha, hora, staffId: p.id })}
              onCita={onCita}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function RejillaSemana({
  dias,
  hoy,
  desde,
  hasta,
  alto,
  onHueco,
  onCita,
}: {
  dias: DiaAgenda[];
  hoy: string;
  desde: number;
  hasta: number;
  alto: number;
  onHueco: (h: HuecoPinchado) => void;
  onCita: (c: CitaAgenda) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <div className="min-w-[44rem]">
        <div className="flex border-b border-slate-200 text-sm">
          <div className="w-12 flex-none" />
          {dias.map((d) => (
            <div key={d.fecha} className={`min-w-0 flex-1 truncate border-l border-slate-200 px-2 py-2 capitalize ${d.fecha === hoy ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>
              {diaCorto(d.fecha)}
            </div>
          ))}
        </div>
        <div className="flex pt-2">
          <Horas desde={desde} hasta={hasta} />
          {dias.map((d) => (
            <Columna
              key={d.fecha}
              // En la semana se junta a todo el equipo: un día cerrado se ve cerrado.
              tramos={unirTramos(d.tramos)}
              citas={d.citas}
              desde={desde}
              hasta={hasta}
              alto={alto}
              onHueco={(hora) => onHueco({ fecha: d.fecha, hora, staffId: null })}
              onCita={onCita}
              etiquetaProfesional
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Une los tramos de todas las profesionales en los intervalos abiertos del día. */
export function unirTramos(tramos: { desde: string; hasta: string; suelto: boolean }[]): { desde: string; hasta: string; suelto: boolean }[] {
  const ordenados = [...tramos]
    .map((t) => ({ d: minutos(t.desde), h: t.hasta === '24:00' ? 24 * 60 : minutos(t.hasta), suelto: t.suelto }))
    .sort((a, b) => a.d - b.d);
  const out: { desde: string; hasta: string; suelto: boolean }[] = [];
  for (const t of ordenados) {
    const ultimo = out.at(-1);
    if (ultimo && minutos(ultimo.hasta) >= t.d) {
      if (minutos(ultimo.hasta) < t.h) ultimo.hasta = hhmm(t.h);
      ultimo.suelto = ultimo.suelto && t.suelto;
    } else {
      out.push({ desde: hhmm(t.d), hasta: hhmm(t.h), suelto: t.suelto });
    }
  }
  return out;
}

// -----------------------------------------------------------------------------
// Detalle de una cita y cargar una a mano
// -----------------------------------------------------------------------------

function DetalleCita({ cita: c, ocupado, cerrar, cancelar }: { cita: CitaAgenda; ocupado: boolean; cerrar: () => void; cancelar: () => void }) {
  return (
    <div role="dialog" aria-label="La cita" className="tarjeta">
      <div className="flex items-start gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{c.horaInicio}–{c.horaFin} · {c.servicio}</h2>
          <p className="mt-1 text-sm text-slate-600">Con {c.profesional}</p>
          <p className="mt-1 text-sm">{c.clienta.nombre ?? 'Sin nombre'} · {c.clienta.telefono}{c.clienta.email ? ` · ${c.clienta.email}` : ''}</p>
          {c.notas ? <p className="mt-1 text-sm text-slate-500">{c.notas}</p> : null}
          <p className="mt-1 text-xs text-slate-400">{ESTADO[c.estado]} · la cargó {ORIGEN[c.origen]}</p>
        </div>
        <button type="button" className="boton-suave ml-auto" onClick={cerrar}>Cerrar</button>
      </div>
      {c.estado === 'confirmada' ? (
        <button
          type="button"
          className="boton-peligro mt-4"
          disabled={ocupado}
          onClick={() => confirm(`¿Cancelar la cita de ${c.clienta.nombre ?? c.clienta.telefono} a las ${c.horaInicio}?${c.clienta.email ? ' Le llegará un email de cancelación.' : ''}`) && cancelar()}
        >
          Cancelar la cita
        </button>
      ) : null}
    </div>
  );
}

function CitaAMano({ negocio: n, hueco, cerrar, onCreada }: { negocio: Negocio; hueco: HuecoPinchado; cerrar: () => void; onCreada: () => void }) {
  const { pedir } = useApiNegocio();
  const servicios = n.servicios.filter((s) => s.activo);
  const [f, setF] = useState({ serviceId: '', staffId: hueco.staffId ?? '', hora: hueco.hora, email: '', telefono: '', nombre: '', notas: '' });
  const a = useAccion();
  const servicio = f.serviceId || servicios[0]?.id || '';
  const quienes = n.profesionales.filter((p) => p.activo && p.servicioIds.includes(servicio));
  const staff = quienes.some((p) => p.id === f.staffId) ? f.staffId : (quienes[0]?.id ?? '');
  const crear = () =>
    a.hacer(async () => {
      await pedir('POST', 'citas', {
        serviceId: servicio,
        staffId: staff,
        fecha: hueco.fecha,
        hora: f.hora,
        email: f.email || null,
        telefono: f.telefono,
        nombre: f.nombre,
        notas: f.notas || null,
      });
      onCreada();
    }, f.email ? 'Cita cargada. Se ha mandado el email de confirmación.' : 'Cita cargada. Sin email, no le llega confirmación.');
  return (
    <div role="dialog" aria-label="Cargar una cita a mano" className="tarjeta">
      <div className="flex items-start">
        <div>
          <h2 className="text-base font-semibold">Cargar una cita · {diaLargo(hueco.fecha)}</h2>
          <p className="mt-1 text-xs text-slate-500">A cualquier hora, también fuera de la rejilla. No se puede fuera de horario, en festivo ni encima de otra cita.</p>
        </div>
        <button type="button" className="boton-suave ml-auto" onClick={cerrar}>Cerrar</button>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
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
        <label className="block"><span className="etiqueta">Hora</span><input className="campo" type="time" value={f.hora} onChange={(e) => setF({ ...f, hora: e.target.value })} /></label>
        <label className="block"><span className="etiqueta">Teléfono de la clienta</span><input className="campo" placeholder="+34 600 000 000" value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} /></label>
        <label className="block"><span className="etiqueta">Nombre</span><input className="campo" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></label>
        <label className="block"><span className="etiqueta">Email (opcional)</span><input className="campo" type="email" placeholder="nombre@gmail.com" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <div className="sm:col-span-2">
          <label className="block"><span className="etiqueta">Notas (opcional)</span><input className="campo" value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} /></label>
        </div>
      </div>
      <button type="button" className="boton mt-4" disabled={a.ocupado || !servicio || !staff || !f.hora || !f.telefono || !f.nombre} onClick={() => void crear()}>
        Cargar cita
      </button>
      <Aviso error={a.error} ok={a.ok} />
    </div>
  );
}
