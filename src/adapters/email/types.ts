// =============================================================================
// EmailProvider — el contrato del envío de emails (PW-18, 13/11/2026)
// =============================================================================
// Quien manda la confirmación o el código (src/citas/confirmacion.ts,
// src/citas/codigo.ts) no sabe qué proveedor hay detrás. De momento solo
// existe el de prueba (prueba.ts), que no envía nada. El proveedor real
// (Resend, Amazon SES…) se elige y se conecta cuando Mariana lo decida: es
// otra implementación de esta interfaz, sin tocar el resto.
//
// `enviar` lanza si el envío falla; el llamador marca el email como `fallido`
// y la cita sigue valiendo.
// =============================================================================

export interface Adjunto {
  /** Nombre del archivo, p. ej. "cita.ics". */
  nombre: string;
  /** Tipo MIME, p. ej. "text/calendar". */
  tipo: string;
  contenido: string;
}

export interface EmailSaliente {
  para: string;
  /** Nombre que se ve como remitente: el del negocio (PW-18). */
  remitente: string;
  asunto: string;
  texto: string;
  adjuntos?: Adjunto[];
}

export interface EmailEnviado {
  /** 'prueba' si el proveedor no lo mandó de verdad. */
  estado: 'enviado' | 'prueba';
  /** Id del mensaje en el proveedor, si lo da. */
  proveedorId?: string;
}

export interface EmailProvider {
  /** Se guarda en email_messages.proveedor. */
  readonly nombre: string;
  enviar(email: EmailSaliente): Promise<EmailEnviado>;
}
