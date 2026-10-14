CREATE TABLE auto_join_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','RUNNING','PAUSED','STOPPED','COMPLETED')),
  mode TEXT NOT NULL CHECK (mode IN ('single','all')),
  total_input INTEGER NOT NULL DEFAULT 0 CHECK (total_input >= 0),
  valid_count INTEGER NOT NULL DEFAULT 0 CHECK (valid_count >= 0),
  duplicate_count INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  invalid_count INTEGER NOT NULL DEFAULT 0 CHECK (invalid_count >= 0),
  success_count INTEGER NOT NULL DEFAULT 0 CHECK (success_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE auto_join_job_accounts (
  job_id INTEGER NOT NULL REFERENCES auto_join_jobs(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 1),
  PRIMARY KEY (job_id, account_id),
  UNIQUE(job_id, position)
) STRICT;

CREATE TABLE auto_join_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES auto_join_jobs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 1),
  invite_code TEXT NOT NULL,
  invite_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','PROCESSING','SUCCESS','FAILED','SKIPPED')),
  account_id INTEGER REFERENCES whatsapp_accounts(id) ON DELETE SET NULL,
  group_jid TEXT,
  group_name TEXT,
  participant_count INTEGER NOT NULL DEFAULT 0 CHECK (participant_count >= 0),
  error_text TEXT,
  attempted_at TEXT,
  completed_at TEXT,
  UNIQUE(job_id, position),
  UNIQUE(job_id, invite_code)
) STRICT;

CREATE INDEX idx_auto_join_jobs_status ON auto_join_jobs(status, id DESC);
CREATE INDEX idx_auto_join_targets_job_status ON auto_join_targets(job_id, status, position);
