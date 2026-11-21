// =============================================================================
// Preparar un archivo antes de subirlo al chat (Fase 9b · PC-21)
// =============================================================================
// Una petición a Vercel no puede pasar de 4,5 MB, y una foto del móvil pesa
// eso o más. Por eso las FOTOS se achican aquí, en el navegador, antes de
// subir: el lado largo a 2000 px y en JPEG (se leen igual de bien y pesan
// unos cientos de KB). De paso, las del iPhone (HEIC) salen en JPEG, si el
// navegador sabe abrirlas (Safari sí). Los PDF van tal cual, hasta 4 MB.
//
// Lo que no es imagen ni PDF se rechaza aquí con una frase; el servidor lo
// vuelve a comprobar en los bytes (src/db/adjuntos.ts), que es lo que manda.
// =============================================================================

export const MAX_ADJUNTOS = 5;
export const MAX_BYTES = 4 * 1024 * 1024;
const LADO_MAXIMO = 2000;

export class ArchivoNoValido extends Error {}

function esPdf(f: File): boolean {
  return f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
}

function esImagen(f: File): boolean {
  return f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(f.name);
}

/** El archivo listo para subir (las fotos, achicadas), o un error con una frase. */
export async function prepararArchivo(f: File): Promise<{ datos: Blob; nombre: string }> {
  if (esPdf(f)) {
    if (f.size > MAX_BYTES) throw new ArchivoNoValido(`«${f.name}» pasa de 4 MB. Prueba con un PDF más pequeño o manda una foto de las páginas que hacen falta.`);
    return { datos: f, nombre: f.name };
  }
  if (!esImagen(f)) throw new ArchivoNoValido(`«${f.name}» no es una imagen ni un PDF. Puedes adjuntar fotos (JPG, PNG) y PDF.`);
  // Un GIF pequeño va tal cual (puede ser animado).
  if (f.type === 'image/gif' && f.size <= MAX_BYTES) return { datos: f, nombre: f.name };
  let imagen: ImageBitmap;
  try {
    imagen = await createImageBitmap(f);
  } catch {
    throw new ArchivoNoValido(`No he podido abrir «${f.name}». Prueba a hacerle una captura o a guardarla como JPG.`);
  }
  const escala = Math.min(1, LADO_MAXIMO / Math.max(imagen.width, imagen.height));
  const ancho = Math.round(imagen.width * escala);
  const alto = Math.round(imagen.height * escala);
  const lienzo = document.createElement('canvas');
  lienzo.width = ancho;
  lienzo.height = alto;
  const ctx = lienzo.getContext('2d');
  if (!ctx) throw new ArchivoNoValido(`No he podido preparar «${f.name}».`);
  // Fondo blanco: un PNG con transparencia no sale negro al pasarlo a JPEG.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, ancho, alto);
  ctx.drawImage(imagen, 0, 0, ancho, alto);
  imagen.close();
  const datos = await new Promise<Blob | null>((ok) => lienzo.toBlob(ok, 'image/jpeg', 0.85));
  if (!datos) throw new ArchivoNoValido(`No he podido preparar «${f.name}».`);
  if (datos.size > MAX_BYTES) throw new ArchivoNoValido(`«${f.name}» sigue pasando de 4 MB.`);
  return { datos, nombre: f.name.replace(/\.[^.]+$/, '') + '.jpg' };
}
