// =============================================================================
// Los adjuntos, tal como los ve el modelo (Fase 9b · PC-21)
// =============================================================================
// Una foto o un PDF que el negocio manda con un mensaje va al modelo como un
// bloque `image` o `document`. En el historial guardado (messages.tool_calls)
// NO se guardan sus bytes: se guarda una MARCA de texto con su id
// («⟦adjunto:…⟧») y, cada vez que se llama al modelo, `expandirAdjuntos`
// cambia la marca por el archivo de verdad, leído de portal.adjuntos.
//
// Por qué así: los bytes no se duplican en la base, el historial sigue siendo
// solo-añadir (D-44) y el modelo SIGUE viendo el archivo en los mensajes
// siguientes del chat (si el cliente lo sube sin decir nada y luego contesta
// «cárgalos», el agente lo vuelve a tener delante). Con la caché de prompts,
// volver a mandarlo cuesta poco.
// =============================================================================

import type Anthropic from '@anthropic-ai/sdk';
import type { Sql } from 'postgres';

import { leerAdjuntos, type AdjuntoResumido } from '../db/adjuntos.js';

type MessageParam = Anthropic.Beta.BetaMessageParam;
type Bloque = Anthropic.Beta.BetaContentBlockParam;

const MARCA = /^⟦adjunto:([0-9a-f-]{36})\|([^|]*)\|(.*)⟧$/;

/** La marca que se guarda en el historial en lugar del archivo. */
export function marcaDeAdjunto(a: AdjuntoResumido): Bloque {
  return { type: 'text', text: `⟦adjunto:${a.id}|${a.tipo}|${a.nombre.replace(/[|⟧]/g, ' ')}⟧` };
}

/** Cambia cada marca por el archivo de verdad (imagen o PDF) para mandárselo al modelo. */
export async function expandirAdjuntos(sql: Sql, businessId: string, mensajes: MessageParam[]): Promise<MessageParam[]> {
  const ids = new Set<string>();
  for (const m of mensajes) {
    if (m.role !== 'user' || typeof m.content === 'string') continue;
    for (const b of m.content) if (b.type === 'text') { const x = MARCA.exec(b.text); if (x) ids.add(x[1]!); }
  }
  if (ids.size === 0) return mensajes;
  const porId = new Map((await leerAdjuntos(sql, businessId, [...ids])).map((a) => [a.id, a]));
  return mensajes.map((m) => {
    if (m.role !== 'user' || typeof m.content === 'string') return m;
    return {
      ...m,
      content: m.content.flatMap((b): Bloque[] => {
        if (b.type !== 'text') return [b];
        const x = MARCA.exec(b.text);
        if (!x) return [b];
        const a = porId.get(x[1]!);
        if (!a) return [{ type: 'text', text: `[El archivo «${x[3]}» ya no está disponible.]` }];
        const data = a.datos.toString('base64');
        if (a.tipo === 'application/pdf') {
          return [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data }, title: a.nombre }];
        }
        // El nombre delante: «horario-local.jpg» ya dice algo al modelo.
        return [{ type: 'text', text: `Archivo adjunto: «${a.nombre}»` }, { type: 'image', source: { type: 'base64', media_type: a.tipo, data } }];
      }),
    };
  });
}
