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
//   · En cuanto escribe, la conversación ocupa el centro y la caja baja al
//     pie.
//   · El primer mensaje abre el chat en el servidor (PC-17) y avisa a quien
//     lo contiene para que aparezca en el historial con su título.
//
// El resumen de cada sección (PC-03) lo dibuja esta pantalla, no el modelo: la
// respuesta trae los datos (título, líneas y, si hace falta, una tabla) y aquí
// se pintan siempre igual. Se ve como texto: React escapa, así que lo que
// escriba el cliente nunca se interpreta como HTML.
// =============================================================================

import { useEffect, useRef, useState } from 'react';

import { api, type MensajeChat, type RespuestaChat, type Resumen } from './api';
import { PEDIDOS, type Pedido } from './pedir';
import { Aviso } from '../ui';

interface Linea extends MensajeChat {
  resumen?: Resumen | null;
}

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

  async function enviar(mensaje: string, previas: Linea[]): Promise<void> {
    setEnviando(true);
    setError(null);
    const conElMio: Linea[] = [...previas, { rol: 'cliente', texto: mensaje }];
    setLineas(conElMio);
    try {
      const r = await api<RespuestaChat>('POST', 'chat', { texto: mensaje, clientMessageId: crypto.randomUUID(), chatId: id.current });
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
    } finally {
      setEnviando(false);
    }
  }

  const mandar = (t = texto) => {
    const limpio = t.trim();
    if (!limpio || enviando) return;
    setTexto('');
    void enviar(limpio, lineas ?? []);
  };

  if (error && !lineas) return <div className="mx-auto max-w-3xl p-6"><Aviso error={error} /></div>;
  if (!lineas) return <p className="p-6 text-center text-sm text-slate-400">Cargando…</p>;

  const caja = <Caja texto={texto} setTexto={setTexto} enviando={enviando} mandar={() => mandar()} />;

  // La pantalla de inicio: saludo, la caja en el centro y las sugerencias.
  if (lineas.length === 0 && !enviando) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-4 pb-24">
        <Saludo saludo={saludo} />
        <div className="w-full max-w-3xl">
          {caja}
          {error ? <div className="mt-3"><Aviso error={error} /></div> : null}
          {sugerencias.length > 0 ? (
            <ul className="mt-6 space-y-1" aria-label="Sugerencias">
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
                <div data-rol="cliente" className="max-w-[80%] whitespace-pre-wrap rounded-3xl bg-slate-200/70 px-4 py-2.5 text-[15px] text-slate-900">{l.texto}</div>
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
    <div className="mb-10 max-w-3xl text-center leading-tight text-slate-800">
      <h1 className="break-words text-3xl font-medium sm:text-[2.5rem]">{arriba}</h1>
      {abajo ? <h2 className="mt-3 text-xl font-normal text-slate-500 sm:text-2xl">{abajo}</h2> : null}
    </div>
  );
}

/** La caja para escribir: blanca, redondeada, con el botón de enviar dentro. */
function Caja({ texto, setTexto, enviando, mandar }: { texto: string; setTexto: (t: string) => void; enviando: boolean; mandar: () => void }) {
  const area = useRef<HTMLTextAreaElement>(null);
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
  return (
    <div className="flex items-end gap-2 rounded-[28px] border border-slate-200 bg-white py-2 pl-5 pr-2 shadow-[0_2px_12px_rgba(0,0,0,0.06)] focus-within:border-slate-300">
      <textarea
        ref={area}
        className="max-h-[200px] min-h-10 flex-1 resize-none bg-transparent py-2 text-[15px] text-slate-900 placeholder:text-slate-400 focus:outline-none"
        rows={1}
        aria-label="Escribe tu mensaje"
        placeholder="Escribe aquí…"
        value={texto}
        disabled={enviando}
        onChange={(e) => setTexto(e.target.value)}
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
        disabled={enviando || texto.trim() === ''}
        onClick={mandar}
      >
        <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10 16V4M5 9l5-5 5 5" />
        </svg>
      </button>
    </div>
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
