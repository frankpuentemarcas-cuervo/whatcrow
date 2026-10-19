use crate::db::{Db, DbError};
use rusqlite::{OptionalExtension, TransactionBehavior, params};

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
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

impl Db {
    pub fn send(&mut self, suggestion_id: i64, text: &str, now: i64) -> Result<i64, ActionError> {
        self.enqueue(suggestion_id, text, None, now)
    }

    pub fn schedule(
        &mut self,
        suggestion_id: i64,
        text: &str,
        send_at: i64,
        now: i64,
    ) -> Result<i64, ActionError> {
        if send_at <= now {
            return Err(ActionError::PastSchedule);
        }
        self.enqueue(suggestion_id, text, Some(send_at), now)
    }

    /// Spec §7: UPDATE condicionado + INSERT en una sola transacción; 0 filas = no se inserta nada.
    fn enqueue(
        &mut self,
        suggestion_id: i64,
        text: &str,
        send_at: Option<i64>,
        now: i64,
    ) -> Result<i64, ActionError> {
        let text = text.trim();
        if text.is_empty() {
            return Err(ActionError::EmptyText);
        }
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let row: Option<(String, String)> = tx
            .query_row(
                "SELECT chat_jid, category FROM suggestions WHERE id = ?1 AND status = 'pending'",
                params![suggestion_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let (chat_jid, category) = row.ok_or(ActionError::NotPending)?;
        if category != "respuesta" {
            return Err(ActionError::NotSendable);
        }
        let next = if send_at.is_some() {
            "scheduled"
        } else {
            "sent"
        };
        let changed = tx.execute(
            "UPDATE suggestions SET status = ?1, final_text = ?2, updated_at = ?3 WHERE id = ?4 AND status = 'pending'",
            params![next, text, now, suggestion_id],
        )?;
        if changed != 1 {
            return Err(ActionError::NotPending);
        }
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
            "UPDATE suggestions SET status = 'dismissed', updated_at = ?1 WHERE id = ?2 AND status = 'pending'",
            params![now, suggestion_id],
        )?;
        if n == 1 {
            Ok(())
        } else {
            Err(ActionError::NotPending)
        }
    }

    pub fn cancel_scheduled(&mut self, outbox_id: i64, now: i64) -> Result<(), ActionError> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let suggestion: Option<Option<i64>> = tx
            .query_row(
                "SELECT suggestion_id FROM outbox WHERE id = ?1 AND status = 'pending' AND send_at IS NOT NULL",
                params![outbox_id],
                |r| r.get(0),
            )
            .optional()?;
        let suggestion = suggestion.ok_or(ActionError::NotPending)?;
        tx.execute(
            "UPDATE outbox SET status = 'cancelled' WHERE id = ?1 AND status = 'pending'",
            params![outbox_id],
        )?;
        if let Some(sid) = suggestion {
            // Índice único: una sola pending por chat. Si el loop ya dejó otra, la cancelada queda superseded.
            let other: bool = tx.query_row(
                "SELECT EXISTS (SELECT 1 FROM suggestions WHERE status = 'pending' AND chat_jid = (SELECT chat_jid FROM suggestions WHERE id = ?1))",
                params![sid],
                |r| r.get(0),
            )?;
            let back = if other { "superseded" } else { "pending" };
            tx.execute(
                "UPDATE suggestions SET status = ?1, updated_at = ?2 WHERE id = ?3 AND status = 'scheduled'",
                params![back, now, sid],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn retry(&mut self, outbox_id: i64, now: i64) -> Result<i64, ActionError> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let row: Option<(String, String, Option<i64>)> = tx
            .query_row(
                "SELECT chat_jid, text, suggestion_id FROM outbox WHERE id = ?1 AND status IN ('failed', 'expired')",
                params![outbox_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;
        let (chat_jid, text, suggestion_id) = row.ok_or(ActionError::NotRetryable)?;
        tx.execute(
            "UPDATE outbox SET status = 'retried' WHERE id = ?1",
            params![outbox_id],
        )?;
        tx.execute(
            "INSERT INTO outbox (chat_jid, text, status, created_at, approved_via, suggestion_id) VALUES (?1, ?2, 'pending', ?3, 'whatcrow', ?4)",
            params![chat_jid, text, now, suggestion_id],
        )?;
        let id = tx.last_insert_rowid();
        tx.commit()?;
        Ok(id)
    }
}
