---
name: consultar-base
description: Mira qué pasó en la base del Recepcionista IA, solo leyendo — una conversación entera con las herramientas que usó el agente y lo que le devolvieron, las citas de una clienta, las últimas citas, las derivaciones al equipo, el consumo del mes y los SMS de prueba. Usala cuando Mariana pregunte cosas como "¿qué le contestó el agente a…?", "el agente dijo algo raro", "¿se creó la cita?", "¿por qué no reservó?", "¿cuánto llevamos gastado?", "¿llegó el SMS?", o para depurar cualquier prueba del chat o del widget.
---

# Consultar la base (solo lectura)

Las consultas están en `consultas.sql`, al lado de este archivo, y se
ejecutan con `consulta.sh`. La sesión se abre en **solo lectura**: no puede
modificar nada aunque se intente. **Esta skill nunca escribe en la base.** Si
hace falta corregir datos, se le pregunta a Mariana y se hace aparte.

```bash
S=.claude/skills/consultar-base/consulta.sh
$S <consulta> [var=valor …]            # base local (DATABASE_URL de .env)
NUBE=1 $S <consulta> [var=valor …]     # Supabase en la nube
```

`negocio` vale `estetica-aurora` si no se indica (`negocio=<slug>` para otro).

| Consulta | Variables | Para qué |
|---|---|---|
| `conversaciones` | `negocio` | Las 15 últimas: estado, clienta, cuántos mensajes, tokens. **Empezá por acá** para encontrar el id |
| `conversacion` | `conv=<uuid>` | La conversación entera en orden: lo que escribió la clienta, qué herramientas pidió el agente, sus respuestas, respuestas fijas del código y tokens |
| `resultados` | `conv=<uuid>` | Qué le mandó el modelo a cada herramienta y qué le devolvió. Explica **por qué** dijo lo que dijo |
| `clienta` | `tel=+34…` | Las citas y conversaciones de una clienta |
| `citas` | `negocio` | Las 15 últimas citas creadas, en hora local |
| `derivaciones` | `negocio` | Lo que se pasó al equipo y sigue sin resolver |
| `consumo` | `negocio` | Mensajes, tokens, citas y coste en US$ del mes, frente al tope (PW-04) |
| `sms` | `negocio` | Los últimos SMS de confirmación (PW-07) |

## Cómo investigar "el agente dijo algo raro"

1. `conversaciones` → encontrá la conversación (por hora o por clienta).
2. `conversacion conv=…` → leé el diálogo. Fijate en `respuesta_fija`: si
   tiene valor, ese texto lo puso el código (límite, tope, error, derivada),
   no la IA.
3. `resultados conv=…` → mirá qué devolvió cada herramienta. Casi siempre la
   explicación está ahí: un hueco que no había, un error del motor (`motivo`),
   la clienta sin identificar…
4. Contale a Mariana, en lenguaje simple, **qué pasó y por qué**, y si es un
   fallo del prompt, de una herramienta o de los datos del negocio. Si hay que
   arreglar algo, proponelo; no lo cambies sin decirlo.

## Cuidado con los datos

- Son datos de personas (teléfonos, nombres, a veces temas de salud). Mostrá
  solo lo que haga falta para responder; no copies listados enteros de
  teléfonos en el chat.
- La nube es la base compartida: para leerla usá siempre `NUBE=1` (nunca
  muestres la contraseña ni la cadena de conexión).

## Añadir una consulta

Un bloque nuevo en `consultas.sql` que empiece con `-- @nombre  (variables:
…)` y un comentario de para qué sirve, filtrando por negocio y con horas
`at time zone b.timezone`. Probalo con `consulta.sh` y añadí su fila a la
tabla de arriba.
