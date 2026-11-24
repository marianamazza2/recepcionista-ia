# src/conocimiento/ — lo que sabe el negocio (Fase 5)

Los **documentos** del negocio (su carta, hojas de cuidados, folletos o un
texto escrito) y cómo los usa el agente de las clientas. Reglas de producto:
**PB-01 a PB-09** en `_specs/decisiones-producto.md`; spec:
`_specs/fase-5-conocimiento.md`.

| Archivo | Qué hace |
|---|---|
| `documentos.ts` | **El único camino** para subir, reemplazar y resolver un documento (PC-05): lo usan las rutas de Documentos del panel y del portal (`src/api/admin/negocio.ts`) y el chat del portal (`src/alta/herramientas.ts`). Comprueba antes de gastar, lee con la IA, apunta el coste, parte en trozos, compara y guarda |
| `leer.ts` | Leer un documento con la IA, en **una** llamada con salida estructurada: texto por secciones, título, de qué trata, palabras de la clienta, datos de personas y los valores que da de la configuración. `lectorDesdeEnv` crea el lector de los servidores (`CONOCIMIENTO_MODEL`, más tiempo de espera, sin reintentos) |
| `trozos.ts` | Partir en trozos de ~1.000–1.500 caracteres, sin cortar una lista de precios, con el título del documento y de la sección en cada uno. Puro |
| `comparar.ts` | **PB-04 / PB-01 en el código, no en el modelo**: compara cada valor del documento con la configuración de AHORA (ok · pregunta · viejo) y sabe corregir el texto. Puro |
| `buscar.ts` | La búsqueda detrás de una interfaz (`BuscadorConocimiento`, D-96) y lo que recibe la herramienta `buscar_en_conocimiento`, con los precios, duraciones y horarios de la configuración ya puestos en los trozos (PB-01) |

## Reglas que no se rompen

1. **Un solo camino.** Ni las rutas ni el chat leen, parten o comparan por su
   cuenta: llaman a `subirDocumento` y `resolverValor`. Una regla nueva entra
   aquí una vez.
2. **La comparación la hace el código** (`comparar.ts`), contra la
   configuración de ahora, cada vez que se lee (D-98). Por eso un cambio en
   Configuración marca solo los documentos que quedaron viejos, sin guardar
   nada más. El modelo solo extrae valores con el **fragmento exacto** donde
   aparecen.
3. **La configuración manda, en el código** (PB-01): el agente nunca recibe
   un trozo con un precio, una duración o un horario distinto del de
   Configuración (`aplicarAlTrozo`). Un precio oculto cuenta como «sin
   precio» (⚠️ propuesta bajo PB-04).
4. **Antes de gastar**: tipo por los bytes (PDF o foto; un Word renombrado,
   no), hasta 4 MB, PDF sin contraseña, y los límites de PB-06 (20
   documentos, 100 páginas). El límite de verdad lo pone la base (RA011).
5. **PB-07**: leer un documento se apunta SIEMPRE como
   `usage_events.concepto = 'preparar_documento'`, se guarde o no, y no
   cuenta para ningún tope (D-99). Buscar con una clienta sí cuenta: va en su
   conversación.
6. **PB-08**: un documento con datos de personas no se guarda, ni sus
   trozos. Se dice con una frase (`textoDatosDePersonas`).
7. **No se guarda el archivo** (D-97), solo su texto. Desde el chat, al
   guardarlo, el adjunto pierde sus bytes (PB-06).
8. **Borrador** = lo leyó el chat del portal y el negocio no ha dicho que
   sí (PC-03). No lo ve el agente, no cuenta para los límites y se borra al
   día.
9. **Aislamiento**: todo filtra por `business_id` (`src/db/conocimiento.ts`
   con `inTenant`) y la búsqueda de la base también (`app.buscar_conocimiento`).
   El negocio sale del turno o de la sesión, nunca del modelo.

## Cómo se prueba

- Sin coste: `tests/documentos.test.ts` (modelo simulado: la lectura es un
  JSON guionizado) y `supabase/tests/18_base_de_conocimiento.sql`.
- En el navegador: paso 12 de `tests/e2e/portal.e2e.ts`.
- Con la IA de verdad: escenarios 18–22 de `npm run agent:eval` y el 7 de
  `npm run alta:eval` (avisar del coste).
