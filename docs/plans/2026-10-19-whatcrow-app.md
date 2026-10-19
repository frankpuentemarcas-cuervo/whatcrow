# whatcrow, Plan 2: la app de escritorio (Tauri)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una ventana de Windows siempre encima que muestra las sugerencias de respuesta de `wa.sqlite`. Deja enviarlas, programarlas, descartarlas y reintentarlas, y se actualiza sola desde GitHub Releases.

**Architecture:** Tauri 2. El backend en Rust (`rusqlite`) es el único que toca la base y expone comandos chicos y transaccionales. El frontend es TypeScript sin framework: porta el mockup aprobado y lee un `snapshot` cada 3 s. La lógica de UI que se puede probar (pausa, layout, deshacer, id) vive en módulos puros con tests `vitest`. El `.exe` lo compila y firma GitHub Actions.

**Tech Stack:** Tauri 2, Rust (rusqlite con `bundled`, serde, thiserror), TypeScript + Vite, vitest, tauri-plugin-updater / autostart / process, GitHub Actions (`tauri-apps/tauri-action`).

**Spec:** `docs/spec.md` (copia de `C:\dev\whatsapp\docs\superpowers\specs\2026-10-19-whatcrow-overlay-design.md`), diseño en `docs/design/ui-spec.md` y `docs/design/mockup.html`. El backend del repo `whatsapp` ya está en `main` (Plan 1).

## Global Constraints

- La app **nunca** envía por WhatsApp: solo escribe en `outbox` con `approved_via = 'whatcrow'`. El daemon envía.
- La app no crea la base: si el archivo no existe, error visible ("no encuentra la base"). Ruta por defecto: `C:\dev\whatsapp\data\wa.sqlite`.
- Toda escritura va en una transacción `IMMEDIATE`, con la condición de estado en el `WHERE` (por ejemplo `status = 'pending'`). Si afecta 0 filas, error "ya enviada o reemplazada" y no se escribe nada más.
- `PRAGMA busy_timeout = 5000` en cada conexión. La app no cambia `journal_mode` (lo pone el daemon en WAL).
- Ventana: siempre encima, sin decoraciones nativas, 330 × 660 por defecto, mínimo 300 × 360. Paleta, breakpoints y estados: `docs/design/ui-spec.md` (manda sobre este plan en lo visual).
- Textos de UI en español neutro, como en el mockup.
- Deshacer de Enviar y Descartar: **5 s**. Fallidos visibles: **últimos 7 días**. Sin atajo global en v1. (Decisiones por defecto mientras Erick no diga otra cosa.)
- Tests: `cargo test` en `src-tauri/` y `npm test` (vitest) en la raíz. Sin `tauri build` local: el `.exe` sale de CI.
- Commits: Conventional Commits, sin líneas de atribución a IA.
- Sin datos reales en tests ni fixtures: el esquema viene de `src-tauri/tests/fixtures/schema.sql` y los datos se inventan.

## Review Focus

1. **Doble clic o dos ventanas enviando lo mismo:** el segundo `send` sobre la misma sugerencia no inserta nada y devuelve `NotPending`. Test en Task 3.
2. **Sugerencia desactualizada:** llegó un mensaje entrante después de `last_msg_id`. El snapshot la marca `stale` con el texto nuevo. Un mensaje **propio** posterior no la marca. Test en Task 2.
3. **Base inexistente o bloqueada:** `Db::open` sobre una ruta que no existe falla sin crear el archivo. Test en Task 2.
4. **Cancelar un programado cuando el loop ya dejó otra sugerencia para ese chat:** la vieja pasa a `superseded`, no a `pending`, así no se viola el índice único. Test en Task 3.
5. **Datos viejos:** si el último snapshot exitoso tiene más de 10 s, la UI pausa Enviar, Programar, Reintentar y Descartar. Test en Task 6 (`isPaused`).

---

### Task 1 (repo `whatsapp`): guardar el nombre del chat en la sugerencia

El overlay no debe reimplementar la resolución de nombres (agenda > nombre del chat > pushName). `suggest_reply` ya la calcula: se guarda.

**Files:**
- Modify: `C:\dev\whatsapp\src\shared\db.ts` (bloque whatcrow de `migrate`)
- Modify: `C:\dev\whatsapp\src\mcp\suggestions.ts` (`SuggestionInput`, `Suggestion`, `COLUMNS`, `upsertSuggestion`)
- Modify: `C:\dev\whatsapp\src\mcp\tools.ts` (`suggestReply`)
- Test: `C:\dev\whatsapp\tests\mcp\suggestions.test.ts`, `C:\dev\whatsapp\tests\mcp\tools.test.ts`, `C:\dev\whatsapp\tests\shared\db.test.ts`

**Interfaces:**
- Produces: columna `suggestions.chat_name TEXT`; `SuggestionInput.chatName: string | null`; `Suggestion.chatName: string | null`.

- [ ] **Step 1: Tests que fallan**
  - `tests/shared/db.test.ts`: en el test `'suggestions: una sola pending por chat'`, agregar al final:
    ```ts
    const cols = (db.prepare(`PRAGMA table_info(suggestions)`).all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain('chat_name');
    ```
  - `tests/mcp/suggestions.test.ts`: `base` pasa a incluir `chatName: 'Juan'` y la expectativa del primer test incluye `chatName: 'Juan'`.
  - `tests/mcp/tools.test.ts`, en `describe('sugerencias (whatcrow)')`:
    ```ts
    it('suggestReply guarda el nombre resuelto del chat', () => {
      tools.suggestReply({ chat: JUAN, lastMsgId: 'J9', category: 'respuesta', draft: 'ok' });
      expect(parse(tools.listSuggestions({})).data[0]).toMatchObject({ chatName: 'Juan' });
    });
    ```
- [ ] **Step 2:** `npx vitest run tests/shared/db.test.ts tests/mcp/suggestions.test.ts tests/mcp/tools.test.ts`. Esperado: FAIL (no existe `chat_name`).
- [ ] **Step 3: Implementación**
  - `db.ts`: `addColumnIfMissing(db, 'suggestions', 'chat_name', 'TEXT');` después de las columnas de `outbox`.
  - `suggestions.ts`: `chatName: string | null` en `SuggestionInput` y `Suggestion`. `COLUMNS` suma `chat_name AS chatName`. El `INSERT` de `upsertSuggestion` suma `chat_name` con `s.chatName`.
  - `tools.ts` (`suggestReply`): calcular `const head = chatIdentity(createIdentityResolver(deps.db), ref);` antes de `upsertSuggestion` y pasar `chatName: (head.name ?? ref.name) ?? null`. Reusar `head` en la respuesta (`chat: { ...ref, ...head }`).
- [ ] **Step 4:** `npm test && npm run typecheck`. Esperado: todo PASS.
- [ ] **Step 5: Commit** `feat(mcp): store the resolved chat name with each suggestion`

---

### Task 2: proyecto Tauri y lectura de la base (`snapshot`)

**Files:**
- Create (scaffold): `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.ts`, `src-tauri/**` con `npm create tauri-app@latest . -- --template vanilla-ts --manager npm --identifier pe.overskull.whatcrow -y` (si el CLI pregunta, nombre `whatcrow`).
- Create: `src-tauri/src/db.rs`, `src-tauri/src/model.rs`, `src-tauri/tests/fixtures/schema.sql`, `src-tauri/tests/common/mod.rs`, `src-tauri/tests/snapshot.rs`
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`

**Interfaces:**
- Produces (`model.rs`, todos `#[derive(Debug, Clone, Serialize)] #[serde(rename_all = "camelCase")]`):
  ```rust
  pub struct Snapshot { pub pending: Vec<SuggestionView>, pub scheduled: Vec<OutboxView>, pub failed: Vec<OutboxView>, pub health: Health, pub read_at: i64 }
  pub struct SuggestionView { pub id: i64, pub chat_jid: String, pub chat_name: String, pub is_group: bool, pub last_msg_text: Option<String>, pub draft: Option<String>, pub category: String, pub note: Option<String>, pub created_at: i64, pub updated_at: i64, pub newer: Option<NewerMessage> }
  pub struct NewerMessage { pub id: String, pub text: Option<String>, pub ts: i64 }
  pub struct OutboxView { pub id: i64, pub chat_jid: String, pub chat_name: String, pub text: String, pub status: String, pub error: Option<String>, pub send_at: Option<i64>, pub created_at: i64, pub failed_at: Option<i64>, pub suggestion_id: Option<i64> }
  pub struct Health { pub daemon_status: String, pub daemon_healthy: bool, pub agent_last_at: Option<i64>, pub agent_healthy: bool }
  ```
- Produces (`db.rs`): `pub struct Db`, `Db::open(path: &Path) -> Result<Db, DbError>`, `Db::snapshot(&self, now: i64) -> Result<Snapshot, DbError>`, `pub enum DbError` (thiserror: `Missing(PathBuf)`, `Sqlite(#[from] rusqlite::Error)`), constantes `DAEMON_STALE_MS = 120_000`, `AGENT_STALE_MS = 1_200_000`, `FAILED_WINDOW_MS = 604_800_000`.

- [ ] **Step 1: Scaffold y dependencias**
  En `C:\dev\whatcrow` (ya tiene `docs/`):
  ```bash
  npm create tauri-app@latest . -- --template vanilla-ts --manager npm --identifier pe.overskull.whatcrow -y
  npm install
  npm install -D vitest jsdom
  ```
  En `src-tauri/Cargo.toml`, `[dependencies]`: `rusqlite = { version = "0.32", features = ["bundled"] }`, `thiserror = "2"` (serde ya viene). `[dev-dependencies]`: `tempfile = "3"`.
  `package.json` scripts: `"test": "vitest run"`.
  `tauri.conf.json`, ventana principal: `"title": "whatcrow"`, `"width": 330`, `"height": 660`, `"minWidth": 300`, `"minHeight": 360`, `"alwaysOnTop": true`, `"decorations": false`, `"resizable": true`, `"skipTaskbar": false`.
  Copiar `src-tauri/tests/fixtures/schema.sql` desde `docs/design/schema.sql` (ya commiteado: es el esquema real de `wa.sqlite` después del Plan 1 y la Task 1).

- [ ] **Step 2: Helper de tests** `src-tauri/tests/common/mod.rs`:
  ```rust
  use rusqlite::{params, Connection};
  use std::path::PathBuf;
  use tempfile::TempDir;

  pub const NOW: i64 = 1_800_000_000_000;
  pub const JUAN: &str = "5491111111111@s.whatsapp.net";
  pub const ANA: &str = "5492222222222@s.whatsapp.net";

  pub struct Fixture { pub _dir: TempDir, pub path: PathBuf }

  impl Fixture {
      pub fn new() -> Self {
          let dir = tempfile::tempdir().unwrap();
          let path = dir.path().join("wa.sqlite");
          let conn = Connection::open(&path).unwrap();
          conn.execute_batch(include_str!("../fixtures/schema.sql")).unwrap();
          conn.execute_batch("PRAGMA journal_mode = WAL;").unwrap();
          Fixture { _dir: dir, path }
      }
      pub fn conn(&self) -> Connection { Connection::open(&self.path).unwrap() }
      pub fn chat(&self, jid: &str, name: &str) {
          self.conn().execute("INSERT INTO chats (jid, name, is_group) VALUES (?1, ?2, ?3)", params![jid, name, jid.ends_with("@g.us") as i64]).unwrap();
      }
      pub fn message(&self, jid: &str, id: &str, from_me: bool, text: &str, ts: i64) {
          self.conn().execute(
              "INSERT INTO messages (id, chat_jid, from_me, sender, type, text, ts) VALUES (?1, ?2, ?3, ?4, 'text', ?5, ?6)",
              params![id, jid, from_me as i64, if from_me { None } else { Some(jid) }, text, ts],
          ).unwrap();
      }
      pub fn suggestion(&self, jid: &str, last_msg_id: &str, category: &str, draft: Option<&str>, status: &str) -> i64 {
          let c = self.conn();
          c.execute(
              "INSERT INTO suggestions (chat_jid, chat_name, last_msg_id, last_msg_text, draft, category, status, created_at, updated_at)
               VALUES (?1, 'Juan', ?2, 'hola', ?3, ?4, ?5, ?6, ?6)",
              params![jid, last_msg_id, draft, category, status, NOW - 60_000],
          ).unwrap();
          c.last_insert_rowid()
      }
      pub fn daemon(&self, status: &str, heartbeat_at: i64) {
          let c = self.conn();
          c.execute("INSERT OR REPLACE INTO daemon_state (key, value) VALUES ('status', ?1)", params![status]).unwrap();
          c.execute("INSERT OR REPLACE INTO daemon_state (key, value) VALUES ('heartbeat_at', ?1)", params![heartbeat_at.to_string()]).unwrap();
      }
      pub fn agent(&self, at: i64) {
          self.conn().execute("INSERT OR REPLACE INTO agent_heartbeat (key, at) VALUES ('loop', ?1)", params![at]).unwrap();
      }
  }
  ```

- [ ] **Step 3: Tests que fallan** `src-tauri/tests/snapshot.rs`:
  ```rust
  mod common;
  use common::*;
  use whatcrow_lib::db::{Db, DbError};

  #[test]
  fn open_falla_si_la_base_no_existe_y_no_la_crea() {
      let dir = tempfile::tempdir().unwrap();
      let path = dir.path().join("no-existe.sqlite");
      assert!(matches!(Db::open(&path), Err(DbError::Missing(_))));
      assert!(!path.exists());
  }

  #[test]
  fn snapshot_lista_pendientes_con_nombre_y_sin_newer() {
      let f = Fixture::new();
      f.chat(JUAN, "Juan");
      f.message(JUAN, "J1", false, "¿venís?", NOW - 120_000);
      let id = f.suggestion(JUAN, "J1", "respuesta", Some("Sí"), "pending");
      f.suggestion(ANA, "A1", "respuesta", Some("x"), "sent");
      let s = Db::open(&f.path).unwrap().snapshot(NOW).unwrap();
      assert_eq!(s.pending.len(), 1);
      let p = &s.pending[0];
      assert_eq!((p.id, p.chat_name.as_str(), p.is_group, p.draft.as_deref()), (id, "Juan", false, Some("Sí")));
      assert!(p.newer.is_none());
      assert_eq!(s.read_at, NOW);
  }

  #[test]
  fn snapshot_marca_newer_solo_con_un_mensaje_entrante_posterior() {
      let f = Fixture::new();
      f.message(JUAN, "J1", false, "¿venís?", NOW - 120_000);
      f.suggestion(JUAN, "J1", "respuesta", Some("Sí"), "pending");
      f.message(JUAN, "J2", true, "yo respondí algo", NOW - 60_000);
      assert!(Db::open(&f.path).unwrap().snapshot(NOW).unwrap().pending[0].newer.is_none());
      f.message(JUAN, "J3", false, "¿y entonces?", NOW - 30_000);
      let newer = Db::open(&f.path).unwrap().snapshot(NOW).unwrap().pending[0].newer.clone().unwrap();
      assert_eq!((newer.id.as_str(), newer.text.as_deref()), ("J3", Some("¿y entonces?")));
  }

  #[test]
  fn snapshot_separa_programados_y_fallidos_recientes() {
      let f = Fixture::new();
      let c = f.conn();
      let ins = "INSERT INTO outbox (chat_jid, text, status, created_at, send_at, failed_at, approved_via) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'whatcrow')";
      c.execute(ins, rusqlite::params![JUAN, "luego", "pending", NOW, NOW + 3_600_000, None::<i64>]).unwrap();
      c.execute(ins, rusqlite::params![JUAN, "ya", "pending", NOW, None::<i64>, None::<i64>]).unwrap();
      c.execute(ins, rusqlite::params![JUAN, "falló", "failed", NOW - 1_000, None::<i64>, None::<i64>]).unwrap();
      c.execute(ins, rusqlite::params![JUAN, "venció", "expired", NOW - 9 * 86_400_000, NOW - 9 * 86_400_000, NOW - 60_000]).unwrap();
      c.execute(ins, rusqlite::params![JUAN, "viejo", "failed", NOW - 8 * 86_400_000, None::<i64>, None::<i64>]).unwrap();
      let s = Db::open(&f.path).unwrap().snapshot(NOW).unwrap();
      assert_eq!(s.scheduled.iter().map(|o| o.text.as_str()).collect::<Vec<_>>(), vec!["luego"]);
      // Orden por hora de falla: "falló" (NOW - 1 s) antes que "venció" (failed_at NOW - 60 s); "viejo" queda fuera de los 7 días.
      assert_eq!(s.failed.iter().map(|o| o.text.as_str()).collect::<Vec<_>>(), vec!["falló", "venció"]);
  }

  #[test]
  fn snapshot_calcula_salud_del_daemon_y_del_agente() {
      let f = Fixture::new();
      f.daemon("connected", NOW - 30_000);
      f.agent(NOW - 25 * 60_000);
      let h = Db::open(&f.path).unwrap().snapshot(NOW).unwrap().health;
      assert!(h.daemon_healthy);
      assert!(!h.agent_healthy);
      assert_eq!(h.agent_last_at, Some(NOW - 25 * 60_000));
      f.daemon("connected", NOW - 200_000);
      assert!(!Db::open(&f.path).unwrap().snapshot(NOW).unwrap().health.daemon_healthy);
  }
  ```
  El crate de la librería se llama `whatcrow_lib` (lo define el scaffold en `[lib] name`). Si el scaffold usa otro nombre, ajustar el `use`.

- [ ] **Step 4:** `cd src-tauri && cargo test --test snapshot`. Esperado: FAIL (`could not find db in whatcrow_lib`).

- [ ] **Step 5: Implementación**
  `src-tauri/src/lib.rs`: agregar `pub mod db; pub mod model;` arriba (el resto del scaffold queda).

  `src-tauri/src/model.rs`: las structs de **Interfaces** tal cual, con `use serde::Serialize;`.

  `src-tauri/src/db.rs`:
  ```rust
  use crate::model::*;
  use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
  use std::path::{Path, PathBuf};

  pub const DAEMON_STALE_MS: i64 = 120_000;
  pub const AGENT_STALE_MS: i64 = 1_200_000;
  pub const FAILED_WINDOW_MS: i64 = 604_800_000;

  #[derive(Debug, thiserror::Error)]
  pub enum DbError {
      #[error("no se encuentra la base en {0}")]
      Missing(PathBuf),
      #[error("error de la base: {0}")]
      Sqlite(#[from] rusqlite::Error),
  }

  pub struct Db { pub(crate) conn: Connection }

  impl Db {
      /// Nunca crea la base: la crea y migra el daemon de whatsapp.
      pub fn open(path: &Path) -> Result<Db, DbError> {
          if !path.is_file() { return Err(DbError::Missing(path.to_path_buf())); }
          let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX)?;
          conn.busy_timeout(std::time::Duration::from_millis(5000))?;
          Ok(Db { conn })
      }

      pub fn snapshot(&self, now: i64) -> Result<Snapshot, DbError> {
          Ok(Snapshot {
              pending: self.pending()?,
              scheduled: self.outbox_where("o.status IN ('pending', 'sending') AND o.send_at IS NOT NULL AND o.send_at > ?1", now, "o.send_at ASC")?,
              failed: self.outbox_where("o.status IN ('failed', 'expired') AND COALESCE(o.failed_at, o.created_at) >= ?1", now - FAILED_WINDOW_MS, "COALESCE(o.failed_at, o.created_at) DESC, o.id DESC")?,
              health: self.health(now)?,
              read_at: now,
          })
      }

      fn pending(&self) -> Result<Vec<SuggestionView>, DbError> {
          let mut stmt = self.conn.prepare(
              "SELECT s.id, s.chat_jid, COALESCE(s.chat_name, c.name, s.chat_jid), s.chat_jid LIKE '%@g.us', s.last_msg_text,
                      s.draft, s.category, s.note, s.created_at, s.updated_at, s.last_msg_id
               FROM suggestions s LEFT JOIN chats c ON c.jid = s.chat_jid
               WHERE s.status = 'pending' ORDER BY s.updated_at DESC, s.id DESC",
          )?;
          let rows = stmt.query_map([], |r| {
              Ok((SuggestionView {
                  id: r.get(0)?, chat_jid: r.get(1)?, chat_name: r.get(2)?, is_group: r.get(3)?, last_msg_text: r.get(4)?,
                  draft: r.get(5)?, category: r.get(6)?, note: r.get(7)?, created_at: r.get(8)?, updated_at: r.get(9)?, newer: None,
              }, r.get::<_, String>(10)?))
          })?.collect::<Result<Vec<_>, _>>()?;
          rows.into_iter().map(|(mut v, anchor)| { v.newer = self.newer_than(&v.chat_jid, &anchor)?; Ok(v) }).collect()
      }

      /// Último mensaje ENTRANTE del chat, si no es el ancla de la sugerencia (spec §7, sugerencia desactualizada).
      fn newer_than(&self, chat_jid: &str, anchor: &str) -> Result<Option<NewerMessage>, DbError> {
          let last = self.conn.query_row(
              "SELECT id, COALESCE(text, caption, transcript), ts FROM messages WHERE chat_jid = ?1 AND from_me = 0 ORDER BY ts DESC LIMIT 1",
              params![chat_jid],
              |r| Ok(NewerMessage { id: r.get(0)?, text: r.get(1)?, ts: r.get(2)? }),
          ).optional()?;
          Ok(last.filter(|m| m.id != anchor))
      }

      fn outbox_where(&self, cond: &str, bound: i64, order: &str) -> Result<Vec<OutboxView>, DbError> {
          let sql = format!(
              "SELECT o.id, o.chat_jid, COALESCE(s.chat_name, c.name, o.chat_jid), o.text, o.status, o.error, o.send_at, o.created_at, o.failed_at, o.suggestion_id
               FROM outbox o LEFT JOIN suggestions s ON s.id = o.suggestion_id LEFT JOIN chats c ON c.jid = o.chat_jid
               WHERE {cond} ORDER BY {order} LIMIT 100"
          );
          let mut stmt = self.conn.prepare(&sql)?;
          let rows = stmt.query_map(params![bound], |r| Ok(OutboxView {
              id: r.get(0)?, chat_jid: r.get(1)?, chat_name: r.get(2)?, text: r.get(3)?, status: r.get(4)?, error: r.get(5)?,
              send_at: r.get(6)?, created_at: r.get(7)?, failed_at: r.get(8)?, suggestion_id: r.get(9)?,
          }))?.collect::<Result<Vec<_>, _>>()?;
          Ok(rows)
      }

      fn health(&self, now: i64) -> Result<Health, DbError> {
          let state = |key: &str| -> Result<Option<String>, DbError> {
              Ok(self.conn.query_row("SELECT value FROM daemon_state WHERE key = ?1", params![key], |r| r.get(0)).optional()?)
          };
          let daemon_status = state("status")?.unwrap_or_else(|| "unknown".into());
          let heartbeat = state("heartbeat_at")?.and_then(|v| v.parse::<i64>().ok());
          let agent_last_at: Option<i64> = self.conn.query_row("SELECT at FROM agent_heartbeat WHERE key = 'loop'", [], |r| r.get(0)).optional()?;
          Ok(Health {
              daemon_healthy: daemon_status == "connected" && heartbeat.is_some_and(|h| now - h <= DAEMON_STALE_MS),
              daemon_status,
              agent_healthy: agent_last_at.is_some_and(|a| now - a <= AGENT_STALE_MS),
              agent_last_at,
          })
      }
  }
  ```

- [ ] **Step 6:** `cd src-tauri && cargo test --test snapshot`. Esperado: 5 tests PASS.
- [ ] **Step 7: Commit** `feat: scaffold tauri app and read suggestions snapshot from wa.sqlite`

---

### Task 3: acciones transaccionales (enviar, programar, descartar, cancelar, reintentar)

**Files:**
- Create: `src-tauri/src/actions.rs`, `src-tauri/tests/actions.rs`
- Modify: `src-tauri/src/lib.rs` (`pub mod actions;`)

**Interfaces:**
- Consumes: `Db` (campo `conn`, `pub(crate)`), `Fixture` de los tests.
- Produces (métodos de `Db` en `actions.rs`, mediante `impl Db`):
  - `send(&mut self, suggestion_id: i64, text: &str, now: i64) -> Result<i64, ActionError>` (id de `outbox`)
  - `schedule(&mut self, suggestion_id: i64, text: &str, send_at: i64, now: i64) -> Result<i64, ActionError>`
  - `dismiss(&mut self, suggestion_id: i64, now: i64) -> Result<(), ActionError>`
  - `cancel_scheduled(&mut self, outbox_id: i64, now: i64) -> Result<(), ActionError>`
  - `retry(&mut self, outbox_id: i64, now: i64) -> Result<i64, ActionError>`
  - `pub enum ActionError` (thiserror, `Serialize` como string): `NotPending`, `EmptyText`, `NotSendable`, `PastSchedule`, `NotRetryable`, `Db(#[from] DbError)`, `Sqlite(#[from] rusqlite::Error)`.
  - Estado nuevo de `outbox`: `retried` (la fila fallida que se reintentó; sale de la lista de Fallidos y de `failedLast24h` del MCP, que cuenta solo `failed` y `expired`).

- [ ] **Step 1: Tests que fallan** `src-tauri/tests/actions.rs`:
  ```rust
  mod common;
  use common::*;
  use rusqlite::params;
  use whatcrow_lib::{actions::ActionError, db::Db};

  fn outbox(f: &Fixture) -> Vec<(String, String, String, Option<i64>, Option<i64>)> {
      let c = f.conn();
      let mut s = c.prepare("SELECT chat_jid, text, status || '/' || approved_via, send_at, suggestion_id FROM outbox ORDER BY id").unwrap();
      s.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))).unwrap().map(Result::unwrap).collect()
  }
  fn status(f: &Fixture, id: i64) -> (String, Option<String>) {
      f.conn().query_row("SELECT status, final_text FROM suggestions WHERE id = ?1", params![id], |r| Ok((r.get(0)?, r.get(1)?))).unwrap()
  }

  #[test]
  fn send_encola_el_texto_final_y_marca_sent() {
      let f = Fixture::new();
      let id = f.suggestion(JUAN, "J1", "respuesta", Some("Sí"), "pending");
      let mut db = Db::open(&f.path).unwrap();
      db.send(id, "  Sí, voy mañana ", NOW).unwrap();
      assert_eq!(outbox(&f), vec![(JUAN.into(), "Sí, voy mañana".into(), "pending/whatcrow".into(), None, Some(id))]);
      assert_eq!(status(&f, id), ("sent".into(), Some("Sí, voy mañana".into())));
  }

  #[test]
  fn send_dos_veces_no_duplica() {
      let f = Fixture::new();
      let id = f.suggestion(JUAN, "J1", "respuesta", Some("Sí"), "pending");
      let mut db = Db::open(&f.path).unwrap();
      db.send(id, "Sí", NOW).unwrap();
      assert!(matches!(db.send(id, "Sí", NOW), Err(ActionError::NotPending)));
      assert_eq!(outbox(&f).len(), 1);
  }

  #[test]
  fn send_rechaza_texto_vacio_y_categorias_no_enviables() {
      let f = Fixture::new();
      let r = f.suggestion(JUAN, "J1", "respuesta", Some("Sí"), "pending");
      let t = f.suggestion(ANA, "A1", "tarea", None, "pending");
      let mut db = Db::open(&f.path).unwrap();
      assert!(matches!(db.send(r, "   ", NOW), Err(ActionError::EmptyText)));
      assert!(matches!(db.send(t, "hola", NOW), Err(ActionError::NotSendable)));
      assert!(outbox(&f).is_empty());
      assert_eq!(status(&f, r).0, "pending");
  }

  #[test]
  fn schedule_guarda_send_at_y_rechaza_el_pasado() {
      let f = Fixture::new();
      let id = f.suggestion(JUAN, "J1", "respuesta", Some("Sí"), "pending");
      let mut db = Db::open(&f.path).unwrap();
      assert!(matches!(db.schedule(id, "Sí", NOW - 1, NOW), Err(ActionError::PastSchedule)));
      db.schedule(id, "Sí", NOW + 3_600_000, NOW).unwrap();
      assert_eq!(outbox(&f)[0].3, Some(NOW + 3_600_000));
      assert_eq!(status(&f, id).0, "scheduled");
  }

  #[test]
  fn dismiss_solo_sobre_pending() {
      let f = Fixture::new();
      let id = f.suggestion(JUAN, "J1", "esperando", None, "pending");
      let mut db = Db::open(&f.path).unwrap();
      db.dismiss(id, NOW).unwrap();
      assert_eq!(status(&f, id).0, "dismissed");
      assert!(matches!(db.dismiss(id, NOW), Err(ActionError::NotPending)));
  }

  #[test]
  fn cancel_devuelve_la_sugerencia_a_pending_si_el_chat_no_tiene_otra() {
      let f = Fixture::new();
      let id = f.suggestion(JUAN, "J1", "respuesta", Some("Sí"), "pending");
      let mut db = Db::open(&f.path).unwrap();
      let out = db.schedule(id, "Sí", NOW + 60_000, NOW).unwrap();
      db.cancel_scheduled(out, NOW).unwrap();
      assert_eq!(outbox(&f)[0].2, "cancelled/whatcrow");
      assert_eq!(status(&f, id).0, "pending");
      assert!(matches!(db.cancel_scheduled(out, NOW), Err(ActionError::NotPending)));
  }

  #[test]
  fn cancel_deja_superseded_si_el_loop_ya_dejo_otra_pending() {
      let f = Fixture::new();
      let old = f.suggestion(JUAN, "J1", "respuesta", Some("Sí"), "pending");
      let mut db = Db::open(&f.path).unwrap();
      let out = db.schedule(old, "Sí", NOW + 60_000, NOW).unwrap();
      let newer = f.suggestion(JUAN, "J2", "respuesta", Some("Otra"), "pending");
      db.cancel_scheduled(out, NOW).unwrap();
      assert_eq!(status(&f, old).0, "superseded");
      assert_eq!(status(&f, newer).0, "pending");
  }

  #[test]
  fn retry_reencola_el_mismo_texto_y_saca_la_fila_de_fallidos() {
      let f = Fixture::new();
      f.conn().execute(
          "INSERT INTO outbox (chat_jid, text, status, error, created_at, approved_via, suggestion_id) VALUES (?1, 'hola', 'expired', 'vencido', ?2, 'whatcrow', 7)",
          params![JUAN, NOW - 1000],
      ).unwrap();
      let mut db = Db::open(&f.path).unwrap();
      db.retry(1, NOW).unwrap();
      assert_eq!(outbox(&f), vec![
          (JUAN.into(), "hola".into(), "retried/whatcrow".into(), None, Some(7)),
          (JUAN.into(), "hola".into(), "pending/whatcrow".into(), None, Some(7)),
      ]);
      assert!(matches!(db.retry(1, NOW), Err(ActionError::NotRetryable)));
  }
  ```
- [ ] **Step 2:** `cargo test --test actions`. Esperado: FAIL (`could not find actions`).
- [ ] **Step 3: Implementación** `src-tauri/src/actions.rs`:
  ```rust
  use crate::db::{Db, DbError};
  use rusqlite::{params, OptionalExtension, TransactionBehavior};

  #[derive(Debug, thiserror::Error)]
  pub enum ActionError {
      #[error("ya enviada o reemplazada")]
      NotPending,
      #[error("escribe un mensaje para enviar")]
      EmptyText,
      #[error("esta sugerencia no es una respuesta enviable")]
      NotSendable,
      #[error("la hora programada ya pasó")]
      PastSchedule,
      #[error("este envío ya no se puede reintentar")]
      NotRetryable,
      #[error(transparent)]
      Db(#[from] DbError),
      #[error("error de la base: {0}")]
      Sqlite(#[from] rusqlite::Error),
  }

  impl serde::Serialize for ActionError {
      fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> { s.serialize_str(&self.to_string()) }
  }

  impl Db {
      pub fn send(&mut self, suggestion_id: i64, text: &str, now: i64) -> Result<i64, ActionError> {
          self.enqueue(suggestion_id, text, None, now)
      }

      pub fn schedule(&mut self, suggestion_id: i64, text: &str, send_at: i64, now: i64) -> Result<i64, ActionError> {
          if send_at <= now { return Err(ActionError::PastSchedule); }
          self.enqueue(suggestion_id, text, Some(send_at), now)
      }

      /// Spec §7: UPDATE condicionado + INSERT en una sola transacción; 0 filas = no se inserta nada.
      fn enqueue(&mut self, suggestion_id: i64, text: &str, send_at: Option<i64>, now: i64) -> Result<i64, ActionError> {
          let text = text.trim();
          if text.is_empty() { return Err(ActionError::EmptyText); }
          let tx = self.conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
          let row: Option<(String, String)> = tx.query_row(
              "SELECT chat_jid, category FROM suggestions WHERE id = ?1 AND status = 'pending'", params![suggestion_id],
              |r| Ok((r.get(0)?, r.get(1)?)),
          ).optional()?;
          let (chat_jid, category) = row.ok_or(ActionError::NotPending)?;
          if category != "respuesta" { return Err(ActionError::NotSendable); }
          let next = if send_at.is_some() { "scheduled" } else { "sent" };
          let changed = tx.execute(
              "UPDATE suggestions SET status = ?1, final_text = ?2, updated_at = ?3 WHERE id = ?4 AND status = 'pending'",
              params![next, text, now, suggestion_id],
          )?;
          if changed != 1 { return Err(ActionError::NotPending); }
          tx.execute(
              "INSERT INTO outbox (chat_jid, text, status, created_at, send_at, approved_via, suggestion_id)
               VALUES (?1, ?2, 'pending', ?3, ?4, 'whatcrow', ?5)",
              params![chat_jid, text, now, send_at, suggestion_id],
          )?;
          let id = tx.last_insert_rowid();
          tx.commit()?;
          Ok(id)
      }

      pub fn dismiss(&mut self, suggestion_id: i64, now: i64) -> Result<(), ActionError> {
          let n = self.conn.execute(
              "UPDATE suggestions SET status = 'dismissed', updated_at = ?1 WHERE id = ?2 AND status = 'pending'", params![now, suggestion_id],
          )?;
          if n == 1 { Ok(()) } else { Err(ActionError::NotPending) }
      }

      pub fn cancel_scheduled(&mut self, outbox_id: i64, now: i64) -> Result<(), ActionError> {
          let tx = self.conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
          let suggestion: Option<Option<i64>> = tx.query_row(
              "SELECT suggestion_id FROM outbox WHERE id = ?1 AND status = 'pending' AND send_at IS NOT NULL", params![outbox_id], |r| r.get(0),
          ).optional()?;
          let suggestion = suggestion.ok_or(ActionError::NotPending)?;
          tx.execute("UPDATE outbox SET status = 'cancelled' WHERE id = ?1 AND status = 'pending'", params![outbox_id])?;
          if let Some(sid) = suggestion {
              // Índice único: una sola pending por chat. Si el loop ya dejó otra, la cancelada queda superseded.
              let other: bool = tx.query_row(
                  "SELECT EXISTS (SELECT 1 FROM suggestions WHERE status = 'pending' AND chat_jid = (SELECT chat_jid FROM suggestions WHERE id = ?1))",
                  params![sid], |r| r.get(0),
              )?;
              let back = if other { "superseded" } else { "pending" };
              tx.execute(
                  "UPDATE suggestions SET status = ?1, updated_at = ?2 WHERE id = ?3 AND status = 'scheduled'", params![back, now, sid],
              )?;
          }
          tx.commit()?;
          Ok(())
      }

      pub fn retry(&mut self, outbox_id: i64, now: i64) -> Result<i64, ActionError> {
          let tx = self.conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
          let row: Option<(String, String, Option<i64>)> = tx.query_row(
              "SELECT chat_jid, text, suggestion_id FROM outbox WHERE id = ?1 AND status IN ('failed', 'expired')", params![outbox_id],
              |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
          ).optional()?;
          let (chat_jid, text, suggestion_id) = row.ok_or(ActionError::NotRetryable)?;
          tx.execute("UPDATE outbox SET status = 'retried' WHERE id = ?1", params![outbox_id])?;
          tx.execute(
              "INSERT INTO outbox (chat_jid, text, status, created_at, approved_via, suggestion_id) VALUES (?1, ?2, 'pending', ?3, 'whatcrow', ?4)",
              params![chat_jid, text, now, suggestion_id],
          )?;
          let id = tx.last_insert_rowid();
          tx.commit()?;
          Ok(id)
      }
  }
  ```
- [ ] **Step 4:** `cargo test`. Esperado: snapshot + actions PASS.
- [ ] **Step 5: Commit** `feat: transactional send, schedule, dismiss, cancel and retry`

---

### Task 4: comandos Tauri, configuración, bandeja, autoarranque y updater

**Files:**
- Create: `src-tauri/src/config.rs`, `src-tauri/src/commands.rs`, `src-tauri/tests/config.rs`
- Modify: `src-tauri/src/lib.rs` (`run()`), `src-tauri/capabilities/default.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `package.json`

**Interfaces:**
- Produces (`config.rs`): `#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)] #[serde(rename_all = "camelCase")] pub struct Config { pub db_path: PathBuf, pub window: Option<(f64, f64)> }`, `impl Default` (`db_path = C:\dev\whatsapp\data\wa.sqlite`, `window = None`), `Config::load(dir: &Path) -> Config` (archivo ausente o inválido → default), `Config::save(&self, dir: &Path) -> std::io::Result<()>` (`config.json`).
- Produces (comandos, todos `#[tauri::command]`, `now` = `chrono`-free: `SystemTime::now()` en ms):
  - `snapshot() -> Result<Snapshot, String>`
  - `send(id: i64, text: String) -> Result<i64, ActionError>`
  - `schedule(id: i64, text: String, send_at: i64) -> Result<i64, ActionError>`
  - `dismiss(id: i64) -> Result<(), ActionError>`
  - `cancel_scheduled(id: i64) -> Result<(), ActionError>`
  - `retry(id: i64) -> Result<i64, ActionError>`
  - `get_config() -> Config`, `set_db_path(path: String) -> Result<Config, String>` (reabre la base; si no existe, error y no guarda), `save_window_size(width: f64, height: f64) -> Result<(), String>`
- Estado: `pub struct AppState { pub db: Mutex<Option<Db>>, pub config: Mutex<Config>, pub config_dir: PathBuf }`. La base se abre en el primer comando y se reabre si una operación devolvió `DbError`.

- [ ] **Step 1: Test que falla** `src-tauri/tests/config.rs`:
  ```rust
  use whatcrow_lib::config::Config;

  #[test]
  fn load_sin_archivo_o_invalido_devuelve_default_y_save_persiste() {
      let dir = tempfile::tempdir().unwrap();
      assert_eq!(Config::load(dir.path()), Config::default());
      std::fs::write(dir.path().join("config.json"), "{no es json").unwrap();
      assert_eq!(Config::load(dir.path()), Config::default());
      let c = Config { db_path: "D:/otra/wa.sqlite".into(), window: Some((380.0, 660.0)) };
      c.save(dir.path()).unwrap();
      assert_eq!(Config::load(dir.path()), c);
      assert_eq!(Config::default().db_path, std::path::PathBuf::from(r"C:\dev\whatsapp\data\wa.sqlite"));
  }
  ```
- [ ] **Step 2:** `cargo test --test config`. Esperado: FAIL.
- [ ] **Step 3: `config.rs`** con `serde_json` (`load`: `fs::read_to_string` → `serde_json::from_str` → `unwrap_or_default`; `save`: `create_dir_all` + `fs::write` con `to_string_pretty`).
- [ ] **Step 4:** `cargo test --test config`. Esperado: PASS.
- [ ] **Step 5: Plugins** (cada uno agrega crate, paquete npm y permiso):
  ```bash
  npm run tauri add updater
  npm run tauri add autostart
  npm run tauri add process
  ```
  `Cargo.toml`: `tauri = { version = "2", features = ["tray-icon"] }`.
  `tauri.conf.json`:
  - `"bundle": { "createUpdaterArtifacts": true, "targets": ["nsis"] }`
  - `"plugins": { "updater": { "pubkey": "REEMPLAZAR_EN_TASK_7", "endpoints": ["https://github.com/frankpuentemarcas-cuervo/whatcrow/releases/latest/download/latest.json"], "windows": { "installMode": "passive" } } }`

  (`REEMPLAZAR_EN_TASK_7` es literal y a propósito: la clave pública se genera en la Task 7, fuera del sandbox.)
  `capabilities/default.json` suma: `"core:window:allow-set-size"`, `"core:window:allow-minimize"`, `"core:window:allow-hide"`, `"core:window:allow-show"`, `"core:window:allow-start-dragging"`, `"core:window:allow-inner-size"`, `"autostart:allow-enable"`, `"autostart:allow-disable"`, `"autostart:allow-is-enabled"`, `"updater:default"`, `"process:allow-restart"`.
- [ ] **Step 6: `commands.rs` y `run()`**
  - Cada comando de acción: toma el lock de `db`, abre si es `None`, llama al método de `Db` con `now_ms()`. Si el resultado es `ActionError::Db(_)` o `ActionError::Sqlite(_)`, deja `db = None` para reabrir en el próximo comando.
  - `run()`: `.plugin(tauri_plugin_updater::Builder::new().build())`, `.plugin(tauri_plugin_process::init())`, `.plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))`. En `.setup`: `config_dir = app.path().app_config_dir()`, carga `Config`, si tiene `window` aplica `set_size(LogicalSize)`. Crea un `TrayIconBuilder` con menú "Mostrar" (`show` + `set_focus`) y "Salir" (`app.exit(0)`); clic izquierdo en el ícono muestra la ventana.
  - `.on_window_event`: `CloseRequested` → `api.prevent_close()` + `window.hide()` (la × manda a la bandeja; "Salir" del menú cierra de verdad).
  - Registrar todos los comandos en `invoke_handler`.
- [ ] **Step 7:** `cargo test` (todo) y `cargo check`. Esperado: PASS y sin errores.
- [ ] **Step 8: Commit** `feat: tauri commands, config, tray, autostart and updater wiring`

---

### Task 5: lógica de UI en módulos puros (TypeScript)

**Files:**
- Create: `src/api.ts`, `src/logic/paused.ts`, `src/logic/layout.ts`, `src/logic/undo.ts`, `src/logic/ids.ts`
- Test: `src/logic/*.test.ts`

**Interfaces:**
- `src/api.ts`: tipos espejo de `Snapshot`, `SuggestionView`, `NewerMessage`, `OutboxView`, `Health`, `Config` (camelCase, igual que Rust) y funciones `snapshot()`, `send(id, text)`, `schedule(id, text, sendAt)`, `dismiss(id)`, `cancelScheduled(id)`, `retry(id)`, `getConfig()`, `setDbPath(path)`, `saveWindowSize(w, h)` con `invoke` de `@tauri-apps/api/core` (nombres de comando en snake_case: `cancel_scheduled`, `set_db_path`, `save_window_size`).
- `paused.ts`: `export const PAUSE_AFTER_MS = 10_000; export function isPaused(lastOkAt: number | null, now: number): boolean`
- `layout.ts`: `export type WidthMode = 'narrow' | 'narrow-plus' | 'list-detail' | 'three-col'; export type HeightMode = 'low' | 'medium' | 'tall'; export function widthMode(w: number): WidthMode; export function heightMode(h: number): HeightMode; export const PRESETS = { counter: [184, 48], compact: [330, 440], normal: [330, 660], wide: [760, 660] } as const; export function scheduleAsIcon(cardWidth: number): boolean`
- `undo.ts`: `export const UNDO_MS = 5_000; export class UndoQueue { constructor(setTimer = setTimeout, clearTimer = clearTimeout); start(key: string, commit: () => void): void; cancel(key: string): boolean; cancelAll(): void; pending(key: string): boolean }`
- `ids.ts`: `export function formatId(id: number): string` (`#142`), `export function parseId(text: string): number | null`

- [ ] **Step 1: Tests que fallan**
  ```ts
  // src/logic/paused.test.ts
  import { describe, expect, it } from 'vitest';
  import { isPaused } from './paused';
  describe('isPaused', () => {
    it('pausa sin lectura o con lectura de más de 10 s', () => {
      expect(isPaused(null, 1_000)).toBe(true);
      expect(isPaused(0, 10_000)).toBe(false);
      expect(isPaused(0, 10_001)).toBe(true);
    });
  });

  // src/logic/layout.test.ts
  import { describe, expect, it } from 'vitest';
  import { heightMode, scheduleAsIcon, widthMode } from './layout';
  describe('layout (ui-spec §3.3 y §3.4)', () => {
    it('breakpoints de ancho', () => {
      expect([300, 379, 380, 599, 600, 959, 960].map(widthMode)).toEqual([
        'narrow', 'narrow', 'narrow-plus', 'narrow-plus', 'list-detail', 'list-detail', 'three-col',
      ]);
    });
    it('breakpoints de alto', () => {
      expect([360, 479, 480, 799, 800].map(heightMode)).toEqual(['low', 'low', 'medium', 'medium', 'tall']);
    });
    it('Programar pasa a ícono con tarjeta de menos de 340 px', () => {
      expect([267, 339, 340].map(scheduleAsIcon)).toEqual([true, true, false]);
    });
  });

  // src/logic/undo.test.ts
  import { describe, expect, it, vi } from 'vitest';
  import { UndoQueue, UNDO_MS } from './undo';
  describe('UndoQueue', () => {
    it('confirma a los 5 s salvo que se cancele', () => {
      vi.useFakeTimers();
      const q = new UndoQueue();
      const a = vi.fn(); const b = vi.fn();
      q.start('1', a); q.start('2', b);
      expect(q.cancel('2')).toBe(true);
      vi.advanceTimersByTime(UNDO_MS - 1);
      expect(a).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(a).toHaveBeenCalledOnce();
      expect(b).not.toHaveBeenCalled();
      expect(q.pending('1')).toBe(false);
      vi.useRealTimers();
    });
    it('cancelAll (cierre de ventana) no confirma nada', () => {
      vi.useFakeTimers();
      const q = new UndoQueue(); const a = vi.fn();
      q.start('1', a); q.cancelAll(); vi.advanceTimersByTime(UNDO_MS);
      expect(a).not.toHaveBeenCalled();
      vi.useRealTimers();
    });
    it('start dos veces con la misma clave no duplica', () => {
      vi.useFakeTimers();
      const q = new UndoQueue(); const a = vi.fn();
      q.start('1', a); q.start('1', a); vi.advanceTimersByTime(UNDO_MS);
      expect(a).toHaveBeenCalledOnce();
      vi.useRealTimers();
    });
  });

  // src/logic/ids.test.ts
  import { describe, expect, it } from 'vitest';
  import { formatId, parseId } from './ids';
  describe('ids', () => {
    it('formato corto y parseo tolerante', () => {
      expect(formatId(142)).toBe('#142');
      expect(['#142', '142', ' #142 ', '#x', ''].map(parseId)).toEqual([142, 142, 142, null, null]);
    });
  });
  ```
- [ ] **Step 2:** `npm test`. Esperado: FAIL (módulos inexistentes).
- [ ] **Step 3: Implementación**
  ```ts
  // src/logic/paused.ts
  export const PAUSE_AFTER_MS = 10_000;
  /** ui-spec: con datos de más de 10 s se pausan Enviar, Programar, Reintentar y Descartar. */
  export function isPaused(lastOkAt: number | null, now: number): boolean {
    return lastOkAt === null || now - lastOkAt > PAUSE_AFTER_MS;
  }

  // src/logic/layout.ts
  export type WidthMode = 'narrow' | 'narrow-plus' | 'list-detail' | 'three-col';
  export type HeightMode = 'low' | 'medium' | 'tall';
  export const PRESETS = { counter: [184, 48], compact: [330, 440], normal: [330, 660], wide: [760, 660] } as const;
  export const widthMode = (w: number): WidthMode => (w >= 960 ? 'three-col' : w >= 600 ? 'list-detail' : w >= 380 ? 'narrow-plus' : 'narrow');
  export const heightMode = (h: number): HeightMode => (h >= 800 ? 'tall' : h >= 480 ? 'medium' : 'low');
  export const scheduleAsIcon = (cardWidth: number): boolean => cardWidth < 340;

  // src/logic/undo.ts
  export const UNDO_MS = 5_000;
  type SetT = (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  type ClearT = (t: ReturnType<typeof setTimeout>) => void;
  /** Enviar y Descartar esperan 5 s antes de escribir en la base; cerrar la ventana cancela todo. */
  export class UndoQueue {
    private timers = new Map<string, ReturnType<typeof setTimeout>>();
    constructor(private readonly setTimer: SetT = setTimeout, private readonly clearTimer: ClearT = clearTimeout) {}
    start(key: string, commit: () => void): void {
      if (this.timers.has(key)) return;
      this.timers.set(key, this.setTimer(() => { this.timers.delete(key); commit(); }, UNDO_MS));
    }
    cancel(key: string): boolean {
      const t = this.timers.get(key);
      if (t === undefined) return false;
      this.clearTimer(t);
      this.timers.delete(key);
      return true;
    }
    cancelAll(): void { for (const key of [...this.timers.keys()]) this.cancel(key); }
    pending(key: string): boolean { return this.timers.has(key); }
  }

  // src/logic/ids.ts
  export const formatId = (id: number): string => `#${id}`;
  export function parseId(text: string): number | null {
    const m = /^#?(\d+)$/.exec(text.trim());
    return m ? Number(m[1]) : null;
  }
  ```
  `src/api.ts`: tipos e `invoke` según **Interfaces** (sin lógica).
- [ ] **Step 4:** `npm test`. Esperado: PASS.
- [ ] **Step 5: Commit** `feat: pure UI logic for pause, layout, undo and ids`

---

### Task 6: interfaz (port del mockup aprobado)

`docs/design/mockup.html` es la referencia visual **aprobada por Erick**: se porta, no se rediseña.

**Files:**
- Modify: `index.html`, `src/main.ts`
- Create: `src/styles.css`, `src/render.ts`, `src/fonts/` (Atkinson Hyperlegible Next 400/500/700, `.woff2`, licencia OFL incluida)

**Interfaces:**
- Consumes: todo `src/api.ts` y `src/logic/*` de la Task 5; comandos de la Task 4.

- [ ] **Step 1: Estilos.** Copiar a `src/styles.css` el CSS del mockup completo (tokens verdes de §8.1, breakpoints, container query de la tarjeta, scrollbars, `scrollbar-gutter: stable`). Cambiar la fuente de Google Fonts por `@font-face` locales de `src/fonts/` (la app no depende de la red). Quitar la barra de escenarios del mockup y los estilos que solo usa ella.
- [ ] **Step 2: Estructura.** `index.html` con la anatomía de `ui-spec.md` §4: barra de título propia con `data-tauri-drag-region`, punto de salud, control de tamaño, ⚙, – y ×; banners; pestañas Pendientes / Programados / Fallidos con contador; lista; barra de estado.
- [ ] **Step 3: Render y sondeo** (`src/render.ts`, `src/main.ts`):
  - `snapshot()` al iniciar y cada 3 s. Guardar `lastOkAt = Date.now()` si respondió bien; si falla, conservar los datos anteriores y mostrar el banner que corresponda (`no se encuentra la base` → banner de base; otros errores → banner genérico).
  - Render por diferencia de ids: no reconstruir una tarjeta que se está editando. Si cambió su sugerencia (`id` nuevo para el mismo `chatJid` mientras el editor tiene foco o cambios), mostrar el aviso de §5.4 "Hay una sugerencia nueva" con Ver / Usar la nueva / Seguir con la mía. "Seguir con la mía" deja el texto del usuario y apunta la tarjeta al id nuevo.
  - Si no se estaba editando y llega un id nuevo para el chat, reemplazar y mostrar "Actualizada HH:MM · reemplaza a #viejo" durante 10 s.
  - Banners de salud: `health.daemonHealthy === false` → "WhatsApp no está conectado"; `health.agentHealthy === false` → "El agente no da señales desde HH:MM".
  - `isPaused(lastOkAt, Date.now())` → acciones con `aria-disabled` y tooltip con el motivo (§5.4 "Deshabilitada").
- [ ] **Step 4: Acciones**
  - **Enviar / Enviar igual:** `UndoQueue.start('send:' + id, () => api.send(id, texto))`. Mientras corre, el slot de Enviar muestra la cuenta y "Deshacer" (`Esc`). `newer` presente → "Enviar igual" con contorno naranja y `Ctrl+Shift+Enter`.
  - **Descartar:** igual, con `UndoQueue.start('dismiss:' + id, …)`.
  - **Programar:** selector de §5.8. Llama a `api.schedule(id, texto, sendAtMs)`.
  - **Programados:** Cancelar → `api.cancelScheduled(outboxId)`. **Fallidos:** Reintentar → `api.retry(outboxId)`.
  - Error de una acción → bloque rojo en la tarjeta con el mensaje que devuelve Rust (por ejemplo "ya enviada o reemplazada").
  - Cerrar u ocultar la ventana → `undo.cancelAll()`.
- [ ] **Step 5: `#ID`:** chip con `formatId(id)`. Clic o `C` sobre la tarjeta con foco → `navigator.clipboard.writeText(formatId(id))` y toast "Copiado #142" (`aria-live`).
- [ ] **Step 6: Tamaño.** Control de presets con `PRESETS` y `Ctrl+0..3` (`getCurrentWindow().setSize(new LogicalSize(w, h))`). En `resize`: recalcular `widthMode`/`heightMode` como clases en `<body>` y, con debounce de 500 ms, `api.saveWindowSize`. Contador (184 × 48): píldora con el número de pendientes; clic → vuelve al último tamaño.
- [ ] **Step 7: Ajustes.** Hoja de §5.12: ruta de la base (`setDbPath`, con el error visible si no existe), "Iniciar con Windows" (`@tauri-apps/plugin-autostart` `enable`/`disable`/`isEnabled`), versión actual y **Buscar actualizaciones** (`check()` de `@tauri-apps/plugin-updater`; estados de §5.13: buscando, al día, disponible, descargando con progreso, listo → `relaunch()` de `@tauri-apps/plugin-process`).
- [ ] **Step 8:** `npm test` y `npx tsc --noEmit`. Esperado: PASS y sin errores.
- [ ] **Step 9: Commit** `feat: overlay UI ported from the approved mockup`

---

### Task 7: releases firmados y CI (la hace el orquestador: maneja la clave privada)

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `README.md`
- Modify: `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`)

- [ ] **Step 1: Claves** (en la máquina de Erick, **nunca** en un sandbox ni en el repo):
  ```powershell
  npm run tauri signer generate -- -w "$env:USERPROFILE\.tauri\whatcrow.key"
  ```
  Pide una contraseña. Guardar la clave y la contraseña en el gestor de Erick (**backup obligatorio**: sin ella no se pueden publicar actualizaciones para las instalaciones existentes).
  ```powershell
  gh secret set TAURI_SIGNING_PRIVATE_KEY -R frankpuentemarcas-cuervo/whatcrow < "$env:USERPROFILE\.tauri\whatcrow.key"
  gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD -R frankpuentemarcas-cuervo/whatcrow
  ```
  Pegar el contenido de `whatcrow.key.pub` en `plugins.updater.pubkey`.
- [ ] **Step 2: `ci.yml`**, en cada push y PR: `windows-latest`, `actions/setup-node@v4` (node 22, cache npm), `dtolnay/rust-toolchain@stable`, `swatinem/rust-cache@v2` con `workspaces: src-tauri`, `npm ci`, `npm test`, `npx tsc --noEmit`, `cargo test --manifest-path src-tauri/Cargo.toml`.
- [ ] **Step 3: `release.yml`**, en push de tags `v*`: mismos pasos de setup, `npm ci` y
  ```yaml
  - uses: tauri-apps/tauri-action@v0
    env:
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
    with:
      tagName: ${{ github.ref_name }}
      releaseName: whatcrow ${{ github.ref_name }}
      releaseDraft: false
      includeUpdaterJson: true
  ```
  `permissions: contents: write`.
- [ ] **Step 4: `README.md`**: qué es, requisitos (daemon y loop del repo `whatsapp`), instalar desde Releases, **cómo publicar una versión** (subir la versión en `package.json`, `src-tauri/Cargo.toml` y `src-tauri/tauri.conf.json`; commit; `git tag vX.Y.Z`; `git push --tags`) y dónde está el backup de la clave.
- [ ] **Step 5:** push de `main`, verificar `ci.yml` en verde (`gh run watch`). Tag `v0.1.0`, verificar `release.yml` en verde y que el Release tenga el `.exe` de NSIS, su `.sig` y `latest.json`.
- [ ] **Step 6: Prueba de punta a punta (con Erick)**
  1. Instalar `v0.1.0` desde el Release.
  2. Ver las sugerencias del loop, copiar un `#ID`, editar un borrador y Enviar a un chat de prueba que elija Erick. Verificar que el daemon lo despacha y que en `outbox` queda `approved_via = 'whatcrow'`.
  3. Programar uno a 5 min y Cancelar otro.
  4. Publicar `v0.1.1` (cambio trivial) y usar **Buscar actualizaciones**: se instala sin desinstalar.
- [ ] **Step 7: Commit** `ci: test on every push and publish signed releases with updater manifest`
