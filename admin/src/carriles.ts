// =============================================================================
// Carriles de la agenda: citas que coinciden, una al lado de otra (Fase 9 · PC-16)
// =============================================================================
// Aparte de Agenda.tsx para poder probarlo sin React
// (tests/agenda-carriles.test.ts).
// =============================================================================

function minutos(hhmm: string): number {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Las citas que coinciden en el tiempo se reparten la columna en carriles,
 * una al lado de otra (en la semana, varias profesionales a la misma hora).
 * Sin esto se tapaban unas a otras (aceptación Fase 9, caso 74).
 */
export function carriles(citas: { id: string; horaInicio: string; horaFin: string }[]): Map<string, { carril: number; de: number }> {
  const orden = [...citas].sort((a, b) => minutos(a.horaInicio) - minutos(b.horaInicio) || minutos(b.horaFin) - minutos(a.horaFin));
  const out = new Map<string, { carril: number; de: number }>();
  let grupo: { id: string; carril: number }[] = [];
  let finDelGrupo = -1;
  let finPorCarril: number[] = [];
  const cerrar = () => {
    const de = finPorCarril.length;
    for (const g of grupo) out.set(g.id, { carril: g.carril, de });
    grupo = [];
    finPorCarril = [];
  };
  for (const c of orden) {
    const ini = minutos(c.horaInicio);
    const fin = minutos(c.horaFin);
    if (ini >= finDelGrupo) cerrar();
    let carril = finPorCarril.findIndex((f) => f <= ini);
    if (carril === -1) carril = finPorCarril.push(fin) - 1;
    else finPorCarril[carril] = fin;
    grupo.push({ id: c.id, carril });
    finDelGrupo = Math.max(finDelGrupo, fin);
  }
  cerrar();
  return out;
}
