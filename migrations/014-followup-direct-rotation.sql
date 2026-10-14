-- Existing campaigns retain their original sequential-susulan semantics.
-- Only new direct-from-account campaigns use ROTATE (one ad per contact).
ALTER TABLE followup_campaigns ADD COLUMN delivery_mode TEXT NOT NULL DEFAULT 'SEQUENCE'
  CHECK(delivery_mode IN ('SEQUENCE','ROTATE'));
CREATE TABLE followup_rotation_cursor (
  campaign_id INTEGER NOT NULL REFERENCES followup_campaigns(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL,
  next_ad_no INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (campaign_id,account_id)
) STRICT;