// =============================================================================
// "Su portal": el enlace de invitación y la vista de Mariana (Fase 9 · 9.6)
// =============================================================================
//   · PC-02: generar, ver, anular y regenerar el enlace de cada negocio. El
//     enlace solo se enseña una vez, cuando se genera: en la base queda solo
//     su hash, así que después ya no se puede volver a ver (se genera otro).
//   · PC-13: si el cliente ya terminó el alta, se dice aquí y se marca como
//     revisada.
//   · PC-05: debajo, SU portal tal como lo ve él (la misma ficha, con
//     `ver: portal`: sin tope, sin activar y sin la clave), editable por
//     Mariana. Lo que cambie aquí lo ve él al recargar y al revés.
// =============================================================================

import { useState } from 'react';

import { api, type Negocio } from '../api';
import { ProveedorNegocio } from '../negocio-api';
import { Aviso, Bloque, fechaHora, useAccion, useCarga } from '../ui';
import { Ficha } from './Ficha';

interface EstadoInvitacion {
  invitacion: { email: string; expiraAt: string; creadaAt: string } | null;
  alta: { seccion: number; terminadaAt: string | null; revisadaAt: string | null };
}

const SECCIONES = ['la bienvenida', 'su negocio', 'los servicios', 'las profesionales', 'los horarios', 'festivos', 'las reservas', 'preguntas', 'el chat en su web', 'el cierre'];

export function Invitacion({ negocio: n, poner }: { negocio: Negocio; poner: (n: Negocio) => void }) {
  const { datos, error, recargar, poner: ponerEstado } = useCarga(() => api<EstadoInvitacion>('GET', `negocios/${n.id}/invitacion`), [n.id]);
  const [email, setEmail] = useState('');
  const [enlace, setEnlace] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const a = useAccion();

  // PC-05: lo de abajo es su portal tal como lo ve él, pero contra la API del panel.
  const comoElCliente = {
    ver: 'portal' as const,
    pedir: <T,>(metodo: 'GET' | 'POST' | 'PUT' | 'DELETE', camino: string, body?: unknown) =>
      api<T>(metodo, `negocios/${n.id}${camino ? `/${camino}` : ''}`, body),
  };

  const generar = () =>
    a.hacer(async () => {
      const r = await api<EstadoInvitacion & { enlace: string; emailEstado: string }>('POST', `negocios/${n.id}/invitacion`, { email: email.trim().toLowerCase() });
      setEnlace(r.enlace);
      ponerEstado({ invitacion: r.invitacion, alta: r.alta });
    }, 'Enlace generado. Cópialo ahora: después ya no se puede volver a ver.');

  const anular = () =>
    a.hacer(async () => {
      ponerEstado(await api<EstadoInvitacion>('DELETE', `negocios/${n.id}/invitacion`));
      setEnlace(null);
    }, 'Enlace anulado. Ya no sirve.');

  const revisada = () =>
    a.hacer(async () => {
      await api('POST', `negocios/${n.id}/alta/revisada`);
      recargar();
    }, 'Marcada como revisada.');

  const copiar = async () => {
    if (!enlace) return;
    try {
      await navigator.clipboard.writeText(enlace);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setCopiado(false);
    }
  };

  return (
    <div className="space-y-6">
      <Bloque titulo="Su acceso al portal" ayuda="El enlace es la única puerta: nadie se da de alta por su cuenta. Vale una sola vez, caduca a los 7 días y se puede anular.">
        {error ? <Aviso error={error} /> : null}
        {datos?.alta.terminadaAt ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            <p className="font-semibold">Terminó el alta el {fechaHora(datos.alta.terminadaAt)}.</p>
            <p className="mt-1">Revisa su configuración aquí abajo y, cuando esté, actívalo desde la Ficha.</p>
            {datos.alta.revisadaAt ? (
              <p className="mt-1 text-emerald-700">Ya lo revisaste el {fechaHora(datos.alta.revisadaAt)}.</p>
            ) : (
              <button type="button" className="boton mt-2" disabled={a.ocupado} onClick={() => void revisada()}>Marcar como revisada</button>
            )}
          </div>
        ) : datos ? (
          <p className="text-sm text-slate-600">
            Todavía no ha terminado el alta{datos.alta.seccion > 0 ? `: va por ${SECCIONES[datos.alta.seccion] ?? 'el principio'}` : ''}.
          </p>
        ) : null}

        {datos?.invitacion ? (
          <p className="mt-4 text-sm">
            Hay un enlace vivo para <strong>{datos.invitacion.email}</strong>, generado el {fechaHora(datos.invitacion.creadaAt)} y válido hasta el {fechaHora(datos.invitacion.expiraAt)}.
            <button type="button" className="ml-2 text-xs text-red-700 underline hover:no-underline" disabled={a.ocupado} onClick={() => void anular()}>Anularlo</button>
          </p>
        ) : (
          <p className="mt-4 text-sm text-slate-500">No hay ningún enlace vivo.</p>
        )}

        {enlace ? (
          <div className="mt-3">
            <span className="etiqueta">El enlace (cópialo ahora: no se puede volver a ver)</span>
            <pre className="overflow-x-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">{enlace}</pre>
            <button type="button" className="boton-suave mt-2" onClick={() => void copiar()}>{copiado ? 'Copiado' : 'Copiar'}</button>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="etiqueta">Email del contacto</span>
            <input className="campo" type="email" placeholder="contacto@sunegocio.es" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <button type="button" className="boton" disabled={a.ocupado || !email.includes('@')} onClick={() => void generar()}>
            {datos?.invitacion ? 'Generar otro (anula el anterior)' : 'Generar el enlace'}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">Al generarlo se le manda por email. Hoy los emails son de prueba: salen en la Terminal o en los registros de Vercel.</p>
        <Aviso error={a.error} ok={a.ok} />
      </Bloque>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-slate-500">Su portal, tal como lo ve él (y lo puedes editar)</h2>
        <ProveedorNegocio valor={comoElCliente}>
          <Ficha negocio={n} poner={poner} />
        </ProveedorNegocio>
      </div>
    </div>
  );
}
