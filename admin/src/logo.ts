// =============================================================================
// Logo del negocio (PI-10, PW-17)
// =============================================================================
// Se sube PNG, JPG, SVG o WebP. Si pesa más de 150 KB, se reduce aquí, en el
// navegador, a 256 × 256 (en el círculo del chat se ve a 36 px) antes de
// guardarlo: el servidor no tiene librerías de imagen. La base solo acepta
// data URL de esos tipos y hasta 200.000 caracteres (D-75); si aun así no
// cabe, se dice con palabras.
// =============================================================================

export const MAX_BYTES_SIN_REDUCIR = 150 * 1024;
export const MAX_CARACTERES = 200_000;
export const LADO = 256;
const TIPOS = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];

export class LogoNoValido extends Error {}

function leerComoDataUrl(f: Blob): Promise<string> {
  return new Promise((ok, mal) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => mal(new LogoNoValido('No se ha podido leer el archivo.'));
    r.readAsDataURL(f);
  });
}

function cargarImagen(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, mal) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => mal(new LogoNoValido('El archivo no parece una imagen.'));
    img.src = src;
  });
}

/** El logo listo para guardar, reducido si hace falta. */
export async function prepararLogo(archivo: File): Promise<{ dataUrl: string; reducido: boolean }> {
  if (!TIPOS.includes(archivo.type)) throw new LogoNoValido('El logo tiene que ser PNG, JPG, SVG o WebP.');
  const original = await leerComoDataUrl(archivo);
  if (archivo.size <= MAX_BYTES_SIN_REDUCIR && original.length <= MAX_CARACTERES) return { dataUrl: original, reducido: false };

  // Reducir: la imagen entera dentro de 256 × 256, centrada, con fondo
  // transparente (el círculo del chat es blanco).
  const img = await cargarImagen(original);
  const ancho = img.naturalWidth || LADO;
  const alto = img.naturalHeight || LADO;
  const escala = Math.min(LADO / ancho, LADO / alto, 1);
  const lienzo = document.createElement('canvas');
  lienzo.width = LADO;
  lienzo.height = LADO;
  const ctx = lienzo.getContext('2d');
  if (!ctx) throw new LogoNoValido('Este navegador no puede reducir la imagen.');
  const w = ancho * escala;
  const h = alto * escala;
  ctx.drawImage(img, (LADO - w) / 2, (LADO - h) / 2, w, h);
  for (const [tipo, calidad] of [['image/png', undefined], ['image/webp', 0.9], ['image/webp', 0.7]] as const) {
    const dataUrl = lienzo.toDataURL(tipo, calidad);
    if (dataUrl.startsWith(`data:${tipo}`) && dataUrl.length <= MAX_CARACTERES) return { dataUrl, reducido: true };
  }
  throw new LogoNoValido('El logo sigue siendo demasiado grande incluso reducido. Prueba con una imagen más sencilla.');
}

/** Blanco o casi negro sobre el color del negocio, como el widget (contraste WCAG). */
export function textoSobre(hex: string): string {
  const c = /^#([0-9a-f]{6})$/i.exec(hex)?.[1];
  if (!c) return '#fff';
  const canal = (i: number) => {
    const v = parseInt(c.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * canal(0) + 0.7152 * canal(2) + 0.0722 * canal(4);
  return (1.05) / (l + 0.05) >= (l + 0.05) / 0.05 ? '#fff' : '#1a1a1a';
}
