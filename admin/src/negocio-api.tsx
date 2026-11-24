// =============================================================================
// De dónde salen y a dónde van los datos de un negocio (Fase 9 · PC-05)
// =============================================================================
// Las secciones de la ficha (Ficha.tsx) y la agenda visual son LAS MISMAS en
// los dos sitios:
//
//   · el panel interno de Mariana, contra /api/admin/negocios/:id/… ;
//   · el portal del cliente, contra /api/portal/negocio/… , donde el negocio
//     sale de su sesión y no viaja en la dirección (PC-02).
//
// Para no duplicar ni una pantalla, los componentes no llaman a una API
// concreta: piden la de su contexto con `useApiNegocio()` y usan caminos
// RELATIVOS al negocio ('datos', 'servicios/:id', 'agenda'…). Cada app pone
// el suyo con <ProveedorNegocio>.
//
// `ver` dice quién está mirando. Lo único que cambia entre los dos:
//   · 'panel'  ve y cambia el tope mensual, activa/pausa, la clave del widget
//              y el código para pegar en la web;
//   · 'portal' no (PC-09): eso es de MAZZMKT.
// Las reglas de negocio NO cambian: son las mismas rutas y las mismas
// validaciones de la base.
// =============================================================================

import { createContext, useContext, type ReactNode } from 'react';

export type VerNegocio = 'panel' | 'portal';

export interface ApiNegocio {
  ver: VerNegocio;
  /** `camino` es relativo al negocio: '' es la ficha, 'datos', 'servicios/:id'… */
  pedir<T>(metodo: 'GET' | 'POST' | 'PUT' | 'DELETE', camino: string, body?: unknown): Promise<T>;
  /**
   * PC-19 (Fase 9b), solo en el portal: lo vacío ofrece «Pídeselo al agente»,
   * que abre un chat nuevo con el mensaje de esa sección ya enviado.
   */
  pedirAlAgente?: (seccion: 'negocio' | 'servicios' | 'profesionales' | 'horario' | 'reglas' | 'festivo' | 'documento') => void;
}

const Contexto = createContext<ApiNegocio | null>(null);

export function ProveedorNegocio({ valor, children }: { valor: ApiNegocio; children: ReactNode }) {
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useApiNegocio(): ApiNegocio {
  const v = useContext(Contexto);
  if (!v) throw new Error('Falta <ProveedorNegocio> alrededor de esta pantalla');
  return v;
}
