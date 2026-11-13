// Proveedor de email de prueba (PW-18): no envía nada. Muestra el email en la
// consola del servidor y lo marca como `prueba`. Guarda los enviados en
// memoria para que los tests (y agent:eval, que lee el código, PA-16) los lean.

import type { EmailEnviado, EmailProvider, EmailSaliente } from './types.js';

export class EmailDePrueba implements EmailProvider {
  readonly nombre = 'prueba';
  readonly enviados: EmailSaliente[] = [];

  constructor(private readonly opts: { silencioso?: boolean } = {}) {}

  async enviar(email: EmailSaliente): Promise<EmailEnviado> {
    this.enviados.push(email);
    if (!this.opts.silencioso) {
      const adjuntos = email.adjuntos?.length ? `\n│ (adjunto: ${email.adjuntos.map((a) => a.nombre).join(', ')})` : '';
      const cuerpo = email.texto.split('\n').join('\n│ ');
      console.log(
        `\n┌─ Email de prueba (no se envía) → ${email.para}\n│ De: ${email.remitente}\n│ Asunto: ${email.asunto}\n│\n│ ${cuerpo}${adjuntos}\n└─\n`,
      );
    }
    return { estado: 'prueba' };
  }

  /** El último código de 6 dígitos mandado a ese email (para tests y agent:eval). */
  ultimoCodigo(para: string): string | null {
    for (let i = this.enviados.length - 1; i >= 0; i--) {
      const e = this.enviados[i]!;
      if (e.para !== para) continue;
      const m = /\b(\d{6})\b/.exec(e.texto);
      if (m && /código/i.test(e.asunto)) return m[1]!;
    }
    return null;
  }
}
