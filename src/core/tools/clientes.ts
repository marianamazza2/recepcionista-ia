// identificar_cliente — busca o crea la clienta por teléfono (PA-02, PA-08)
//
// Una conversación queda ligada a UNA clienta: una vez identificada, otro
// teléfono no la cambia. Así nadie puede, a mitad de chat, "pasar a ser" otra
// persona para ver o tocar sus citas (PA-08).

import { findCustomerByPhone, findOrCreateCustomer } from '../../db/customers.js';
import { setConversationCustomer } from '../../db/conversations.js';
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
        'Identifica a la persona que viene a la cita por su teléfono (el suyo, del que es titular) y su nombre: la busca y, si es nueva, ' +
        'la registra. La cita queda a nombre de ese teléfono. Hace falta antes de reservar, ' +
        'cancelar, mover o ver citas. Devuelve si es nueva y, si ya vino antes, quién la atendió la última vez (ultima_profesional).',
      strict: true,
      input_schema: {
        type: 'object',
        properties: {
          telefono: { type: 'string', description: 'Teléfono de la persona que viene a la cita, tal como lo dio' },
          nombre: { type: 'string', description: 'Nombre de la persona que viene a la cita (titular del teléfono)' },
        },
        required: ['telefono', 'nombre'],
        additionalProperties: false,
      },
    };
  },

  async run(input, ctx) {
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
      // Ya identificada: solo vale el mismo teléfono. Se comprueba antes de
      // crear nada, para no registrar a otra persona por el camino.
      const existente = await findCustomerByPhone(ctx.sql, ctx.config.id, telefono);
      if (existente?.id !== ctx.state.customerId) {
        return fallo({
          motivo: 'conversacion_ya_identificada',
          mensaje:
            'Esta conversación ya está identificada con otro teléfono. Por seguridad solo se pueden ver y tocar las citas de ese ' +
            'teléfono. Para gestionar las citas de otra persona, que escriba ella o que llame al local.',
        });
      }
    }
    const { customer, nueva } = await findOrCreateCustomer(ctx.sql, ctx.config.id, telefono, nombre);
    const ligada = await setConversationCustomer(ctx.sql, ctx.config.id, ctx.conversationId, customer.id);
    if (!ligada) {
      return fallo({
        motivo: 'conversacion_ya_identificada',
        mensaje: 'Esta conversación ya está identificada con otro teléfono.',
      });
    }
    ctx.state.customerId = customer.id;

    const ultima = nueva ? null : await ctx.adapter.getLastStaff(customer.id);
    return ok({
      identificada: true,
      telefono,
      clienta_nueva: nueva,
      ultima_profesional: ultima ? nombreProfesional(ctx.config, ultima) : null,
    });
  },
};
