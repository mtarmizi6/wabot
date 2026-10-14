CREATE TABLE contact_candidates (
  account_id INTEGER NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  jid TEXT NOT NULL,
  name TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(account_id, phone)
) STRICT;

CREATE TABLE contact_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE contact_list_members (
  list_id INTEGER NOT NULL REFERENCES contact_lists(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  phone TEXT NOT NULL,
  name TEXT,
  account_id INTEGER REFERENCES whatsapp_accounts(id) ON DELETE SET NULL,
  PRIMARY KEY(list_id, phone),
  UNIQUE(list_id, position)
) STRICT;

CREATE TABLE followup_suppression (
  phone TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE followup_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id INTEGER NOT NULL REFERENCES contact_lists(id),
  owner_type TEXT NOT NULL CHECK(owner_type IN ('SENDIRI','CLIENT')),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','RUNNING','PAUSED','STOPPED','COMPLETED')),
  delay_min_sec INTEGER NOT NULL DEFAULT 120,
  delay_max_sec INTEGER NOT NULL DEFAULT 300,
  start_hour INTEGER NOT NULL DEFAULT 9,
  end_hour INTEGER NOT NULL DEFAULT 18,
  last_claimed_at TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  report_status TEXT NOT NULL DEFAULT 'NONE',
  summary_json TEXT
) STRICT;
CREATE INDEX followup_campaign_queue ON followup_campaigns(status,last_claimed_at,id);

CREATE TABLE followup_ads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES followup_campaigns(id) ON DELETE CASCADE,
  ad_no INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('TEXT','PHOTO','VIDEO')),
  body TEXT NOT NULL,
  media_path TEXT,
  media_mime TEXT,
  followup_hours INTEGER NOT NULL DEFAULT 48,
  created_at TEXT NOT NULL,
  UNIQUE(campaign_id,ad_no)
) STRICT;
CREATE TABLE followup_buttons (
  ad_id INTEGER NOT NULL REFERENCES followup_ads(id) ON DELETE CASCADE,
  button_no INTEGER NOT NULL CHECK(button_no IN (1,2)),
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  PRIMARY KEY(ad_id,button_no)
) STRICT;

CREATE TABLE followup_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES followup_campaigns(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  phone TEXT NOT NULL,
  name TEXT,
  account_id INTEGER REFERENCES whatsapp_accounts(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PROCESSING','REPLIED','COMPLETED','FAILED','STOPPED','UNCERTAIN')),
  next_ad_no INTEGER NOT NULL DEFAULT 1,
  next_at TEXT NOT NULL,
  last_sent_at TEXT,
  sent_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  UNIQUE(campaign_id,phone)
) STRICT;
CREATE INDEX followup_due ON followup_targets(account_id,status,next_at,campaign_id);

CREATE TABLE followup_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES followup_campaigns(id) ON DELETE CASCADE,
  target_id INTEGER NOT NULL REFERENCES followup_targets(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL,
  ad_no INTEGER NOT NULL,
  status TEXT NOT NULL,
  message_id TEXT,
  error_text TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE followup_workers (
  account_id INTEGER PRIMARY KEY REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
  available_at TEXT
) STRICT;
