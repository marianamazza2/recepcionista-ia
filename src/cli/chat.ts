// =============================================================================
// Conversar con el agente desde la Terminal (Fase 2 · 2.6)
// =============================================================================
//   npm run chat -- --negocio estetica-aurora --telefono +34600111222
//   npm run chat -- --negocio estetica-aurora                # clienta anónima
//   npm run chat -- --negocio estetica-aurora --debug        # ver herramientas
//   npm run chat -- --negocio estetica-aurora --telefono … --nueva
//
// Abre (o retoma) una conversación del negocio por el canal `web`. Con
// --telefono de una clienta que ya existe, la conversación nace identificada
// y se retoma su última conversación activa (salvo --nueva). Para salir:
// "salir" o Ctrl+D. Al salir imprime el coste aproximado.
//
// La clave ANTHROPIC_API_KEY se lee de .env; nunca se imprime.
// =============================================================================

import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';

import { BusinessNotFoundError, loadBusinessConfig } from '../config/business.js';
import { anthropicModelClient, runAgentTurn, settingsFromEnv } from '../core/agent.js';
import { costeTotal, formatoUsd } from '../core/costes.js';
import { normalizarTelefono } from '../core/phone.js';
import { createSql } from '../db/client.js';
import { conversationUsage, createConversation, findActiveConversation, type Conversation } from '../db/conversations.js';
import { findCustomerByPhone } from '../db/customers.js';

const GRIS = '\x1b[90m';
const NEGRITA = '\x1b[1m';
const NORMAL = '\x1b[0m';

async function main(): Promise<number> {
  if (existsSync('.env')) process.loadEnvFile('.env');

  const { values } = parseArgs({
    options: {
      negocio: { type: 'string' },
      telefono: { type: 'string' },
      debug: { type: 'boolean', default: false },
      nueva: { type: 'boolean', default: false },
    },
  });
  if (!values.negocio) {
    console.error('Uso: npm run chat -- --negocio <slug> [--telefono +34…] [--debug] [--nueva]');
    return 2;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Falta ANTHROPIC_API_KEY en .env');
    return 2;
  }

  const sql = createSql();
  try {
    const config = await loadBusinessConfig(sql, { slug: values.negocio });
    const settings = settingsFromEnv();

    let customerId: string | null = null;
    if (values.telefono) {
      const tel = normalizarTelefono(values.telefono);
      if (!tel) {
        console.error(`"${values.telefono}" no parece un teléfono.`);
        return 2;
      }
      const c = await findCustomerByPhone(sql, config.id, tel);
      if (c) {
        customerId = c.id;
        console.log(`${GRIS}Clienta: ${c.nombre ?? '(sin nombre)'} (${tel})${NORMAL}`);
      } else {
        console.log(`${GRIS}No hay ninguna clienta con ${tel}: la conversación empieza sin identificar.${NORMAL}`);
      }
    }

    let conv: Conversation | null = null;
    if (customerId && !values.nueva) {
      conv = await findActiveConversation(sql, config.id, customerId);
    }
    const retomada = conv !== null;
    conv ??= await createConversation(sql, config.id, customerId, 'web');

    console.log(
      `${GRIS}${config.nombre} · modelo ${settings.model} · esfuerzo ${settings.effort} · conversación ${conv.id}` +
        `${retomada ? ' (retomada)' : ''}${NORMAL}`,
    );
    console.log(`${GRIS}Escribe "salir" o pulsa Ctrl+D para terminar.${NORMAL}\n`);
    if (!retomada && config.mensajeBienvenida) {
      console.log(`${NEGRITA}${config.nombre}:${NORMAL} ${config.mensajeBienvenida}\n`);
    }

    const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: `${NEGRITA}Tú:${NORMAL} ` });
    let cerrada = false;
    rl.on('close', () => (cerrada = true));
    rl.on('SIGINT', () => rl.close());
    const interactiva = process.stdin.isTTY === true;
    const preguntar = () => {
      if (!cerrada) rl.prompt();
    };
    try {
      preguntar();
      // Con un iterador las líneas no se pierden mientras el agente responde
      // (también si la entrada llega por una tubería, con un guion).
      for await (const entrada of rl) {
        const linea = entrada.trim();
        if (linea === '') {
          preguntar();
          continue;
        }
        if (['salir', 'exit', 'quit'].includes(linea.toLowerCase())) break;
        if (!interactiva) console.log(linea);

        const r = await runAgentTurn(
          {
            sql,
            model: anthropicModelClient(settings),
            settings,
            onError: (e) => console.error(`${GRIS}[error] ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}${NORMAL}`),
          },
          { config, conversationId: conv.id, mensaje: linea },
        );

        if (values.debug) {
          for (const h of r.herramientas) {
            console.log(`${GRIS}→ ${h.nombre} ${JSON.stringify(h.input)}`);
            console.log(`  ${h.isError ? '✗' : '✓'} ${h.content}${NORMAL}`);
          }
          console.log(
            `${GRIS}  [${r.motivoFin} · ${r.llamadas} llamada(s) · entrada ${r.usage.input_tokens} · caché leída ${r.usage.cache_read_input_tokens} · caché escrita ${r.usage.cache_creation_input_tokens} · salida ${r.usage.output_tokens}]${NORMAL}`,
          );
        }
        console.log(`\n${NEGRITA}${config.nombre}:${NORMAL} ${r.texto}\n`);
        if (r.escalada && values.debug) {
          console.log(`${GRIS}(conversación pasada a una persona)${NORMAL}\n`);
        }
        preguntar();
      }
    } finally {
      rl.close();
    }

    const u = await conversationUsage(sql, config.id, conv.id);
    const { usd, sinPrecio } = costeTotal(u.porModelo);
    console.log(
      `\n${GRIS}Conversación ${conv.id}: ${u.llamadas} llamadas · entrada ${u.inputTokens} · caché leída ${u.cacheReadTokens} · ` +
        `caché escrita ${u.cacheWriteTokens} · salida ${u.outputTokens} tokens · coste aprox. ${formatoUsd(usd)}` +
        `${sinPrecio.length ? ` (sin precio para: ${sinPrecio.join(', ')})` : ''}${NORMAL}`,
    );
    return 0;
  } catch (e) {
    if (e instanceof BusinessNotFoundError) {
      console.error(e.message);
      return 2;
    }
    throw e;
  } finally {
    await sql.end();
  }
}

process.exitCode = await main();
