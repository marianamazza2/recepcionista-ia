// =============================================================================
// Ficha de un negocio: alta y edición por bloques (Fase 4 · 4.3)
// =============================================================================
// En el orden del cuestionario de alta: negocio, servicios, profesionales,
// horarios, festivos, reglas, preguntas frecuentes y el chat en su web. Arriba,
// "Publicar": lo que falta, activar/pausar (PI-03) y el código del widget
// (PI-09). En horarios: "Copiar a…" entre días y el aviso de PI-18 (horario
// propio fuera del horario del local: tramos en ámbar, un aviso fijo debajo y
// confirmación al guardar). Cada bloque se guarda por separado; la API devuelve el negocio
// entero ya actualizado (PI-05: el agente lo usa en el siguiente mensaje).
// =============================================================================

import { useEffect, useState, type ReactNode } from 'react';

import { api, type Negocio, type Profesional, type Servicio, type Tramo } from '../api';
import { copiarDia, fueraDelLocal, LABORABLES, TODA_LA_SEMANA } from '../horario';
import { LogoNoValido, prepararLogo, textoSobre } from '../logo';
import { Aviso, Bloque, fechaCorta, SEMANA, useAccion } from '../ui';

type Props = { negocio: Negocio; poner: (n: Negocio) => void };

export function Ficha(p: Props) {
  return (
    <div className="grid gap-6 lg:grid-cols-[180px_1fr]">
      <nav className="hidden text-sm lg:block">
        <ul className="sticky top-20 space-y-1 text-slate-500">
          {[
            ['publicar', 'Publicar'],
            ['datos', 'Negocio'],
            ['servicios', 'Servicios'],
            ['profesionales', 'Profesionales'],
            ['horarios', 'Horarios'],
            ['festivos', 'Festivos y ausencias'],
            ['reglas', 'Reservas y cancelación'],
            ['preguntas', 'Preguntas frecuentes'],
            ['chat', 'El chat en su web'],
          ].map(([id, t]) => (
            <li key={id}>
              <button type="button" className="hover:text-slate-900" onClick={() => document.getElementById(id!)?.scrollIntoView({ behavior: 'smooth' })}>{t}</button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0 space-y-6">
        <Publicar {...p} />
        <Datos {...p} />
        <Servicios {...p} />
        <Profesionales {...p} />
        <Horarios {...p} />
        <Festivos {...p} />
        <Reglas {...p} />
        <Preguntas {...p} />
        <Chat {...p} />
      </div>
    </div>
  );
}

function Campo({ etiqueta, children, ayuda }: { etiqueta: string; children: ReactNode; ayuda?: string }) {
  return (
    <label className="block">
      <span className="etiqueta">{etiqueta}</span>
      {children}
      {ayuda ? <span className="mt-1 block text-xs text-slate-500">{ayuda}</span> : null}
    </label>
  );
}

const nada = (s: string) => (s.trim() === '' ? null : s);

// -----------------------------------------------------------------------------
// Publicar (PI-03, PI-09)
// -----------------------------------------------------------------------------

function Publicar({ negocio: n, poner }: Props) {
  const a = useAccion();
  const [copiado, setCopiado] = useState(false);
  const codigo = `<script src="${n.widgetJs}" data-key="${n.widgetKey}" async></script>`;
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setCopiado(false);
    }
  };
  return (
    <Bloque id="publicar" titulo="Publicar">
      {n.loQueFalta.length > 0 ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <strong>Falta:</strong> {n.loQueFalta.map((f) => f.texto).join(' · ')}
        </p>
      ) : (
        <p className="text-sm text-emerald-700">Tiene lo mínimo para atender.</p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {n.estado !== 'activo' ? (
          <button type="button" className="boton" disabled={a.ocupado || n.loQueFalta.length > 0} onClick={() => a.hacer(async () => poner(await api('POST', `negocios/${n.id}/activar`)), 'Negocio activado.')}>
            Activar
          </button>
        ) : null}
        {n.estado !== 'pausado' ? (
          <button
            type="button"
            className="boton-suave"
            disabled={a.ocupado}
            onClick={() => confirm('Al pausarlo, el chat de su web deja de responder y el agente no atiende. ¿Pausar?') && a.hacer(async () => poner(await api('POST', `negocios/${n.id}/pausar`)), 'Negocio pausado.')}
          >
            Pausar
          </button>
        ) : null}
        <a className="boton-suave" href={`#/negocios/${n.id}/probar`}>Probar el chat</a>
      </div>
      <Aviso error={a.error} ok={a.ok} />
      <div className="mt-5">
        <span className="etiqueta">Código para pegar en su web (antes de &lt;/body&gt;)</span>
        <pre className="overflow-x-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">{codigo}</pre>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className="boton-suave" onClick={() => void copiar()}>{copiado ? 'Copiado' : 'Copiar'}</button>
          <button
            type="button"
            className="boton-peligro"
            disabled={a.ocupado}
            onClick={() =>
              confirm('La clave actual dejará de funcionar AL MOMENTO y el negocio tendrá que pegar el código nuevo en su web. ¿Cambiar la clave?') &&
              a.hacer(async () => poner(await api('POST', `negocios/${n.id}/clave`)), 'Clave cambiada. Manda el código nuevo al negocio.')
            }
          >
            Cambiar la clave
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">El chat aparece en su web cuando el negocio está <strong>activo</strong> y en los dominios de "El chat en su web" (PI-16): en prueba o pausado, no sale aunque el código esté pegado. Antes de activar, usa "Probar el chat". Ya activo, para verlo en local añade <code>localhost</code> y abre la web de prueba: <code>http://localhost:4310/prueba.html?key={n.widgetKey}</code></p>
      </div>
    </Bloque>
  );
}

// -----------------------------------------------------------------------------
// Datos del negocio
// -----------------------------------------------------------------------------

function Datos({ negocio: n, poner }: Props) {
  const [f, setF] = useState({
    nombre: n.nombre,
    sector: n.sector ?? '',
    timezone: n.timezone,
    direccion: n.direccion ?? '',
    telefonoHumano: n.telefonoHumano ?? '',
    tonoDeVoz: n.tonoDeVoz ?? '',
    mensajeBienvenida: n.mensajeBienvenida ?? '',
  });
  const a = useAccion();
  const c = (k: keyof typeof f) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value }) });
  const guardar = () =>
    a.hacer(async () =>
      poner(
        await api('PUT', `negocios/${n.id}/datos`, {
          nombre: f.nombre,
          sector: nada(f.sector),
          timezone: f.timezone,
          direccion: nada(f.direccion),
          telefonoHumano: nada(f.telefonoHumano),
          tonoDeVoz: nada(f.tonoDeVoz),
          mensajeBienvenida: nada(f.mensajeBienvenida),
        }),
      ),
    );
  return (
    <Bloque id="datos" titulo="El negocio">
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Nombre"><input className="campo" {...c('nombre')} /></Campo>
        <Campo etiqueta="Sector"><input className="campo" placeholder="estética, peluquería…" {...c('sector')} /></Campo>
        <Campo etiqueta="Dirección"><input className="campo" {...c('direccion')} /></Campo>
        <Campo etiqueta="Teléfono del local" ayuda="El agente lo da cuando pasa la conversación a una persona."><input className="campo" placeholder="+34 910 000 000" {...c('telefonoHumano')} /></Campo>
        <Campo etiqueta="Zona horaria"><input className="campo" {...c('timezone')} /></Campo>
        <Campo etiqueta="Tono de voz" ayuda="Opcional. Por ejemplo: cercano, tratando de tú."><input className="campo" {...c('tonoDeVoz')} /></Campo>
        <div className="sm:col-span-2">
          <Campo etiqueta="Mensaje de bienvenida del chat" ayuda="Si empieza por «¡Hola!», el widget lo cambia según la hora (buenos días, buenas tardes…).">
            <textarea className="campo" rows={2} {...c('mensajeBienvenida')} />
          </Campo>
        </div>
      </div>
      <button type="button" className="boton mt-4" disabled={a.ocupado} onClick={() => void guardar()}>Guardar</button>
      <Aviso error={a.error} ok={a.ok} />
    </Bloque>
  );
}

// -----------------------------------------------------------------------------
// Servicios (PI-04: se desactivan, no se borran)
// -----------------------------------------------------------------------------

const SERVICIO_NUEVO = { nombre: '', descripcion: '', duracionMin: 60, bufferMin: 0, precio: '', precioVisible: true, activo: true };

function Servicios({ negocio: n, poner }: Props) {
  return (
    <Bloque id="servicios" titulo="Servicios" ayuda="Un servicio con citas no se borra: se desactiva y el agente deja de ofrecerlo; sus citas siguen ahí.">
      <div className="space-y-3">
        {n.servicios.map((s) => <FilaServicio key={s.id} negocio={n} poner={poner} servicio={s} />)}
        <FilaServicio negocio={n} poner={poner} servicio={null} />
      </div>
    </Bloque>
  );
}

function FilaServicio({ negocio: n, poner, servicio: s }: Props & { servicio: Servicio | null }) {
  const inicial = s ? { ...s, descripcion: s.descripcion ?? '', precio: s.precio === null ? '' : String(s.precio) } : SERVICIO_NUEVO;
  const [f, setF] = useState(inicial);
  useEffect(() => setF(inicial), [s]); // eslint-disable-line react-hooks/exhaustive-deps
  const a = useAccion();
  const guardar = (activo = f.activo) => {
    if (s && s.activo && !activo && s.citasFuturas > 0 && !confirm(`${s.nombre} tiene ${s.citasFuturas} cita${s.citasFuturas > 1 ? 's' : ''} futura${s.citasFuturas > 1 ? 's' : ''}. Siguen en pie, pero el agente dejará de ofrecerlo. ¿Desactivar?`)) return;
    const body = {
      nombre: f.nombre,
      descripcion: nada(f.descripcion),
      duracionMin: Number(f.duracionMin),
      bufferMin: Number(f.bufferMin),
      precio: f.precio === '' ? null : Number(String(f.precio).replace(',', '.')),
      precioVisible: f.precioVisible,
      activo,
    };
    void a.hacer(async () => {
      poner(await api(s ? 'PUT' : 'POST', s ?`negocios/${n.id}/servicios/${s.id}` : `negocios/${n.id}/servicios`, body));
      if (!s) setF(SERVICIO_NUEVO);
    }, s ? 'Guardado.' : 'Servicio añadido.');
  };
  return (
    <div className={`rounded-md border p-3 ${s && !s.activo ? 'border-dashed border-slate-300 bg-slate-50' : 'border-slate-200'}`}>
      {!s ? <p className="mb-2 text-xs font-medium text-slate-500">Añadir un servicio</p> : null}
      <div className="grid gap-3 sm:grid-cols-[2fr_repeat(3,1fr)]">
        <Campo etiqueta="Nombre"><input className="campo" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></Campo>
        <Campo etiqueta="Duración (min)"><input className="campo" type="number" min={1} value={f.duracionMin} onChange={(e) => setF({ ...f, duracionMin: Number(e.target.value) })} /></Campo>
        <Campo etiqueta="Margen después (min)"><input className="campo" type="number" min={0} value={f.bufferMin} onChange={(e) => setF({ ...f, bufferMin: Number(e.target.value) })} /></Campo>
        <Campo etiqueta="Precio (€)"><input className="campo" inputMode="decimal" placeholder="sin precio" value={f.precio} onChange={(e) => setF({ ...f, precio: e.target.value })} /></Campo>
        <div className="sm:col-span-4">
          <Campo etiqueta="Descripción (el agente la usa para explicar el servicio)"><textarea className="campo" rows={2} value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} /></Campo>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.precioVisible} onChange={(e) => setF({ ...f, precioVisible: e.target.checked })} /> El agente puede decir el precio</label>
        <button type="button" className="boton ml-auto" disabled={a.ocupado} onClick={() => guardar()}>{s ? 'Guardar' : 'Añadir'}</button>
        {s ? (
          <button type="button" className={s.activo ? 'boton-peligro' : 'boton-suave'} disabled={a.ocupado} onClick={() => guardar(!s.activo)}>
            {s.activo ? 'Desactivar' : 'Reactivar'}
          </button>
        ) : null}
      </div>
      {s && !s.activo ? <p className="mt-2 text-xs text-slate-500">Desactivado: el agente no lo ofrece.</p> : null}
      <Aviso error={a.error} ok={a.ok} />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Profesionales (qué hace cada una; PI-04)
// -----------------------------------------------------------------------------

function Profesionales({ negocio: n, poner }: Props) {
  return (
    <Bloque id="profesionales" titulo="Profesionales" ayuda="Y qué servicios hace cada una. Una profesional con citas no se borra: se desactiva.">
      <div className="space-y-3">
        {n.profesionales.map((p) => <FilaProfesional key={p.id} negocio={n} poner={poner} profesional={p} />)}
        <FilaProfesional negocio={n} poner={poner} profesional={null} />
      </div>
    </Bloque>
  );
}

function FilaProfesional({ negocio: n, poner, profesional: p }: Props & { profesional: Profesional | null }) {
  const inicial = { nombre: p?.nombre ?? '', servicioIds: p?.servicioIds ?? [] };
  const [f, setF] = useState(inicial);
  useEffect(() => setF(inicial), [p]); // eslint-disable-line react-hooks/exhaustive-deps
  const a = useAccion();
  const guardar = (activo = p?.activo ?? true) => {
    if (p && p.activo && !activo && p.citasFuturas > 0 && !confirm(`${p.nombre} tiene ${p.citasFuturas} cita${p.citasFuturas > 1 ? 's' : ''} futura${p.citasFuturas > 1 ? 's' : ''}. Siguen en pie, pero el agente dejará de darle citas. ¿Desactivar?`)) return;
    void a.hacer(async () => {
      poner(await api(p ? 'PUT' : 'POST', p ? `negocios/${n.id}/profesionales/${p.id}` : `negocios/${n.id}/profesionales`, { nombre: f.nombre, activo, servicioIds: f.servicioIds }));
      if (!p) setF({ nombre: '', servicioIds: [] });
    }, p ? 'Guardado.' : 'Profesional añadida.');
  };
  const alternar = (id: string) => setF({ ...f, servicioIds: f.servicioIds.includes(id) ? f.servicioIds.filter((x) => x !== id) : [...f.servicioIds, id] });
  return (
    <div className={`rounded-md border p-3 ${p && !p.activo ? 'border-dashed border-slate-300 bg-slate-50' : 'border-slate-200'}`}>
      {!p ? <p className="mb-2 text-xs font-medium text-slate-500">Añadir una profesional</p> : null}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1"><Campo etiqueta="Nombre"><input className="campo" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></Campo></div>
        <button type="button" className="boton" disabled={a.ocupado} onClick={() => guardar()}>{p ? 'Guardar' : 'Añadir'}</button>
        {p ? (
          <button type="button" className={p.activo ? 'boton-peligro' : 'boton-suave'} disabled={a.ocupado} onClick={() => guardar(!p.activo)}>{p.activo ? 'Desactivar' : 'Reactivar'}</button>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {n.servicios.filter((s) => s.activo || f.servicioIds.includes(s.id)).map((s) => (
          <label key={s.id} className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={f.servicioIds.includes(s.id)} onChange={() => alternar(s.id)} /> {s.nombre}
          </label>
        ))}
        {n.servicios.length === 0 ? <span className="text-xs text-slate-500">Primero añade los servicios.</span> : null}
      </div>
      <Aviso error={a.error} ok={a.ok} />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Horarios (PD-01): el del local y los propios
// -----------------------------------------------------------------------------

function Horarios({ negocio: n, poner }: Props) {
  return (
    <Bloque id="horarios" titulo="Horarios" ayuda="El horario propio de una profesional reemplaza al del local los días que lo tenga; los demás días hereda el del local.">
      <EditorHorario negocio={n} poner={poner} staffId={null} titulo="Horario del local" />
      {n.profesionales.filter((p) => p.activo).map((p) => (
        <div key={p.id} className="mt-6 border-t border-slate-100 pt-4">
          <EditorHorario negocio={n} poner={poner} staffId={p.id} titulo={`Horario propio de ${p.nombre}`} />
        </div>
      ))}
    </Bloque>
  );
}

function EditorHorario({ negocio: n, poner, staffId, titulo }: Props & { staffId: string | null; titulo: string }) {
  const actuales = n.horario.filter((t) => t.staffId === staffId);
  const [tramos, setTramos] = useState<Tramo[]>(actuales);
  const [copiando, setCopiando] = useState<number | null>(null);
  const [destinos, setDestinos] = useState<number[]>([]);
  useEffect(() => setTramos(n.horario.filter((t) => t.staffId === staffId)), [n, staffId]);
  const a = useAccion();
  const cambiar = (i: number, k: 'apertura' | 'cierre', v: string) => setTramos(tramos.map((t, j) => (j === i ? { ...t, [k]: v } : t)));
  const nombreDia = (w: number) => SEMANA.find((d) => d.weekday === w)!.nombre.toLowerCase();

  const empezarCopia = (w: number) => {
    setCopiando(copiando === w ? null : w);
    setDestinos([]);
  };
  const copiar = () => {
    if (copiando === null) return;
    setTramos(copiarDia(tramos, copiando, destinos));
    setCopiando(null);
    setDestinos([]);
  };

  // PI-18: un horario propio puede salirse del horario del local (PD-01: manda
  // el propio). Se avisa siempre en pantalla (también con lo ya guardado) y se
  // pide confirmación al guardar, por si es un error al cargarlo.
  const fuera = staffId === null ? [] : fueraDelLocal(tramos, n.horario.filter((t) => t.staffId === null));
  const quien = n.profesionales.find((p) => p.id === staffId)?.nombre ?? 'Esta profesional';
  const listaFuera = fuera.map((t) => `${nombreDia(t.weekday)} ${t.apertura}–${t.cierre}`).join(' · ');

  const guardar = () => {
    if (fuera.length > 0 && !confirm(`${quien} trabajaría fuera del horario del local: ${listaFuera}. ¿Guardar igual?`)) return;
    void a.hacer(async () => poner(await api('PUT', `negocios/${n.id}/horario`, { staffId, tramos })));
  };

  return (
    <div role="group" aria-label={titulo}>
      <h3 className="text-sm font-semibold">{titulo}</h3>
      {staffId !== null && tramos.length === 0 ? <p className="mt-1 text-xs text-slate-500">Sin horario propio: trabaja en el horario del local.</p> : null}
      <div className="mt-2 space-y-1.5">
        {SEMANA.map((d) => (
          <div key={d.weekday}>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="w-24 text-slate-600">{d.nombre}</span>
              {tramos.map((t, i) =>
                t.weekday === d.weekday ? (
                  <span key={i} title={fuera.includes(t) ? 'Fuera del horario del local' : undefined} className={`flex items-center gap-1 rounded-md px-1.5 py-1 ${fuera.includes(t) ? 'bg-amber-100 ring-1 ring-amber-400' : 'bg-slate-100'}`}>
                    <input type="time" aria-label={`${d.nombre}, apertura`} className="rounded border border-slate-300 px-1 text-sm" value={t.apertura} onChange={(e) => cambiar(i, 'apertura', e.target.value)} />
                    –
                    <input type="text" aria-label={`${d.nombre}, cierre`} className="w-16 rounded border border-slate-300 px-1 text-sm" value={t.cierre} onChange={(e) => cambiar(i, 'cierre', e.target.value)} placeholder="HH:MM" />
                    <button type="button" aria-label="Quitar tramo" className="px-1 text-slate-400 hover:text-red-600" onClick={() => setTramos(tramos.filter((_, j) => j !== i))}>×</button>
                  </span>
                ) : null,
              )}
              {!tramos.some((t) => t.weekday === d.weekday) ? <span className="text-xs text-slate-400">{staffId === null ? 'cerrado' : '—'}</span> : null}
              <button type="button" className="text-xs text-slate-500 underline hover:text-slate-900" onClick={() => setTramos([...tramos, { staffId, weekday: d.weekday, apertura: '10:00', cierre: '14:00' }])}>+ tramo</button>
              {tramos.some((t) => t.weekday === d.weekday) ? (
                <button type="button" aria-expanded={copiando === d.weekday} className="text-xs text-slate-500 underline hover:text-slate-900" onClick={() => empezarCopia(d.weekday)}>Copiar a…</button>
              ) : null}
            </div>
            {copiando === d.weekday ? (
              <div role="group" aria-label={`Copiar el ${nombreDia(d.weekday)} a otros días`} className="ml-26 mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                <span className="text-slate-600">Copiar el {nombreDia(d.weekday)} a:</span>
                <button type="button" className="boton-suave px-2 py-1 text-xs" onClick={() => setDestinos(LABORABLES.filter((w) => w !== d.weekday))}>Días laborables</button>
                <button type="button" className="boton-suave px-2 py-1 text-xs" onClick={() => setDestinos(TODA_LA_SEMANA.filter((w) => w !== d.weekday))}>Toda la semana</button>
                {SEMANA.filter((o) => o.weekday !== d.weekday).map((o) => (
                  <label key={o.weekday} className="flex items-center gap-1">
                    <input type="checkbox" checked={destinos.includes(o.weekday)} onChange={(e) => setDestinos(e.target.checked ? [...destinos, o.weekday] : destinos.filter((w) => w !== o.weekday))} />
                    {o.nombre.slice(0, 3)}
                  </label>
                ))}
                <button type="button" className="boton px-2 py-1 text-xs" disabled={destinos.length === 0} onClick={copiar}>Copiar</button>
                <button type="button" className="text-slate-500 underline" onClick={() => setCopiando(null)}>Cancelar</button>
                <span className="basis-full text-slate-500">Sustituye lo que tuvieran esos días. Después, "Guardar horario".</span>
              </div>
            ) : null}
          </div>
        ))}
      </div>
      {fuera.length > 0 ? (
        <p role="note" aria-label="Aviso de horario" className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <strong>Fuera del horario del local:</strong> {listaFuera}. Se puede (ese día manda su horario) y el agente ofrecerá esas horas; revisa que no sea un error al cargarlo.
        </p>
      ) : null}
      <button type="button" className="boton mt-3" disabled={a.ocupado} onClick={guardar}>Guardar horario</button>
      <Aviso error={a.error} ok={a.ok} />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Festivos y ausencias (PI-12)
// -----------------------------------------------------------------------------

function Festivos({ negocio: n, poner }: Props) {
  const [f, setF] = useState({ staffId: '', fechaDesde: '', fechaHasta: '', porHoras: false, horaDesde: '', horaHasta: '', motivo: '' });
  const a = useAccion();
  const nombre = (id: string | null) => (id ? (n.profesionales.find((p) => p.id === id)?.nombre ?? 'Profesional') : 'Local');
  const anadir = () =>
    a.hacer(async () => {
      poner(
        await api('POST', `negocios/${n.id}/festivos`, {
          staffId: f.staffId || null,
          fechaDesde: f.fechaDesde,
          ...(f.porHoras ? { horaDesde: f.horaDesde, horaHasta: f.horaHasta } : f.fechaHasta ? { fechaHasta: f.fechaHasta } : {}),
          motivo: nada(f.motivo),
        }),
      );
      setF({ ...f, fechaDesde: '', fechaHasta: '', horaDesde: '', horaHasta: '', motivo: '' });
    }, 'Añadido.');
  return (
    <Bloque id="festivos" titulo="Festivos y ausencias" ayuda="Del local (cierra todo el mundo) o de una profesional; de días enteros o de unas horas. Se ven los próximos.">
      <ul className="divide-y divide-slate-100 text-sm">
        {n.festivos.map((x) => (
          <li key={x.id} className="flex items-center gap-3 py-2">
            <span className="w-28 font-medium">{nombre(x.staffId)}</span>
            <span>
              {x.diaEntero
                ? x.fechaDesde === x.fechaHasta ? fechaCorta(x.fechaDesde) : `del ${fechaCorta(x.fechaDesde)} al ${fechaCorta(x.fechaHasta)}`
                : `${fechaCorta(x.fechaDesde)} de ${x.horaDesde} a ${x.horaHasta}`}
            </span>
            <span className="text-slate-500">{x.motivo}</span>
            <button type="button" className="ml-auto text-xs text-red-700 hover:underline" onClick={() => void a.hacer(async () => poner(await api('DELETE', `negocios/${n.id}/festivos/${x.id}`)), 'Borrado.')}>Borrar</button>
          </li>
        ))}
        {n.festivos.length === 0 ? <li className="py-2 text-slate-500">No hay próximos.</li> : null}
      </ul>
      <div className="mt-4 grid gap-3 rounded-md bg-slate-50 p-3 sm:grid-cols-3">
        <Campo etiqueta="Quién">
          <select className="campo" value={f.staffId} onChange={(e) => setF({ ...f, staffId: e.target.value })}>
            <option value="">El local (festivo)</option>
            {n.profesionales.filter((p) => p.activo).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta={f.porHoras ? 'Día' : 'Desde el día'}><input className="campo" type="date" value={f.fechaDesde} onChange={(e) => setF({ ...f, fechaDesde: e.target.value })} /></Campo>
        {f.porHoras ? (
          <div className="flex gap-2">
            <Campo etiqueta="De"><input className="campo" type="time" value={f.horaDesde} onChange={(e) => setF({ ...f, horaDesde: e.target.value })} /></Campo>
            <Campo etiqueta="A"><input className="campo" type="time" value={f.horaHasta} onChange={(e) => setF({ ...f, horaHasta: e.target.value })} /></Campo>
          </div>
        ) : (
          <Campo etiqueta="Hasta el día (incluido)" ayuda="Vacío: solo un día."><input className="campo" type="date" value={f.fechaHasta} onChange={(e) => setF({ ...f, fechaHasta: e.target.value })} /></Campo>
        )}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.porHoras} onChange={(e) => setF({ ...f, porHoras: e.target.checked })} /> Solo unas horas</label>
        <Campo etiqueta="Motivo (opcional)"><input className="campo" value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} placeholder="Festivo local, formación…" /></Campo>
        <div className="flex items-end"><button type="button" className="boton" disabled={a.ocupado || !f.fechaDesde} onClick={() => void anadir()}>Añadir</button></div>
      </div>
      <Aviso error={a.error} ok={a.ok} />
    </Bloque>
  );
}

// -----------------------------------------------------------------------------
// Reglas de reserva y cancelación (PD-03, PD-05, PR-01, PR-02, PR-07)
// -----------------------------------------------------------------------------

function Reglas({ negocio: n, poner }: Props) {
  const [f, setF] = useState({ ...n.reglas, politicaCancelacion: n.reglas.politicaCancelacion ?? '' });
  const a = useAccion();
  return (
    <Bloque id="reglas" titulo="Reservas y cancelación">
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Antelación mínima para reservar (horas)" ayuda="De serie, 2."><input className="campo" type="number" min={0} value={f.antelacionMinHoras} onChange={(e) => setF({ ...f, antelacionMinHoras: Number(e.target.value) })} /></Campo>
        <Campo etiqueta="Cada cuánto se ofrecen horarios (min)" ayuda="Desde la apertura. De serie, 30."><input className="campo" type="number" min={1} max={240} value={f.intervaloHuecosMin} onChange={(e) => setF({ ...f, intervaloHuecosMin: Number(e.target.value) })} /></Campo>
        <Campo etiqueta="Quién atiende si la clienta no pide a nadie">
          <select className="campo" value={f.asignacionProfesional} onChange={(e) => setF({ ...f, asignacionProfesional: e.target.value as 'preguntar' | 'automatica' })}>
            <option value="preguntar">El agente pregunta (de serie)</option>
            <option value="automatica">Se asigna sola</option>
          </select>
        </Campo>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" checked={f.margenDentroHorario} onChange={(e) => setF({ ...f, margenDentroHorario: e.target.checked })} />
          El margen de la última cita cuenta dentro del horario
        </label>
        <Campo etiqueta="Cancelar o mover dentro del plazo">
          <select className="campo" value={f.cancelacionModo} onChange={(e) => setF({ ...f, cancelacionModo: e.target.value as 'informar' | 'bloquear' })}>
            <option value="informar">Solo informar de la política (de serie)</option>
            <option value="bloquear">Bloquear y pasar con una persona</option>
          </select>
        </Campo>
        <Campo etiqueta="Plazo (horas)" ayuda="De serie, 24."><input className="campo" type="number" min={0} value={f.cancelacionPlazoHoras} onChange={(e) => setF({ ...f, cancelacionPlazoHoras: Number(e.target.value) })} /></Campo>
        <div className="sm:col-span-2">
          <Campo etiqueta="Política de cancelación (el agente la explica tal cual)"><textarea className="campo" rows={2} value={f.politicaCancelacion} onChange={(e) => setF({ ...f, politicaCancelacion: e.target.value })} /></Campo>
        </div>
      </div>
      <button type="button" className="boton mt-4" disabled={a.ocupado} onClick={() => void a.hacer(async () => poner(await api('PUT', `negocios/${n.id}/reglas`, { ...f, politicaCancelacion: nada(f.politicaCancelacion) })))}>Guardar</button>
      <Aviso error={a.error} ok={a.ok} />
    </Bloque>
  );
}

// -----------------------------------------------------------------------------
// Preguntas frecuentes (PI-08)
// -----------------------------------------------------------------------------

const MAX_PREGUNTAS = 20;
const MAX_CARACTERES = 4000;

function Preguntas({ negocio: n, poner }: Props) {
  const usados = n.preguntas.reduce((t, q) => t + q.pregunta.length + q.respuesta.length, 0);
  return (
    <Bloque id="preguntas" titulo="Preguntas frecuentes" ayuda="Cortas: el agente las responde tal cual. Si preguntan algo que no está, lo pasa al equipo.">
      <p className="mb-3 text-xs text-slate-500">{n.preguntas.length} de {MAX_PREGUNTAS} preguntas · {usados.toLocaleString('es-ES')} de {MAX_CARACTERES.toLocaleString('es-ES')} caracteres</p>
      <div className="space-y-3">
        {n.preguntas.map((q, i) => <FilaPregunta key={q.id} negocio={n} poner={poner} id={q.id} inicial={{ pregunta: q.pregunta, respuesta: q.respuesta, orden: q.orden || i + 1 }} />)}
        <FilaPregunta negocio={n} poner={poner} id={null} inicial={{ pregunta: '', respuesta: '', orden: n.preguntas.length + 1 }} />
      </div>
    </Bloque>
  );
}

function FilaPregunta({ negocio: n, poner, id, inicial }: Props & { id: string | null; inicial: { pregunta: string; respuesta: string; orden: number } }) {
  const [f, setF] = useState(inicial);
  useEffect(() => setF(inicial), [n]); // eslint-disable-line react-hooks/exhaustive-deps
  const a = useAccion();
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_2fr]">
        <input className="campo" aria-label="Pregunta" placeholder="¿Hay aparcamiento?" maxLength={200} value={f.pregunta} onChange={(e) => setF({ ...f, pregunta: e.target.value })} />
        <textarea className="campo" aria-label="Respuesta" rows={2} maxLength={1000} placeholder="Sí, el parking de la plaza está a 2 minutos." value={f.respuesta} onChange={(e) => setF({ ...f, respuesta: e.target.value })} />
      </div>
      <div className="mt-2 flex justify-end gap-2">
        {id ? <button type="button" className="boton-peligro" disabled={a.ocupado} onClick={() => void a.hacer(async () => poner(await api('DELETE', `negocios/${n.id}/preguntas/${id}`)), 'Borrada.')}>Borrar</button> : null}
        <button type="button" className="boton" disabled={a.ocupado} onClick={() => void a.hacer(async () => poner(await api(id ? 'PUT' : 'POST', id ? `negocios/${n.id}/preguntas/${id}` : `negocios/${n.id}/preguntas`, f)), id ? 'Guardada.' : 'Añadida.')}>{id ? 'Guardar' : 'Añadir'}</button>
      </div>
      <Aviso error={a.error} ok={a.ok} />
    </div>
  );
}

// -----------------------------------------------------------------------------
// El chat en su web (PW-01, PW-02, PW-04, PW-06, PW-17, PI-10)
// -----------------------------------------------------------------------------

function Chat({ negocio: n, poner }: Props) {
  const [f, setF] = useState({ dominios: n.chat.dominios.join('\n'), color: n.chat.color, logo: n.chat.logo, privacidadUrl: n.chat.privacidadUrl ?? '', topeMensualUsd: n.chat.topeMensualUsd });
  const [avisoLogo, setAvisoLogo] = useState<string | null>(null);
  const a = useAccion();
  const subir = async (archivo: File | undefined) => {
    setAvisoLogo(null);
    if (!archivo) return;
    try {
      const r = await prepararLogo(archivo);
      setF({ ...f, logo: r.dataUrl });
      setAvisoLogo(r.reducido ? `Pesaba ${Math.round(archivo.size / 1024)} KB: se ha reducido a 256 × 256. Guarda para aplicarlo.` : 'Guarda para aplicarlo.');
    } catch (e) {
      setAvisoLogo(e instanceof LogoNoValido ? e.message : 'No se ha podido leer el logo.');
    }
  };
  const sobre = textoSobre(f.color);
  return (
    <Bloque id="chat" titulo="El chat en su web" ayuda="Los cambios de aspecto pueden tardar hasta 5 minutos en verse en su web (el navegador los guarda un rato).">
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Dominios donde aparece (uno por línea)" ayuda="Exactos: esteticaaurora.es y www.esteticaaurora.es son dos. Vacío = en ninguna web.">
          <textarea className="campo font-mono" rows={4} value={f.dominios} onChange={(e) => setF({ ...f, dominios: e.target.value })} placeholder={'www.sunegocio.es\nsunegocio.es'} />
        </Campo>
        <div className="space-y-4">
          <Campo etiqueta="Color de su marca">
            <div className="flex items-center gap-2">
              <input type="color" aria-label="Elegir color" value={/^#[0-9a-f]{6}$/i.test(f.color) ? f.color : '#4f6d7a'} onChange={(e) => setF({ ...f, color: e.target.value })} />
              <input className="campo font-mono" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} />
            </div>
          </Campo>
          <Campo etiqueta="Política de privacidad (enlace)"><input className="campo" placeholder="https://…" value={f.privacidadUrl} onChange={(e) => setF({ ...f, privacidadUrl: e.target.value })} /></Campo>
          <Campo etiqueta="Tope mensual de la IA (US$)" ayuda="Al llegar, el chat da el teléfono del local sin llamar a la IA."><input className="campo" type="number" min={0} step="1" value={f.topeMensualUsd} onChange={(e) => setF({ ...f, topeMensualUsd: Number(e.target.value) })} /></Campo>
        </div>
        <div className="sm:col-span-2">
          <span className="etiqueta">Logo (PNG, JPG, SVG o WebP; si pesa más de 150 KB se reduce solo)</span>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex w-72 items-center gap-2.5 rounded-t-xl px-3 py-2.5" style={{ background: f.color, color: sobre }} aria-label="Vista previa de la cabecera del chat">
              <span className="flex h-9 w-9 flex-none items-center justify-center overflow-hidden rounded-full bg-white text-base font-semibold" style={{ color: f.color }}>
                {f.logo ? <img src={f.logo} alt="" className="h-full w-full object-cover" /> : n.nombre.trim().charAt(0).toUpperCase()}
              </span>
              <span className="truncate text-sm font-semibold">{n.nombre}</span>
            </div>
            <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={(e) => void subir(e.target.files?.[0])} className="text-sm" />
            {f.logo ? <button type="button" className="text-xs text-red-700 hover:underline" onClick={() => setF({ ...f, logo: null })}>Quitar logo</button> : null}
          </div>
          {avisoLogo ? <p className="mt-2 text-xs text-slate-600">{avisoLogo}</p> : null}
        </div>
      </div>
      <button
        type="button"
        className="boton mt-4"
        disabled={a.ocupado}
        onClick={() =>
          void a.hacer(async () =>
            poner(
              await api('PUT', `negocios/${n.id}/chat`, {
                dominios: f.dominios.split(/[\n,]+/).map((d) => d.trim()).filter(Boolean),
                color: f.color.trim(),
                logo: f.logo,
                privacidadUrl: nada(f.privacidadUrl),
                topeMensualUsd: f.topeMensualUsd,
              }),
            ),
          )
        }
      >
        Guardar
      </button>
      <Aviso error={a.error} ok={a.ok} />
    </Bloque>
  );
}
