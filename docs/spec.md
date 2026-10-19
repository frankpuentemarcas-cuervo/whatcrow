# whatcrow: overlay de aprobación de respuestas

Fecha: 2026-10-19
Repos: `whatsapp` (este, datos y MCP) y `whatcrow` (https://github.com/frankpuentemarcas-cuervo/whatcrow, app de escritorio)
Relacionado: `docs/superpowers/specs/2026-10-17-whatsapp-agent-design.md`

## 1. Objetivo

Que el usuario apruebe respuestas de WhatsApp sin abrir la conversación con Claude. Claude revisa los chats en segundo plano y deja borradores; una ventana de Windows siempre encima los muestra y el usuario envía, programa, edita o descarta con un clic.

Éxito:
- Las sugerencias aparecen en el overlay sin intervención del usuario mientras la PC está encendida.
- Ningún mensaje sale sin un clic del usuario (o su aprobación explícita en la conversación).
- Una versión nueva de whatcrow se instala desde el propio programa, sin desinstalar.

## 2. Decisiones tomadas

| Tema | Decisión | Descartado |
|------|----------|------------|
| Quién revisa | Sesión de Claude Code con `/loop 10m` (opción A) | `claude -p` headless por mensaje: costo en tokens por cada mensaje, incluido ruido de grupos |
| Stack del overlay | Tauri (Rust + webview) | Electron: >100 MB de instalador y ~150 MB de RAM para una ventana siempre abierta |
| Canal Claude ↔ overlay | `data/wa.sqlite` como contrato; tools nuevas en el MCP `whatsapp` | MCP HTTP propio del overlay: sin overlay abierto no hay dónde escribir, y para enviar igual tiene que tocar `outbox` |

## 3. Arquitectura

```
Claude (/loop) ──MCP whatsapp──► suggestions ◄──lee── whatcrow (Tauri)
                                                         │ Enviar / Programar
daemon ◄──procesa (send_at <= ahora)── outbox ◄──────────┘
```

`wa.sqlite` ya corre en WAL con `busy_timeout = 5000` (`src/shared/db.ts`), así que daemon, MCP y whatcrow pueden leer y escribir a la vez.

whatcrow no habla con Claude ni con WhatsApp: solo lee `suggestions`, `messages`, `chats`, `outbox`, `daemon_state` y `agent_heartbeat`, y escribe en `suggestions` y `outbox`.

## 4. Modelo de datos (repo `whatsapp`, migración en `src/shared/db.ts`)

### `suggestions` (nueva)
| Columna | Tipo | Nota |
|---------|------|------|
| `id` | INTEGER PK AUTOINCREMENT | |
| `chat_jid` | TEXT NOT NULL | jid exacto del chat |
| `last_msg_id` | TEXT NOT NULL | último mensaje entrante que la sugerencia contempla |
| `last_msg_text` | TEXT | para mostrar sin otra consulta |
| `draft` | TEXT | null si `category` no es `respuesta` |
| `category` | TEXT NOT NULL | `respuesta` \| `tarea` \| `esperando` |
| `note` | TEXT | por qué, qué falta saber, "sin ficha, contexto limitado" |
| `status` | TEXT NOT NULL DEFAULT 'pending' | `pending` \| `sent` \| `scheduled` \| `dismissed` \| `superseded` |
| `final_text` | TEXT | texto que el usuario envió (puede diferir de `draft`) |
| `created_at`, `updated_at` | INTEGER NOT NULL | epoch ms |

Índice único parcial: una sola fila `pending` por `chat_jid`. `suggest_reply` marca la anterior como `superseded` e inserta la nueva en la misma transacción.

### `outbox` (columnas nuevas)
- `send_at INTEGER` — null = enviar ya.
- `approved_via TEXT NOT NULL DEFAULT 'chat'` — `chat` \| `whatcrow`.
- `suggestion_id INTEGER` — referencia a `suggestions.id`, null si no vino de una sugerencia.
- Estados nuevos en `status`: `cancelled`, `expired`.

### `agent_heartbeat` (nueva)
Una fila (`key = 'loop'`, `at` epoch ms). El loop la actualiza en cada vuelta.

## 5. Tools MCP nuevas (`src/mcp/tools.ts`)

- `suggest_reply({ chat_jid, last_msg_id, category, draft?, note? })` — crea o reemplaza la sugerencia `pending` del chat. Rechaza `draft` vacío si `category = 'respuesta'`.
- `clear_suggestion({ chat_jid })` — pasa la `pending` a `dismissed`.
- `list_suggestions({ status?, since? })` — lo que ya se propuso, para no repetir; incluye `final_text` para detectar ediciones.
- `agent_heartbeat()` — actualiza `agent_heartbeat`.

Ninguna envía. `send_message` no cambia salvo que ahora escribe `approved_via = 'chat'`.

## 6. Daemon (`src/daemon/service.ts`)

- Toma solo filas `pending` con `send_at IS NULL OR send_at <= ahora`.
- Si `ahora - send_at > 30 min` (por ejemplo, el daemon estuvo caído), no envía: pasa la fila a `expired`.
- Al enviar una fila con `suggestion_id`, no toca `suggestions` (eso ya lo hizo whatcrow al encolar).

## 7. whatcrow (repo nuevo)

### Ventana
- Siempre encima. Tamaño por defecto: dos notas adhesivas apiladas en vertical (~330 × 660 px). El usuario la agranda o achica (arrastrando el borde o con un control de tamaño rápido) y el layout se adapta por breakpoints. Se puede minimizar a la bandeja. El diseño visual y los breakpoints los define `ui-spec.md` del agente `disenador-ux`, que se versiona en el repo `whatcrow`.
- Una tarjeta por sugerencia `pending`, más reciente primero: nombre del chat, último mensaje, categoría, nota y borrador **editable**.
- Botones por tarjeta: **Enviar**, **Programar** (selector de fecha y hora), **Descartar**. `tarea` y `esperando` solo tienen **Descartar**.
- Sección **Programados**: envíos con `send_at` futuro y botón **Cancelar**.
- Sección **Fallidos**: filas `failed` o `expired` con su error y botón **Reintentar** (encola de nuevo el mismo texto; el clic es la aprobación).
- Botón **Buscar actualizaciones**.
- Ajustes: ruta a `wa.sqlite` (default `C:\dev\whatsapp\data\wa.sqlite`), iniciar con Windows.
- Refresco: sondeo de la base cada 3 s.

### Enviar (una transacción)
1. `UPDATE suggestions SET status='sent', final_text=? , updated_at=? WHERE id=? AND status='pending'`.
2. Si afectó 0 filas: abortar y avisar ("ya enviada o reemplazada").
3. `INSERT INTO outbox (chat_jid, text, status, created_at, approved_via, suggestion_id) VALUES (?, ?, 'pending', ?, 'whatcrow', ?)`.

Programar es igual con `status='scheduled'` en `suggestions` y `send_at` en `outbox`. Cancelar pasa `outbox` a `cancelled` solo si sigue `pending`; en la misma transacción la sugerencia vuelve a `pending` si el chat no tiene otra `pending`, y si la tiene pasa a `superseded`.

### Sugerencia desactualizada
Antes de enviar, whatcrow busca el último mensaje entrante del chat en `messages`. Si no es `last_msg_id`, la tarjeta muestra el mensaje nuevo y el botón pasa a **Enviar igual**.

### Edición concurrente
Si el loop reemplaza la sugerencia mientras el usuario edita, la tarjeta avisa ("hay una sugerencia nueva") y no pisa el texto en edición hasta que el usuario elija.

### Banners de error
- No encuentra `wa.sqlite` o no puede abrirla.
- Daemon no saludable (mismo criterio que `wa_status`).
- `agent_heartbeat` con más de 20 min: "el agente no está corriendo".

## 8. Releases y actualización (`whatcrow`)

- Instalador NSIS (`.exe`) generado por Tauri.
- `tauri-plugin-updater` contra `https://github.com/frankpuentemarcas-cuervo/whatcrow/releases/latest/download/latest.json`.
- GitHub Actions con `tauri-action`: al pushear un tag `v*` compila, firma con minisign y publica el Release con `latest.json`.
- Clave privada en el secret `TAURI_SIGNING_PRIVATE_KEY` (y su password). La clave pública va embebida en `tauri.conf.json`. **Perder la privada impide actualizar las instalaciones existentes**: se guarda un backup fuera del repo.

## 9. Agente en segundo plano (repo `whatsapp`)

### Cada vuelta del loop (10 min)
1. `wa_status` y `agent_heartbeat`.
2. `list_chats` con `unread_only: true`: solo chats 1:1 y grupos donde se menciona al usuario. Se excluyen newsletters y comunidades.
3. `list_suggestions`: se saltean los chats cuya sugerencia `pending` ya cubre el último mensaje.
4. Un `respondedor-whatsapp` por chat nuevo, en paralelo; luego `suggest_reply` con borrador, categoría y nota.
5. Sugerencias `sent` con `final_text` distinto de `draft`: el loop arma la propuesta de nota para `Estilo.md` o la ficha y la deja anotada; no la escribe. Se muestra al usuario cuando abra una conversación.

### Sin ficha
El loop redacta igual y la nota lleva "sin ficha, contexto limitado" más lo que falta saber. Crear la ficha sigue requiriendo el OK del usuario en la conversación.

### Arranque
- `scripts/start-agent.ps1`: cierra la sesión anterior del agente si existe y abre Windows Terminal en `C:\dev\whatsapp` con `claude "/loop 10m <prompt del loop>"`.
- `scripts/install-autostart.ps1` registra la tarea `WhatsApp Agent`: al iniciar sesión (después de `WhatsApp Daemon`) y todos los días a las 6:00, porque las tareas recurrentes de Claude Code expiran a los 7 días y el loop muere si se cierra la terminal (https://code.claude.com/docs/en/scheduled-tasks).
- Verificar en la implementación que `claude "/loop ..."` arranca el loop: la doc solo muestra prompts de texto como prompt inicial.

### Permisos (`.claude/settings.json`)
Allowlist explícita, tool por tool: `wa_status`, `list_chats`, `read_messages`, `search_messages`, `group_info`, `list_labels`, `suggest_reply`, `clear_suggestion`, `list_suggestions`, `agent_heartbeat`. **Sin comodín**: `mcp__whatsapp__*` incluiría `send_message` (https://code.claude.com/docs/en/permissions).

## 10. Cambios en `CLAUDE.md`

- Regla de aprobación: `approved: true` solo cuando el usuario aprobó ese texto exacto en esta conversación. El otro canal válido es el clic en Enviar, Programar o Reintentar de whatcrow, que escribe en `outbox` sin pasar por Claude.
- El loop nunca llama a `send_message`.
- Paso 4 del flujo: en el loop, sin ficha se sugiere igual con la marca "sin ficha, contexto limitado".
- Sección "Correr": tarea `WhatsApp Agent` y cómo reinstalarla.

## 11. Pruebas

- `whatsapp` (TDD estricto, `vitest`): migración idempotente; `suggest_reply` reemplaza y deja una sola `pending`; validaciones de `suggest_reply`; `list_suggestions`; el daemon respeta `send_at`, expira a los 30 min e ignora `cancelled`; `send_message` escribe `approved_via='chat'`.
- `whatcrow` (Rust, `cargo test` contra un SQLite temporal con el esquema real): transacción de Enviar, doble clic (segundo envío no inserta), sugerencia desactualizada, Programar y Cancelar, Reintentar.
- UI: prueba manual con el daemon real antes de cada release.

## 12. Fuera de alcance

- Enviar media desde el overlay.
- Responder chats sin sugerencia desde el overlay.
- macOS o Linux.
- Que el overlay arranque o reinicie la sesión de Claude.
