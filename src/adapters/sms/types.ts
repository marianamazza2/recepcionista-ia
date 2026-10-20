// =============================================================================
// SmsProvider — el contrato del envío de SMS (Fase 3 · 3.5, PW-07)
// =============================================================================
// Quien manda la confirmación (src/citas/confirmacion.ts) no sabe qué proveedor
// hay detrás. En la Fase 3 solo existe el de prueba (prueba.ts), que no envía
// nada. El proveedor real se elige y se conecta cuando Mariana lo decida:
// es otra implementación de esta interfaz, sin tocar el resto.
//
// `enviar` lanza si el envío falla; el llamador marca el SMS como `fallido` y
// la cita sigue valiendo.
// =============================================================================

export interface SmsSaliente {
  /** Teléfono con prefijo internacional (+34…). */
  telefono: string;
  texto: string;
}

export interface SmsEnviado {
  /** 'prueba' si el proveedor no lo mandó de verdad. */
  estado: 'enviado' | 'prueba';
  /** Id del mensaje en el proveedor, si lo da. */
  proveedorId?: string;
}

export interface SmsProvider {
  /** Se guarda en sms_messages.proveedor. */
  readonly nombre: string;
  enviar(sms: SmsSaliente): Promise<SmsEnviado>;
}
