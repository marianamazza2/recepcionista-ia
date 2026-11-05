// Entrar al panel (PI-01): email y contraseña, sin registro público.

import { useState, type FormEvent } from 'react';

import { entrar } from '../api';
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
    <main className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={enviar} className="tarjeta w-full max-w-sm">
        <h1 className="text-lg font-semibold">Panel del Recepcionista</h1>
        <p className="mt-1 text-sm text-slate-500">Solo para cuentas autorizadas.</p>
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
