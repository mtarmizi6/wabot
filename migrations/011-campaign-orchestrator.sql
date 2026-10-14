CREATE TABLE posting_campaign_plans (
  posting_id INTEGER PRIMARY KEY REFERENCES postings(id) ON DELETE CASCADE,
  target_mode TEXT NOT NULL DEFAULT 'SUCCESS'
    CHECK (target_mode IN ('SUCCESS','DAYS','CONTINUOUS')),
  target_value INTEGER CHECK (target_value IS NULL OR target_value >= 1),
  reuse_mode TEXT NOT NULL DEFAULT 'REPEAT'
    CHECK (reuse_mode IN ('REPEAT','UNIQUE')),
  delay_min_sec INTEGER NOT NULL DEFAULT 60 CHECK (delay_min_sec BETWEEN 10 AND 3600),
  delay_max_sec INTEGER NOT NULL DEFAULT 120 CHECK (delay_max_sec BETWEEN 10 AND 3600),
  batch_size INTEGER NOT NULL DEFAULT 5 CHECK (batch_size BETWEEN 1 AND 100),
  rest_min_sec INTEGER NOT NULL DEFAULT 300 CHECK (rest_min_sec BETWEEN 0 AND 21600),
  rest_max_sec INTEGER NOT NULL DEFAULT 600 CHECK (rest_max_sec BETWEEN 0 AND 21600),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','READY')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

INSERT INTO posting_campaign_plans
  (posting_id, target_mode, target_value, reuse_mode,
   delay_min_sec, delay_max_sec, batch_size, rest_min_sec, rest_max_sec,
   status, created_at, updated_at)
SELECT posting_id, 'SUCCESS', target_value, 'UNIQUE',
       60, 120, 5, 300, 600,
       status, created_at, updated_at
FROM posting_plans;

ALTER TABLE posting_jobs ADD COLUMN target_mode TEXT NOT NULL DEFAULT 'SUCCESS'
  CHECK (target_mode IN ('SUCCESS','DAYS','CONTINUOUS'));
ALTER TABLE posting_jobs ADD COLUMN target_days INTEGER;
ALTER TABLE posting_jobs ADD COLUMN reuse_mode TEXT NOT NULL DEFAULT 'UNIQUE'
  CHECK (reuse_mode IN ('REPEAT','UNIQUE'));
ALTER TABLE posting_jobs ADD COLUMN ends_at TEXT;
ALTER TABLE posting_jobs ADD COLUMN last_claimed_at TEXT;
ALTER TABLE posting_jobs ADD COLUMN next_ad_no INTEGER NOT NULL DEFAULT 1 CHECK (next_ad_no >= 1);
ALTER TABLE posting_jobs ADD COLUMN report_status TEXT NOT NULL DEFAULT 'NONE'
  CHECK (report_status IN ('NONE','PENDING','SENT'));
ALTER TABLE posting_jobs ADD COLUMN report_attempts INTEGER NOT NULL DEFAULT 0 CHECK (report_attempts >= 0);
ALTER TABLE posting_jobs ADD COLUMN report_retry_at TEXT;
ALTER TABLE posting_jobs ADD COLUMN report_filename TEXT;
ALTER TABLE posting_jobs ADD COLUMN report_sent_at TEXT;
ALTER TABLE posting_jobs ADD COLUMN cleanup_at TEXT;
ALTER TABLE posting_jobs ADD COLUMN delete_after_report INTEGER NOT NULL DEFAULT 0 CHECK (delete_after_report IN (0,1));

ALTER TABLE posting_job_accounts ADD COLUMN current_round INTEGER NOT NULL DEFAULT 1 CHECK (current_round >= 1);
ALTER TABLE posting_job_accounts ADD COLUMN round_done INTEGER NOT NULL DEFAULT 0 CHECK (round_done IN (0,1));

ALTER TABLE posting_job_targets ADD COLUMN round_no INTEGER NOT NULL DEFAULT 1 CHECK (round_no >= 1);

CREATE TABLE posting_workers (
  account_id INTEGER PRIMARY KEY,
  available_at TEXT,
  batch_processed INTEGER NOT NULL DEFAULT 0 CHECK (batch_processed >= 0),
  last_job_id INTEGER,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE posting_job_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES posting_jobs(id) ON DELETE CASCADE,
  target_id INTEGER,
  account_id INTEGER NOT NULL,
  round_no INTEGER NOT NULL DEFAULT 1 CHECK (round_no >= 1),
  group_jid TEXT NOT NULL,
  group_name TEXT NOT NULL,
  ad_no INTEGER NOT NULL CHECK (ad_no >= 1),
  status TEXT NOT NULL CHECK (status IN ('SUCCESS','FAILED')),
  message_id TEXT,
  error_text TEXT,
  attempted_at TEXT NOT NULL,
  completed_at TEXT NOT NULL
) STRICT;

CREATE INDEX posting_job_attempts_job_idx
ON posting_job_attempts(job_id, id);
CREATE INDEX posting_job_attempts_account_idx
ON posting_job_attempts(job_id, account_id, id);

CREATE TABLE posting_archives (
  posting_id INTEGER PRIMARY KEY REFERENCES postings(id) ON DELETE CASCADE,
  job_id INTEGER NOT NULL,
  archived_at TEXT NOT NULL
) STRICT;

CREATE INDEX posting_jobs_fair_queue_idx
ON posting_jobs(status, last_claimed_at, id);
