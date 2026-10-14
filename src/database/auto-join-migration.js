// Additive job metadata; preserve historical target IDs and recorded results.
export const autoJoinMigration = `
ALTER TABLE auto_join_jobs ADD COLUMN distribution TEXT NOT NULL DEFAULT 'ROUND_ROBIN';
ALTER TABLE auto_join_jobs ADD COLUMN draft_stage TEXT NOT NULL DEFAULT 'REVIEW';
ALTER TABLE auto_join_jobs ADD COLUMN invalid_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE auto_join_jobs ADD COLUMN setting_draft_json TEXT;
ALTER TABLE auto_join_jobs ADD COLUMN selection_dirty INTEGER NOT NULL DEFAULT 0;
ALTER TABLE auto_join_jobs ADD COLUMN cursor INTEGER NOT NULL DEFAULT 0;
UPDATE auto_join_jobs SET status='STOPPED' WHERE status='DRAFT'
 AND id<>(SELECT max(id) FROM auto_join_jobs WHERE status='DRAFT');
UPDATE auto_join_jobs SET selection_dirty=1,draft_stage='ACCOUNTS' WHERE status='DRAFT' AND NOT EXISTS(SELECT 1 FROM auto_join_job_accounts a JOIN whatsapp_accounts w ON w.id=a.account_id WHERE a.job_id=auto_join_jobs.id AND w.deleted_at IS NULL);
CREATE UNIQUE INDEX idx_auto_join_one_draft ON auto_join_jobs(status) WHERE status='DRAFT';
CREATE TABLE auto_join_targets_next (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 job_id INTEGER NOT NULL REFERENCES auto_join_jobs(id) ON DELETE CASCADE,
 position INTEGER NOT NULL CHECK(position>=1),
 link_position INTEGER NOT NULL CHECK(link_position>=1),
 invite_code TEXT NOT NULL, invite_url TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN
 ('PENDING','PROCESSING','SUCCESS','ALREADY','APPROVAL','FAILED','UNKNOWN','SKIPPED')),
 account_id INTEGER REFERENCES whatsapp_accounts(id) ON DELETE SET NULL,
 group_jid TEXT, group_name TEXT,
 participant_count INTEGER NOT NULL DEFAULT 0,
 error_text TEXT, attempted_at TEXT, completed_at TEXT, dispatched_at TEXT,
 retry_count INTEGER NOT NULL DEFAULT 0,
 schedule_recorded INTEGER NOT NULL DEFAULT 0,
 UNIQUE(job_id,position), UNIQUE(job_id,account_id,invite_code)
) STRICT;
INSERT INTO auto_join_targets_next
 (id,job_id,position,link_position,invite_code,invite_url,status,account_id,
 group_jid,group_name,participant_count,error_text,attempted_at,completed_at,dispatched_at,schedule_recorded)
 SELECT t.id,t.job_id,t.position,t.position,t.invite_code,t.invite_url,t.status,
 coalesce(t.account_id,(SELECT a.account_id FROM auto_join_job_accounts a
  WHERE a.job_id=t.job_id AND a.position=1+((t.position-1) %
    (SELECT count(*) FROM auto_join_job_accounts b WHERE b.job_id=t.job_id)))),
 t.group_jid,t.group_name,t.participant_count,t.error_text,t.attempted_at,t.completed_at,
 CASE WHEN t.status='PROCESSING' THEN coalesce(t.attempted_at,CURRENT_TIMESTAMP) ELSE NULL END,
 CASE WHEN t.status IN ('SUCCESS','FAILED','SKIPPED') THEN 1 ELSE 0 END
 FROM auto_join_targets t;
DROP TABLE auto_join_targets;
ALTER TABLE auto_join_targets_next RENAME TO auto_join_targets;
CREATE INDEX idx_auto_join_targets_job_status ON auto_join_targets(job_id,status,position);
CREATE INDEX idx_auto_join_targets_account ON auto_join_targets(job_id,account_id,status);
CREATE TABLE auto_join_links (
 job_id INTEGER NOT NULL REFERENCES auto_join_jobs(id) ON DELETE CASCADE,
 position INTEGER NOT NULL, invite_code TEXT NOT NULL, invite_url TEXT NOT NULL,
 PRIMARY KEY(job_id,invite_code), UNIQUE(job_id,position)
) STRICT;
INSERT INTO auto_join_links SELECT job_id,min(link_position),invite_code,invite_url
 FROM auto_join_targets GROUP BY job_id,invite_code;
`;
