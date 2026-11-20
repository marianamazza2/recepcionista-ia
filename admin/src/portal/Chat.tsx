// =============================================================================
// El chat del portal (Fase 9 · 9.3 y 9.5)
// =============================================================================
// Durante el alta es lo ÚNICO que se ve (PC-11): con el negocio vacío, las
// secciones del portal serían huecos y botones que no llevan a nada. Al
// terminar, el portal aparece y el chat se queda al lado para pedir cambios
// («Núria no viene el jueves»).
//
// El resumen de cada sección (PC-03) lo dibuja esta pantalla, no el modelo: la
// respuesta trae los datos (título, líneas y, si hace falta, una tabla) y aquí
// se pintan siempre igual. Se ve como texto: React escapa, así que lo que
// escriba el cliente nunca se interpreta como HTML.
// =============================================================================

import { useEffect, useRef, useState } from 'react';

import { api, type MensajeChat, type RespuestaChat, type Resumen } from './api';
import { Aviso, Cargando } from '../ui';

interface Linea extends MensajeChat {
  resumen?: Resumen | null;
}

export function Chat({ alTerminarElAlta, compacto }: { alTerminarElAlta: () => void; compacto?: boolean }) {
  const [lineas, setLineas] = useState<Linea[] | null>(null);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fin = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let vivo = true;
    api<{ mensajes: MensajeChat[] }>('GET', 'chat').then(
      async (r) => {
        if (!vivo) return;
        // La primera vez no hay nada: el chat saluda él (sección 0 del guion).
        if (r.mensajes.length === 0) {
          setLineas([]);
          await enviar('Hola', []);
        } else {
          setLineas(r.mensajes);
        }
      },
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
      const r = await api<RespuestaChat>('POST', 'chat', { texto: mensaje, clientMessageId: crypto.randomUUID() });
      setLineas([...conElMio, { rol: 'asistente', texto: r.respuesta, resumen: r.resumen }]);
      if (r.altaTerminada) alTerminarElAlta();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido enviar. Inténtalo otra vez.');
      setLineas(previas);
      setTexto(mensaje);
    } finally {
      setEnviando(false);
    }
  }

  const mandar = () => {
    const t = texto.trim();
    if (!t || enviando) return;
    setTexto('');
    void enviar(t, lineas ?? []);
  };

  if (error && !lineas) return <Aviso error={error} />;
  if (!lineas) return <Cargando />;

  return (
    <div className={`flex flex-col ${compacto ? 'h-[32rem]' : 'h-[calc(100vh-10rem)]'} rounded-lg border border-slate-200 bg-white`}>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {lineas.map((l, i) => (
          <div key={i} className={l.rol === 'cliente' ? 'flex justify-end' : 'flex justify-start'}>
            <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm ${l.rol === 'cliente' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-900'}`}>
              {l.texto}
              {l.resumen ? <BloqueResumen resumen={l.resumen} /> : null}
            </div>
          </div>
        ))}
        {enviando ? <p className="text-xs text-slate-400">Escribiendo…</p> : null}
        <div ref={fin} />
      </div>
      {error ? <div className="px-4"><Aviso error={error} /></div> : null}
      <div className="flex gap-2 border-t border-slate-200 p-3">
        <textarea
          className="campo min-h-11 resize-none"
          rows={1}
          aria-label="Escribe tu respuesta"
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
        <button type="button" className="boton" disabled={enviando || texto.trim() === ''} onClick={mandar}>Enviar</button>
      </div>
    </div>
  );
}

/** PC-03: el resumen para confirmar. El formato lo pone el portal, no el modelo. */
function BloqueResumen({ resumen: r }: { resumen: Resumen }) {
  return (
    <div className="mt-3 rounded-lg border border-slate-300 bg-white p-3 text-slate-900">
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
