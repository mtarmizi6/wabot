ALTER TABLE followup_campaigns ADD COLUMN rest_every INTEGER NOT NULL DEFAULT 20;
ALTER TABLE followup_campaigns ADD COLUMN rest_min_sec INTEGER NOT NULL DEFAULT 600;
ALTER TABLE followup_campaigns ADD COLUMN rest_max_sec INTEGER NOT NULL DEFAULT 1200;
ALTER TABLE followup_workers ADD COLUMN sent_since_rest INTEGER NOT NULL DEFAULT 0;
CREATE TABLE followup_selected_accounts (
 campaign_id INTEGER NOT NULL REFERENCES followup_campaigns(id) ON DELETE CASCADE,
 account_id INTEGER NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
 PRIMARY KEY(campaign_id,account_id)
) STRICT;
