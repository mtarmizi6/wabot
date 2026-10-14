import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectRoot } from '../src/system/paths.js';

const source = readFileSync(join(projectRoot, 'scripts', 'menu.js'), 'utf8');

test('Control panel cancels an active prompt cleanly on Ctrl+C', () => {
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /rl\.once\('SIGINT', onSigint\)/);
  assert.match(source, /controller\.abort\(\)/);
  assert.match(source, /if \(cancelled\) break;/);
  assert.doesNotMatch(source, /rl\.on\('SIGINT'.*rl\.close/s);
});


test('Controller startup screen is shown before the stable synchronous child lifecycle', () => {
  assert.match(source, /function renderControllerStarting\(\)/);
  assert.match(source, /Controller   ● STARTING/);
  assert.match(source, /const result = run\('scripts\/telegram-controller\.js', \{ WAPROMOBOT_WAKE_LOCK:/);
  assert.match(source, /if \(Number\(result\?\.status \|\| 0\) !== 0\) await pause\(\)/);
});
