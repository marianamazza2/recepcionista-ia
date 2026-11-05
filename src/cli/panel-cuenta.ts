// =============================================================================
// Crear una cuenta del panel interno (Fase 4 · 4.2, PI-01)
// =============================================================================
//   npm run panel:cuenta -- --email mariana@…
//   ./scripts/con-supabase.sh npm run panel:cuenta -- --email mariana@…   (la nube)
//
// Sin registro público: las cuentas se crean con este comando.
//   1. Pide la contraseña en la Terminal, sin mostrarla (nunca va en el chat
//      ni en los argumentos, que quedan en el historial).
//   2. Crea el usuario en Supabase Auth con la API de administración (email
//      ya confirmado). Necesita SUPABASE_SERVICE_ROLE_KEY en .env: es la
//      única pieza que la usa y nunca sale de esta máquina.
//      Si el usuario ya existe, comprueba la contraseña entrando con ella.
//   3. Lo añade a panel.personas de la base de DATABASE_URL.
//
// Las cuentas de Supabase Auth son del proyecto en la nube; la lista
// panel.personas es de cada base. Para entrar al panel en local y al
// publicado, se corre una vez contra cada base (la segunda solo comprueba la
// contraseña y añade a la lista).
// =============================================================================

import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { supabaseAuth, urlSupabase } from '../api/admin/auth.js';
import { createSql } from '../db/client.js';
import { guardarPersonaPanel } from '../db/personas.js';

/** Lee una línea de la Terminal sin mostrar lo que se escribe. */
function preguntarOculto(pregunta: string): Promise<string> {
  return new Promise((ok, mal) => {
    const entrada = process.stdin;
    if (!entrada.isTTY) {
      mal(new Error('Hace falta una Terminal interactiva para escribir la contraseña.'));
      return;
    }
    process.stdout.write(pregunta);
    entrada.setRawMode(true);
    entrada.resume();
    entrada.setEncoding('utf8');
    let valor = '';
    const alTeclear = (c: string) => {
      for (const ch of c) {
        if (ch === '\r' || ch === '\n') {
          entrada.setRawMode(false);
          entrada.pause();
          entrada.off('data', alTeclear);
          process.stdout.write('\n');
          ok(valor);
          return;
        }
        if (ch === '\u0003') {
          entrada.setRawMode(false);
          process.stdout.write('\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') valor = valor.slice(0, -1);
        else valor += ch;
      }
    };
    entrada.on('data', alTeclear);
  });
}

async function main(): Promise<number> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const { values } = parseArgs({ options: { email: { type: 'string' } } });
  const email = values.email?.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) {
    console.error('Uso: npm run panel:cuenta -- --email <email>');
    return 2;
  }
  const url = urlSupabase();
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !anonKey) {
    console.error('Faltan SUPABASE_PROJECT_REF y SUPABASE_ANON_KEY en .env.');
    return 2;
  }

  const password = await preguntarOculto(`Contraseña para ${email} (no se ve al escribir): `);
  if (password.length < 10) {
    console.error('La contraseña tiene que tener al menos 10 caracteres.');
    return 2;
  }

  let userId: string | null = null;
  if (serviceKey) {
    const r = await fetch(`${url}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    if (r.ok) {
      userId = ((await r.json()) as { id: string }).id;
      console.log('Cuenta creada en Supabase Auth.');
    } else if (r.status !== 422) {
      console.error(`Supabase Auth no ha creado la cuenta (${r.status}). Revisa SUPABASE_SERVICE_ROLE_KEY.`);
      return 1;
    }
  }
  if (!userId) {
    // Ya existía (o no hay clave de servicio): se comprueba entrando con ella.
    const auth = supabaseAuth({ url, anonKey });
    const sesion = await auth.entrar(email, password);
    const usuario = sesion ? await auth.usuario(sesion.accessToken) : null;
    if (!usuario) {
      console.error(
        serviceKey
          ? 'Esa cuenta ya existe en Supabase Auth y la contraseña no coincide.'
          : 'No se ha podido entrar con esa cuenta. Para crearla, añade SUPABASE_SERVICE_ROLE_KEY a .env (Supabase → Project Settings → API).',
      );
      return 1;
    }
    userId = usuario.id;
    console.log('La cuenta ya existía en Supabase Auth: contraseña comprobada.');
  }

  const sql = createSql(undefined, { max: 1 });
  try {
    await guardarPersonaPanel(sql, userId, email);
  } finally {
    await sql.end();
  }
  console.log(`${email} puede entrar al panel de esta base.`);
  return 0;
}

process.exitCode = await main();
