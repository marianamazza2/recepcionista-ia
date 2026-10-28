// Probar el chat del negocio desde el panel (PI-13): usa la IA de verdad
// (cuesta lo mismo), aunque el negocio esté en prueba y sin web. La
// conversación queda marcada como prueba. Si reserva, la cita es real.

import { useRef, useState, type FormEvent } from 'react';

import { api, type Negocio, type RespuestaChat } from '../api';
import { textoSobre } from '../logo';
import { Aviso, mensajeDe } from '../ui';

interface Mensaje {
  rol: 'clienta' | 'asistente';
  texto: string;
}

export function Probar({ negocio: n }: { negocio: Negocio }) {
  const [mensajes, setMensajes] = useState<Mensaje[]>(n.mensajeBienvenida ? [{ rol: 'asistente', texto: n.mensajeBienvenida }] : []);
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const token = useRef<string | null>(null);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    const t = texto.trim();
    if (!t || ocupado) return;
    setTexto('');
    setError(null);
    setMensajes((m) => [...m, { rol: 'clienta', texto: t }]);
    setOcupado(true);
    try {
      const r = await api<RespuestaChat>('POST', `negocios/${n.id}/probar`, { sessionToken: token.current, clientMessageId: crypto.randomUUID(), texto: t });
      token.current = r.sessionToken;
      setMensajes((m) => [...m, { rol: 'asistente', texto: r.respuesta }]);
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setOcupado(false);
    }
  };

  const reiniciar = () => {
    token.current = null;
    setMensajes(n.mensajeBienvenida ? [{ rol: 'asistente', texto: n.mensajeBienvenida }] : []);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
      <div className="flex h-[70vh] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        <div className="px-4 py-3 text-sm font-semibold" style={{ background: n.chat.color, color: textoSobre(n.chat.color) }}>{n.nombre} · prueba</div>
        <div className="flex-1 space-y-2 overflow-y-auto p-4" aria-live="polite">
          {mensajes.map((m, i) => (
            <p key={i} className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${m.rol === 'clienta' ? 'ml-auto bg-slate-900 text-white' : 'bg-slate-100'}`}>{m.texto}</p>
          ))}
          {ocupado ? <p className="text-xs text-slate-400">Escribiendo…</p> : null}
        </div>
        <form onSubmit={(e) => void enviar(e)} className="flex gap-2 border-t border-slate-200 p-3">
          <input className="campo" aria-label="Mensaje" placeholder="Escribe como si fueras una clienta…" value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={1000} />
          <button className="boton" disabled={ocupado || !texto.trim()}>Enviar</button>
        </form>
      </div>
      <aside className="space-y-3 text-sm text-slate-600">
        <p>Conversas con el agente de <strong>{n.nombre}</strong> con sus servicios, horarios y reglas, aunque todavía no esté activo.</p>
        <p>Usa la IA de verdad: <strong>cuesta lo mismo</strong> que una conversación real. Queda guardada como <em>prueba</em> en Conversaciones y el consumo la cuenta aparte.</p>
        <p>Si reservas, la cita es real (y sale el SMS de prueba): cancélala desde el chat o desde la Agenda.</p>
        <button type="button" className="boton-suave" onClick={reiniciar}>Empezar otra conversación</button>
        <Aviso error={error} />
      </aside>
    </div>
  );
}
