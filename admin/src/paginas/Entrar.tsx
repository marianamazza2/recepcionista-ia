// Entrar al panel (PI-01): email y contraseña, sin registro público. Si se
// llega aquí porque la sesión caducó, se dice y el email ya viene puesto (caso 74).

import { useState, type FormEvent } from 'react';

import { entrar, sesionCaducada } from '../api';
import { Aviso, useAccion } from '../ui';

export function Entrar() {
  const caducada = sesionCaducada();
  const [email, setEmail] = useState(caducada ?? '');
  const [password, setPassword] = useState('');
  const a = useAccion();
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    void a.hacer(() => entrar(email.trim(), password), '');
  };
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={enviar} className="tarjeta w-full max-w-sm">
        <h1 className="text-lg font-semibold">Panel del Recepcionista</h1>
        <p className="mt-1 text-sm text-slate-500">Solo para cuentas autorizadas.</p>
        {caducada ? <p role="status" className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">Tu sesión ha caducado. Vuelve a entrar; lo que no llegaste a guardar se ha perdido.</p> : null}
        <label className="etiqueta mt-5" htmlFor="email">Email</label>
        <input id="email" className="campo" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <label className="etiqueta mt-3" htmlFor="password">Contraseña</label>
        <input id="password" className="campo" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <button type="submit" className="boton mt-5 w-full" disabled={a.ocupado}>{a.ocupado ? 'Entrando…' : 'Entrar'}</button>
        <Aviso error={a.error} />
      </form>
    </main>
  );
}
