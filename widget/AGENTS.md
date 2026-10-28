# widget/ — reglas del chat embebible

Este código corre **en la web de otra empresa**, en navegadores que no
controlamos. Qué hace y cómo se usa: [`README.md`](README.md).

## Reglas

1. **Cero dependencias de ejecución.** Nada de React, ni librerías, ni
   fuentes o imágenes externas. Todo sale en un solo `widget.js` (esbuild,
   `iife`, `es2020`). Vigilá el tamaño que imprime el build. El logo del
   negocio (PW-17) tampoco se pide a otra web: llega dentro de la config como
   data URL, y el widget solo acepta `data:image/…`.
2. **Shadow DOM** para todo: los estilos de la web no lo rompen y los suyos no
   tocan la web. Nada de CSS ni de nodos fuera de su raíz, salvo el host.
3. **Una sola instancia** por página (`__recepcionistaWidget`), y si falta la
   clave o la config no responde, **no aparece** (sin errores visibles).
4. **Nada secreto en el navegador.** Solo la clave pública y el token de
   sesión. Sin cookies (`credentials: 'omit'`), sin analítica, sin terceros.
5. **`localStorage` siempre en `try/catch`**: sin él, el widget funciona igual
   (solo no retoma la conversación).
6. **Texto de la web nunca como HTML**: lo que llega del servidor se pinta con
   `textContent`, no con `innerHTML`.
7. **Idempotencia:** el reintento reutiliza el mismo `clientMessageId`.
8. **Accesible y móvil:** roles y `aria-label`, foco manejable con teclado,
   pantalla completa por debajo de 480 px, `prefers-color-scheme` y
   `prefers-reduced-motion`.
9. Textos para la clienta en **español de España, de tú**. Marca: solo la del
   negocio (PW-01); el nombre del producto no aparece mientras no exista
   (PD-07).
10. **`dist/` es generado**: no se edita a mano; se regenera con el build.
11. Tiene su propio `tsconfig.json` (navegador). El `tsconfig` raíz no lo
    incluye: comprobá los tipos con `npx tsc -p widget`.
12. **Lo que se quiera testear sin navegador va en su propio módulo** (como
    `src/saludo.ts`, PW-02): `widget.ts` se monta al importarse y no se puede
    cargar desde Vitest. El build lo junta todo en el mismo `widget.js`.

## Si cambiás algo de acá

**Obligatorio:** si tu cambio toca la arquitectura, una regla de negocio o la
forma de trabajo de esta carpeta, actualizá este `AGENTS.md` (y el raíz si
aplica) en el mismo cambio. Ver §8 del [`AGENTS.md` raíz](../AGENTS.md#8-mantener-esta-documentación).

- Si cambia lo que el widget espera de la API → `src/api/README.md` y los
  handlers, en el mismo cambio.
- Si cambia cómo se pega o qué necesita el negocio (dominios, color,
  privacidad) → [`README.md`](README.md), el `README.md` raíz y el
  cuestionario de alta de Research Desk.
