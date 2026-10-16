// Modelo simulado para los tests del loop: devuelve respuestas guionizadas y
// guarda las peticiones que recibe. Sin red y sin coste de API.

import type Anthropic from '@anthropic-ai/sdk';

import type { ModelClient } from '../../src/core/agent.js';

type CreateParams = Anthropic.Beta.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.BetaMessage;

export interface Guion {
  content: Array<Record<string, unknown>>;
  stop_reason: Message['stop_reason'];
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
}

let contador = 0;

export function texto(t: string): Guion {
  return { content: [{ type: 'text', text: t, citations: null }], stop_reason: 'end_turn' };
}

export function herramientas(...llamadas: Array<{ name: string; input: Record<string, unknown> }>): Guion {
  return {
    content: [
      // Un bloque de pensamiento con firma: el loop tiene que reenviarlo tal cual.
      { type: 'thinking', thinking: '', signature: `firma-${++contador}` },
      ...llamadas.map((l) => ({ type: 'tool_use', id: `toolu_${++contador}`, name: l.name, input: l.input })),
    ],
    stop_reason: 'tool_use',
  };
}

export class ModeloSimulado implements ModelClient {
  readonly peticiones: CreateParams[] = [];
  private readonly guion: Array<Guion | ((p: CreateParams) => Guion) | Error>;

  constructor(guion: Array<Guion | ((p: CreateParams) => Guion) | Error>) {
    this.guion = [...guion];
  }

  async create(params: CreateParams): Promise<Message> {
    // Copia profunda: así el test ve la petición tal como se envió, aunque el
    // loop siga añadiendo mensajes al mismo array.
    this.peticiones.push(structuredClone(params));
    const paso = this.guion.shift();
    if (paso === undefined) {
      throw new Error('El guion del modelo simulado se ha terminado');
    }
    if (paso instanceof Error) {
      throw paso;
    }
    const g = typeof paso === 'function' ? paso(params) : paso;
    return {
      id: `msg_${++contador}`,
      type: 'message',
      role: 'assistant',
      model: params.model,
      content: structuredClone(g.content),
      stop_reason: g.stop_reason,
      stop_sequence: null,
      usage: {
        input_tokens: g.usage?.input_tokens ?? 100,
        output_tokens: g.usage?.output_tokens ?? 20,
        cache_read_input_tokens: g.usage?.cache_read_input_tokens ?? 0,
        cache_creation_input_tokens: g.usage?.cache_creation_input_tokens ?? 0,
      },
    } as unknown as Message;
  }
}
