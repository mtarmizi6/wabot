// New tables deliberately leave legacy followup_* records untouched.
export const followupMigration = `
CREATE TABLE fu_jobs (
 id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'DRAFT', data TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX fu_jobs_owner ON fu_jobs(owner,id);
CREATE TABLE fu_targets (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 job_id INTEGER NOT NULL REFERENCES fu_jobs(id) ON DELETE CASCADE,
 phone TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING',
 account_id INTEGER, attempted_at TEXT, finished_at TEXT,
 message_id TEXT, error TEXT,
 UNIQUE(job_id,phone)
) STRICT;
CREATE INDEX fu_targets_pending ON fu_targets(job_id,status,id);
`;
