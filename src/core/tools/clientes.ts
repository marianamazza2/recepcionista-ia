// identificar_cliente — busca o crea la clienta por su email (PA-17; antes
// por teléfono, PA-02) y la liga a la conversación (PA-08)
//
// Una conversación queda ligada a UNA clienta: una vez identificada, otros
// datos no la cambian. Así nadie puede, a mitad de chat, "pasar a ser" otra
// persona para ver o tocar sus citas (PA-08). Y aunque alguien dé el email de
// otra, sin el código de ese correo no ve ni toca nada (PA-16): reconocerla
// ("la última vez te atendió Lucía") sí, porque eso no cuenta nada útil.
//
// PA-17: el email se comprueba aquí (formato) y el agente lo repite antes de
// llamar. Sin email, la clienta reserva igual con su teléfono, pero no puede
// gestionar sus citas por el chat.

import { findCustomer, findOrCreateCustomer } from '../../db/customers.js';
import { setConversationCustomer } from '../../db/conversations.js';
import { normalizarEmail } from '../email.js';
import { normalizarTelefono } from '../phone.js';
import { fallo, nombreProfesional, ok, texto } from './common.js';
import type { AgentTool } from './types.js';

export const identificarCliente: AgentTool = {
  name: 'identificar_cliente',
  escribe: true,

  definition() {
    return {
      name: 'identificar_cliente',
      description:
        'Identifica a la persona que viene a la cita por su email (ya repetido y confirmado con ella), su nombre y un móvil: la ' +
        'busca y, si es nueva, la registra. Si no quiere dar email, pasa email null: reserva igual, pero no podrá cambiar sus ' +
        'citas por el chat. Hace falta antes de reservar, cancelar, mover o ver citas. Devuelve si es nueva y, si ya vino ' +
        'antes, quién la atendió la última vez (ultima_profesional).',
      strict: true,
      input_schema: {
        type: 'object',
        properties: {
          email: {
            type: ['string', 'null'],
            description: 'Email de la persona que viene a la cita, tal como lo confirmó; null si no quiere darlo',
          },
          telefono: { type: 'string', description: 'Móvil de la persona que viene a la cita, tal como lo dio' },
          nombre: { type: 'string', description: 'Nombre de la persona que viene a la cita' },
        },
        required: ['email', 'telefono', 'nombre'],
        additionalProperties: false,
      },
    };
  },

  async run(input, ctx) {
    const emailDado = texto(input, 'email');
    const email = emailDado ? normalizarEmail(emailDado) : null;
    if (emailDado && !email) {
      return fallo({
        motivo: 'email_no_valido',
        mensaje: 'Ese email no parece válido. Pídeselo de nuevo y repíteselo para que lo confirme.',
      });
    }
    const telefono = normalizarTelefono(texto(input, 'telefono') ?? '');
    if (!telefono) {
      return fallo({
        motivo: 'telefono_no_valido',
        mensaje: 'Ese teléfono no parece válido. Pídeselo de nuevo (por ejemplo 600 11 22 33 o con prefijo +34).',
      });
    }
    const nombre = texto(input, 'nombre');
    if (!nombre) {
      return fallo({ motivo: 'falta_nombre', mensaje: 'Falta el nombre de la clienta.' });
    }

    if (ctx.state.customerId) {
      // Ya identificada: solo valen los datos de la misma ficha. Se comprueba
      // antes de crear nada, para no registrar a otra persona por el camino.
      const existente = await findCustomer(ctx.sql, ctx.config.id, { telefono, email });
      if (existente?.id !== ctx.state.customerId) {
        return fallo({
          motivo: 'conversacion_ya_identificada',
          mensaje:
            'Esta conversación ya está identificada con otra persona. Por seguridad solo se pueden ver y tocar las citas de ' +
            'esa persona. Para gestionar las citas de otra, que escriba ella o que llame al local.',
        });
      }
    }
    const { customer, nueva } = await findOrCreateCustomer(ctx.sql, ctx.config.id, { telefono, nombre, email });
    const ligada = await setConversationCustomer(ctx.sql, ctx.config.id, ctx.conversationId, customer.id);
    if (!ligada) {
      return fallo({
        motivo: 'conversacion_ya_identificada',
        mensaje: 'Esta conversación ya está identificada con otra persona.',
      });
    }
    ctx.state.customerId = customer.id;

    const ultima = nueva ? null : await ctx.adapter.getLastStaff(customer.id);
    return ok({
      identificada: true,
      email: customer.email,
      clienta_nueva: nueva,
      ultima_profesional: ultima ? nombreProfesional(ctx.config, ultima) : null,
      ...(customer.email
        ? {}
        : {
            sin_email:
              'Reserva sin email: no le llegará la confirmación y, para cambiar o cancelar, tendrá que llamar al local. Díselo al cerrar la cita, sin insistir.',
          }),
    });
  },
};
