// =============================================================================
// Borrado de datos: retención del chat y derecho de supresión (PD-13)
// =============================================================================
//   npm run borrado                                   # qué se borraría (no borra)
//   npm run borrado -- --si                            # borra el texto vencido
//   npm run borrado -- --si --meses 12                 # con otra retención
//   npm run borrado -- --negocio clinica-olea --clienta maria@x.com --si
//   npm run borrado -- --negocio clinica-olea --clienta +34600111222 --si
//
// Decidido el 13/11/2026 (PD-13): el texto del chat caduca a los 6 meses; la
// ficha de la clienta y las citas se guardan siempre. Y si una clienta pide que
// la borren, se borra ella: su texto, sus conversaciones desligadas y su ficha
// anónima, con sus citas en pie.
//
// Sin --si no borra nada: cuenta lo que hay. Borrar es irreversible (y las
// copias de seguridad de Supabase lo conservan hasta que rotan, PD-11).
// =============================================================================

import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { BusinessNotFoundError, loadBusinessConfig } from '../config/business.js';
import { normalizarTelefono } from '../core/phone.js';
import { borrarClienta, borrarConversacionesVencidas, buscarClienta, MESES_RETENCION } from '../db/borrado.js';
import { createSql } from '../db/client.js';

const USO = `Uso:
  npm run borrado [-- --meses 6]                                  ensaya el borrado del texto vencido
  npm run borrado -- --si [--meses 6]                             lo borra
  npm run borrado -- --negocio <slug> --clienta <email|teléfono> [--si]`;

async function main(): Promise<number> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const { values } = parseArgs({
    options: {
      meses: { type: 'string' },
      si: { type: 'boolean' },
      negocio: { type: 'string' },
      clienta: { type: 'string' },
    },
  });

  const meses = values.meses ? Number(values.meses) : MESES_RETENCION;
  if (!Number.isInteger(meses) || meses < 1) {
    console.error('--meses tiene que ser un número entero de 1 o más.');
    return 2;
  }
  if ((values.clienta && !values.negocio) || (values.negocio && !values.clienta)) {
    console.error(`Para borrar a una clienta hacen falta --negocio y --clienta.\n\n${USO}`);
    return 2;
  }

  const sql = createSql();
  try {
    // ---- Una clienta que lo pide (derecho de supresión) ---------------------
    if (values.negocio && values.clienta) {
      const config = await loadBusinessConfig(sql, { slug: values.negocio });
      const dato = values.clienta.includes('@')
        ? { email: values.clienta }
        : { telefono: normalizarTelefono(values.clienta) ?? values.clienta };
      const clienta = await buscarClienta(sql, config.id, dato);
      if (!clienta) {
        console.error(`\nNo hay ninguna clienta de ${config.nombre} con ${values.clienta}.\n`);
        return 1;
      }
      console.log(`\n${config.nombre} · clienta ${clienta.nombre ?? '(sin nombre)'} · ${clienta.email ?? clienta.telefono}`);
      if (!values.si) {
        console.log('\n  Se borraría: su nombre, su teléfono, su email y todo su texto de chat.');
        console.log('  Se quedarían: sus citas en la agenda, sin nombre.');
        console.log('\n  Nada borrado: volvé a correrlo con --si.\n');
        return 0;
      }
      const r = await borrarClienta(sql, config.id, clienta.id);
      console.log(`\n  Borrada. ${r.mensajes} mensajes borrados, ${r.conversaciones} conversaciones desligadas.`);
      console.log(`  ${r.citas} citas siguen en la agenda, ya sin nombre.\n`);
      return 0;
    }

    // ---- Retención: el texto vencido de todos los negocios ------------------
    if (!values.si) {
      const [r] = await sql<{ conversaciones: number; mensajes: number }[]>`
        select count(distinct c.id)::int as conversaciones, count(m.id)::int as mensajes
          from public.conversations c
          join public.messages m on m.conversation_id = c.id
         where c.ultimo_mensaje_at < now() - make_interval(months => ${meses})
      `;
      console.log(`\nRetención de ${meses} meses (PD-13)\n`);
      console.log(`  Se borraría el texto de ${r?.conversaciones ?? 0} conversaciones (${r?.mensajes ?? 0} mensajes).`);
      console.log('  Las conversaciones, las fichas de las clientas, las citas y el consumo se quedan.');
      console.log('\n  Nada borrado: volvé a correrlo con --si.\n');
      return 0;
    }

    const r = await borrarConversacionesVencidas(sql, meses);
    console.log(`\nRetención de ${meses} meses (PD-13)\n`);
    console.log(`  Texto borrado de ${r.conversaciones} conversaciones (${r.mensajes} mensajes).`);
    console.log('  Las conversaciones, las fichas, las citas y el consumo siguen igual.\n');
    return 0;
  } catch (e) {
    if (e instanceof BusinessNotFoundError) {
      console.error(`\nNo hay ningún negocio con el slug "${values.negocio}".\n`);
      return 1;
    }
    throw e;
  } finally {
    await sql.end();
  }
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
