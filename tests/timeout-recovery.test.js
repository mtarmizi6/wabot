import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initializeDatabase } from '../src/database/connection.js';
import { createWhatsAppAccount, updateWhatsAppAccount } from '../src/whatsapp/store.js';
import { WhatsAppManager, guardBaileysLoginSuccess } from '../src/whatsapp/manager.js';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function testManager(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wap156-timeout-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const db = join(dir, 'app.sqlite');
  initializeDatabase(db);
  const manager = new WhatsAppManager({ databasePath: db, sessionsPath: join(dir, 'sessions'), ...options });
  t.after(() => manager.stop());
  const account = createWhatsAppAccount(db, { phone: '60123456789' });
  updateWhatsAppAccount(db, account.id, { status: 'OFFLINE', lastConnectedAt: new Date().toISOString() });
  return { db, manager, account: manager.get(account.id) };
}

function fakeLibrary(socket) {
  return {
    default: () => socket,
    useMultiFileAuthState: async () => ({ state: { creds: { registered: true } }, saveCreds: async () => {} }),
    fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 1] }),
    DisconnectReason: { loggedOut: 401 }
  };
}

test('Baileys 6.7.24 async CB:success failure is caught and handed to socket.end', async () => {
  const ws = new EventEmitter();
  const error = Object.assign(new Error('Timed Out'), { output: { statusCode: 408 } });
  const failures = [];
  const ended = [];
  let callbackCalls = 0;
  ws.on('CB:success', async () => { callbackCalls += 1; throw error; });
  const socket = { ws, end: reason => { ended.push(reason); } };
  assert.equal(guardBaileysLoginSuccess(socket, failure => failures.push(failure)), true);
  assert.equal(guardBaileysLoginSuccess(socket), false, 'installing twice must not double-wrap');
  ws.emit('CB:success', { attrs: {} });
  await wait(10);
  assert.equal(callbackCalls, 1);
  assert.deepEqual(failures, [error]);
  assert.deepEqual(ended, [error]);
});

test('non-Baileys/missing transport is left alone', () => {
  assert.equal(guardBaileysLoginSuccess({}), false);
  const ws = new EventEmitter();
  let called = 0;
  ws.on('unrelated', () => called++);
  assert.equal(guardBaileysLoginSuccess({ ws }), false);
  ws.emit('unrelated');
  assert.equal(called, 1);
});

test('408 during Baileys login closes only the failed account and schedules reconnect', async t => {
  const { manager, account } = testManager(t);
  const ws = new EventEmitter();
  const ev = new EventEmitter();
  let ended = 0;
  const socket = {
    ws, ev,
    end(error) {
      ended += 1;
      ev.emit('connection.update', { connection: 'close', lastDisconnect: { error } });
    }
  };
  ws.on('CB:success', async () => { throw Object.assign(new Error('Timed Out'), { output: { statusCode: 408 } }); });
  manager.library = fakeLibrary(socket);
  await manager.connect(account.id);
  ws.emit('CB:success', {});
  await wait(25);
  assert.equal(ended, 1);
  assert.equal(manager.get(account.id).status, 'OFFLINE');
  assert.equal(manager.reconnectTimers.has(account.id), true);
  assert.equal(manager.healthSummary().state, 'RECOVERING');
});

test('established account stalled during CONNECTING is recycled without deleting session', async t => {
  const { manager, account } = testManager(t, { connectWatchdogMs: 35 });
  const ws = new EventEmitter();
  const ev = new EventEmitter();
  let stopped = 0;
  ws.on('CB:success', async () => {});
  manager.library = fakeLibrary({ ws, ev, end: () => { stopped++; } });
  await manager.connect(account.id);
  assert.equal(manager.get(account.id).status, 'CONNECTING');
  await wait(100);
  assert.equal(stopped, 1);
  assert.equal(manager.get(account.id).status, 'OFFLINE');
  assert.equal(manager.reconnectTimers.has(account.id), true);
  assert.equal(manager.get(account.id).lastConnectedAt !== null, true);
});

test('connection.open cancels watchdog: healthy accounts never get recycled', async t => {
  const { manager, account } = testManager(t, { connectWatchdogMs: 40 });
  const ws = new EventEmitter();
  const ev = new EventEmitter();
  let stopped = 0;
  ws.on('CB:success', async () => {});
  const socket = { ws, ev, user: { id: '60123456789@s.whatsapp.net' }, end: () => { stopped++; } };
  manager.library = fakeLibrary(socket);
  await manager.connect(account.id);
  ev.emit('connection.update', { connection: 'open' });
  await wait(110);
  assert.equal(manager.get(account.id).status, 'ONLINE');
  assert.equal(stopped, 0);
  assert.equal(manager.connectionWatchdogs.has(account.id), false);
});

test('watchdog cannot disconnect a superseding socket with a newer token', async t => {
  const { manager, account } = testManager(t, { connectWatchdogMs: 35 });
  const ws = new EventEmitter();
  const ev = new EventEmitter();
  let stopped = 0;
  ws.on('CB:success', async () => {});
  manager.library = fakeLibrary({ ws, ev, end: () => { stopped++; } });
  await manager.connect(account.id);
  manager.invalidateConnection(account.id);
  await wait(90);
  assert.equal(stopped, 0);
  assert.equal(manager.reconnectTimers.size, 0);
});
