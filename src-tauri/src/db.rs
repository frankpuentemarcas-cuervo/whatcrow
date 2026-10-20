use crate::model::*;
use rusqlite::{Connection, OpenFlags, OptionalExtension, params};
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

pub struct Db {
    pub(crate) conn: Connection,
}

impl Db {
    /// Nunca crea la base: la crea y migra el daemon de whatsapp.
    pub fn open(path: &Path) -> Result<Db, DbError> {
        if !path.is_file() {
            return Err(DbError::Missing(path.to_path_buf()));
        }
        let conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        conn.busy_timeout(std::time::Duration::from_millis(5000))?;
        Ok(Db { conn })
    }

    pub fn snapshot(&self, now: i64) -> Result<Snapshot, DbError> {
        Ok(Snapshot {
            pending: self.pending()?,
            scheduled: self.outbox_where(
                "o.status IN ('pending', 'sending') AND o.send_at IS NOT NULL AND o.send_at > ?1",
                now,
                "o.send_at ASC",
            )?,
            failed: self.outbox_where(
                "o.status IN ('failed', 'expired') AND COALESCE(o.failed_at, o.created_at) >= ?1",
                now - FAILED_WINDOW_MS,
                "COALESCE(o.failed_at, o.created_at) DESC, o.id DESC",
            )?,
            health: self.health(now)?,
            read_at: now,
        })
    }

    fn pending(&self) -> Result<Vec<SuggestionView>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT s.id, s.chat_jid, COALESCE(s.chat_name, c.name, s.chat_jid), s.chat_jid LIKE '%@g.us', s.last_msg_text,
                    s.draft, s.category, s.note, s.created_at, s.updated_at, s.last_msg_id,
                    (SELECT m.ts FROM messages m WHERE m.chat_jid = s.chat_jid AND m.id = s.last_msg_id) AS anchor_ts
             FROM suggestions s LEFT JOIN chats c ON c.jid = s.chat_jid
             WHERE s.status = 'pending'
             -- La conversación más reciente primero (pedido de Erick): último entrante del chat, no la hora de la sugerencia.
             ORDER BY COALESCE((SELECT MAX(m.ts) FROM messages m WHERE m.chat_jid = s.chat_jid AND m.from_me = 0), anchor_ts, s.updated_at) DESC, s.id DESC",
        )?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    SuggestionView {
                        id: r.get(0)?,
                        chat_jid: r.get(1)?,
                        chat_name: r.get(2)?,
                        is_group: r.get(3)?,
                        last_msg_text: r.get(4)?,
                        draft: r.get(5)?,
                        category: r.get(6)?,
                        note: r.get(7)?,
                        created_at: r.get(8)?,
                        updated_at: r.get(9)?,
                        last_msg_at: r.get(11)?,
                        newer: None,
                    },
                    r.get::<_, String>(10)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        rows.into_iter()
            .map(|(mut v, anchor)| {
                v.newer = self.newer_than(&v.chat_jid, &anchor)?;
                Ok(v)
            })
            .collect()
    }

    /// Último mensaje ENTRANTE del chat, si no es el ancla de la sugerencia (spec §7, sugerencia desactualizada).
    fn newer_than(&self, chat_jid: &str, anchor: &str) -> Result<Option<NewerMessage>, DbError> {
        let last = self
            .conn
            .query_row(
                "SELECT id, COALESCE(text, caption, transcript), ts FROM messages WHERE chat_jid = ?1 AND from_me = 0 ORDER BY ts DESC LIMIT 1",
                params![chat_jid],
                |r| {
                    Ok(NewerMessage {
                        id: r.get(0)?,
                        text: r.get(1)?,
                        ts: r.get(2)?,
                    })
                },
            )
            .optional()?;
        Ok(last.filter(|m| m.id != anchor))
    }

    fn outbox_where(
        &self,
        cond: &str,
        bound: i64,
        order: &str,
    ) -> Result<Vec<OutboxView>, DbError> {
        let sql = format!(
            "SELECT o.id, o.chat_jid, COALESCE(s.chat_name, c.name, o.chat_jid), o.text, o.status, o.error, o.send_at, o.created_at, o.failed_at, o.suggestion_id
             FROM outbox o LEFT JOIN suggestions s ON s.id = o.suggestion_id LEFT JOIN chats c ON c.jid = o.chat_jid
             WHERE {cond} ORDER BY {order} LIMIT 100"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt
            .query_map(params![bound], |r| {
                Ok(OutboxView {
                    id: r.get(0)?,
                    chat_jid: r.get(1)?,
                    chat_name: r.get(2)?,
                    text: r.get(3)?,
                    status: r.get(4)?,
                    error: r.get(5)?,
                    send_at: r.get(6)?,
                    created_at: r.get(7)?,
                    failed_at: r.get(8)?,
                    suggestion_id: r.get(9)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    fn health(&self, now: i64) -> Result<Health, DbError> {
        let state = |key: &str| -> Result<Option<String>, DbError> {
            Ok(self
                .conn
                .query_row(
                    "SELECT value FROM daemon_state WHERE key = ?1",
                    params![key],
                    |r| r.get(0),
                )
                .optional()?)
        };
        let daemon_status = state("status")?.unwrap_or_else(|| "unknown".into());
        let heartbeat = state("heartbeat_at")?.and_then(|v| v.parse::<i64>().ok());
        let agent_last_at: Option<i64> = self
            .conn
            .query_row(
                "SELECT at FROM agent_heartbeat WHERE key = 'loop'",
                [],
                |r| r.get(0),
            )
            .optional()?;
        Ok(Health {
            daemon_healthy: daemon_status == "connected"
                && heartbeat.is_some_and(|h| now - h <= DAEMON_STALE_MS),
            daemon_status,
            agent_healthy: agent_last_at.is_some_and(|a| now - a <= AGENT_STALE_MS),
            agent_last_at,
        })
    }
}
