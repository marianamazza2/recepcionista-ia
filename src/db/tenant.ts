// =============================================================================
// Transacción con el tenant declarado
// =============================================================================
// Lo mismo que hace el SupabaseAdapter en cada operación (D-15, D-16), para el
// resto del backend: configuración, clientas y conversaciones. El tenant se
// declara con scope de transacción, así una conexión reutilizada del pool nunca
// hereda el negocio de otra petición.
//
// Aunque la conexión haga BYPASSRLS, cada consulta filtra además por
// business_id (T-03).
// =============================================================================

import type { Sql, TransactionSql } from 'postgres';

export async function inTenant<T>(
  sql: Sql,
  businessId: string,
  fn: (tx: TransactionSql) => Promise<T>,
): Promise<T> {
  const result = await sql.begin(async (tx) => {
    await tx`select app.set_business_id(${businessId}::uuid)`;
    return fn(tx);
  });
  return result as T;
}
