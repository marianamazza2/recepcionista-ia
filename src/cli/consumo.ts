// =============================================================================
// Informe de consumo de un negocio (Fase 3 · 3.3)
// =============================================================================
//   npm run consumo -- --negocio estetica-aurora               # mes en curso
//   npm run consumo -- --negocio estetica-aurora --mes 2026-10
//
// Mensajes, conversaciones, citas, tokens y coste del mes (en US$), y el % del
// tope mensual (PW-04). A partir del 80 % avisa para hablar con el negocio.
// Cuenta lo que pasa por el widget; las pruebas por la Terminal (npm run chat)
// no se registran como consumo de un negocio.
// =============================================================================

import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { BusinessNotFoundError, loadBusinessConfig } from '../config/business.js';
import { utcToLocal } from '../core/time.js';
import { createSql } from '../db/client.js';
import { AVISO_TOPE, informeConsumo } from '../db/usage.js';

const n = (x: number, dec = 0) => x.toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec });

async function main(): Promise<number> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const { values } = parseArgs({ options: { negocio: { type: 'string' }, mes: { type: 'string' } } });
  if (!values.negocio) {
    console.error('Uso: npm run consumo -- --negocio <slug> [--mes AAAA-MM]');
    return 2;
  }
  const sql = createSql();
  try {
    const config = await loadBusinessConfig(sql, { slug: values.negocio });
    const mes = values.mes ?? utcToLocal(new Date(), config.timezone).fecha.slice(0, 7);
    const r = await informeConsumo(sql, config.id, mes);

    console.log(`\n${r.negocio} · ${r.mes}\n`);
    console.log(`  Mensajes          ${n(r.mensajes)}`);
    console.log(`  Conversaciones    ${n(r.conversaciones)}`);
    console.log(`  Citas reservadas  ${n(r.citas)}`);
    console.log(`  Tokens            ${n(r.tokens)}`);
    console.log(`  Coste del agente  ${n(r.costeUsd, 4)} US$`);
    console.log(
      `  Tope mensual      ${n(r.topeUsd, 2)} US$` +
        (r.fraccionTope !== null ? ` (${n(r.fraccionTope * 100, 1)} % usado)` : ' (tope 0: el widget no llama a la IA)'),
    );
    if (r.conversaciones > 0) console.log(`  Coste por conversación  ${n(r.costeUsd / r.conversaciones, 4)} US$`);
    if (r.modelosSinPrecio.length) console.log(`\n  ⚠️  Modelos sin precio en core/costes.ts (contados a 0): ${r.modelosSinPrecio.join(', ')}`);
    if (r.fraccionTope !== null && r.fraccionTope >= 1) {
      console.log(`\n  ⛔ Tope alcanzado: el widget responde con el teléfono del local sin llamar a la IA.`);
    } else if (r.aviso) {
      console.log(`\n  ⚠️  Por encima del ${n(AVISO_TOPE * 100)} % del tope: hablar con el negocio o subir el tope.`);
    }
    console.log('');
    return 0;
  } catch (e) {
    if (e instanceof BusinessNotFoundError) {
      console.error(e.message);
      return 2;
    }
    if (e instanceof Error && e.message.startsWith('Mes no válido')) {
      console.error(e.message);
      return 2;
    }
    throw e;
  } finally {
    await sql.end();
  }
}

process.exitCode = await main();
