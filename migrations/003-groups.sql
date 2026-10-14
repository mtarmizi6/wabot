ALTER TABLE whatsapp_accounts ADD COLUMN last_group_sync_at TEXT;

CREATE TABLE whatsapp_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
  jid TEXT NOT NULL,
  subject TEXT NOT NULL,
  participant_count INTEGER NOT NULL DEFAULT 0 CHECK (participant_count >= 0),
  is_available INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0,1)),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  UNIQUE(account_id, jid)
) STRICT;

CREATE INDEX idx_whatsapp_groups_account_available
  ON whatsapp_groups(account_id, is_available);
CREATE INDEX idx_whatsapp_groups_subject
  ON whatsapp_groups(account_id, subject COLLATE NOCASE);
