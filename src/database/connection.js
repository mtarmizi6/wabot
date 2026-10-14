import { personalChatMigration } from './personal-chat-migration.js';
import { followupMigration } from './followup-migration.js';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, chmodSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { autoJoinMigration } from './auto-join-migration.js';
import { clientMigration } from './client-migration.js';
import { postingMigration } from './posting-migration.js';
import { groupMigration } from './group-migration.js';

const migrations = [
  { version: 1, file: new URL('../../migrations/001-foundation.sql', import.meta.url) },
  { version: 2, file: new URL('../../migrations/002-whatsapp.sql', import.meta.url) },
  { version: 3, file: new URL('../../migrations/003-groups.sql', import.meta.url) },
  { version: 4, file: new URL('../../migrations/004-group-sync-stage.sql', import.meta.url) },
  { version: 5, file: new URL('../../migrations/005-auto-join.sql', import.meta.url) },
  { version: 6, file: new URL('../../migrations/006-auto-join-scheduler.sql', import.meta.url) },
  { version: 7, file: new URL('../../migrations/007-auto-join-settings.sql', import.meta.url) },
  { version: 8, file: new URL('../../migrations/008-posting-ads-draft.sql', import.meta.url) },
  { version: 9, file: new URL('../../migrations/009-posting-plan.sql', import.meta.url) },
  { version: 10, file: new URL('../../migrations/010-posting-engine.sql', import.meta.url) },
  { version: 11, file: new URL('../../migrations/011-campaign-orchestrator.sql', import.meta.url) },
  { version: 12, file: new URL('../../migrations/012-contact-followup.sql', import.meta.url) },
  { version: 13, file: new URL('../../migrations/013-followup-multi-account-rest.sql', import.meta.url) },
  { version: 14, file: new URL('../../migrations/014-followup-direct-rotation.sql', import.meta.url) },
  { version: 15, file: new URL('../../migrations/015-followup-delivery-status.sql', import.meta.url) },
  { version: 16, file: new URL('../../migrations/016-group-status.sql', import.meta.url) },
  { version: 17, sql: "ALTER TABLE whatsapp_accounts ADD COLUMN deleted_at TEXT;\nCREATE INDEX idx_whatsapp_accounts_visible ON whatsapp_accounts(deleted_at, id);\nALTER TABLE posting_campaign_plans ADD COLUMN account_selection_dirty INTEGER NOT NULL DEFAULT 0;\n" },
  { version: 18, sql: autoJoinMigration },
  { version: 19, sql: groupMigration },
  { version: 20, sql: postingMigration },
  { version: 21, sql: clientMigration },
  { version: 22, sql: followupMigration },
  { version: 23, sql: personalChatMigration }
].map(item => {
  const sql = item.sql ?? readFileSync(item.file, 'utf8');
  return { ...item, sql, checksum: createHash('sha256').update(sql).digest('hex') };
});

function verifyKnownMigrations(db, { allowMissing = false } = {}) {
  const rows = db.prepare('SELECT version, checksum FROM schema_migrations ORDER BY version').all();
  const known = new Map(migrations.map(item => [item.version, item.checksum]));
  for (const row of rows) {
    if (!known.has(row.version) || known.get(row.version) !== row.checksum) throw new Error('Unsupported schema');
  }
  if (!allowMissing && rows.length !== migrations.length) throw new Error('Database migration incomplete');
  return rows;
}

export function inspectDatabase(db) {
  if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new Error('Integrity check failed');
  verifyKnownMigrations(db);
  const install = db.prepare("SELECT value FROM system_meta WHERE key = 'install_id'").get();
  if (!install || !/^WAP-[A-F0-9]{16}$/.test(install.value)) throw new Error('Invalid installation');
  return { installId: install.value, schemaVersion: migrations.length };
}

export function initializeDatabase(path) {
  const db = new DatabaseSync(path);
  try {
    chmodSync(path, 0o600);
    db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
    if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new Error('Integrity check failed');
    if (db.prepare('PRAGMA journal_mode = WAL').get().journal_mode !== 'wal') throw new Error('WAL unavailable');
    db.exec('PRAGMA synchronous = FULL; BEGIN IMMEDIATE;');
    try {
      const existing = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
      if (existing.length === 0) {
        db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;');
        const first = migrations[0];
        db.exec(first.sql);
        db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(first.version, first.checksum, new Date().toISOString());
        const insert = db.prepare('INSERT INTO system_meta (key, value) VALUES (?, ?)');
        insert.run('install_id', `WAP-${randomBytes(8).toString('hex').toUpperCase()}`);
        insert.run('created_at', new Date().toISOString());
      }

      const applied = new Set(verifyKnownMigrations(db, { allowMissing: true }).map(row => row.version));
      for (const migration of migrations) {
        if (applied.has(migration.version)) continue;
        db.exec(migration.sql);
        db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(migration.version, migration.checksum, new Date().toISOString());
      }

      const info = inspectDatabase(db);
      db.exec('COMMIT;');
      return info;
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  } finally {
    db.close();
  }
}

export function readDatabaseInfo(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout = 5000;');
    return inspectDatabase(db);
  } finally {
    db.close();
  }
}
