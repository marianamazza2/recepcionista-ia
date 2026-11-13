// enviar_codigo · verificar_codigo — PA-16 (13/11/2026)
//
// Para ver, cancelar o mover una cita que ya existe desde el chat, la clienta
// escribe el código que le llega a su email. Reservar no lo necesita.
// Las reglas (6 dígitos, 10 minutos, un uso, 3 intentos, 3 por hora, solo el
// hash) viven en src/db/codigos.ts y en la base, no en el prompt. El código
// nunca vuelve al modelo: solo "enviado", y al comprobarlo, si acertó.

import { getCustomer } from '../../db/customers.js';
import { CODIGO_MINUTOS, comprobarCodigo, guardarCodigo, nuevoCodigo } from '../../db/codigos.js';
import { telefonoLegible } from '../phone.js';
import { exigirCodigo, fallo, ok, sinClienta, texto } from './common.js';
import type { AgentTool, ToolContext } from './types.js';

function llamaAlLocal(ctx: ToolContext): string {
  return ctx.config.telefonoHumano ? ` al ${telefonoLegible(ctx.config.telefonoHumano)}` : '';
}

export const enviarCodigo: AgentTool = {
  name: 'enviar_codigo',
  escribe: false,

  definition() {
    return {
      name: 'enviar_codigo',
      description:
        'Manda un código de seis dígitos al email de la clienta identificada. Hace falta para ver, cancelar o mover citas que ya ' +
        'existen (no para reservar una nueva). Úsala cuando otra herramienta devuelva falta_codigo o cuando la clienta quiera ' +
        'gestionar sus citas. Nunca devuelve el código: se lo tiene que dar ella.',
      strict: true,
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
    };
  },

  async run(_input, ctx) {
    if (!ctx.state.customerId) return sinClienta();
    if (ctx.state.verificada) return ok({ ya_verificada: true });
    const clienta = await getCustomer(ctx.sql, ctx.config.id, ctx.state.customerId);
    if (!clienta?.email) return (await exigirCodigo(ctx))!;
    if (!ctx.enviarCodigo) {
      return fallo({
        motivo: 'email_no_disponible',
        mensaje: `Ahora mismo no se pueden mandar códigos. Dile que para ver, cancelar o mover su cita llame al local${llamaAlLocal(ctx)}.`,
      });
    }
    const codigo = nuevoCodigo();
    const guardado = await guardarCodigo(ctx.sql, ctx.config.id, {
      conversationId: ctx.conversationId,
      customerId: clienta.id,
      codigo,
      ahora: ctx.now(),
    });
    if (!guardado) {
      return fallo({
        motivo: 'demasiados_codigos',
        mensaje:
          'Ya se le han mandado varios códigos en la última hora y no se mandan más. Dile que revise su correo (también la carpeta ' +
          `de spam) o que llame al local${llamaAlLocal(ctx)}.`,
      });
    }
    await ctx.enviarCodigo({ businessId: ctx.config.id, customerId: clienta.id, email: clienta.email, nombre: clienta.nombre, codigo });
    return ok({ enviado: true, email: clienta.email, caduca_en_minutos: CODIGO_MINUTOS });
  },
};

export const verificarCodigo: AgentTool = {
  name: 'verificar_codigo',
  escribe: false,

  definition() {
    return {
      name: 'verificar_codigo',
      description:
        'Comprueba el código de seis dígitos que la clienta ha recibido en su email (enviar_codigo). Si es correcto, ya se pueden ' +
        'ver, cancelar y mover sus citas en esta conversación.',
      strict: true,
      input_schema: {
        type: 'object',
        properties: { codigo: { type: 'string', description: 'Los seis dígitos tal como los escribió la clienta' } },
        required: ['codigo'],
        additionalProperties: false,
      },
    };
  },

  async run(input, ctx) {
    if (!ctx.state.customerId) return sinClienta();
    if (ctx.state.verificada) return ok({ verificada: true });
    const codigo = (texto(input, 'codigo') ?? '').replace(/\s/g, '');
    if (!/^\d{6}$/.test(codigo)) {
      return fallo({ motivo: 'codigo_no_valido', mensaje: 'El código son seis números. Pídele que lo copie tal cual del correo.' });
    }
    const r = await comprobarCodigo(ctx.sql, ctx.config.id, { conversationId: ctx.conversationId, codigo, ahora: ctx.now() });
    switch (r.resultado) {
      case 'correcto':
        ctx.state.verificada = true;
        return ok({ verificada: true });
      case 'incorrecto':
        return fallo({
          motivo: 'codigo_incorrecto',
          mensaje: `Ese código no es correcto. Le quedan ${r.quedan} intento${r.quedan === 1 ? '' : 's'}: que lo revise en su correo.`,
        });
      case 'agotado':
        return fallo({
          motivo: 'codigo_agotado',
          mensaje: 'Ha fallado tres veces y ese código ya no vale. Si quiere, mándale uno nuevo con enviar_codigo.',
        });
      case 'caducado':
        return fallo({
          motivo: 'codigo_caducado',
          mensaje: `El código ha caducado (dura ${CODIGO_MINUTOS} minutos). Si quiere, mándale uno nuevo con enviar_codigo.`,
        });
      case 'sin_codigo':
        return fallo({ motivo: 'sin_codigo', mensaje: 'No hay ningún código pendiente. Mándale uno con enviar_codigo.' });
    }
  },
};
