use serde::Serialize;

/// Fotografía completa de la base que el frontend lee cada 3 segundos.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub learning_rules: Vec<LearningRuleView>,
    pub pending: Vec<SuggestionView>,
    pub scheduled: Vec<OutboxView>,
    pub failed: Vec<OutboxView>,
    pub health: Health,
    pub read_at: i64,
}

/// Sugerencia pendiente, con el último mensaje entrante posterior si lo hay.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestionView {
    pub id: i64,
    pub chat_jid: String,
    pub chat_name: String,
    pub is_group: bool,
    pub last_msg_text: Option<String>,
    pub draft: Option<String>,
    pub category: String,
    pub note: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    /// Hora del mensaje que contesta la sugerencia (el ancla); es la que muestra la tarjeta.
    pub last_msg_at: Option<i64>,
    pub newer: Option<NewerMessage>,
}

/// Mensaje entrante que llegó después del ancla de la sugerencia.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewerMessage {
    pub id: String,
    pub text: Option<String>,
    pub ts: i64,
}

/// Fila de la bandeja de salida (programada o fallida).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutboxView {
    pub id: i64,
    pub chat_jid: String,
    pub chat_name: String,
    pub text: String,
    pub status: String,
    pub error: Option<String>,
    pub send_at: Option<i64>,
    pub created_at: i64,
    pub failed_at: Option<i64>,
    pub suggestion_id: Option<i64>,
}

/// Salud del daemon de WhatsApp y del loop del agente.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Health {
    pub daemon_status: String,
    pub daemon_healthy: bool,
    pub agent_last_at: Option<i64>,
    pub agent_healthy: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LearningRuleView {
    pub id: i64,
    pub source_suggestion_id: i64,
    pub chat_jid: Option<String>,
    pub scope: String,
    pub rule_text: String,
    pub rationale: String,
    pub created_at: i64,
    pub updated_at: i64,
}
