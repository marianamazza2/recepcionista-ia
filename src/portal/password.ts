// =============================================================================
// Contraseñas del portal (Fase 9 · 9.2, PC-11)
// =============================================================================
// Las cuentas del portal son nuestras, no de Supabase Auth (D-80): crear
// usuarios desde el servidor pediría la SUPABASE_SERVICE_ROLE_KEY, que no
// puede ir a Vercel (§6 del AGENTS.md raíz), y el alta con la clave anon
// abriría registro público, que PC-11 prohíbe (el enlace es la única puerta).
//
// scrypt del módulo `crypto` de Node (sin dependencias nuevas), con sal de 16
// bytes y los parámetros recomendados por la documentación de Node para
// contraseñas interactivas. El formato guardado lleva los parámetros dentro,
// así que se pueden subir más adelante sin romper las contraseñas de antes:
//
//   scrypt$N$r$p$<sal en base64url>$<hash en base64url>
//
// La comparación es en tiempo constante (timingSafeEqual).
// =============================================================================

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  opciones: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** Coste de serie: ~100 ms por hash en un portátil. */
const N = 16384;
const R = 8;
const P = 1;
const LARGO = 32;
/** scrypt pide 128 · N · r bytes; el de serie de Node (32 MB) se queda corto con N alto. */
const MAXMEM = 64 * 1024 * 1024;

/** PC-11: lo mínimo que se le pide a una contraseña del portal. */
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;

/** Null si la contraseña vale; si no, la frase que se le enseña al cliente. */
export function problemaConPassword(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `La contraseña tiene que tener al menos ${PASSWORD_MIN} caracteres.`;
  if (password.length > PASSWORD_MAX) return `La contraseña es demasiado larga (máximo ${PASSWORD_MAX} caracteres).`;
  if (password.trim() === '') return 'La contraseña no puede estar en blanco.';
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const sal = randomBytes(16);
  const hash = await scryptAsync(password.normalize('NFKC'), sal, LARGO, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${sal.toString('base64url')}$${hash.toString('base64url')}`;
}

/** Comprueba la contraseña contra lo guardado. Nunca lanza: un hash raro es "no coincide". */
export async function verificarPassword(password: string, guardado: string): Promise<boolean> {
  const partes = guardado.split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;
  const n = Number(partes[1]);
  const r = Number(partes[2]);
  const p = Number(partes[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  try {
    const sal = Buffer.from(partes[4]!, 'base64url');
    const esperado = Buffer.from(partes[5]!, 'base64url');
    const hash = await scryptAsync(password.normalize('NFKC'), sal, esperado.length, { N: n, r, p, maxmem: MAXMEM });
    return hash.length === esperado.length && timingSafeEqual(hash, esperado);
  } catch {
    return false;
  }
}
