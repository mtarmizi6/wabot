import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bytesToHuman,
  storageSnapshot,
  cleanTempCache,
  cleanLogs,
  cleanOrphanPostingMedia,
  cleanManagedStorage
} from '../src/system/storage.js';

function sandbox() {
  return mkdtempSync(join(tmpdir(), 'wapromobot-storage-'));
}

function removeSandbox(path) {
  rmSync(path, { recursive: true, force: true });
}

function createMediaDb(path, refs = []) {
  mkdirSync(join(path, 'data'), { recursive: true });
  const dbPath = join(path, 'data', 'wapromobot.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE posting_ads (id INTEGER PRIMARY KEY, media_path TEXT);
    CREATE TABLE posting_job_ads (id INTEGER PRIMARY KEY, media_path TEXT);
  `);
  const insert = db.prepare('INSERT INTO posting_ads(media_path) VALUES (?)');
  for (const ref of refs) insert.run(ref);
  db.close();
  return dbPath;
}

test('bytesToHuman stays compact across storage units', () => {
  assert.equal(bytesToHuman(0), '0 B');
  assert.equal(bytesToHuman(1024), '1.00 KB');
  assert.equal(bytesToHuman(10 * 1024 * 1024), '10.0 MB');
  assert.equal(bytesToHuman(2 * 1024 * 1024 * 1024), '2.00 GB');
});

test('storageSnapshot measures managed folders without touching WhatsApp sessions', () => {
  const root = sandbox();
  try {
    const dbPath = createMediaDb(root);
    mkdirSync(join(root, 'media', 'postings'), { recursive: true });
    mkdirSync(join(root, 'reports'), { recursive: true });
    mkdirSync(join(root, 'logs'), { recursive: true });
    mkdirSync(join(root, 'temp'), { recursive: true });
    mkdirSync(join(root, 'sessions', 'whatsapp'), { recursive: true });
    writeFileSync(join(root, 'media', 'postings', 'a.bin'), Buffer.alloc(100));
    writeFileSync(join(root, 'reports', 'r.txt'), Buffer.alloc(200));
    writeFileSync(join(root, 'logs', 'x.log'), Buffer.alloc(300));
    writeFileSync(join(root, 'temp', 'x.tmp'), Buffer.alloc(400));
    writeFileSync(join(root, 'sessions', 'whatsapp', 'secret.bin'), Buffer.alloc(100000));

    const snap = storageSnapshot(root, dbPath);
    assert.ok(snap.database > 0);
    assert.equal(snap.media, 100);
    assert.equal(snap.reports, 200);
    assert.equal(snap.logs, 300);
    assert.equal(snap.temp, 400);
    assert.equal(snap.managedTotal, snap.database + 1000);
    assert.ok(snap.deviceFree >= 0);
  } finally {
    removeSandbox(root);
  }
});

test('temp cleanup preserves live controller lock and logs cleanup is isolated', () => {
  const root = sandbox();
  try {
    mkdirSync(join(root, 'temp'), { recursive: true });
    mkdirSync(join(root, 'cache'), { recursive: true });
    mkdirSync(join(root, 'logs'), { recursive: true });
    writeFileSync(join(root, 'temp', 'telegram-controller.lock'), '123');
    writeFileSync(join(root, 'temp', 'old.tmp'), Buffer.alloc(20));
    writeFileSync(join(root, 'cache', 'cache.bin'), Buffer.alloc(30));
    writeFileSync(join(root, 'logs', 'session-warnings.log'), Buffer.alloc(40));

    const temp = cleanTempCache(root);
    assert.equal(temp.files, 2);
    assert.equal(temp.bytes, 50);
    assert.equal(readFileSync(join(root, 'temp', 'telegram-controller.lock'), 'utf8'), '123');
    assert.ok(existsSync(join(root, 'logs', 'session-warnings.log')));

    const logs = cleanLogs(root);
    assert.equal(logs.files, 1);
    assert.equal(logs.bytes, 40);
    assert.equal(existsSync(join(root, 'logs', 'session-warnings.log')), false);
  } finally {
    removeSandbox(root);
  }
});

test('media cleanup removes only old orphan files and preserves referenced/recent media', () => {
  const root = sandbox();
  try {
    const keepRel = 'media/postings/posting-1/keep.jpg';
    const dbPath = createMediaDb(root, [keepRel]);
    const dir = join(root, 'media', 'postings', 'posting-1');
    mkdirSync(dir, { recursive: true });
    const keep = join(dir, 'keep.jpg');
    const orphan = join(dir, 'orphan.jpg');
    const recent = join(dir, 'recent.jpg');
    writeFileSync(keep, Buffer.alloc(11));
    writeFileSync(orphan, Buffer.alloc(22));
    writeFileSync(recent, Buffer.alloc(33));

    const now = Date.now();
    const old = new Date(now - 60 * 60 * 1000);
    utimesSync(keep, old, old);
    utimesSync(orphan, old, old);

    const result = cleanOrphanPostingMedia(root, dbPath, { nowMs: now, minAgeMs: 10 * 60 * 1000 });
    assert.equal(result.files, 1);
    assert.equal(result.bytes, 22);
    assert.equal(result.skippedRecent, 1);
    assert.ok(existsSync(keep));
    assert.equal(existsSync(orphan), false);
    assert.ok(existsSync(recent));
  } finally {
    removeSandbox(root);
  }
});

test('all cleanup combines safe categories and never deletes database or referenced media', () => {
  const root = sandbox();
  try {
    const keepRel = 'media/postings/posting-9/live.mp4';
    const dbPath = createMediaDb(root, [keepRel]);
    const mediaDir = join(root, 'media', 'postings', 'posting-9');
    mkdirSync(mediaDir, { recursive: true });
    const keep = join(mediaDir, 'live.mp4');
    const orphan = join(mediaDir, 'old.tmp');
    writeFileSync(keep, Buffer.alloc(10));
    writeFileSync(orphan, Buffer.alloc(15));
    const old = new Date(Date.now() - 60 * 60 * 1000);
    utimesSync(keep, old, old);
    utimesSync(orphan, old, old);
    mkdirSync(join(root, 'temp'), { recursive: true });
    mkdirSync(join(root, 'logs'), { recursive: true });
    writeFileSync(join(root, 'temp', 'telegram-controller.lock'), '1');
    writeFileSync(join(root, 'temp', 'x.tmp'), Buffer.alloc(5));
    writeFileSync(join(root, 'logs', 'x.log'), Buffer.alloc(6));

    const result = cleanManagedStorage(root, dbPath);
    assert.equal(result.files, 3);
    assert.equal(result.bytes, 26);
    assert.ok(existsSync(dbPath));
    assert.ok(existsSync(keep));
    assert.ok(existsSync(join(root, 'temp', 'telegram-controller.lock')));
    assert.equal(existsSync(orphan), false);
  } finally {
    removeSandbox(root);
  }
});
