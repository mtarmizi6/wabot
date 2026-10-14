CREATE TABLE auto_join_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  mode TEXT NOT NULL DEFAULT 'STANDARD' CHECK (mode IN ('STANDARD','CUSTOM')),
  delay_min_sec INTEGER NOT NULL DEFAULT 60 CHECK (delay_min_sec BETWEEN 10 AND 3600),
  delay_max_sec INTEGER NOT NULL DEFAULT 120 CHECK (delay_max_sec BETWEEN 10 AND 3600),
  batch_size INTEGER NOT NULL DEFAULT 5 CHECK (batch_size BETWEEN 1 AND 100),
  rest_min_sec INTEGER NOT NULL DEFAULT 300 CHECK (rest_min_sec BETWEEN 0 AND 21600),
  rest_max_sec INTEGER NOT NULL DEFAULT 600 CHECK (rest_max_sec BETWEEN 0 AND 21600),
  cooldown_every INTEGER NOT NULL DEFAULT 25 CHECK (cooldown_every BETWEEN 1 AND 1000),
  cooldown_sec INTEGER NOT NULL DEFAULT 900 CHECK (cooldown_sec BETWEEN 0 AND 43200),
  updated_at TEXT NOT NULL
) STRICT;

INSERT INTO auto_join_settings
  (id, mode, delay_min_sec, delay_max_sec, batch_size, rest_min_sec, rest_max_sec, cooldown_every, cooldown_sec, updated_at)
VALUES (1, 'STANDARD', 60, 120, 5, 300, 600, 25, 900, CURRENT_TIMESTAMP);
