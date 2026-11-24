// =============================================================================
// Buscar en lo que sabe el negocio (Fase 5 · 5.3: PB-09, PB-01, PB-05)
// =============================================================================
// La búsqueda va detrás de una interfaz, `BuscadorConocimiento` (D-96): hoy es
// la opción A de PB-09 (texto completo de Postgres en español, en nuestra base,
// app.buscar_conocimiento). Si las pruebas con la IA de verdad mostraran que
// no encuentra lo que debería, la B (embeddings con Voyage AI + pgvector) es
// otra implementación de esta misma interfaz: el agente y su herramienta no
// cambian.
//
// `buscarParaElAgente` es lo que devuelve la herramienta buscar_en_conocimiento
// y aplica PB-01 EN EL CÓDIGO: si un documento dice un precio, una duración o
// un horario distinto del de la configuración, el agente lee el trozo ya con
// el de la configuración (y un aviso si no se pudo cambiar en el texto). Así no
// depende de que el modelo haga caso al prompt.
//
// El negocio sale del turno (el BusinessConfig), nunca del modelo: un negocio
// no encuentra trozos de otro (criterio 9).
// =============================================================================

import type { Sql } from 'postgres';

import type { BusinessConfig } from '../config/business.js';
import { buscarTrozos, valoresDe, type TrozoEncontrado } from '../db/conocimiento.js';
import { aplicarAlTrozo, comparar, type Referencia } from './comparar.js';

/** Cuántos trozos ve el agente por búsqueda (spec: los 3–5 mejores). */
export const TROZOS_POR_BUSQUEDA = 5;

export interface BuscadorConocimiento {
  buscar(p: { sql: Sql; businessId: string; consulta: string; limite: number }): Promise<TrozoEncontrado[]>;
}

/** PB-09, la A (decidida el 23/11/2026). */
export const buscadorDeTexto: BuscadorConocimiento = {
  buscar: ({ sql, businessId, consulta, limite }) => buscarTrozos(sql, businessId, consulta, limite),
};

/** La configuración del agente (la que ve la clienta), para comparar. Un precio oculto ya llega como null. */
export function referenciaDeConfig(c: BusinessConfig): Referencia {
  return {
    servicios: c.servicios.map((s) => ({ id: s.id, nombre: s.nombre, precio: s.precio, duracionMin: s.duracionMin, activo: true })),
    horarioLocal: c.horario,
    direccion: c.direccion,
    telefono: c.telefonoHumano,
  };
}

export interface ResultadoParaElAgente {
  trozos: { documento: string; seccion: string; texto: string }[];
  /** PB-01: lo que vale, cuando un trozo habla de algo que la configuración dice distinto. */
  datos_que_mandan: string[];
}

export async function buscarParaElAgente(
  sql: Sql,
  config: BusinessConfig,
  consulta: string,
  buscador: BuscadorConocimiento = buscadorDeTexto,
): Promise<ResultadoParaElAgente> {
  const encontrados = await buscador.buscar({ sql, businessId: config.id, consulta, limite: TROZOS_POR_BUSQUEDA });
  if (encontrados.length === 0) return { trozos: [], datos_que_mandan: [] };
  const r = referenciaDeConfig(config);
  const docIds = [...new Set(encontrados.map((t) => t.docId))];
  const comparaciones = (await valoresDe(sql, config.id, docIds)).map((v) => comparar(v, r));
  const mandan = new Set<string>();
  const trozos = encontrados.map((t) => {
    const delDoc = comparaciones.filter((c) => c.valor.docId === t.docId);
    const { texto, sinAplicar } = aplicarAlTrozo(t.contenido, delDoc, r);
    for (const c of sinAplicar) mandan.add(`${c.que.charAt(0).toUpperCase()}${c.que.slice(1)}: ${c.configuracion}. Usa siempre este dato, no el del documento.`);
    const seccion = t.titulos.startsWith(`${t.documento} · `) ? t.titulos.slice(t.documento.length + 3) : '';
    return { documento: t.documento, seccion, texto };
  });
  return { trozos, datos_que_mandan: [...mandan] };
}
