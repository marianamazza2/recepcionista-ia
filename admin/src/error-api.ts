// =============================================================================
// Un error que la API explicó con palabras (Fase 4 · 4.3; Fase 9 · 9.4)
// =============================================================================
// Vive aparte porque lo comparten las DOS apps de admin/: el panel
// (src/api.ts) y el portal del cliente (src/portal/api.ts). Si cada una
// tuviera su clase, `mensajeDe()` (src/ui.tsx) solo reconocería la del panel
// y el portal enseñaría "No se ha podido conectar con el servidor" en vez de
// la frase que mandó la API.
// =============================================================================

export class ErrorApi extends Error {
  constructor(
    readonly status: number,
    mensaje: string,
    readonly datos: Record<string, unknown> = {},
  ) {
    super(mensaje);
    this.name = 'ErrorApi';
  }
}
