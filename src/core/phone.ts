// =============================================================================
// Normalización de teléfonos (Fase 2 · 2.3)
// =============================================================================
// El teléfono identifica a la clienta dentro de un negocio (PA-02, UNIQUE
// (business_id, telefono)). "600 11 12 22", "+34 600-111-222" y
// "0034600111222" tienen que ser la misma persona, así que se guarda y se busca
// siempre en formato internacional: "+34600111222".
//
// Sin prefijo, se asume España (+34): el MVP es solo España (maestro §2.2).
// =============================================================================

const PREFIJO_POR_DEFECTO = '34';

/** Devuelve el teléfono en formato internacional, o null si no parece un teléfono. */
export function normalizarTelefono(entrada: string): string | null {
  let s = entrada.trim().replace(/[\s.\-()/]/g, '');
  if (s.startsWith('00')) {
    s = '+' + s.slice(2);
  }
  if (!s.startsWith('+')) {
    // Número nacional español: 9 cifras que empiezan por 6, 7, 8 o 9.
    if (/^[6789]\d{8}$/.test(s)) {
      s = `+${PREFIJO_POR_DEFECTO}${s}`;
    } else {
      return null;
    }
  }
  if (!/^\+[1-9]\d{7,14}$/.test(s)) {
    return null;
  }
  // Un número español con prefijo tiene que tener 9 cifras después del +34.
  if (s.startsWith('+34') && !/^\+34[6789]\d{8}$/.test(s)) {
    return null;
  }
  return s;
}
