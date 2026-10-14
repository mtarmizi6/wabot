ALTER TABLE followup_attempts ADD COLUMN delivery_status INTEGER NOT NULL DEFAULT 0;
CREATE INDEX followup_message_ack ON followup_attempts(account_id,message_id);
