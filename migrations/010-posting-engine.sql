CREATE TABLE posting_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  posting_id INTEGER NOT NULL REFERENCES postings(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'WAITING'
    CHECK (status IN ('WAITING','RUNNING','PAUSED','STOPPED','COMPLETED')),
  target_success INTEGER NOT NULL CHECK (target_success >= 1),
  success_count INTEGER NOT NULL DEFAULT 0 CHECK (success_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  processed_count INTEGER NOT NULL DEFAULT 0 CHECK (processed_count >= 0),
  delay_min_sec INTEGER NOT NULL DEFAULT 60 CHECK (delay_min_sec BETWEEN 10 AND 3600),
  delay_max_sec INTEGER NOT NULL DEFAULT 120 CHECK (delay_max_sec BETWEEN 10 AND 3600),
  batch_size INTEGER NOT NULL DEFAULT 5 CHECK (batch_size BETWEEN 1 AND 100),
  rest_min_sec INTEGER NOT NULL DEFAULT 300 CHECK (rest_min_sec BETWEEN 0 AND 21600),
  rest_max_sec INTEGER NOT NULL DEFAULT 600 CHECK (rest_max_sec BETWEEN 0 AND 21600),
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX posting_jobs_status_idx ON posting_jobs(status, id DESC);
CREATE INDEX posting_jobs_posting_idx ON posting_jobs(posting_id, id DESC);

CREATE TABLE posting_job_accounts (
  job_id INTEGER NOT NULL REFERENCES posting_jobs(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL,
  account_label TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 1),
  success_count INTEGER NOT NULL DEFAULT 0 CHECK (success_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  processed_count INTEGER NOT NULL DEFAULT 0 CHECK (processed_count >= 0),
  batch_processed INTEGER NOT NULL DEFAULT 0 CHECK (batch_processed >= 0),
  available_at TEXT,
  PRIMARY KEY (job_id, account_id),
  UNIQUE(job_id, position)
) STRICT;

CREATE TABLE posting_job_ads (
  job_id INTEGER NOT NULL REFERENCES posting_jobs(id) ON DELETE CASCADE,
  ad_no INTEGER NOT NULL CHECK (ad_no >= 1),
  kind TEXT NOT NULL CHECK (kind IN ('TEXT','PHOTO','VIDEO')),
  body TEXT NOT NULL,
  media_path TEXT,
  media_mime TEXT,
  media_size INTEGER NOT NULL DEFAULT 0 CHECK (media_size >= 0),
  PRIMARY KEY (job_id, ad_no)
) STRICT;

CREATE TABLE posting_job_buttons (
  job_id INTEGER NOT NULL,
  ad_no INTEGER NOT NULL,
  button_no INTEGER NOT NULL CHECK (button_no BETWEEN 1 AND 2),
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  PRIMARY KEY (job_id, ad_no, button_no),
  FOREIGN KEY (job_id, ad_no) REFERENCES posting_job_ads(job_id, ad_no) ON DELETE CASCADE
) STRICT;

CREATE TABLE posting_job_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES posting_jobs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 1),
  account_id INTEGER NOT NULL,
  group_jid TEXT NOT NULL,
  group_name TEXT NOT NULL,
  participant_count INTEGER NOT NULL DEFAULT 0 CHECK (participant_count >= 0),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','PROCESSING','SUCCESS','FAILED','SKIPPED')),
  ad_no INTEGER,
  message_id TEXT,
  error_text TEXT,
  attempted_at TEXT,
  completed_at TEXT,
  UNIQUE(job_id, position),
  UNIQUE(job_id, group_jid)
) STRICT;

CREATE INDEX posting_job_targets_status_idx
ON posting_job_targets(job_id, status, position);
CREATE INDEX posting_job_targets_account_idx
ON posting_job_targets(job_id, account_id, status, position);
