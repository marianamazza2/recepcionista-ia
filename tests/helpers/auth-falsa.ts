// Proveedor de cuentas falso para los tests del panel (Fase 4 · 4.8): sin red
// ni Supabase Auth. Un usuario por email y contraseña; los tokens son
// aleatorios y valen hasta que se "caducan" a mano.

import { randomBytes, randomUUID } from 'node:crypto';

import type { AuthPanel, SesionPanel, UsuarioAuth } from '../../src/api/admin/auth.js';

export class AuthFalsa implements AuthPanel {
  private readonly usuarios = new Map<string, { id: string; password: string }>();
  private readonly tokens = new Map<string, UsuarioAuth>();
  private readonly renovaciones = new Map<string, UsuarioAuth>();

  /** Crea un usuario en "Supabase Auth" y devuelve su id. */
  crearUsuario(email: string, password: string): string {
    const id = randomUUID();
    this.usuarios.set(email, { id, password });
    return id;
  }

  /** Un token de acceso válido para ese usuario, como si hubiera entrado. */
  tokenPara(email: string): string {
    const u = this.usuarios.get(email);
    if (!u) throw new Error(`No existe ${email}`);
    const t = randomBytes(24).toString('base64url');
    this.tokens.set(t, { id: u.id, email });
    return t;
  }

  caducar(token: string): void {
    this.tokens.delete(token);
  }

  private sesion(u: UsuarioAuth): SesionPanel {
    const accessToken = randomBytes(24).toString('base64url');
    const refreshToken = randomBytes(24).toString('base64url');
    this.tokens.set(accessToken, u);
    this.renovaciones.set(refreshToken, u);
    return { accessToken, refreshToken, expiraEn: 3600 };
  }

  async entrar(email: string, password: string): Promise<SesionPanel | null> {
    const u = this.usuarios.get(email);
    return u && u.password === password ? this.sesion({ id: u.id, email }) : null;
  }

  async renovar(refreshToken: string): Promise<SesionPanel | null> {
    const u = this.renovaciones.get(refreshToken);
    if (!u) return null;
    this.renovaciones.delete(refreshToken);
    return this.sesion(u);
  }

  async usuario(accessToken: string): Promise<UsuarioAuth | null> {
    return this.tokens.get(accessToken) ?? null;
  }
}
