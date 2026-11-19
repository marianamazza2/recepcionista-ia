# src/portal/ — cuentas y emails del portal del cliente

Lo que hace falta para que un negocio **entre** a su portal (Fase 9, PC-02 y
PC-11). Los datos están en [`src/db/portal.ts`](../db/AGENTS.md); las rutas,
en [`src/api/portal/`](../api/AGENTS.md); el chat, en
[`src/alta/`](../alta/AGENTS.md).

| Archivo | Qué tiene |
|---|---|
| `password.ts` | `scrypt` del módulo `crypto` de Node: hash, comprobación en tiempo constante y qué contraseña vale |
| `email.ts` | Los dos emails del portal: el enlace de invitación y el código que confirma el email |

## Las cuentas son NUESTRAS, no de Supabase Auth

El panel usa Supabase Auth (PI-01), pero el portal no puede (D-87):

- crear usuarios desde el servidor pide la `SUPABASE_SERVICE_ROLE_KEY`, que
  **no puede ir a Vercel** (§6 del `AGENTS.md` raíz);
- el alta con la clave anon sería **registro público**, y PC-11 dice que el
  enlace de invitación es la **única** puerta;
- y la cuenta pertenece a **un negocio**, que es dato nuestro.

Así que: contraseña con `scrypt` (sal de 16 bytes, parámetros dentro del hash
para poder subirlos después), sesión con un token aleatorio del que la base
guarda **solo el sha256**, y el email confirmado con un código de seis
dígitos con las mismas reglas que PA-16.

## Reglas

- **Nunca se guarda ni se enseña un secreto.** El token del enlace se devuelve
  UNA vez (al generarlo) y en la base queda su hash; el código va tapado
  (`[código]`) en `email_messages`, como en PA-16; la contraseña, solo su hash.
- **Las respuestas no distinguen.** Un enlace inventado, usado, caducado o
  anulado contestan lo mismo, y un email que no existe tarda lo mismo que uno
  que sí (se comprueba una contraseña falsa a propósito).
- **El email es un extra, no un requisito.** Si el envío falla, el enlace se
  enseña igual en el panel para dárselo a mano; lo que no se puede saltar es
  el **código** (PC-02).
- Los dos emails van por el mismo `EmailProvider` que la confirmación de una
  cita (PW-18). Hoy es el de prueba: salen en la Terminal. **PC-15: antes del
  primer cliente real hay que conectar uno de verdad** — es de Mariana y no
  bloquea construir.
- Textos para el cliente en **español de España, de tú**.

## Si cambiás algo de acá

**Obligatorio:** si tu cambio toca la arquitectura, una regla de negocio o la
forma de trabajo de esta carpeta, actualizá este `AGENTS.md` (y el raíz si
aplica) en el mismo cambio. Ver §8 del [`AGENTS.md` raíz](../../AGENTS.md#8-mantener-esta-documentación).

- Si cambian los parámetros de `scrypt`, las contraseñas de antes tienen que
  seguir valiendo: van dentro del hash a propósito.
- Un email nuevo del portal → su función aquí, su fila en `email_messages`
  (con el secreto tapado) y su test.
