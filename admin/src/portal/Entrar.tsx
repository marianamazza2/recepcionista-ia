// =============================================================================
// Entrar al portal y crear la cuenta con el enlace (Fase 9 · 9.2, PC-02, PC-11)
// =============================================================================
// Dos pantallas y ninguna más: no hay registro abierto. El enlace de
// invitación es la única puerta; a partir de la segunda vez se entra con email
// y contraseña.
// =============================================================================

import { useEffect, useState, type FormEvent } from 'react';

import { abrirInvitacion, crearCuenta, entrar, sesionCaducada } from './api';
import { Aviso, useAccion } from '../ui';

export function Entrar() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const a = useAccion();
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    void a.hacer(() => entrar(email.trim(), password), '');
  };
  return (
    <Marco titulo="Tu portal">
      {sesionCaducada() ? (
        <p role="status" className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">Tu sesión ha caducado. Vuelve a entrar y seguimos donde lo dejaste.</p>
      ) : null}
      <form onSubmit={enviar}>
        <label className="etiqueta mt-5" htmlFor="email">Email</label>
        <input id="email" className="campo" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <label className="etiqueta mt-3" htmlFor="password">Contraseña</label>
        <input id="password" className="campo" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <button type="submit" className="boton mt-5 w-full" disabled={a.ocupado}>{a.ocupado ? 'Entrando…' : 'Entrar'}</button>
        <Aviso error={a.error} />
      </form>
      <p className="mt-5 text-xs text-slate-500">
        ¿Es tu primera vez? Entra con el enlace que te ha pasado MAZZMKT: es el único modo de crear tu cuenta.
      </p>
    </Marco>
  );
}

/** Con el enlace: se manda el código al email de la invitación y se crea la cuenta. */
export function CrearCuenta({ token }: { token: string }) {
  const [paso, setPaso] = useState<'abriendo' | 'codigo' | 'roto'>('abriendo');
  const [negocio, setNegocio] = useState('');
  const [correo, setCorreo] = useState('');
  const [codigo, setCodigo] = useState('');
  const [password, setPassword] = useState('');
  const [repetida, setRepetida] = useState('');
  const [fallo, setFallo] = useState<string | null>(null);
  const a = useAccion();

  useEffect(() => {
    let vivo = true;
    abrirInvitacion(token).then(
      (r) => {
        if (!vivo) return;
        setNegocio(r.negocio);
        setCorreo(r.email);
        setPaso('codigo');
      },
      (e: unknown) => {
        if (!vivo) return;
        setFallo(e instanceof Error ? e.message : 'Este enlace ya no sirve.');
        setPaso('roto');
      },
    );
    return () => {
      vivo = false;
    };
  }, [token]);

  const crear = (e: FormEvent) => {
    e.preventDefault();
    if (password !== repetida) {
      setFallo('Las dos contraseñas no coinciden.');
      return;
    }
    setFallo(null);
    void a.hacer(() => crearCuenta(token, codigo.trim(), password), '');
  };

  if (paso === 'abriendo') return <Marco titulo="Un momento…"><p className="mt-3 text-sm text-slate-500">Comprobando tu enlace.</p></Marco>;
  if (paso === 'roto') {
    return (
      <Marco titulo="Este enlace ya no sirve">
        <p className="mt-3 text-sm text-slate-600">{fallo}</p>
        <p className="mt-3 text-sm text-slate-500">Si ya tienes cuenta, <a className="underline" href="#/">entra con tu email y tu contraseña</a>.</p>
      </Marco>
    );
  }
  return (
    <Marco titulo={`Bienvenida al portal de ${negocio}`}>
      <p className="mt-2 text-sm text-slate-600">
        Te hemos mandado un código a <strong>{correo}</strong>. Escríbelo aquí y elige tu contraseña: con esas dos cosas entrarás a partir de ahora.
      </p>
      <form onSubmit={crear}>
        <label className="etiqueta mt-5" htmlFor="codigo">Código del email</label>
        <input id="codigo" className="campo font-mono tracking-widest" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={codigo} onChange={(e) => setCodigo(e.target.value)} />
        <label className="etiqueta mt-3" htmlFor="password">Tu contraseña</label>
        <input id="password" className="campo" type="password" autoComplete="new-password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
        <p className="mt-1 text-xs text-slate-500">Al menos 10 caracteres.</p>
        <label className="etiqueta mt-3" htmlFor="repetida">Repítela</label>
        <input id="repetida" className="campo" type="password" autoComplete="new-password" required value={repetida} onChange={(e) => setRepetida(e.target.value)} />
        <button type="submit" className="boton mt-5 w-full" disabled={a.ocupado}>{a.ocupado ? 'Creando…' : 'Crear mi cuenta'}</button>
        <Aviso error={fallo ?? a.error} />
      </form>
    </Marco>
  );
}

function Marco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="tarjeta w-full max-w-sm">
        <h1 className="text-lg font-semibold">{titulo}</h1>
        {children}
      </div>
    </main>
  );
}
