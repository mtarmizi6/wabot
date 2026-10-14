import test from 'node:test';
import assert from 'node:assert/strict';
import { basename } from 'node:path';
import { databasePath } from '../src/system/paths.js';
import { initializeDatabase } from '../src/database/connection.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('Canonical application database uses current branding', () => {
  assert.equal(basename(databasePath), 'wapromobot.sqlite');
});

test('New installation identity uses current prefix', t => {
  const dir = mkdtempSync(join(tmpdir(), 'wapromobot-branding-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const info = initializeDatabase(join(dir, 'test.sqlite'));
  assert.match(info.installId, /^WAP-[A-F0-9]{16}$/);
});
