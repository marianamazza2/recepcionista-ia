// =============================================================================
// Normalización de emails (PA-17, 13/11/2026)
// =============================================================================
// El email identifica a la clienta dentro de un negocio. "Maria.Lopez@Gmail.com "
// y "maria.lopez@gmail.com" tienen que ser la misma persona, así que se guarda
// y se busca siempre en minúsculas y sin espacios. El formato es el mismo que
// comprueba la base (customers_email_formato).
// =============================================================================

/** Devuelve el email en minúsculas, o null si no parece un email. */
export function normalizarEmail(entrada: string): string | null {
  const s = entrada.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) return null;
  // "maria@gmail" o "maria@.com" no llegan a ningún sitio.
  const dominio = s.split('@')[1]!;
  if (dominio.startsWith('.') || dominio.endsWith('.') || dominio.includes('..')) return null;
  return s;
}
