// =============================================================================
// Personas del panel interno (Fase 4 · 4.2, PI-01)
// =============================================================================
// Quién puede entrar al panel: `panel.personas`. No es de ningún negocio, así
// que es la única lectura de este módulo sin inTenant (no hay tenant que
// declarar; la tabla tiene RLS sin política y solo el servidor la lee).
// =============================================================================

import type { Sql } from 'postgres';

export interface PersonaPanel {
  userId: string;
  email: string;
}

/** La persona con ese id de Supabase Auth, si existe y está activa. */
export async function personaPanel(sql: Sql, userId: string): Promise<PersonaPanel | null> {
  const [p] = await sql<{ user_id: string; email: string }[]>`
    select user_id, email from panel.personas
     where user_id = ${userId}::uuid and activa`;
  return p ? { userId: p.user_id, email: p.email } : null;
}

/** Da de alta (o reactiva) a una persona del panel. Lo usa npm run panel:cuenta. */
export async function guardarPersonaPanel(sql: Sql, userId: string, email: string): Promise<void> {
  await sql`
    insert into panel.personas (user_id, email) values (${userId}::uuid, ${email.toLowerCase()})
    on conflict (user_id) do update set email = excluded.email, activa = true`;
}
