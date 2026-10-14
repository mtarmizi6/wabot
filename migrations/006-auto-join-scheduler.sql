ALTER TABLE auto_join_jobs ADD COLUMN delay_min_sec INTEGER NOT NULL DEFAULT 60 CHECK (delay_min_sec BETWEEN 10 AND 3600);
ALTER TABLE auto_join_jobs ADD COLUMN delay_max_sec INTEGER NOT NULL DEFAULT 120 CHECK (delay_max_sec BETWEEN 10 AND 3600);
ALTER TABLE auto_join_jobs ADD COLUMN batch_size INTEGER NOT NULL DEFAULT 5 CHECK (batch_size BETWEEN 1 AND 100);
ALTER TABLE auto_join_jobs ADD COLUMN rest_min_sec INTEGER NOT NULL DEFAULT 300 CHECK (rest_min_sec BETWEEN 0 AND 21600);
ALTER TABLE auto_join_jobs ADD COLUMN rest_max_sec INTEGER NOT NULL DEFAULT 600 CHECK (rest_max_sec BETWEEN 0 AND 21600);
ALTER TABLE auto_join_jobs ADD COLUMN cooldown_every INTEGER NOT NULL DEFAULT 25 CHECK (cooldown_every BETWEEN 1 AND 1000);
ALTER TABLE auto_join_jobs ADD COLUMN cooldown_sec INTEGER NOT NULL DEFAULT 900 CHECK (cooldown_sec BETWEEN 0 AND 43200);

ALTER TABLE auto_join_job_accounts ADD COLUMN processed_count INTEGER NOT NULL DEFAULT 0 CHECK (processed_count >= 0);
ALTER TABLE auto_join_job_accounts ADD COLUMN batch_processed INTEGER NOT NULL DEFAULT 0 CHECK (batch_processed >= 0);
ALTER TABLE auto_join_job_accounts ADD COLUMN available_at TEXT;
ALTER TABLE auto_join_job_accounts ADD COLUMN last_delay_sec INTEGER NOT NULL DEFAULT 0 CHECK (last_delay_sec >= 0);
ALTER TABLE auto_join_job_accounts ADD COLUMN last_rest_sec INTEGER NOT NULL DEFAULT 0 CHECK (last_rest_sec >= 0);
