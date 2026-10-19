// Helpers compartidos por los tests de integración. No todos se usan en cada
// archivo de test, así que silenciamos los avisos de código muerto.
#![allow(dead_code)]

use rusqlite::{params, Connection};
use std::path::PathBuf;
use tempfile::TempDir;

pub const NOW: i64 = 1_800_000_000_000;
pub const JUAN: &str = "5491111111111@s.whatsapp.net";
pub const ANA: &str = "5492222222222@s.whatsapp.net";

pub struct Fixture {
    pub _dir: TempDir,
    pub path: PathBuf,
}

impl Fixture {
    pub fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("wa.sqlite");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(include_str!("../fixtures/schema.sql"))
            .unwrap();
        conn.execute_batch("PRAGMA journal_mode = WAL;").unwrap();
        Fixture { _dir: dir, path }
    }
    pub fn conn(&self) -> Connection {
        Connection::open(&self.path).unwrap()
    }
    pub fn chat(&self, jid: &str, name: &str) {
        self.conn()
            .execute(
                "INSERT INTO chats (jid, name, is_group) VALUES (?1, ?2, ?3)",
                params![jid, name, jid.ends_with("@g.us") as i64],
            )
            .unwrap();
    }
    pub fn message(&self, jid: &str, id: &str, from_me: bool, text: &str, ts: i64) {
        self.conn()
            .execute(
                "INSERT INTO messages (id, chat_jid, from_me, sender, type, text, ts) VALUES (?1, ?2, ?3, ?4, 'text', ?5, ?6)",
                params![id, jid, from_me as i64, if from_me { None } else { Some(jid) }, text, ts],
            )
            .unwrap();
    }
    pub fn suggestion(
        &self,
        jid: &str,
        last_msg_id: &str,
        category: &str,
        draft: Option<&str>,
        status: &str,
    ) -> i64 {
        let c = self.conn();
        c.execute(
            "INSERT INTO suggestions (chat_jid, chat_name, last_msg_id, last_msg_text, draft, category, status, created_at, updated_at)
             VALUES (?1, 'Juan', ?2, 'hola', ?3, ?4, ?5, ?6, ?6)",
            params![jid, last_msg_id, draft, category, status, NOW - 60_000],
        )
        .unwrap();
        c.last_insert_rowid()
    }
    pub fn daemon(&self, status: &str, heartbeat_at: i64) {
        let c = self.conn();
        c.execute(
            "INSERT OR REPLACE INTO daemon_state (key, value) VALUES ('status', ?1)",
            params![status],
        )
        .unwrap();
        c.execute(
            "INSERT OR REPLACE INTO daemon_state (key, value) VALUES ('heartbeat_at', ?1)",
            params![heartbeat_at.to_string()],
        )
        .unwrap();
    }
    pub fn agent(&self, at: i64) {
        self.conn()
            .execute(
                "INSERT OR REPLACE INTO agent_heartbeat (key, at) VALUES ('loop', ?1)",
                params![at],
            )
            .unwrap();
    }
}
