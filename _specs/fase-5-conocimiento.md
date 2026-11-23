# FASE 5 — LO QUE SABE EL NEGOCIO (BASE DE CONOCIMIENTO)
### Spec de ejecución · Recepcionista IA
**Depende de:** `mazzmkt-recepcionista-ia-spec.md` (maestro: §5.4 las tablas, §6 la herramienta `buscar_en_conocimiento` y la regla dura, §8 qué va al prompt y qué se busca, §11 la Fase 5), `decisiones-producto.md` (sobre todo **PB-01 a PB-09**, las propuestas de esta fase, y las que se cruzan: **PA-05** cuándo deriva, **PI-08** preguntas frecuentes, **PC-05** un solo sitio para los datos, **PC-14** quién paga la IA del portal, **PC-21** adjuntar en el chat del portal, **PD-11** RGPD y **PD-13** qué se borra), `fase-9-portal-cliente.md` y `fase-9b-chat-portal.md` (cerradas: el portal, su chat y el «+») y `docs/DECISIONES.md`. Leer todos antes de empezar.

> **Estado de las decisiones (23/11/2026):** ✅ PB-02 a PB-09 decididas (**PB-09: la A**, sin proveedor nuevo; **PB-04: ante una contradicción, se pregunta al negocio cuál es el valor correcto**). ✅ **PC-22** (el tope del chat del portal) decidida: entra en esta fase (5.5b). ⚠️ **PB-01 por confirmar** (un solo valor siempre: al subir se corrige el texto del documento si gana la configuración; si después cambia la configuración, el documento avisa de que quedó viejo). **No se construye hasta que esté.**

---

## OBJETIVO DE ESTA FASE

Que el agente **conteste con lo que el negocio sabe de verdad**: cómo es un tratamiento, cuánto dura la recuperación, qué cuidados hay antes y después, qué incluye un bono. Hoy solo sabe lo que el negocio tiene en **Configuración** (servicios con precio y duración, equipo, horarios, reglas de reserva y cancelación) y unas 20 preguntas frecuentes cortas (PI-08). Lo largo no cabe en el prompt.

El negocio **sube sus documentos** —la carta de tratamientos en PDF, la hoja de cuidados, una foto del folleto o un texto escrito a mano— desde su portal (o pidiéndoselo al chat del portal con el «+»), y vos desde tu panel. Cuando una clienta pregunta algo que no está en su configuración, el agente **lo busca en esos documentos** y contesta con eso, sin inventar. Si no lo encuentra, lo dice y ofrece pasar con una persona.

Es la prueba del maestro: *preguntás por un tratamiento que está solo en un PDF y responde bien.*

### Criterio de "terminada" (Definition of Done)

1. **«Documentos» en Configuración**, en el portal y en tu panel (la misma pantalla, PC-05): subir un PDF, una foto o escribir un texto; ver la lista con el título, de qué trata (una línea) y cuándo se subió; cambiarle el título, reemplazarlo y borrarlo.
2. **Desde el chat del portal**: con el «+» (PC-21), «esta es mi carta de tratamientos, que el agente la sepa» → resumen y confirmación (PC-03) → queda en Documentos.
3. **Al subir**, se saca el texto (también de fotos y PDF escaneados), se parte en trozos y se prepara para buscar según PB-09. El negocio ve **de qué trata** y, si el documento **contradice su configuración** (un precio, una duración, un horario, la dirección), **se le dice y se le pregunta cuál es el valor correcto**: en el chat del portal con palabras, en Documentos con un botón por valor; si elige el del documento, se cambia la configuración con su confirmación (PB-04). Un documento con datos de personas no se guarda (PB-08).
4. **El agente de las clientas busca** (`buscar_en_conocimiento`, maestro §6) cuando la respuesta no está en la configuración ni en las preguntas frecuentes, y contesta con lo encontrado, en sus palabras y sin inventar (PB-05).
5. **Un solo valor, siempre** (PB-01): si al subir gana la configuración, se corrige el texto del documento; si después cambia un precio, una duración o un horario en Configuración y un documento dice el viejo, el agente usa el de Configuración y ese documento muestra el aviso con «Corregirlo» o «Reemplazar».
6. **Si no está en ningún sitio**, lo dice y ofrece derivar (PA-05). Nada de "probablemente".
7. **Salud** (PB-05): explica lo que dice el documento, pero si la clienta pregunta si le conviene a ella, deriva (PA-05). No promete resultados aunque el folleto lo haga.
8. **Borrar o reemplazar** un documento cambia lo que sabe el agente **al momento**. Borrar el negocio borra sus documentos.
9. **Aislamiento**: un negocio nunca encuentra trozos de otro, ni por el agente ni por el portal ni cambiando la dirección. Lo decide el código y la base (RLS + `business_id`), no el prompt.
10. **Límites y costes** (PB-06, PB-07): lo que se pasa del límite se rechaza con un mensaje claro; lo que cuesta preparar un documento y lo que cuesta buscar se registra, cada cosa donde le toca.
11. **Prueba de verdad**: un negocio inventado sube su carta en PDF (con un tratamiento que no está en sus Servicios) y una hoja de cuidados en foto; una clienta pregunta por el widget por ese tratamiento y por los cuidados, y el agente contesta bien; pregunta por algo que no está, y deriva; pregunta un precio que el PDF dice distinto, y da el de su configuración.
12. Todos los tests anteriores siguen pasando, en local y en Supabase, y `npm run agent:eval` y `npm run alta:eval` en verde con los escenarios nuevos.

---

## DECISIONES DE PRODUCTO DE ESTA FASE

Todas en `decisiones-producto.md` (sección *La base de conocimiento (Fase 5)*), con el detalle y un ejemplo. **Decididas el 23/11/2026 salvo PB-01.** En el texto, «la configuración» es lo que el negocio tiene en *Configuración* del portal (la pantalla que en el código es `Ficha.tsx`).

| # | Tema | Propuesta |
|---|---|---|
| PB-01 | Un solo valor, siempre | La configuración y las preguntas frecuentes **en el prompt**, siempre; los documentos, **se buscan** solo cuando hace falta. Si al subir gana la configuración, se corrige el texto del documento; si después cambia la configuración, el documento avisa de que quedó viejo · ⚠️ por confirmar |
| PB-02 | Qué se puede subir | PDF (también escaneados), fotos (folletos, carteles) y texto escrito en el portal. Word y páginas web, más adelante (PC-07) |
| PB-03 | Dónde se sube | En **Configuración → Documentos**, en el portal y en tu panel; y desde el **chat del portal** con el «+», con confirmación |
| PB-04 | Al subir, si contradice la configuración | **Se le dice al negocio y se le pregunta cuál es el valor correcto**; si es el del documento, se cambia la configuración con su «sí». Además: título, una línea de qué trata y las páginas ilegibles |
| PB-05 | Cómo contesta el agente con un documento | Con lo que dice el documento, en sus palabras, sin inventar ni completar. Sin consejo médico ni promesas de resultados. Si no está, lo dice y ofrece derivar |
| PB-06 | Límites | Hasta **20 documentos** y unas **100 páginas** en total por negocio; cada PDF, hasta **4 MB** (el máximo de Vercel, como PC-21) |
| PB-07 | Quién paga | Preparar un documento al subirlo (céntimos): **MAZZMKT**, fuera del tope (como PC-14). Buscar cuando pregunta una clienta: **dentro del tope** del negocio, como el resto de la conversación |
| PB-08 | Datos de personas | «No subas datos de tus clientas». Si un documento trae datos de personas (una lista de clientas, un historial), **no se guarda** y se avisa. Pendiente del RGPD (PD-11) |
| PB-09 | Cómo busca el agente | ✅ **La A: sin proveedor nuevo**, búsqueda de texto en español dentro de nuestra base, con las palabras con que lo pediría una clienta añadidas al subir. La B (*embeddings* con Voyage AI y `pgvector`) queda de reserva si las pruebas muestran que la A no encuentra bien |

## CONTEXTO TÉCNICO

- **Las tablas ya existen** desde la Fase 0 (`supabase/migrations/20260806120400_conocimiento.sql`): `knowledge_docs` (`titulo`, `tipo` pdf/texto/faq, `contenido_raw`) y `knowledge_chunks` (`contenido`, `embedding vector(1024)` vacío), con RLS y borrado en cascada. Esta fase **las amplía** con una migración nueva (lo que falta: de qué trata, avisos, origen —portal, panel o chat—, tamaño y páginas, cuándo se reemplazó; y en los trozos, las palabras de búsqueda y la columna de búsqueda de texto o el índice vectorial, según PB-09). No se reescribe la migración vieja.
- **Cómo se busca (PB-09, decidida: la A).** Se anota como decisión técnica (D-) al empezar.
  - *Opción A (la elegida).* Búsqueda de texto completo de Postgres en español (`to_tsvector('spanish', …)` con índice GIN y `websearch_to_tsquery`), en la misma base. Para que «bótox» encuentre «toxina botulínica», al subir cada trozo el modelo escribe **las palabras con que una clienta lo pediría** (sinónimos, coloquialismos, faltas típicas) y se indexan con el trozo; y la herramienta recibe una búsqueda que redacta el propio agente, que ya sabe sinónimos. Sin cuenta nueva, sin clave nueva, sin otro país recibiendo las preguntas de las clientas. Una clínica pequeña tiene pocas páginas: buscar en texto alcanza.
  - *Opción B (de reserva).* *Embeddings* con **Voyage AI** (de MongoDB; Anthropic no tiene modelo de *embeddings* y recomienda este) y `pgvector` con índice HNSW, que es lo que decía el maestro. Entiende el significado aunque no coincidan las palabras. Pero suma un proveedor, una clave (en `.env` y en Vercel, la pone Mariana) y un tercero en EE. UU. que recibe las preguntas de las clientas, que pueden traer datos de salud (PD-11). El coste es casi nulo: la cuenta trae 200 millones de *tokens* gratis en la familia `voyage-4`, y después son céntimos por millón; una clínica entera son unas decenas de miles.
  - *Opción C, descartada como base pero útil de reserva.* Meter todos los documentos en el prompt con *caché*: funciona si son pocos, pero el coste de cada mensaje crece con lo que se sube y choca con el límite de PB-06.
  - Sea cual sea, **la búsqueda queda detrás de una interfaz** (`buscarEnConocimiento(businessId, consulta)`) para poder pasar de A a B sin tocar el agente, si las pruebas con el modelo real muestran que A no encuentra lo que debería.
- **Leer los documentos al subirlos**: el modelo ya lee PDF y fotos (lo hace el «+» de PC-21). Se le pide el texto limpio por páginas, el título, la línea de qué trata, las palabras de búsqueda, los datos de personas (PB-08) y **los valores que el documento da para lo que hay en la configuración** (precio y duración de cada servicio, horarios, dirección, teléfono) en una sola llamada con salida estructurada. **La comparación con la configuración la hace el código**, no el modelo: así las contradicciones de PB-04 salen siempre igual y con los valores exactos. Se guardan como «pendientes de contestar» hasta que el negocio elige. Esos valores se guardan aparte, así que **cuando cambia la configuración** el código vuelve a comparar y marca los documentos que quedaron viejos (PB-01); «Corregirlo» cambia el valor en el texto que lee el agente. Se guarda el texto (`contenido_raw`), no el archivo: el PDF no hace falta después. ⚠️ Decisión técnica (D-): guardar o no el archivo original; *propuesta*: no guardarlo (menos datos, menos almacenamiento) y que «Reemplazar» pida el archivo nuevo.
- **Trozos**: por secciones y párrafos, de unos 1.000–1.500 caracteres con algo de solape, sin partir una lista de precios a la mitad. El título del documento y el de la sección van en cada trozo (ayuda a buscar y a contestar).
- **La herramienta del agente** (`src/core/tools/`): `buscar_en_conocimiento({ consulta })` devuelve los 3–5 mejores trozos con el título de su documento. El `business_id` sale del turno, **nunca del modelo** (como todas las herramientas). Va en el mismo registro de herramientas, con su test. El agente de las clientas cambia: la herramienta nueva y unas líneas del prompt (PB-01, PB-05). Nada de datos de un negocio en `src/core/` (regla de oro).
- **El portal y el panel** (`admin/`): una sección más de la pantalla de configuración compartida (`Ficha.tsx`), llamando a rutas nuevas montadas por el panel y por el portal, como las demás (`src/api/admin/negocio.ts`, PC-05). Con «Pídeselo al agente» cuando está vacía (PC-19).
- **El chat del portal** (`src/alta/`): una herramienta `guardar_documento` que usa el mismo camino que la subida a mano, tras el «¿está todo bien?» (PC-03). Reutiliza los adjuntos de PC-21.
- **Costes** (PB-07): preparar un documento se apunta como coste de alta (el de PC-14, fuera del tope); la búsqueda, en el consumo normal del negocio.
- **Borrado** (PD-13): los documentos son del negocio, no de clientas, así que no caducan a los 6 meses; se van cuando el negocio los borra o se borra el negocio.
- Publicar en Vercel y tocar la base de la nube, **solo con el visto bueno de Mariana**. Si PB-09 queda en B, la clave de Voyage la escribe ella en `.env` y en Vercel.

## TAREAS

### 5.1 — Base de datos
- Migración que amplía `knowledge_docs` y `knowledge_chunks` (lo de arriba) y crea el índice de búsqueda (GIN de texto o HNSW, según PB-09). RLS revisada.
- Función de búsqueda en la base, filtrando por `business_id`.
- Límites de PB-06 en la base (como RA007 para las preguntas frecuentes): un código de error propio, el siguiente libre (**RA011**).
- Tests SQL: aislamiento, cascada al borrar, límites, que la búsqueda en español encuentre por las palabras añadidas.

### 5.2 — Leer y preparar un documento
- `src/conocimiento/` (carpeta nueva, con su `AGENTS.md`): sacar el texto de PDF, fotos y texto escrito; título, de qué trata, palabras de búsqueda y avisos; partir en trozos; guardar.
- Con el modelo simulado en los tests y el real en `agent:eval`.

### 5.3 — La herramienta del agente
- `buscar_en_conocimiento` y las líneas del prompt (PB-01, PB-05). Cuándo buscar: cuando la respuesta no está en la configuración ni en las preguntas frecuentes.
- Que la configuración mande sobre el documento (precios y duraciones).

### 5.4 — Documentos en el portal y en el panel
- Rutas (subir, listar, renombrar, reemplazar, borrar) en `src/api/admin/negocio.ts`, para los dos.
- Sección «Documentos» en `Ficha.tsx`, con «Pídeselo al agente» si está vacía, el aviso de PB-08 y, por cada contradicción pendiente (PB-04), el recuadro con la pregunta y un botón por valor; elegir el del documento cambia la configuración con las mismas rutas y validaciones de siempre, con confirmación.

### 5.5 — Desde el chat del portal
- `guardar_documento` en `src/alta/`, con resumen y confirmación (PC-03), usando los adjuntos de PC-21. Si hay contradicciones (PB-04), el chat las dice una a una y pregunta cuál es el valor correcto; si es el del documento, enseña el cambio y lo guarda con su «sí», con las herramientas que ya cambian la configuración.
- **Al guardarlo, el archivo sale de la conversación** (PB-06): en el historial queda solo «guardado: Carta 2026», para que la IA no lo vuelva a leer en cada mensaje de ese chat.

### 5.5b — El tope del chat del portal (PC-22, decidida el 23/11/2026)
- Un tope al mes para el chat del portal, ajuste por negocio que Mariana cambia en su panel (de serie, 5 US$); aviso al 80 % en el panel; al llegar, el chat se pausa con su mensaje y Configuración a mano sigue. Su migración y sus tests. Lo que se pasa del tope se registra; el cliente no ve euros ni porcentajes (como PC-09).

### 5.6 — Tests
**Sin coste (`npm test`, `npm run test:sql`):** subir, listar, reemplazar y borrar; un negocio no ve ni encuentra documentos de otro (API, dirección, chat); límites; la herramienta devuelve los trozos del negocio y nada más; la configuración manda con las clientas; una contradicción se pregunta y, si se elige el valor del documento, la configuración cambia solo con confirmación; el chat del portal no guarda sin confirmar; el tope del chat del portal (PC-22) pausa el chat y deja Configuración a mano.

**Con el navegador (`npm run test:e2e`):** subir un PDF en Documentos del portal, verlo en la lista con su línea de qué trata, contestar la pregunta de un precio distinto (los dos botones), verlo igual en tu panel, borrarlo.

**Con el modelo real (`npm run agent:eval`, `npm run alta:eval`):** las preguntas de la prueba de verdad, una clienta que pregunta con palabras coloquiales («lo del bótox», «lo de quitar manchas»), una que pregunta si le conviene (deriva), un precio distinto en el PDF (manda la configuración), y en el portal «esta es mi carta, que la sepa el agente». Avisar del coste antes de correrlos.

### 5.7 — Documentación
- `docs/DECISIONES.md`: sección Fase 5 (cómo se busca, por qué, qué se guarda).
- `src/conocimiento/AGENTS.md`, la tabla del `AGENTS.md` raíz, `src/core/AGENTS.md` (la herramienta nueva), `admin/AGENTS.md` y el `README.md` raíz.
- `decisiones-producto.md` y el manual «Cómo funciona el Recepcionista» en el mismo turno de cada decisión (§8 del `AGENTS.md` raíz). El cuestionario de alta: la pregunta de qué documentos tiene el negocio.

---

## FUERA DEL ALCANCE DE LA FASE 5

- Leer la web del negocio para sacar sus servicios o documentos (PC-07).
- Word, Excel y presentaciones (cuando alguien los pida; PDF cubre casi todo).
- Que el agente mande el PDF a la clienta o le diga «según la página 3»: contesta con sus palabras.
- Documentos que cambian solos (un enlace que se vuelve a leer cada semana).
- Que el agente aprenda de las conversaciones: solo sabe lo que el negocio sube.
- Búsqueda de documentos para Mariana entre todos los negocios.

---

## ORDEN DE TRABAJO SUGERIDO PARA CLAUDE CODE

1. Leer los documentos de "Depende de" y comprobar que PB-01 a PB-09 están decididas en `decisiones-producto.md`. Si alguna sigue ⚠️, **parar y preguntar**.
2. Anotar las decisiones técnicas (cómo se busca, según PB-09; si se guarda el archivo original) y contarlas en una línea cada una.
3. Migración, función de búsqueda y tests SQL (5.1). Verde.
4. Leer y preparar documentos con el modelo simulado (5.2).
5. La herramienta del agente y el prompt (5.3).
6. Documentos en el portal y el panel (5.4) y desde el chat del portal (5.5).
7. La prueba de verdad con un negocio inventado.
8. `npm run agent:eval` y `npm run alta:eval` con los escenarios nuevos y la verificación en Supabase (`./scripts/con-supabase.sh …`), avisando del coste.
9. Ejecutar el plan de pruebas y publicar el informe.
10. Documentación (5.7). Publicar en Vercel **solo si Mariana lo confirma**.

Trabajar contra el Postgres local (`recepcionista_dev`). No apagar ni reiniciar Postgres sin avisar. **Un solo PR para toda la fase:** la rama `fase-5-spec`, con este spec; se hace push a esa rama y se actualiza ese PR (título y descripción en inglés), sin abrir otro. Mariana lo mergea.

---

## PROMPT DE ARRANQUE (para pegar en Claude Code, sesión fresca en el repo)

> Leé `_specs/mazzmkt-recepcionista-ia-spec.md` (maestro, sobre todo §5.4, §6, §8 y la Fase 5), `_specs/decisiones-producto.md` (reglas de negocio, sobre todo PB-01 a PB-09 y las que cita el spec), `_specs/fase-5-conocimiento.md` (esta fase) y `docs/DECISIONES.md`. Comprobá primero que PB-01 a PB-09 están decididas; si alguna sigue por confirmar, pará y preguntame. PC-22 (el tope del chat del portal) está decidida y entra en esta fase. Implementá la Fase 5 completa siguiendo el spec, en el orden sugerido. Antes de programar, anotá las decisiones técnicas que pide el spec y contámelas en una línea cada una. Reutilizá las rutas y la pantalla de configuración compartida del panel y del portal (`Ficha.tsx`): no las dupliques. Las claves están en `.env`: no me las pidas ni las muestres. Trabajá contra el Postgres local `recepcionista_dev` y no lo apagues. Trabajá en la rama `fase-5-spec`: hacé push a esa rama y actualizá su PR al final (título y descripción en inglés, como los commits). No mergees ni publiques en Vercel sin preguntarme, y no toques la base de la nube sin mi visto bueno. Si aparece una decisión de producto que no está en `decisiones-producto.md`, no la inventes: anotala como propuesta por confirmar y avisame. Actualizá el manual «Cómo funciona el Recepcionista» y el Mapa de avance de Research Desk en cada paso. Las pruebas las hacés vos: ejecutá el plan de pruebas de la fase y publicá el informe. Explicame al final, en lenguaje simple, qué hiciste.

---

## PLAN DE PRUEBAS DE ACEPTACIÓN

Las pruebas las hace Claude Code, no Mariana (§3b del `AGENTS.md` raíz). El plan está en la nota **«Plan de pruebas · Fase 5»** de Research Desk, con la regla de cada bloque explicada en palabras. Mariana lo revisa y añade sus casos en «Tus pruebas»; Claude Code lo ejecuta y publica el **«Informe de pruebas · Fase 5»**.

## CÓMO SABÉS QUE PODÉS PASAR A LA FASE SIGUIENTE

Lo comprueba Claude Code y lo resume en el informe:

1. `npm run test:sql`, `npm test` y `npm run test:e2e` → todo en verde, en local y en Supabase.
2. `npm run agent:eval` y `npm run alta:eval` → todo OK, con los escenarios nuevos.
3. El plan de pruebas, revisado por Mariana, ejecutado: todo en OK o con su arreglo y su test, y las decisiones que salieron, decididas.
4. La prueba de verdad (punto 11 del criterio de terminada), de punta a punta.
5. Ningún negocio encuentra documentos de otro, ni por el agente, ni por la API, ni por la dirección.

Recién ahí, Mariana mergea el PR de la fase y sesión nueva para la Fase 6.
