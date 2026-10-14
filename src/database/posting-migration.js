// Build 183: retain IDs/history; separate account cursors, uncertain results and UI state.
export const postingMigration = `
ALTER TABLE postings ADD COLUMN client_id INTEGER;
ALTER TABLE postings ADD COLUMN client_name TEXT;
ALTER TABLE posting_campaign_plans ADD COLUMN review_json TEXT;
ALTER TABLE posting_jobs ADD COLUMN unknown_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posting_jobs ADD COLUMN finish_reason TEXT;
ALTER TABLE posting_jobs ADD COLUMN pause_reason TEXT;
ALTER TABLE posting_jobs ADD COLUMN summary_json TEXT;
ALTER TABLE posting_jobs ADD COLUMN flow_version INTEGER NOT NULL DEFAULT 182;
ALTER TABLE posting_job_accounts ADD COLUMN next_ad_no INTEGER NOT NULL DEFAULT 1;
ALTER TABLE posting_job_accounts ADD COLUMN unknown_count INTEGER NOT NULL DEFAULT 0;
UPDATE posting_job_accounts SET next_ad_no=coalesce((SELECT CASE WHEN t.ad_no >=
 (SELECT count(*) FROM posting_job_ads a WHERE a.job_id=t.job_id) THEN 1 ELSE t.ad_no+1 END
 FROM posting_job_attempts t WHERE t.job_id=posting_job_accounts.job_id AND t.account_id=posting_job_accounts.account_id ORDER BY t.id DESC LIMIT 1),1);
ALTER TABLE posting_workers ADD COLUMN wait_kind TEXT;
CREATE TABLE posting_targets_new (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 job_id INTEGER NOT NULL REFERENCES posting_jobs(id) ON DELETE CASCADE,
 position INTEGER NOT NULL, account_id INTEGER NOT NULL, group_jid TEXT NOT NULL, group_name TEXT NOT NULL,
 participant_count INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PROCESSING','SUCCESS','FAILED','UNKNOWN','SKIPPED')),
 ad_no INTEGER, message_id TEXT, error_text TEXT, attempted_at TEXT, completed_at TEXT,
 round_no INTEGER NOT NULL DEFAULT 1, attempt_token TEXT, send_started INTEGER NOT NULL DEFAULT 0,
 UNIQUE(job_id,position), UNIQUE(job_id,account_id,group_jid)
) STRICT;
INSERT INTO posting_targets_new(id,job_id,position,account_id,group_jid,group_name,participant_count,status,ad_no,message_id,error_text,attempted_at,completed_at,round_no,send_started)
 SELECT id,job_id,position,account_id,group_jid,group_name,participant_count,status,ad_no,message_id,error_text,attempted_at,completed_at,round_no,CASE WHEN status='PROCESSING' THEN 1 ELSE 0 END FROM posting_job_targets;
DROP TABLE posting_job_targets;
ALTER TABLE posting_targets_new RENAME TO posting_job_targets;
CREATE INDEX posting_job_targets_status_idx ON posting_job_targets(job_id,status,position);
CREATE INDEX posting_job_targets_account_idx ON posting_job_targets(job_id,account_id,status,position);
CREATE TABLE posting_attempts_new (
 id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER NOT NULL REFERENCES posting_jobs(id) ON DELETE CASCADE,
 target_id INTEGER, account_id INTEGER NOT NULL, round_no INTEGER NOT NULL DEFAULT 1,
 group_jid TEXT NOT NULL, group_name TEXT NOT NULL, ad_no INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('SUCCESS','FAILED','UNKNOWN')),
 message_id TEXT, error_text TEXT, attempted_at TEXT NOT NULL, completed_at TEXT NOT NULL,
 attempt_token TEXT UNIQUE
) STRICT;
INSERT INTO posting_attempts_new(id,job_id,target_id,account_id,round_no,group_jid,group_name,ad_no,status,message_id,error_text,attempted_at,completed_at)
 SELECT id,job_id,target_id,account_id,round_no,group_jid,group_name,ad_no,status,message_id,error_text,attempted_at,completed_at FROM posting_job_attempts;
DROP TABLE posting_job_attempts;
ALTER TABLE posting_attempts_new RENAME TO posting_job_attempts;
CREATE INDEX posting_job_attempts_job_idx ON posting_job_attempts(job_id,id);
CREATE INDEX posting_job_attempts_account_idx ON posting_job_attempts(job_id,account_id,id);
CREATE TABLE posting_dashboards(job_id INTEGER PRIMARY KEY REFERENCES posting_jobs(id) ON DELETE CASCADE,chat_id TEXT NOT NULL,message_id INTEGER,updated_at TEXT,display_number INTEGER);
CREATE TABLE posting_flow_state(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;
`;
