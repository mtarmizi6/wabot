import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { initializeDatabase, readDatabaseInfo } from '../src/database/connection.js';

function fixture(t) {
  const folder = mkdtempSync(join(tmpdir(), 'wapromobot-test-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return join(folder, 'test.sqlite');
}

test('Repeated setup preserves installation identity and existing metadata', t => {
  const path = fixture(t);
  const first = initializeDatabase(path);
  const db = new DatabaseSync(path);
  db.prepare('INSERT INTO system_meta VALUES (?, ?)').run('test_data', 'keep');
  assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  db.close();
  assert.deepEqual(initializeDatabase(path), first);
  assert.deepEqual(readDatabaseInfo(path), first);
  const reopened = new DatabaseSync(path);
  assert.equal(reopened.prepare("SELECT value FROM system_meta WHERE key = 'test_data'").get().value, 'keep');
  reopened.close();
});

test('Corrupt file is rejected without replacement', t => {
  const path = fixture(t);
  writeFileSync(path, 'not a sqlite database');
  assert.throws(() => initializeDatabase(path));
  assert.equal(readFileSync(path, 'utf8'), 'not a sqlite database');
});

test('Unknown migration is rejected and retained', t => {
  const path = fixture(t);
  initializeDatabase(path);
  const db = new DatabaseSync(path);
  db.exec("INSERT INTO schema_migrations VALUES (99, 'future', 'later')");
  db.close();
  assert.throws(() => initializeDatabase(path));
  const reopened = new DatabaseSync(path);
  assert.equal(reopened.prepare('SELECT count(*) AS n FROM schema_migrations').get().n, 24);
  reopened.close();
});

test('Doctor read does not create missing database', t => {
  const path = fixture(t);
  assert.throws(() => readDatabaseInfo(path));
  assert.equal(existsSync(path), false);
});


test('Existing schema 1 upgrades to WhatsApp schema without resetting metadata', t => {
  const path = fixture(t);
  const info = initializeDatabase(path);
  const db = new DatabaseSync(path);
  db.prepare('INSERT INTO system_meta VALUES (?, ?)').run('legacy_keep', 'yes');
  db.exec('DROP TABLE personal_chat_sync; DROP TABLE personal_chats; DROP TABLE fu_targets; DROP TABLE fu_jobs; DROP TABLE posting_dashboards; DROP TABLE posting_flow_state; DROP TABLE group_status_targets; DROP TABLE group_status_jobs; DROP TABLE followup_rotation_cursor; DROP TABLE followup_selected_accounts; DROP TABLE followup_attempts; DROP TABLE followup_targets; DROP TABLE followup_buttons; DROP TABLE followup_ads; DROP TABLE followup_workers; DROP TABLE followup_campaigns; DROP TABLE followup_suppression; DROP TABLE contact_list_members; DROP TABLE contact_lists; DROP TABLE contact_candidates; DROP TABLE posting_archives; DROP TABLE posting_job_attempts; DROP TABLE posting_workers; DROP TABLE posting_job_targets; DROP TABLE posting_job_buttons; DROP TABLE posting_job_ads; DROP TABLE posting_job_accounts; DROP TABLE posting_jobs; DROP TABLE posting_campaign_plans; DROP TABLE posting_plan_accounts; DROP TABLE posting_plans; DROP TABLE posting_ad_buttons; DROP TABLE posting_ads; DROP TABLE postings; DROP TABLE auto_join_links; DROP TABLE auto_join_settings; DROP TABLE auto_join_targets; DROP TABLE auto_join_job_accounts; DROP TABLE auto_join_jobs; DROP TABLE whatsapp_group_sync_stage; DROP TABLE whatsapp_groups; DROP TABLE whatsapp_accounts; DELETE FROM schema_migrations WHERE version IN (2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23);');
  db.close();
  const upgraded = initializeDatabase(path);
  assert.equal(upgraded.installId, info.installId);
  assert.equal(upgraded.schemaVersion, 23);
  const reopened = new DatabaseSync(path);
  assert.equal(reopened.prepare("SELECT value FROM system_meta WHERE key = 'legacy_keep'").get().value, 'yes');
  assert.ok(reopened.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='whatsapp_accounts'").get());
  assert.ok(reopened.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='whatsapp_groups'").get());
  assert.ok(reopened.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='postings'").get());
  assert.ok(reopened.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='posting_plans'").get());
  assert.ok(reopened.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='posting_jobs'").get());
  reopened.close();
});
