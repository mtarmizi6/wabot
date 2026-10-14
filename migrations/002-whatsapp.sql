CREATE TABLE whatsapp_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  phone TEXT,
  jid TEXT,
  status TEXT NOT NULL DEFAULT 'OFFLINE' CHECK (status IN ('ONLINE','OFFLINE','CONNECTING','LOGGED_OUT')),
  auth_dir TEXT NOT NULL UNIQUE,
  group_count INTEGER NOT NULL DEFAULT 0 CHECK (group_count >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_connected_at TEXT
) STRICT;

CREATE INDEX idx_whatsapp_accounts_status ON whatsapp_accounts(status);
