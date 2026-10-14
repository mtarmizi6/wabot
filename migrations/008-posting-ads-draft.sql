CREATE TABLE postings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('SENDIRI','CLIENT')),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 120),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','READY')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ready_at TEXT
) STRICT;

CREATE UNIQUE INDEX one_active_posting_draft
ON postings(status)
WHERE status = 'DRAFT';

CREATE TABLE posting_ads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  posting_id INTEGER NOT NULL REFERENCES postings(id) ON DELETE CASCADE,
  ad_no INTEGER NOT NULL CHECK (ad_no >= 1),
  kind TEXT NOT NULL CHECK (kind IN ('TEXT','PHOTO','VIDEO')),
  body TEXT NOT NULL DEFAULT '',
  media_path TEXT,
  media_mime TEXT,
  media_size INTEGER NOT NULL DEFAULT 0 CHECK (media_size >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(posting_id, ad_no)
) STRICT;

CREATE INDEX posting_ads_posting_idx ON posting_ads(posting_id, ad_no);

CREATE TABLE posting_ad_buttons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ad_id INTEGER NOT NULL REFERENCES posting_ads(id) ON DELETE CASCADE,
  button_no INTEGER NOT NULL CHECK (button_no BETWEEN 1 AND 2),
  label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 64),
  url TEXT NOT NULL CHECK (length(trim(url)) BETWEEN 8 AND 2048),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(ad_id, button_no)
) STRICT;

CREATE INDEX posting_buttons_ad_idx ON posting_ad_buttons(ad_id, button_no);
