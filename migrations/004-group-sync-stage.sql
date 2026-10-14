CREATE TABLE whatsapp_group_sync_stage (
  account_id INTEGER NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  jid TEXT NOT NULL,
  subject TEXT NOT NULL,
  participant_count INTEGER NOT NULL DEFAULT 0 CHECK (participant_count >= 0),
  staged_at TEXT NOT NULL,
  PRIMARY KEY (account_id, run_id, jid)
) STRICT;

CREATE INDEX idx_whatsapp_group_sync_stage_run
  ON whatsapp_group_sync_stage(account_id, run_id);
