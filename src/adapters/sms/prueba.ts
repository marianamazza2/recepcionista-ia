// Proveedor de SMS de prueba (PW-07): no envía nada. Muestra el SMS en la
// consola del servidor y lo marca como `prueba`. Guarda los enviados en
// memoria para que los tests los lean.

import type { SmsEnviado, SmsProvider, SmsSaliente } from './types.js';

export class SmsDePrueba implements SmsProvider {
  readonly nombre = 'prueba';
  readonly enviados: SmsSaliente[] = [];

  constructor(private readonly opts: { silencioso?: boolean } = {}) {}

  async enviar(sms: SmsSaliente): Promise<SmsEnviado> {
    this.enviados.push(sms);
    if (!this.opts.silencioso) {
      console.log(`\n┌─ SMS de prueba (no se envía) → ${sms.telefono}\n│ ${sms.texto}\n└─\n`);
    }
    return { estado: 'prueba' };
  }
}
