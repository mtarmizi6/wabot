import test from 'node:test';
import assert from 'node:assert/strict';
import { progressiveRetryBackoffMs, telegramRetryDelayMs, telegramTransportState, formatUptime, termuxWakeLock } from '../src/system/runtime.js';

test('Telegram retry backoff grows progressively and stays capped', () => {
  assert.equal(progressiveRetryBackoffMs(1, () => 0.5), 2500);
  assert.equal(progressiveRetryBackoffMs(2, () => 0.5), 5000);
  assert.equal(progressiveRetryBackoffMs(3, () => 0.5), 10000);
  assert.equal(progressiveRetryBackoffMs(4, () => 0.5), 30000);
  assert.equal(progressiveRetryBackoffMs(5, () => 0.5), 60000);
  assert.equal(progressiveRetryBackoffMs(99, () => 0.5), 60000);
});

test('Telegram retry backoff jitter remains bounded', () => {
  assert.equal(progressiveRetryBackoffMs(1, () => 0), 2125);
  assert.equal(progressiveRetryBackoffMs(1, () => 1), 2875);
});

test('Uptime formatter is compact and stable', () => {
  assert.equal(formatUptime(0), '00:00:00');
  assert.equal(formatUptime(3723000), '01:02:03');
});

test('Wake lock helper fails safely when command is unavailable', () => {
  const fakeRunner = () => ({ error: new Error('missing'), status: null });
  assert.equal(termuxWakeLock('lock', fakeRunner), false);
  assert.equal(termuxWakeLock('unlock', fakeRunner), false);
});


test('Telegram transport retry uses fast bounded recovery for transient mobile drops', () => {
  assert.equal(telegramRetryDelayMs(1), 1000);
  assert.equal(telegramRetryDelayMs(2), 2000);
  assert.equal(telegramRetryDelayMs(3), 3000);
  assert.equal(telegramRetryDelayMs(4), 5000);
  assert.equal(telegramRetryDelayMs(99), 5000);
});

test('Telegram transport health ignores one isolated poll failure', () => {
  assert.equal(telegramTransportState(0), 'CONNECTED');
  assert.equal(telegramTransportState(1), 'CONNECTED');
  assert.equal(telegramTransportState(2), 'DEGRADED');
  assert.equal(telegramTransportState(3), 'RECONNECTING');
  assert.equal(telegramTransportState(20), 'RECONNECTING');
});
