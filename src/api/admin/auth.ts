// =============================================================================
// Cuentas del panel (Fase 4 · 4.2, PI-01)
// =============================================================================
// Supabase Auth con email y contraseña, sin registro público. El panel habla
// solo con nuestra API: el login pasa por aquí (POST /api/admin/sesion) y el
// navegador guarda el token de acceso de Supabase, que manda en cada petición
// (Authorization: Bearer …).
//
// En CADA petición el servidor:
//   1. verifica el token con Supabase Auth: GET /auth/v1/user con `apikey` y
//      el token (200 = válido). Es la forma que la documentación de Supabase
//      ("JSON Web Tokens", verificado el 28/10/2026) recomienda para las
//      claves HS256 y que también vale con claves asimétricas; la función
//      corre en fra1, la región del proyecto;
//   2. comprueba que el usuario está en panel.personas (activa).
// Un token inventado, caducado o de alguien que no está en la lista → 401.
//
// Para no llamar a Supabase en cada clic, un token ya verificado se recuerda
// 60 s (por su hash, en memoria de la instancia).
//
// Ninguna clave de servicio llega aquí: basta la anon (pública). La clave de
// servicio solo la usa `npm run panel:cuenta`, en la Terminal de Mariana.
// =============================================================================

import { sha256 } from '../../db/widget.js';

export interface SesionPanel {
  accessToken: string;
  refreshToken: string;
  /** Segundos hasta que caduca el token de acceso. */
  expiraEn: number;
}

export interface UsuarioAuth {
  id: string;
  email: string;
}

/** Lo que el panel necesita de un proveedor de cuentas. Los tests usan uno falso. */
export interface AuthPanel {
  entrar(email: string, password: string): Promise<SesionPanel | null>;
  renovar(refreshToken: string): Promise<SesionPanel | null>;
  /** El usuario del token, o null si no es válido. */
  usuario(accessToken: string): Promise<UsuarioAuth | null>;
}

export interface OpcionesSupabaseAuth {
  /** https://<ref>.supabase.co */
  url: string;
  /** La clave anon/publishable del proyecto (pública). */
  anonKey: string;
  fetch?: typeof fetch;
  /** Cuánto se recuerda un token ya verificado. */
  recordarMs?: number;
}

/** La URL del proyecto: SUPABASE_URL o, si no, la que sale de SUPABASE_PROJECT_REF. */
export function urlSupabase(env: NodeJS.ProcessEnv = process.env): string | null {
  const url = env.SUPABASE_URL?.trim().replace(/\/+$/, '');
  if (url) return url;
  const ref = env.SUPABASE_PROJECT_REF?.trim();
  return ref ? `https://${ref}.supabase.co` : null;
}

/** El proveedor de Supabase Auth si están SUPABASE_PROJECT_REF (o SUPABASE_URL) y SUPABASE_ANON_KEY. */
export function authPanelDesdeEnv(env: NodeJS.ProcessEnv = process.env): AuthPanel | null {
  const url = urlSupabase(env);
  const anonKey = env.SUPABASE_ANON_KEY?.trim();
  return url && anonKey ? supabaseAuth({ url, anonKey }) : null;
}

export function supabaseAuth(o: OpcionesSupabaseAuth): AuthPanel {
  const f = o.fetch ?? fetch;
  const recordarMs = o.recordarMs ?? 60_000;
  const vistos = new Map<string, { usuario: UsuarioAuth; hasta: number }>();

  const sesion = async (grant: 'password' | 'refresh_token', body: Record<string, string>): Promise<SesionPanel | null> => {
    const r = await f(`${o.url}/auth/v1/token?grant_type=${grant}`, {
      method: 'POST',
      headers: { apikey: o.anonKey, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!j.access_token || !j.refresh_token) return null;
    return { accessToken: j.access_token, refreshToken: j.refresh_token, expiraEn: j.expires_in ?? 3600 };
  };

  return {
    entrar: (email, password) => sesion('password', { email, password }),
    renovar: (refreshToken) => sesion('refresh_token', { refresh_token: refreshToken }),
    async usuario(accessToken) {
      const clave = sha256(accessToken);
      const ahora = Date.now();
      const visto = vistos.get(clave);
      if (visto && visto.hasta > ahora) return visto.usuario;
      const r = await f(`${o.url}/auth/v1/user`, { headers: { apikey: o.anonKey, authorization: `Bearer ${accessToken}` } });
      if (!r.ok) return null;
      const j = (await r.json()) as { id?: string; email?: string };
      if (!j.id || !j.email) return null;
      const usuario = { id: j.id, email: j.email.toLowerCase() };
      if (vistos.size > 200) vistos.clear();
      vistos.set(clave, { usuario, hasta: ahora + recordarMs });
      return usuario;
    },
  };
}
