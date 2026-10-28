// =============================================================================
// Saludo según la hora (Fase 3 · PW-02, decidido el 28/10/2026)
// =============================================================================
// Si la bienvenida del negocio empieza por "¡Hola!", el widget le suma el
// saludo de la hora de quien escribe: "¡Hola, buenas tardes! Soy…". La hora es
// la del navegador. Franjas a la española: días hasta las 14, tardes hasta las
// 21. Si la bienvenida empieza de otra forma, se deja tal cual.
// Va aparte de widget.ts para poder testearla sin montar el widget.
// =============================================================================

export function conSaludo(bienvenida: string, hora: number): string {
  if (!bienvenida.startsWith('¡Hola!')) return bienvenida;
  const franja = hora >= 6 && hora < 14 ? 'buenos días' : hora >= 14 && hora < 21 ? 'buenas tardes' : 'buenas noches';
  return `¡Hola, ${franja}!${bienvenida.slice('¡Hola!'.length)}`;
}
