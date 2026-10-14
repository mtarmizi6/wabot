CREATE TABLE posting_plans (
  posting_id INTEGER PRIMARY KEY REFERENCES postings(id) ON DELETE CASCADE,
  target_mode TEXT NOT NULL DEFAULT 'SUCCESS' CHECK (target_mode IN ('SUCCESS')),
  target_value INTEGER CHECK (target_value IS NULL OR target_value >= 1),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','READY')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE posting_plan_accounts (
  posting_id INTEGER NOT NULL REFERENCES postings(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL,
  account_label TEXT NOT NULL,
  phone_snapshot TEXT,
  group_count_snapshot INTEGER NOT NULL DEFAULT 0 CHECK (group_count_snapshot >= 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (posting_id, account_id)
) STRICT;

CREATE INDEX posting_plan_accounts_posting_idx
ON posting_plan_accounts(posting_id, account_id);
