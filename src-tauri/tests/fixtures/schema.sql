CREATE TABLE agent_heartbeat (
      key TEXT PRIMARY KEY,
      at INTEGER NOT NULL
    );

CREATE TABLE chat_labels (
      chat_jid TEXT NOT NULL,
      label_id TEXT NOT NULL,
      PRIMARY KEY (chat_jid, label_id)
    );

CREATE TABLE chats (
      jid TEXT PRIMARY KEY,
      name TEXT,
      is_group INTEGER NOT NULL DEFAULT 0,
      last_msg_at INTEGER,
      unread INTEGER NOT NULL DEFAULT 0
    );

CREATE TABLE daemon_state (
      key TEXT PRIMARY KEY,
      value TEXT
    );

CREATE TABLE group_members (
      group_jid TEXT NOT NULL,
      member_jid TEXT NOT NULL,
      admin TEXT,
      PRIMARY KEY (group_jid, member_jid)
    );

CREATE TABLE groups (
      jid TEXT PRIMARY KEY,
      subject TEXT,
      description TEXT
    );

CREATE TABLE identities (
      jid TEXT PRIMARY KEY,
      pn TEXT,
      name TEXT,
      name_source TEXT,
      updated_at INTEGER NOT NULL
    );

CREATE TABLE labels (
      id TEXT PRIMARY KEY,
      name TEXT,
      color INTEGER,
      deleted INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );

CREATE TABLE messages (
      id TEXT NOT NULL,
      chat_jid TEXT NOT NULL,
      from_me INTEGER NOT NULL,
      sender TEXT,
      type TEXT NOT NULL,
      text TEXT,
      caption TEXT,
      mime TEXT,
      media_path TEXT,
      media_status TEXT,
      transcript TEXT,
      transcript_status TEXT NOT NULL DEFAULT 'n/a',
      ts INTEGER NOT NULL,
      PRIMARY KEY (chat_jid, id)
    );

CREATE TABLE outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_jid TEXT NOT NULL,
      text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      created_at INTEGER NOT NULL,
      sent_at INTEGER
    , send_at INTEGER, approved_via TEXT NOT NULL DEFAULT 'chat', suggestion_id INTEGER, failed_at INTEGER);

CREATE TABLE suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_jid TEXT NOT NULL,
      last_msg_id TEXT NOT NULL,
      last_msg_text TEXT,
      draft TEXT,
      category TEXT NOT NULL,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      final_text TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    , chat_name TEXT);

CREATE INDEX idx_identities_pn ON identities (pn);

CREATE INDEX idx_messages_chat_ts ON messages (chat_jid, ts);

CREATE UNIQUE INDEX idx_suggestions_one_pending ON suggestions (chat_jid) WHERE status = 'pending';
