-- Build 175: isolated, one-shot Group Status jobs. Existing posting & join tables untouched.
CREATE TABLE group_status_jobs (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','READY','RUNNING','PAUSED','STOPPED','COMPLETED')),
 kind TEXT CHECK (kind IN ('TEXT','PHOTO','VIDEO')),
 body TEXT NOT NULL DEFAULT '',
 media_path TEXT,
 media_mime TEXT,
 delay_min_sec INTEGER NOT NULL DEFAULT 60,
 delay_max_sec INTEGER NOT NULL DEFAULT 120,
 batch_size INTEGER NOT NULL DEFAULT 25,
 rest_min_sec INTEGER NOT NULL DEFAULT 300,
 rest_max_sec INTEGER NOT NULL DEFAULT 600,
 processed_since_rest INTEGER NOT NULL DEFAULT 0,
 next_run_at TEXT,
 rest_until TEXT,
 selected_accounts TEXT NOT NULL DEFAULT '[]',
 target_mode TEXT NOT NULL DEFAULT 'ALL' CHECK (target_mode IN ('ALL','SELECTED')),
 created_at TEXT NOT NULL,
 started_at TEXT,
 completed_at TEXT,
 updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE group_status_targets (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 job_id INTEGER NOT NULL REFERENCES group_status_jobs(id) ON DELETE CASCADE,
 account_id INTEGER NOT NULL,
 group_jid TEXT NOT NULL,
 group_name TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','IN_FLIGHT','ACCEPTED','SKIPPED','FAILED','UNKNOWN')),
 attempts INTEGER NOT NULL DEFAULT 0,
 message_id TEXT,
 last_error TEXT,
 attempted_at TEXT,
 updated_at TEXT NOT NULL,
 UNIQUE(job_id,account_id,group_jid)
) STRICT;
CREATE INDEX idx_gs_targets_job_status ON group_status_targets(job_id,status,id);
