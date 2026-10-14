// Additive: historical jobs retain their original sending and billing semantics.
export const clientMigration = `
ALTER TABLE postings ADD COLUMN client_flow_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE postings ADD COLUMN charge_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE postings ADD COLUMN paid_full_at TEXT;
ALTER TABLE postings ADD COLUMN payment_fingerprint TEXT;
ALTER TABLE posting_jobs ADD COLUMN charge_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posting_jobs ADD COLUMN paid_full_at TEXT;
ALTER TABLE posting_jobs ADD COLUMN target_unit TEXT NOT NULL DEFAULT 'SENDS';
UPDATE postings SET client_flow_version=186 WHERE owner_type='CLIENT'
 AND id NOT IN (SELECT posting_id FROM posting_jobs)
 AND id NOT IN (SELECT posting_id FROM posting_archives);
`;
