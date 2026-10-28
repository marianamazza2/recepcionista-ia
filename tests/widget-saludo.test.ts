// El saludo según la hora de la bienvenida del widget (PW-02, 28/10/2026).
// Función pura: sin base ni navegador.

import { describe, expect, it } from 'vitest';

import { conSaludo } from '../widget/src/saludo.js';

const BIENVENIDA = '¡Hola! Soy la asistente virtual de Estética Aurora, ¿cómo puedo ayudarte?';

describe('PW-02: saludo según la hora', () => {
  it('suma buenos días, buenas tardes o buenas noches a "¡Hola!"', () => {
    expect(conSaludo(BIENVENIDA, 9)).toBe('¡Hola, buenos días! Soy la asistente virtual de Estética Aurora, ¿cómo puedo ayudarte?');
    expect(conSaludo(BIENVENIDA, 16)).toBe('¡Hola, buenas tardes! Soy la asistente virtual de Estética Aurora, ¿cómo puedo ayudarte?');
    expect(conSaludo(BIENVENIDA, 22)).toBe('¡Hola, buenas noches! Soy la asistente virtual de Estética Aurora, ¿cómo puedo ayudarte?');
  });

  it('franjas a la española: días de 6 a 14, tardes de 14 a 21', () => {
    expect(conSaludo('¡Hola!', 5)).toBe('¡Hola, buenas noches!');
    expect(conSaludo('¡Hola!', 6)).toBe('¡Hola, buenos días!');
    expect(conSaludo('¡Hola!', 13)).toBe('¡Hola, buenos días!');
    expect(conSaludo('¡Hola!', 14)).toBe('¡Hola, buenas tardes!');
    expect(conSaludo('¡Hola!', 20)).toBe('¡Hola, buenas tardes!');
    expect(conSaludo('¡Hola!', 21)).toBe('¡Hola, buenas noches!');
  });

  it('una bienvenida que no empieza por "¡Hola!" se deja tal cual', () => {
    expect(conSaludo('Bienvenida a Clínica Sol', 10)).toBe('Bienvenida a Clínica Sol');
    expect(conSaludo('Hola, soy la asistente virtual', 10)).toBe('Hola, soy la asistente virtual');
  });
});
