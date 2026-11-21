# FASE 9b — EL CHAT DEL PORTAL, COMO LOS CHATS QUE TODOS CONOCEMOS
### Spec de ejecución · Recepcionista IA
**Depende de:** `fase-9-portal-cliente.md` (cerrada el 20/11/2026: el portal, el alta por chat y sus herramientas), `decisiones-producto.md` (sobre todo **PC-03, PC-11 y PC-17 a PC-20**) y la nota **«Guion del alta por chat»** de Research Desk.

---

## OBJETIVO

Mariana, 20/11/2026: el chat del portal tiene que **verse y usarse como ChatGPT**, porque es lo que todo el mundo conoce. Al entrar, un saludo con el nombre del negocio y la caja para escribir en el centro; a la izquierda, el historial de chats (uno por tema); arriba, «Agente | Portal» y el círculo del perfil. El alta deja de ir en orden: el cliente empieza por lo que quiera. Y el portal se ve siempre, con «Pídeselo al agente» donde falta algo.

### Criterio de "terminada" (Definition of Done)

1. **Pantalla de inicio** (PC-19): «Buenos días / Buenas tardes / Buenas noches, [negocio]. ¿En qué te puedo ayudar?» según la hora del negocio; la caja blanca en el centro sobre el fondo gris claro; sugerencias debajo según lo que falte. Al escribir, la caja baja al pie.
2. **Historial** (PC-17): arriba el nombre del negocio y la lupa que busca chats por el título, como ChatGPT: en el ordenador una ventana en el centro, en el móvil a pantalla completa con el último mensaje de cada chat (retoque del 20/11/2026); debajo «Nuevo chat» y la lista de chats a la izquierda; cada chat con su título (lo pone la IA con el primer mensaje); se puede renombrar y borrar (borrar lo oculta). En el móvil, detrás del ☰.
3. **«Agente | Portal»** arriba en el centro (en el móvil, dentro del menú ☰); el portal disponible siempre (PC-19).
4. **El círculo del perfil** arriba a la derecha con las iniciales; al pincharlo, Cuenta (el nombre y el email como datos), Ajustes y Cerrar sesión, sin ventanas (retocado con Mariana el 20/11/2026, PC-17).
4b. **En el móvil, como ChatGPT** (retoque del 20/11/2026, PC-17): chat vacío sin saludo y con la caja abajo; el menú ☰ con el nombre del negocio, el email y la lupa que busca chats, Agente y Portal, el historial y «Nuevo chat» abajo. En Agenda y Configuración, «⌂ Inicio › …» para volver.
5. **El alta por temas** (PC-18): cualquier sección, en cualquier orden y en cualquier chat. Qué está hecho lo marca el código al guardar; el agente dice lo que falta; el alta se cierra solo con las cinco.
6. **«Pídeselo al agente»** (PC-19): en el inicio del portal y en lo vacío de la configuración; abre un chat nuevo con el mensaje de esa sección ya enviado.
7. **Mensaje sin sentido** (PC-20): «Disculpa, no he comprendido tu mensaje.» y lo que puede hacer, calculado con lo que ya está cargado.
8. Un chat de otro negocio no existe para el portal (404), ni por la dirección ni por la API.
8b. **El «+» para adjuntar** (PC-21, 21/11/2026): fotos (achicadas en el navegador) y PDF de hasta 4 MB, hasta 5 por mensaje; también arrastrando o pegando. El agente los lee: sin texto, cuenta lo que reconoció y pregunta qué hacer; con instrucciones, lo hace y pregunta lo dudoso; siempre con el resumen para confirmar. Se guardan en `portal.adjuntos` y caducan con el chat (PD-13). Aviso de no subir datos de clientas debajo del «+».
9. Tests: SQL (16 y 17), TypeScript (alta-chat, portal-api), e2e del portal adaptado, y `npm run alta:eval` con el escenario nuevo.

## TAREAS (hechas en la misma sesión, 20/11/2026)

- **9b.1 Base** — migración `20261121120000_chats_del_portal.sql`: `conversations.titulo`, `oculta_at`, `continua_de` (clave compuesta, mismo negocio) y `portal.alta.secciones_hechas`; test `16_chats_del_portal.sql`.
- **9b.2 Servidor** — `src/db/portal.ts` (chats, cadena de un chat largo, secciones hechas), `src/alta/agente.ts` (cada mensaje a su chat; titulador con un modelo pequeño), `src/alta/herramientas.ts` (sin `avanzar_seccion`; `quedan_del_alta`; todas las herramientas durante el alta), `src/alta/prompt.ts` (alta por temas, PC-20, sin bienvenida), rutas `GET chats`, `GET/PUT/DELETE chats/:id` y `POST chat` con `chatId`.
- **9b.3 Pantalla** — `admin/src/portal/App.tsx` (marco, historial, selector, perfil, inicio del portal), `Chat.tsx` (inicio y conversación), `pedir.ts` (mensajes de cada sección); «Pídeselo al agente» en la ficha compartida, solo en el portal.
- **9b.4 Pruebas y documentación** — tests, e2e, `alta:eval`, AGENTS.md, README, manual de Research Desk y guion.

- **9b.5 Adjuntos (PC-21)** — migración `20261122120000_adjuntos_del_portal.sql` y test `17_adjuntos_del_portal.sql`; `src/db/adjuntos.ts` (tipo por los bytes, ligar solo los propios), `src/alta/adjuntos.ts` (marca en el historial y expansión para el modelo), rutas `POST adjuntos`, `GET adjuntos/:id` y `adjuntos` en `POST chat`; `admin/src/portal/adjuntar.ts` y el «+» en `Chat.tsx`; `tests/adjuntos.test.ts` y el paso 11 del e2e.

## FUERA DE ALCANCE

- Adjuntar Word o Excel (PC-21: más adelante, si alguien lo pide).

- Qué va en **Ajustes** (Mariana lo verá más adelante).
- Respuestas que se escriben letra a letra (streaming): el chat contesta de una vez, como ahora.
- Buscar dentro del texto de los chats: la lupa busca solo por el título.
