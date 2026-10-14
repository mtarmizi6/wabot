export const personalChatMigration = `
CREATE TABLE personal_chats (
 account_id INTEGER NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
 jid TEXT NOT NULL, phone TEXT, saved_name TEXT NOT NULL DEFAULT '', profile_name TEXT NOT NULL DEFAULT '',
 has_chat INTEGER NOT NULL DEFAULT 0, excluded INTEGER NOT NULL DEFAULT 0,
 last_chat INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
 PRIMARY KEY(account_id,jid)
) STRICT;
CREATE INDEX personal_chat_phone ON personal_chats(account_id,phone);
CREATE TABLE personal_chat_sync (
 account_id INTEGER PRIMARY KEY REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
 data TEXT NOT NULL
) STRICT;
ALTER TABLE fu_targets ADD COLUMN source_account_id INTEGER;
ALTER TABLE fu_targets ADD COLUMN display_name TEXT NOT NULL DEFAULT '';
CREATE INDEX fu_targets_source ON fu_targets(job_id,status,source_account_id,id);
`;