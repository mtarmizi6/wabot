import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, saveConfig } from '../src/system/config.js';
const valid = { schemaVersion: 1, telegram: { botToken: '123456789:' + 'x'.repeat(35), ownerUserId: '123456789' } };
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'wapromobot-config-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'settings.json');
}
test('Configuration persists with owner-only file permissions', t => {
  const path = fixture(t);
  assert.equal(loadConfig(path), null);
  saveConfig(valid, path);
  assert.deepEqual(loadConfig(path), valid);
  assert.equal(statSync(path).mode & 0o777, 0o600);
});
test('Invalid replacement preserves original settings', t => {
  const path = fixture(t);
  saveConfig(valid, path);
  assert.throws(() => saveConfig({ ...valid, telegram: { ...valid.telegram, ownerUserId: '@name' } }, path));
  assert.deepEqual(loadConfig(path), valid);
});
test('Corrupt settings are not silently overwritten', t => {
  const path = fixture(t);
  writeFileSync(path, '{invalid');
  assert.throws(() => saveConfig(valid, path));
  assert.equal(readFileSync(path, 'utf8'), '{invalid');
});
