// =============================================================================
// El chat del portal (Fase 9 · 9.3 y 9.5; aspecto de la Fase 9b · PC-17, PC-19)
// =============================================================================
// Se ve como los chats de IA que todo el mundo conoce (decisión de Mariana,
// 20/11/2026):
//
//   · Un chat sin mensajes es la pantalla de inicio: el saludo con la hora y
//     el nombre del negocio («Buenas tardes, Clínica Aurora. ¿En qué te puedo
//     ayudar?»), la caja para escribir EN EL CENTRO y, debajo, sugerencias
//     que se tocan (PC-19). Ya no se manda un «Hola» solo al entrar.
//     En el móvil, como ChatGPT (Mariana, 20/11/2026): sin saludo, la caja
//     abajo del todo y las sugerencias justo encima.
//   · En cuanto escribe, la conversación ocupa el centro y la caja baja al
//     pie.
//   · El primer mensaje abre el chat en el servidor (PC-17) y avisa a quien
//     lo contiene para que aparezca en el historial con su título.
//
// PC-21 (21/11/2026): el «+» de la caja adjunta fotos y PDF, como ChatGPT.
// También se pueden arrastrar a la caja o pegar. Se suben en cuanto se
// eligen (las fotos, achicadas: adjuntar.ts) y van con el mensaje por su id.
// Debajo del «+», el aviso: nada de datos de clientas.
//
// El resumen de cada sección (PC-03) lo dibuja esta pantalla, no el modelo: la
// respuesta trae los datos (título, líneas y, si hace falta, una tabla) y aquí
// se pintan siempre igual. Se ve como texto: React escapa, así que lo que
// escriba el cliente nunca se interpreta como HTML.
// =============================================================================

import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';

import { ArchivoNoValido, MAX_ADJUNTOS, prepararArchivo } from './adjuntar';
import { api, subirAdjunto, urlDeAdjunto, type AdjuntoChat, type MensajeChat, type RespuestaChat, type Resumen } from './api';
import { PEDIDOS, type Pedido } from './pedir';
import { Aviso } from '../ui';

interface Linea extends MensajeChat {
  resumen?: Resumen | null;
}

/** PC-21: un archivo elegido que todavía no se mandó. */
interface Pendiente {
  clave: string;
  nombre: string;
  esPdf: boolean;
  /** Vista previa local (solo imágenes). */
  url?: string;
  estado: 'subiendo' | 'listo';
  id?: string;
  tipo?: string;
}

/** Las vistas previas locales de lo que se mandó en esta sesión, para no volver a pedirlas. */
const urlsLocales = new Map<string, string>();

export interface PropsChat {
  /** null: un chat nuevo (la pantalla de inicio). */
  chatId: string | null;
  saludo: string;
  sugerencias: Pedido[];
  /** PC-19: lo que se manda solo al abrir (desde «Pídeselo al agente»). */
  mensajeInicial?: string | undefined;
  /** El servidor ya le dio id a este chat nuevo. */
  alCrear: (id: string) => void;
  /** Después de cada respuesta: para refrescar el historial y lo que falta del alta. */
  alResponder: (r: RespuestaChat) => void;
}

export function Chat({ chatId, saludo, sugerencias, mensajeInicial, alCrear, alResponder }: PropsChat) {
  const [lineas, setLineas] = useState<Linea[] | null>(chatId ? null : []);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendientes, setPendientes] = useState<Pendiente[]>([]);
  const id = useRef<string | null>(chatId);
  const fin = useRef<HTMLDivElement>(null);
  const yaMandado = useRef(false);

  useEffect(() => {
    if (!chatId) {
      // Desde «Pídeselo al agente»: el chat nuevo empieza con el mensaje ya enviado.
      if (mensajeInicial && !yaMandado.current) {
        yaMandado.current = true;
        void enviar(mensajeInicial, []);
      }
      return;
    }
    let vivo = true;
    api<{ mensajes: MensajeChat[] }>('GET', `chats/${chatId}`).then(
      (r) => vivo && setLineas(r.mensajes),
      (e: unknown) => vivo && setError(e instanceof Error ? e.message : 'No se ha podido abrir el chat.'),
    );
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fin.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [lineas, enviando]);

  async function enviar(mensaje: string, previas: Linea[], adjuntos: AdjuntoChat[] = []): Promise<void> {
    setEnviando(true);
    setError(null);
    const conElMio: Linea[] = [...previas, { rol: 'cliente', texto: mensaje, ...(adjuntos.length ? { adjuntos } : {}) }];
    setLineas(conElMio);
    try {
      const r = await api<RespuestaChat>('POST', 'chat', {
        texto: mensaje,
        clientMessageId: crypto.randomUUID(),
        chatId: id.current,
        ...(adjuntos.length ? { adjuntos: adjuntos.map((a) => a.id) } : {}),
      });
      setLineas([...conElMio, { rol: 'asistente', texto: r.respuesta, resumen: r.resumen }]);
      if (!id.current && r.chat.id) {
        id.current = r.chat.id;
        alCrear(r.chat.id);
      }
      alResponder(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido enviar. Inténtalo otra vez.');
      setLineas(previas);
      setTexto(mensaje);
      // Los archivos vuelven a la caja para reintentar.
      if (adjuntos.length) setPendientes(adjuntos.map((a) => ({ clave: a.id, nombre: a.nombre, esPdf: a.tipo === 'application/pdf', url: urlsLocales.get(a.id), estado: 'listo', id: a.id, tipo: a.tipo })));
    } finally {
      setEnviando(false);
    }
  }

  const subiendo = pendientes.some((p) => p.estado === 'subiendo');
  const mandar = (t = texto) => {
    const limpio = t.trim();
    const listos = pendientes.filter((p) => p.estado === 'listo' && p.id);
    if ((!limpio && listos.length === 0) || enviando || subiendo) return;
    setTexto('');
    setPendientes([]);
    void enviar(
      limpio,
      lineas ?? [],
      listos.map((p) => ({ id: p.id!, nombre: p.nombre, tipo: p.tipo ?? '' })),
    );
  };

  /** PC-21: hasta 5; cada uno se prepara y se sube enseguida. */
  async function agregar(archivos: File[]): Promise<void> {
    if (archivos.length === 0) return;
    setError(null);
    const libres = MAX_ADJUNTOS - pendientes.length;
    if (libres <= 0 || archivos.length > libres) setError(`Puedes adjuntar hasta ${MAX_ADJUNTOS} archivos por mensaje.`);
    for (const f of archivos.slice(0, Math.max(0, libres))) {
      const clave = crypto.randomUUID();
      const esPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
      const url = esPdf ? undefined : URL.createObjectURL(f);
      setPendientes((ps) => [...ps, { clave, nombre: f.name, esPdf, url, estado: 'subiendo' }]);
      try {
        const listo = await prepararArchivo(f);
        const a = await subirAdjunto(listo.datos, listo.nombre);
        if (url) urlsLocales.set(a.id, url);
        setPendientes((ps) => ps.map((p) => (p.clave === clave ? { ...p, estado: 'listo', id: a.id, tipo: a.tipo, nombre: a.nombre } : p)));
      } catch (e) {
        setPendientes((ps) => ps.filter((p) => p.clave !== clave));
        setError(e instanceof ArchivoNoValido || e instanceof Error ? e.message : 'No se ha podido subir el archivo.');
      }
    }
  }
  const quitar = (clave: string) => setPendientes((ps) => ps.filter((p) => p.clave !== clave));

  if (error && !lineas) return <div className="mx-auto max-w-3xl p-6"><Aviso error={error} /></div>;
  if (!lineas) return <p className="p-6 text-center text-sm text-slate-400">Cargando…</p>;

  const caja = (
    <Caja
      texto={texto}
      setTexto={setTexto}
      enviando={enviando}
      mandar={() => mandar()}
      pendientes={pendientes}
      agregar={(fs) => void agregar(fs)}
      quitar={quitar}
      puedeMandar={!enviando && !subiendo && (texto.trim() !== '' || pendientes.some((p) => p.estado === 'listo'))}
    />
  );

  // La pantalla de inicio: saludo, la caja en el centro y las sugerencias.
  // En el móvil, como ChatGPT (Mariana, 20/11/2026): sin saludo, la caja
  // abajo del todo y las sugerencias justo encima.
  if (lineas.length === 0 && !enviando) {
    return (
      <div className="flex h-full flex-col items-center justify-end px-4 pb-4 md:justify-center md:pb-24">
        <Saludo saludo={saludo} />
        <div className="flex w-full max-w-3xl flex-col">
          {caja}
          {error ? <div className="mt-3"><Aviso error={error} /></div> : null}
          {sugerencias.length > 0 ? (
            <ul className="order-first mb-3 space-y-1 md:order-none md:mb-0 md:mt-6" aria-label="Sugerencias">
              {sugerencias.map((p) => (
                <li key={p}>
                  <button type="button" className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] text-slate-600 hover:bg-slate-200/50" onClick={() => mandar(PEDIDOS[p].mensaje)}>
                    <IconoSugerencia />
                    {PEDIDOS[p].boton}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
          {lineas.map((l, i) =>
            l.rol === 'cliente' ? (
              <div key={i} className="flex justify-end">
                <div className="flex max-w-[80%] flex-col items-end gap-2">
                  {l.adjuntos?.length ? <AdjuntosDelMensaje adjuntos={l.adjuntos} /> : null}
                  {l.texto ? <div data-rol="cliente" className="whitespace-pre-wrap rounded-3xl bg-slate-200/70 px-4 py-2.5 text-[15px] text-slate-900">{l.texto}</div> : null}
                </div>
              </div>
            ) : (
              <div key={i} data-rol="asistente" className="whitespace-pre-wrap text-[15px] leading-relaxed text-slate-900">
                {l.texto}
                {l.resumen ? <BloqueResumen resumen={l.resumen} /> : null}
              </div>
            ),
          )}
          {enviando ? <Escribiendo /> : null}
          <div ref={fin} />
        </div>
      </div>
      <div className="mx-auto w-full max-w-3xl px-4 pb-4">
        {error ? <div className="mb-2"><Aviso error={error} /></div> : null}
        {caja}
        <p className="mt-2 text-center text-xs text-slate-400">Antes de guardar nada, te enseño un resumen para que lo confirmes.</p>
      </div>
    </div>
  );
}

/**
 * PC-19: el saludo en dos líneas (Mariana, 20/11/2026): «Buenos días, Clínica
 * Aurora» arriba y «¿En qué te puedo ayudar?» debajo, para que un nombre largo
 * no descoloque la pregunta. Un nombre muy largo parte su línea, no la de abajo.
 */
function Saludo({ saludo }: { saludo: string }) {
  const corte = saludo.indexOf('¿');
  const arriba = (corte > 0 ? saludo.slice(0, corte) : saludo).trim().replace(/\.$/, '');
  const abajo = corte > 0 ? saludo.slice(corte).trim() : '';
  // El saludo es el título (h1); la pregunta, su subtítulo (h2).
  return (
    <div className="mb-10 hidden max-w-3xl text-center leading-tight text-slate-800 md:block">
      <h1 className="break-words text-[24px] font-medium">{arriba}</h1>
      {/* Mismo estilo que el h1: el saludo a 24 px y la pregunta a 20 px (Mariana, 20/11/2026). */}
      {abajo ? <h2 className="mt-1 text-[20px] font-medium">{abajo}</h2> : null}
    </div>
  );
}

/** La caja para escribir: blanca, redondeada, con el «+» a la izquierda y enviar a la derecha. */
function Caja({
  texto,
  setTexto,
  enviando,
  mandar,
  pendientes,
  agregar,
  quitar,
  puedeMandar,
}: {
  texto: string;
  setTexto: (t: string) => void;
  enviando: boolean;
  mandar: () => void;
  pendientes: Pendiente[];
  agregar: (fs: File[]) => void;
  quitar: (clave: string) => void;
  puedeMandar: boolean;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const selector = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState(false);
  const [encima, setEncima] = useState(false);
  // Crece con el texto hasta un tope, como en cualquier chat.
  useEffect(() => {
    const a = area.current;
    if (!a) return;
    a.style.height = 'auto';
    a.style.height = `${Math.min(a.scrollHeight, 200)}px`;
  }, [texto]);
  useEffect(() => {
    if (!enviando) area.current?.focus();
  }, [enviando]);
  useEffect(() => {
    if (!menu) return;
    const cerrar = () => setMenu(false);
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false);
    document.addEventListener('click', cerrar);
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('click', cerrar);
      document.removeEventListener('keydown', tecla);
    };
  }, [menu]);

  const soltar = (e: DragEvent) => {
    e.preventDefault();
    setEncima(false);
    agregar([...e.dataTransfer.files]);
  };
  const pegar = (e: ClipboardEvent) => {
    const fs = [...e.clipboardData.files];
    if (fs.length) {
      e.preventDefault();
      agregar(fs);
    }
  };

  return (
    <div
      className={`relative rounded-[28px] border bg-white py-2 pl-2 pr-2 shadow-[0_2px_12px_rgba(0,0,0,0.06)] ${encima ? 'border-slate-400 ring-2 ring-slate-200' : 'border-slate-200 focus-within:border-slate-300'}`}
      onDragOver={(e) => {
        e.preventDefault();
        setEncima(true);
      }}
      onDragLeave={() => setEncima(false)}
      onDrop={soltar}
    >
      {pendientes.length > 0 ? (
        <ul className="flex flex-wrap gap-2 px-2 pb-2 pt-1" aria-label="Archivos para mandar">
          {pendientes.map((p) => (
            <li key={p.clave} className="relative">
              {p.esPdf ? (
                <div className="flex h-14 max-w-[13rem] items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700">
                  <IconoPdf />
                  <span className="truncate">{p.nombre}</span>
                </div>
              ) : (
                <img src={p.url} alt={p.nombre} className="h-14 w-14 rounded-xl border border-slate-200 object-cover" />
              )}
              {p.estado === 'subiendo' ? (
                <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-white/70 text-xs text-slate-600" role="status">Subiendo…</span>
              ) : null}
              <button
                type="button"
                aria-label={`Quitar ${p.nombre}`}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[11px] leading-none text-white hover:bg-slate-700"
                onClick={() => quitar(p.clave)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-end gap-1">
        <div className="relative">
          <button
            type="button"
            aria-label="Adjuntar fotos o documentos"
            aria-expanded={menu}
            className="mb-0.5 flex h-9 w-9 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 disabled:opacity-50"
            disabled={enviando}
            onClick={(e) => {
              e.stopPropagation();
              setMenu((m) => !m);
            }}
          >
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
          </button>
          {menu ? (
            <div role="menu" className="absolute bottom-11 left-0 z-30 w-72 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-lg">
              <button
                role="menuitem"
                type="button"
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                onClick={() => {
                  setMenu(false);
                  selector.current?.click();
                }}
              >
                <IconoClip />
                Añadir fotos y documentos
              </button>
              {/* PC-21 · ⚠️ por confirmar con el RGPD (PD-11). */}
              <p className="px-3 pb-1.5 pt-1 text-xs text-slate-500">No subas datos de tus clientas: solo información de tu negocio (horarios, precios, tratamientos…).</p>
            </div>
          ) : null}
          <input
            ref={selector}
            type="file"
            multiple
            accept="image/*,application/pdf,.heic,.heif"
            className="hidden"
            aria-label="Elegir archivos"
            onChange={(e) => {
              agregar([...(e.target.files ?? [])]);
              e.target.value = '';
            }}
          />
        </div>
        <textarea
          ref={area}
          className="max-h-[200px] min-h-10 flex-1 resize-none bg-transparent px-1 py-2 text-[15px] text-slate-900 placeholder:text-slate-400 focus:outline-none"
          rows={1}
          aria-label="Escribe tu mensaje"
          placeholder="Escribe aquí…"
          value={texto}
          disabled={enviando}
          onChange={(e) => setTexto(e.target.value)}
          onPaste={pegar}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              mandar();
            }
          }}
        />
        <button
          type="button"
          aria-label="Enviar"
          className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white hover:bg-slate-700 disabled:bg-slate-200 disabled:text-slate-400"
          disabled={!puedeMandar}
          onClick={mandar}
        >
          <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10 16V4M5 9l5-5 5 5" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/** PC-21: los archivos de un mensaje ya mandado. Pinchando se abren en otra pestaña. */
function AdjuntosDelMensaje({ adjuntos }: { adjuntos: AdjuntoChat[] }) {
  return (
    <ul className="flex flex-wrap justify-end gap-2" aria-label="Archivos del mensaje">
      {adjuntos.map((a) => (
        <li key={a.id}>
          <VistaAdjunto adjunto={a} />
        </li>
      ))}
    </ul>
  );
}

function VistaAdjunto({ adjunto: a }: { adjunto: AdjuntoChat }) {
  const [url, setUrl] = useState<string | null>(urlsLocales.get(a.id) ?? null);
  const esPdf = a.tipo === 'application/pdf';
  useEffect(() => {
    if (url || esPdf) return;
    let vivo = true;
    urlDeAdjunto(a.id).then(
      (u) => {
        if (!vivo) return;
        urlsLocales.set(a.id, u);
        setUrl(u);
      },
      () => undefined,
    );
    return () => {
      vivo = false;
    };
  }, [a.id, esPdf, url]);
  const abrir = async () => {
    try {
      window.open(url ?? (await urlDeAdjunto(a.id)), '_blank', 'noopener');
    } catch {
      // Si ya no está (caducó), no se abre.
    }
  };
  if (esPdf) {
    return (
      <button type="button" onClick={() => void abrir()} className="flex h-14 max-w-[15rem] items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50">
        <IconoPdf />
        <span className="truncate">{a.nombre}</span>
      </button>
    );
  }
  return (
    <button type="button" onClick={() => void abrir()} className="block overflow-hidden rounded-2xl border border-slate-200 bg-slate-100" aria-label={`Ver ${a.nombre}`}>
      {url ? <img src={url} alt={a.nombre} className="max-h-48 max-w-[14rem] object-cover" /> : <span className="block h-32 w-32" />}
    </button>
  );
}

function IconoPdf() {
  return (
    <svg viewBox="0 0 20 20" className="h-6 w-6 shrink-0 text-red-600" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 2.5h6.5L15.5 6.5v11h-10.5z" />
      <path d="M11.5 2.5v4h4" />
      <text x="5.6" y="15" fontSize="4.2" fill="currentColor" stroke="none" fontWeight="700">PDF</text>
    </svg>
  );
}

function IconoClip() {
  return (
    <svg viewBox="0 0 20 20" className="h-[18px] w-[18px] text-slate-500" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15.5 9.5l-5.8 5.8a3.5 3.5 0 0 1-5-5l6.2-6.2a2.3 2.3 0 0 1 3.3 3.3l-6 6a1.2 1.2 0 0 1-1.7-1.7l5.4-5.4" />
    </svg>
  );
}

function Escribiendo() {
  return (
    <div className="flex gap-1 py-2" aria-label="Escribiendo…" role="status">
      {[0, 150, 300].map((d) => (
        <span key={d} className="h-2 w-2 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: `${d}ms` }} />
      ))}
    </div>
  );
}

function IconoSugerencia() {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5.5h12M4 10h8M4 14.5h10" />
    </svg>
  );
}

/** PC-03: el resumen para confirmar. El formato lo pone el portal, no el modelo. */
function BloqueResumen({ resumen: r }: { resumen: Resumen }) {
  return (
    <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 text-slate-900 shadow-xs">
      <p className="text-sm font-semibold">{r.titulo}</p>
      {r.lineas.length > 0 ? (
        <dl className="mt-2 space-y-1 text-sm">
          {r.lineas.map((l, i) => (
            <div key={i} className="flex flex-wrap gap-x-2">
              <dt className="text-slate-500">{l.etiqueta}:</dt>
              <dd className="font-medium">{l.valor}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {r.tabla ? (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                {r.tabla.columnas.map((c, i) => <th key={i} className="py-1 pr-3 font-medium">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {r.tabla.filas.map((f, i) => (
                <tr key={i} className="border-b border-slate-100 last:border-0">
                  {f.map((c, j) => <td key={j} className="py-1 pr-3">{c}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
