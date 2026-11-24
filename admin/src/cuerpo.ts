// =============================================================================
// El cuerpo de una petición: JSON o un archivo (Fase 5 · Documentos)
// =============================================================================
// Lo comparten el panel y el portal (api.ts y portal/api.ts). Un archivo (un
// PDF o una foto para Documentos) viaja en binario, como los adjuntos del
// chat (PC-21), con su nombre en la cabecera x-nombre; todo lo demás, en JSON.
// =============================================================================

export function cuerpoDe(body: unknown): { headers: Record<string, string>; body?: BodyInit } {
  if (body === undefined) return { headers: {} };
  if (body instanceof Blob) {
    const nombre = body instanceof File ? body.name : 'documento';
    return { headers: { 'content-type': body.type || 'application/octet-stream', 'x-nombre': encodeURIComponent(nombre) }, body };
  }
  return { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}
