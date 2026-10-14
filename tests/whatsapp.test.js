import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeDatabase } from '../src/database/connection.js';
import {
  createWhatsAppAccount, listWhatsAppAccounts, listAllWhatsAppAccounts,
  updateWhatsAppAccount, deleteWhatsAppAccount, deletePendingWhatsAppAccount,
  whatsappAccountSummary, syncWhatsAppGroups, listWhatsAppGroups, getWhatsAppGroupByPosition,
  beginWhatsAppGroupSync, stageWhatsAppGroupBatch, finalizeWhatsAppGroupSync, abortWhatsAppGroupSync,
  getWhatsAppAutoMarkRead, setWhatsAppAutoMarkRead
} from '../src/whatsapp/store.js';
import { normalizePhone, shouldIgnoreIncomingJid } from '../src/whatsapp/manager.js';

function fixture(t) {
  const folder = mkdtempSync(join(tmpdir(), 'wapromobot-wa-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const db = join(folder, 'app.sqlite');
  initializeDatabase(db);
  return db;
}

test('Pending first-login accounts stay hidden until WhatsApp is ONLINE', t => {
  const db = fixture(t);
  const pending = createWhatsAppAccount(db, { phone: '60111111111' });

  assert.equal(listAllWhatsAppAccounts(db).length, 1);
  assert.equal(listWhatsAppAccounts(db).length, 0);
  assert.deepEqual(whatsappAccountSummary(db), { total: 0, connected: 0, groups: 0 });

  updateWhatsAppAccount(db, pending.id, {
    status: 'ONLINE',
    groupCount: 12,
    lastConnectedAt: new Date().toISOString()
  });

  assert.equal(listWhatsAppAccounts(db).length, 1);
  assert.deepEqual(whatsappAccountSummary(db), { total: 1, connected: 1, groups: 12 });
});

test('Failed pending login is removed without consuming the next account number', t => {
  const db = fixture(t);
  const firstTry = createWhatsAppAccount(db, { phone: '60111111111' });
  assert.equal(firstTry.label, 'Akaun 1');
  assert.equal(deletePendingWhatsAppAccount(db, firstTry.id), true);

  const retry = createWhatsAppAccount(db, { phone: '60122222222' });
  assert.notEqual(retry.id, firstTry.id);
  updateWhatsAppAccount(db,retry.id,{status:'ONLINE',lastConnectedAt:new Date().toISOString()});
  assert.equal(listWhatsAppAccounts(db)[0].displayNumber, 1);
});

test('Deleted display numbers close up while internal IDs are never reused', t => {
  const db = fixture(t);
  const first = createWhatsAppAccount(db, { phone: '60111111111' });
  updateWhatsAppAccount(db, first.id, { status: 'ONLINE', lastConnectedAt: new Date().toISOString() });
  const second = createWhatsAppAccount(db, { phone: '60122222222' });
  updateWhatsAppAccount(db, second.id, { status: 'ONLINE', lastConnectedAt: new Date().toISOString() });

  assert.equal(first.label, 'Akaun 1');
  assert.equal(second.label, 'Akaun 2');
  assert.equal(deleteWhatsAppAccount(db, first.id), true);

  const third = createWhatsAppAccount(db, { phone: '60133333333' });
  assert.equal(third.id, 3);
  updateWhatsAppAccount(db,third.id,{status:'ONLINE',lastConnectedAt:new Date().toISOString()});
  assert.deepEqual(listWhatsAppAccounts(db).map(a=>[a.id,a.displayNumber]), [[second.id,1],[third.id,2]]);
});

test('Phone normalization accepts country-code numbers and rejects short input', () => {
  assert.equal(normalizePhone('+60 12-345 6789'), '60123456789');
  assert.throws(() => normalizePhone('123'));
});


test('Logged-out slot remains occupied until user replaces or deletes it', t => {
  const db = fixture(t);
  const first = createWhatsAppAccount(db, { phone: '60111111111' });
  updateWhatsAppAccount(db, first.id, { status: 'ONLINE', lastConnectedAt: new Date().toISOString() });
  updateWhatsAppAccount(db, first.id, { status: 'LOGGED_OUT' });

  const second = createWhatsAppAccount(db, { phone: '60122222222' });
  assert.equal(second.label, 'Akaun 2');
});

test('Pairing code is requested only after WhatsApp emits QR/ref readiness', async t => {
  const folder = mkdtempSync(join(tmpdir(), 'wapromobot-wa-manager-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const db = join(folder, 'app.sqlite');
  const sessions = join(folder, 'sessions');
  initializeDatabase(db);

  const { EventEmitter } = await import('node:events');
  const { WhatsAppManager } = await import('../src/whatsapp/manager.js');
  const manager = new WhatsAppManager({ databasePath: db, sessionsPath: sessions });
  t.after(() => manager.stop());

  let requestCount = 0;
  let fakeSocket;
  manager.library = {
    default: () => {
      const ev = new EventEmitter();
      fakeSocket = {
        ev,
        user: null,
        requestPairingCode: async () => { requestCount += 1; return 'ABCD1234'; },
        end: () => {}
      };
      return fakeSocket;
    },
    useMultiFileAuthState: async () => ({ state: { creds: { registered: false } }, saveCreds: async () => {} }),
    fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 1], isLatest: true }),
    DisconnectReason: { loggedOut: 401 }
  };

  const pairing = manager.createPairing('60123456789');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requestCount, 0);

  fakeSocket.ev.emit('connection.update', { connection: 'connecting' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requestCount, 0);

  fakeSocket.ev.emit('connection.update', { qr: 'ready-ref' });
  await pairing;
  assert.equal(requestCount, 1);
  assert.equal(listWhatsAppAccounts(db).length, 0);

  fakeSocket.user = { id: '60123456789:1@s.whatsapp.net' };
  fakeSocket.ev.emit('connection.update', { connection: 'open' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(listWhatsAppAccounts(db).length, 1);
  assert.equal(listWhatsAppAccounts(db)[0].label, 'Akaun 1');
});


test('Registered pairing restart is preserved instead of deleting the pending slot', async t => {
  const folder = mkdtempSync(join(tmpdir(), 'wapromobot-wa-restart-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const db = join(folder, 'app.sqlite');
  const sessions = join(folder, 'sessions');
  initializeDatabase(db);

  const { EventEmitter } = await import('node:events');
  const { WhatsAppManager } = await import('../src/whatsapp/manager.js');
  const manager = new WhatsAppManager({ databasePath: db, sessionsPath: sessions });
  t.after(() => manager.stop());

  const creds = { registered: false };
  let fakeSocket;
  manager.library = {
    default: () => {
      const ev = new EventEmitter();
      fakeSocket = {
        ev,
        user: null,
        requestPairingCode: async () => 'ZXCV1234',
        end: () => {}
      };
      return fakeSocket;
    },
    useMultiFileAuthState: async () => ({ state: { creds }, saveCreds: async () => {} }),
    fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 1], isLatest: true }),
    DisconnectReason: { loggedOut: 401 }
  };

  const pairing = manager.createPairing('60123456789');
  await new Promise(resolve => setImmediate(resolve));
  fakeSocket.ev.emit('connection.update', { qr: 'ready-ref' });
  await pairing;

  creds.registered = true;
  fakeSocket.ev.emit('connection.update', {
    connection: 'close',
    lastDisconnect: { error: { output: { statusCode: 515 } } }
  });
  await new Promise(resolve => setImmediate(resolve));

  const all = listAllWhatsAppAccounts(db);
  assert.equal(all.length, 1);
  assert.equal(all[0].label, 'Akaun 1');
  assert.equal(all[0].status, 'CONNECTING');
  assert.equal(listWhatsAppAccounts(db).length, 0);
});


test('Group sync stores metadata, updates counts and marks missing groups unavailable', t => {
  const db = fixture(t);
  const account = createWhatsAppAccount(db, { phone: '60111111111' });
  updateWhatsAppAccount(db, account.id, { status: 'ONLINE', lastConnectedAt: new Date().toISOString() });

  const first = syncWhatsAppGroups(db, account.id, [
    { jid: '111@g.us', subject: 'Bazar Utara', participantCount: 120 },
    { jid: '222@g.us', subject: 'Marketplace Malaysia', participantCount: 450 }
  ]);
  assert.equal(first.before, 0);
  assert.equal(first.detected, 2);
  assert.equal(first.newCount, 2);
  assert.equal(first.account.groupCount, 2);

  const page = listWhatsAppGroups(db, account.id, { page: 1 });
  assert.equal(page.total, 2);
  assert.equal(page.items[0].subject, 'Bazar Utara');
  assert.equal(getWhatsAppGroupByPosition(db, account.id, 2).subject, 'Marketplace Malaysia');

  const second = syncWhatsAppGroups(db, account.id, [
    { jid: '222@g.us', subject: 'Marketplace Malaysia', participantCount: 460 },
    { jid: '333@g.us', subject: 'Usahawan Kedah', participantCount: 90 }
  ]);
  assert.equal(second.before, 2);
  assert.equal(second.detected, 2);
  assert.equal(second.newCount, 1);
  assert.equal(second.removedCount, 1);
  assert.equal(listWhatsAppGroups(db, account.id).total, 2);
  assert.equal(listWhatsAppGroups(db, account.id, { availableOnly: false }).total, 3);
});

test('WhatsApp manager syncGroups uses live socket participating-group metadata', async t => {
  const folder = mkdtempSync(join(tmpdir(), 'wapromobot-group-manager-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const db = join(folder, 'app.sqlite');
  const sessions = join(folder, 'sessions');
  initializeDatabase(db);
  const account = createWhatsAppAccount(db, { phone: '60111111111' });
  updateWhatsAppAccount(db, account.id, { status: 'ONLINE', lastConnectedAt: new Date().toISOString() });

  const { WhatsAppManager } = await import('../src/whatsapp/manager.js');
  const manager = new WhatsAppManager({ databasePath: db, sessionsPath: sessions });
  t.after(() => manager.stop());
  manager.sockets.set(account.id, {
    socket: {
      groupFetchAllParticipating: async () => ({
        '111@g.us': { id: '111@g.us', subject: 'Group Satu', participants: [{}, {}, {}] },
        '222@g.us': { id: '222@g.us', subject: 'Group Dua', participants: [{}, {}] }
      })
    },
    autoReconnect: true
  });

  const result = await manager.syncGroups(account.id);
  assert.equal(result.detected, 2);
  assert.equal(result.newCount, 2);
  assert.equal(result.account.groupCount, 2);
  assert.equal(listWhatsAppGroups(db, account.id).items[0].participantCount, 2);
});


test('High-volume group sync stages 1200 groups safely in batches', t => {
  const db = fixture(t);
  const account = createWhatsAppAccount(db, { phone: '60111111111' });
  updateWhatsAppAccount(db, account.id, { status: 'ONLINE', lastConnectedAt: new Date().toISOString() });
  const runId = 'run-large';
  beginWhatsAppGroupSync(db, account.id, runId);
  for (let start = 0; start < 1200; start += 50) {
    const batch = Array.from({ length: Math.min(50, 1200 - start) }, (_, i) => {
      const n = start + i + 1;
      return { jid: `${100000 + n}@g.us`, subject: `Group ${n}`, participantCount: n % 500 };
    });
    stageWhatsAppGroupBatch(db, account.id, runId, batch);
  }
  const result = finalizeWhatsAppGroupSync(db, account.id, runId);
  assert.equal(result.detected, 1200);
  assert.equal(result.newCount, 1200);
  assert.equal(result.account.groupCount, 1200);
  assert.equal(listWhatsAppGroups(db, account.id, { page: 120 }).items.length, 10);
  assert.equal(listWhatsAppGroups(db, account.id).totalPages, 120);
});

test('Interrupted staged group sync does not corrupt the last completed group list', t => {
  const db = fixture(t);
  const account = createWhatsAppAccount(db, { phone: '60111111111' });
  updateWhatsAppAccount(db, account.id, { status: 'ONLINE', lastConnectedAt: new Date().toISOString() });
  syncWhatsAppGroups(db, account.id, [
    { jid: '111@g.us', subject: 'Stable One', participantCount: 10 },
    { jid: '222@g.us', subject: 'Stable Two', participantCount: 20 }
  ]);

  beginWhatsAppGroupSync(db, account.id, 'interrupted');
  stageWhatsAppGroupBatch(db, account.id, 'interrupted', [
    { jid: '333@g.us', subject: 'Partial New', participantCount: 30 }
  ]);
  abortWhatsAppGroupSync(db, account.id, 'interrupted');

  const stable = listWhatsAppGroups(db, account.id);
  assert.equal(stable.total, 2);
  assert.deepEqual(stable.items.map(x => x.subject).sort(), ['Stable One', 'Stable Two']);
});

test('Manager high-volume sync emits progress and rejects duplicate sync on same account', async t => {
  const folder = mkdtempSync(join(tmpdir(), 'wapromobot-group-volume-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const db = join(folder, 'app.sqlite');
  const sessions = join(folder, 'sessions');
  initializeDatabase(db);
  const account = createWhatsAppAccount(db, { phone: '60111111111' });
  updateWhatsAppAccount(db, account.id, { status: 'ONLINE', lastConnectedAt: new Date().toISOString() });
  const { WhatsAppManager } = await import('../src/whatsapp/manager.js');
  const manager = new WhatsAppManager({ databasePath: db, sessionsPath: sessions });
  t.after(() => manager.stop());

  let releaseFetch;
  const delayed = new Promise(resolve => { releaseFetch = resolve; });
  const groups = Object.fromEntries(Array.from({ length: 250 }, (_, i) => {
    const n = i + 1;
    return [`${n}@g.us`, { id: `${n}@g.us`, subject: `Bulk ${n}`, participants: [{}, {}] }];
  }));
  manager.sockets.set(account.id, {
    socket: { groupFetchAllParticipating: async () => { await delayed; return groups; } },
    autoReconnect: true
  });

  const events = [];
  const first = manager.syncGroups(account.id, event => events.push(event));
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(() => manager.syncGroups(account.id), /sedang berjalan/i);
  releaseFetch();
  const result = await first;
  assert.equal(result.detected, 250);
  const progress = events.filter(event => event.type === 'group_sync_progress');
  assert.equal(progress.length, 5);
  assert.equal(progress.at(-1).processed, 250);
});


test('WhatsApp reconnect backoff grows progressively and stays bounded', async () => {
  const { reconnectBackoffMs } = await import('../src/whatsapp/manager.js');
  assert.equal(reconnectBackoffMs(1, () => 0.5), 3000);
  assert.equal(reconnectBackoffMs(2, () => 0.5), 10000);
  assert.equal(reconnectBackoffMs(3, () => 0.5), 30000);
  assert.equal(reconnectBackoffMs(4, () => 0.5), 60000);
  assert.equal(reconnectBackoffMs(99, () => 0.5), 60000);
});

test('Concurrent restores create one socket and ignore a stale socket close', async t => {
  const db = fixture(t);
  const { EventEmitter } = await import('node:events');
  const { WhatsAppManager } = await import('../src/whatsapp/manager.js');
  const a = createWhatsAppAccount(db, { phone: '60111111111' });
  updateWhatsAppAccount(db, a.id, { status: 'ONLINE', lastConnectedAt: new Date().toISOString() });
  const manager = new WhatsAppManager({ databasePath: db, sessionsPath: join(db, '..', 'sessions') });
  t.after(() => manager.stop());
  let made = 0;
  manager.library = {
    default: () => { made++; return { ev: new EventEmitter(), user: { id: '60111111111:1@s.whatsapp.net' }, end() {} }; },
    useMultiFileAuthState: async () => ({ state: { creds: { registered: true } }, saveCreds: async () => {} }),
    fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 1] }),
    DisconnectReason: { loggedOut: 401 }
  };
  const [first, same] = await Promise.all([manager.connect(a.id), manager.connect(a.id)]);
  assert.equal(first, same);
  assert.equal(made, 1);
  manager.stopSocket(a.id, 'test replacement');
  const second = await manager.connect(a.id);
  second.ev.emit('connection.update', { connection: 'open' });
  first.ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { statusCode: 401 } } });
  assert.equal(manager.get(a.id).status, 'ONLINE');
  assert.equal(manager.sockets.get(a.id).socket, second);
});


test('Manual reconnect always creates a new socket while preserving auth files', async t => {
  const folder = mkdtempSync(join(tmpdir(), 'wapromobot-real-reconnect-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const db = join(folder, 'app.sqlite');
  const sessions = join(folder, 'sessions');
  initializeDatabase(db);
  const account = createWhatsAppAccount(db, { phone: '60111111111' });
  updateWhatsAppAccount(db, account.id, { status: 'ONLINE', lastConnectedAt: new Date().toISOString() });

  const authDir = join(sessions, account.authDir);
  mkdirSync(authDir, { recursive: true });
  const marker = join(authDir, 'keep-session.marker');
  writeFileSync(marker, 'preserve');

  const { EventEmitter } = await import('node:events');
  const { WhatsAppManager } = await import('../src/whatsapp/manager.js');
  const manager = new WhatsAppManager({ databasePath: db, sessionsPath: sessions });
  t.after(() => manager.stop());

  const made = [];
  manager.library = {
    default: () => {
      const ev = new EventEmitter();
      const socket = {
        ev,
        user: { id: '60111111111:1@s.whatsapp.net' },
        ended: 0,
        end() { this.ended += 1; }
      };
      made.push(socket);
      return socket;
    },
    useMultiFileAuthState: async () => ({ state: { creds: { registered: true } }, saveCreds: async () => {} }),
    fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 1] }),
    DisconnectReason: { loggedOut: 401 }
  };

  const first = await manager.connect(account.id);
  first.ev.emit('connection.update', { connection: 'open' });
  assert.equal(manager.get(account.id).status, 'ONLINE');

  const second = await manager.reconnect(account.id);
  assert.notEqual(second, first);
  assert.equal(made.length, 2);
  assert.equal(first.ended, 1);
  assert.equal(manager.sockets.get(account.id).socket, second);
  assert.equal(existsSync(marker), true);
  assert.equal(manager.get(account.id).status, 'CONNECTING');

  second.ev.emit('connection.update', { connection: 'open' });
  assert.equal(manager.get(account.id).status, 'ONLINE');

  // A late close from the old socket must not log out or replace the new one.
  first.ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } });
  assert.equal(manager.get(account.id).status, 'ONLINE');
  assert.equal(manager.sockets.get(account.id).socket, second);
});

test('Forced reconnect supersedes an older in-flight connection attempt', async t => {
  const folder = mkdtempSync(join(tmpdir(), 'wapromobot-reconnect-race-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const db = join(folder, 'app.sqlite');
  const sessions = join(folder, 'sessions');
  initializeDatabase(db);
  const account = createWhatsAppAccount(db, { phone: '60111111111' });
  updateWhatsAppAccount(db, account.id, { status: 'OFFLINE', lastConnectedAt: new Date().toISOString() });

  const { EventEmitter } = await import('node:events');
  const { WhatsAppManager } = await import('../src/whatsapp/manager.js');
  const manager = new WhatsAppManager({ databasePath: db, sessionsPath: sessions });
  t.after(() => manager.stop());

  let releaseFirst;
  let authCalls = 0;
  const firstAuthGate = new Promise(resolve => { releaseFirst = resolve; });
  const sockets = [];
  manager.library = {
    default: () => {
      const socket = { ev: new EventEmitter(), user: { id: '60111111111:1@s.whatsapp.net' }, ended: 0, end() { this.ended += 1; } };
      sockets.push(socket);
      return socket;
    },
    useMultiFileAuthState: async () => {
      authCalls += 1;
      if (authCalls === 1) await firstAuthGate;
      return { state: { creds: { registered: true } }, saveCreds: async () => {} };
    },
    fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 1] }),
    DisconnectReason: { loggedOut: 401 }
  };

  const oldAttempt = manager.connect(account.id);
  await new Promise(resolve => setImmediate(resolve));
  const freshAttempt = manager.reconnect(account.id);
  const freshSocket = await freshAttempt;
  releaseFirst();
  await assert.rejects(oldAttempt, /dibatalkan|diganti/i);

  assert.equal(sockets.length, 1);
  assert.equal(manager.sockets.get(account.id).socket, freshSocket);
  freshSocket.ev.emit('connection.update', { connection: 'open' });
  assert.equal(manager.get(account.id).status, 'ONLINE');
});

test('Startup connect rejection schedules recovery for an established account', async t => {
  const db = fixture(t);
  const { WhatsAppManager } = await import('../src/whatsapp/manager.js');
  const a = createWhatsAppAccount(db, { phone: '60111111111' });
  updateWhatsAppAccount(db, a.id, { status: 'ONLINE', lastConnectedAt: new Date().toISOString() });
  const manager = new WhatsAppManager({ databasePath: db, sessionsPath: join(db, '..', 'sessions') });
  t.after(() => manager.stop());
  manager.on('error', () => {});
  manager.connectOnce = async () => { throw new Error('temporary startup failure'); };
  await manager.start();
  assert.equal(manager.reconnectTimers.has(a.id), true);
  assert.equal(manager.connecting.size, 0);
});


test('Build 152 socket guard allows lightweight group message keys but still skips broadcast/newsletter traffic while accepting personal chat history', async t => {
  assert.equal(shouldIgnoreIncomingJid('12345@g.us'), false);
  assert.equal(shouldIgnoreIncomingJid('status@broadcast'), true);
  assert.equal(shouldIgnoreIncomingJid('123@broadcast'), true);
  assert.equal(shouldIgnoreIncomingJid('123@newsletter'), true);
  assert.equal(shouldIgnoreIncomingJid('60111111111@s.whatsapp.net'), false);

  const db = fixture(t);
  const account = createWhatsAppAccount(db, { phone: '60111111111' });
  updateWhatsAppAccount(db, account.id, { status: 'OFFLINE', lastConnectedAt: new Date().toISOString() });
  const { EventEmitter } = await import('node:events');
  const { WhatsAppManager } = await import('../src/whatsapp/manager.js');
  const manager = new WhatsAppManager({ databasePath: db, sessionsPath: join(db, '..', 'sessions-guard') });
  t.after(() => manager.stop());
  let captured;
  manager.library = {
    default: config => { captured = config; return { ev: new EventEmitter(), user: { id: '60111111111:1@s.whatsapp.net' }, end() {} }; },
    useMultiFileAuthState: async () => ({ state: { creds: { registered: true }, keys: { get: async () => ({}), set: async () => {} } }, saveCreds: async () => {} }),
    fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 1] }),
    DisconnectReason: { loggedOut: 401 }
  };

  await manager.connect(account.id);
  assert.equal(captured.syncFullHistory, false);
  assert.equal(captured.shouldSyncHistoryMessage({}), false);
  assert.equal(captured.shouldIgnoreJid('999@g.us'), false);
  assert.equal(captured.shouldIgnoreJid('60199999999@s.whatsapp.net'), false);
});

test('Build 143 serializes auth credential writes so overlapping creds.update events cannot race', async t => {
  const db = fixture(t);
  const account = createWhatsAppAccount(db, { phone: '60111111111' });
  updateWhatsAppAccount(db, account.id, { status: 'OFFLINE', lastConnectedAt: new Date().toISOString() });
  const { EventEmitter } = await import('node:events');
  const { WhatsAppManager } = await import('../src/whatsapp/manager.js');
  const manager = new WhatsAppManager({ databasePath: db, sessionsPath: join(db, '..', 'sessions-auth-serial') });
  t.after(() => manager.stop());
  let active = 0;
  let maxActive = 0;
  let writes = 0;
  manager.library = {
    default: () => ({ ev: new EventEmitter(), user: { id: '60111111111:1@s.whatsapp.net' }, end() {} }),
    useMultiFileAuthState: async () => ({
      state: { creds: { registered: true }, keys: { get: async () => ({}), set: async () => {} } },
      saveCreds: async () => {
        writes += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise(resolve => setTimeout(resolve, 12));
        active -= 1;
      }
    }),
    fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 1] }),
    DisconnectReason: { loggedOut: 401 }
  };

  const socket = await manager.connect(account.id);
  socket.ev.emit('creds.update', {});
  socket.ev.emit('creds.update', {});
  socket.ev.emit('creds.update', {});
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(writes, 3);
  assert.equal(maxActive, 1);
});

test('Build 143 reconnect waits for queued auth writes before creating the replacement socket', async t => {
  const db = fixture(t);
  const account = createWhatsAppAccount(db, { phone: '60111111111' });
  updateWhatsAppAccount(db, account.id, { status: 'ONLINE', lastConnectedAt: new Date().toISOString() });
  const { EventEmitter } = await import('node:events');
  const { WhatsAppManager } = await import('../src/whatsapp/manager.js');
  const manager = new WhatsAppManager({ databasePath: db, sessionsPath: join(db, '..', 'sessions-auth-flush') });
  t.after(() => manager.stop());
  let releaseWrite;
  const writeGate = new Promise(resolve => { releaseWrite = resolve; });
  let firstWrite = true;
  let made = 0;
  manager.library = {
    default: () => { made += 1; return { ev: new EventEmitter(), user: { id: '60111111111:1@s.whatsapp.net' }, end() {} }; },
    useMultiFileAuthState: async () => ({
      state: { creds: { registered: true }, keys: { get: async () => ({}), set: async () => {} } },
      saveCreds: async () => { if (firstWrite) { firstWrite = false; await writeGate; } }
    }),
    fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 1] }),
    DisconnectReason: { loggedOut: 401 }
  };

  const first = await manager.connect(account.id);
  first.ev.emit('connection.update', { connection: 'open' });
  first.ev.emit('creds.update', {});
  await new Promise(resolve => setImmediate(resolve));
  const reconnecting = manager.reconnect(account.id);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(made, 1);
  releaseWrite();
  const second = await reconnecting;
  assert.equal(made, 2);
  assert.notEqual(second, first);
});

test('Build 150 text CTA uses proven native interactive bridge instead of normal sendMessage buttons', async t => {
  const folder = mkdtempSync(join(tmpdir(), 'wapromobot-wa-posting-native-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const db = join(folder, 'app.sqlite');
  const sessions = join(folder, 'sessions');
  initializeDatabase(db);
  const account = createWhatsAppAccount(db, { phone: '60111111111' });
  updateWhatsAppAccount(db, account.id, { status: 'ONLINE', lastConnectedAt: new Date().toISOString() });

  const { WhatsAppManager } = await import('../src/whatsapp/manager.js');
  const manager = new WhatsAppManager({ databasePath: db, sessionsPath: sessions });
  let native;
  let standardCount = 0;
  manager.buttonHelper = {
    sendInteractiveMessage: async (socket, jid, content) => {
      native = { socket, jid, content };
      return { key: { id: 'MSG-NATIVE-150' } };
    }
  };
  manager.sockets.set(account.id, {
    socket: {
      sendMessage: async () => { standardCount += 1; return { key: { id: 'SHOULD-NOT-SEND' } }; }
    }
  });

  const result = await manager.sendPostingAd(account.id, '12345@g.us', {
    kind: 'TEXT',
    body: 'Promo hari ini',
    buttons: [{ label: 'Daftar Sekarang', url: 'https://example.com/daftar' }]
  });
  assert.equal(result.messageId, 'MSG-NATIVE-150');
  assert.equal(result.buttonMode, 'NATIVE');
  assert.equal(standardCount, 0);
  assert.equal(native.jid, '12345@g.us');
  assert.equal(native.content.text, 'Promo hari ini');
  assert.equal(native.content.interactiveButtons.length, 1);
  const params = JSON.parse(native.content.interactiveButtons[0].buttonParamsJson);
  assert.equal(params.display_text, 'Daftar Sekarang');
  assert.equal(params.url, 'https://example.com/daftar');
});

test('Build 150 image CTA puts media caption and native button in one InteractiveMessage', async t => {
  const folder = mkdtempSync(join(tmpdir(), 'wapromobot-wa-posting-media-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const db = join(folder, 'app.sqlite');
  const sessions = join(folder, 'sessions');
  initializeDatabase(db);
  const account = createWhatsAppAccount(db, { phone: '60111111111' });
  updateWhatsAppAccount(db, account.id, { status: 'ONLINE', lastConnectedAt: new Date().toISOString() });

  const { WhatsAppManager } = await import('../src/whatsapp/manager.js');
  const manager = new WhatsAppManager({ databasePath: db, sessionsPath: sessions });
  const mediaDir = join(process.cwd(), 'media', 'test-b150');
  mkdirSync(mediaDir, { recursive: true });
  const mediaFile = join(mediaDir, 'ad.jpg');
  writeFileSync(mediaFile, Buffer.from('fake-image'));
  t.after(() => rmSync(mediaDir, { recursive: true, force: true }));

  let nativeContent;
  manager.buttonHelper = {
    sendInteractiveMessage: async (socket, jid, content) => {
      nativeContent = content;
      return { key: { id: 'MSG-MEDIA-150' } };
    }
  };
  const socket = { waUploadToServer: async () => ({}) };
  manager.sockets.set(account.id, { socket });
  manager.library = {
    prepareWAMessageMedia: async () => ({ imageMessage: { url: 'uploaded-image' } }),
    proto: { Message: { InteractiveMessage: { fromObject: value => value } } }
  };

  const result = await manager.sendPostingAd(account.id, '12345@g.us', {
    kind: 'PHOTO',
    body: 'Caption Demo',
    mediaPath: 'media/test-b150/ad.jpg',
    mediaMime: 'image/jpeg',
    buttons: [{ label: 'Daftar Sekarang', url: 'https://example.com/daftar' }]
  });
  assert.equal(result.buttonMode, 'NATIVE');
  assert.equal(result.messageId, 'MSG-MEDIA-150');
  assert.equal(nativeContent.interactiveMessage.body.text, 'Caption Demo');
  assert.equal(nativeContent.interactiveMessage.header.hasMediaAttachment, true);
  assert.equal(nativeContent.interactiveMessage.header.imageMessage.url, 'uploaded-image');
  assert.equal(nativeContent.interactiveMessage.nativeFlowMessage.buttons.length, 1);
});

test('Build 150 CTA falls back to one clickable message when native helper is unavailable', async t => {
  const folder = mkdtempSync(join(tmpdir(), 'wapromobot-wa-posting-fallback-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const db = join(folder, 'app.sqlite');
  const sessions = join(folder, 'sessions');
  initializeDatabase(db);
  const account = createWhatsAppAccount(db, { phone: '60111111111' });
  updateWhatsAppAccount(db, account.id, { status: 'ONLINE', lastConnectedAt: new Date().toISOString() });

  const { WhatsAppManager } = await import('../src/whatsapp/manager.js');
  const manager = new WhatsAppManager({ databasePath: db, sessionsPath: sessions });
  manager.buttonHelper = null;
  let captured;
  manager.sockets.set(account.id, {
    socket: {
      sendMessage: async (jid, content) => {
        captured = { jid, content };
        return { key: { id: 'MSG-FALLBACK-150' } };
      }
    }
  });

  const result = await manager.sendPostingAd(account.id, '12345@g.us', {
    kind: 'TEXT',
    body: 'Promo hari ini',
    buttons: [{ label: 'Daftar Sekarang', url: 'https://example.com/daftar' }]
  });
  assert.equal(result.buttonMode, 'FALLBACK');
  assert.equal(result.messageId, 'MSG-FALLBACK-150');
  assert.match(captured.content.text, /Promo hari ini/);
  assert.match(captured.content.text, /Daftar Sekarang/);
  assert.match(captured.content.text, /https:\/\/example.com\/daftar/);
});


test('Build 151 Auto Mark Read defaults ON and persists owner toggle', t => {
  const db = fixture(t);
  assert.equal(getWhatsAppAutoMarkRead(db), true);
  assert.equal(setWhatsAppAutoMarkRead(db, false), false);
  assert.equal(getWhatsAppAutoMarkRead(db), false);
  assert.equal(setWhatsAppAutoMarkRead(db, true), true);
  assert.equal(getWhatsAppAutoMarkRead(db), true);
});

test('Build 152 marks actual inbound group message keys read after posting success without clearing chat', async t => {
  const folder = mkdtempSync(join(tmpdir(), 'wapromobot-wa-auto-read-v2-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const db = join(folder, 'app.sqlite');
  const sessions = join(folder, 'sessions');
  initializeDatabase(db);
  const account = createWhatsAppAccount(db, { phone: '60111111111' });
  updateWhatsAppAccount(db, account.id, { status: 'ONLINE', lastConnectedAt: new Date().toISOString() });

  const { WhatsAppManager } = await import('../src/whatsapp/manager.js');
  const manager = new WhatsAppManager({ databasePath: db, sessionsPath: sessions });
  manager.buttonHelper = null;
  let readKeys = [];
  let modification;
  const sentMessage = {
    key: { id: 'MSG-SENT-152', remoteJid: '12345@g.us', fromMe: true },
    messageTimestamp: 1770000002
  };
  manager.sockets.set(account.id, {
    socket: {
      sendMessage: async () => sentMessage,
      readMessages: async keys => { readKeys = keys; },
      chatModify: async (mod, jid) => { modification = { mod, jid }; return {}; }
    }
  });

  const accepted = manager.captureInboundGroupMarkers(account.id, {
    type: 'notify',
    messages: [
      {
        key: { id: 'IN-001', remoteJid: '12345@g.us', fromMe: false, participant: '60122222222@s.whatsapp.net' },
        messageTimestamp: 1770000000,
        message: { conversation: 'Isi chat ini tidak boleh disimpan dalam marker.' }
      },
      {
        key: { id: 'IN-002', remoteJid: '12345@g.us', fromMe: false, participant: '60133333333@s.whatsapp.net' },
        messageTimestamp: 1770000001,
        message: { imageMessage: { caption: 'Media inbound juga tidak disimpan.' } }
      },
      { key: { id: 'OWN-IGNORE', remoteJid: '12345@g.us', fromMe: true }, messageTimestamp: 1770000001 },
      { key: { id: 'DM-IGNORE', remoteJid: '60144444444@s.whatsapp.net', fromMe: false }, messageTimestamp: 1770000001 }
    ]
  });
  assert.equal(accepted, 2);

  const result = await manager.sendPostingAd(account.id, '12345@g.us', {
    kind: 'TEXT',
    body: 'Iklan test auto read v2',
    buttons: []
  });

  assert.equal(result.messageId, 'MSG-SENT-152');
  assert.equal(result.autoRead.applied, true);
  assert.equal(result.autoRead.count, 2);
  assert.equal(result.autoRead.chatStateApplied, true);
  assert.deepEqual(readKeys.map(key => key.id), ['IN-001', 'IN-002']);
  assert.equal(readKeys.every(key => key.fromMe === false), true);
  assert.equal(modification.jid, '12345@g.us');
  assert.equal(modification.mod.markRead, true);
  assert.equal(modification.mod.lastMessages.length, 1);
  assert.equal(modification.mod.lastMessages[0].key.id, 'IN-002');
  assert.equal(modification.mod.lastMessages[0].key.fromMe, false);
  assert.equal(modification.mod.lastMessages[0].messageTimestamp, 1770000001);
  assert.equal('clear' in modification.mod, false);
  assert.equal('archive' in modification.mod, false);
  assert.equal('delete' in modification.mod, false);
  assert.equal(manager.autoReadMarkers.size, 0);
});

test('Build 152 Auto Mark Read tracker keeps only lightweight live inbound group keys', async t => {
  const db = fixture(t);
  const account = createWhatsAppAccount(db, { phone: '60111111111' });
  updateWhatsAppAccount(db, account.id, { status: 'ONLINE', lastConnectedAt: new Date().toISOString() });
  const { WhatsAppManager } = await import('../src/whatsapp/manager.js');
  const manager = new WhatsAppManager({ databasePath: db, sessionsPath: join(db, '..', 'sessions-read-tracker') });

  assert.equal(manager.captureInboundGroupMarkers(account.id, {
    type: 'append',
    messages: [{ key: { id: 'HISTORY', remoteJid: '123@g.us', fromMe: false }, message: { conversation: 'history' } }]
  }), 0);
  assert.equal(manager.captureInboundGroupMarkers(account.id, {
    type: 'notify',
    requestId: 'on-demand-resend',
    messages: [{ key: { id: 'REQUEST', remoteJid: '123@g.us', fromMe: false }, message: { conversation: 'request' } }]
  }), 0);
  assert.equal(manager.captureInboundGroupMarkers(account.id, {
    type: 'notify',
    messages: [{
      key: { id: 'LIVE', remoteJid: '123@g.us', fromMe: false, participant: '60111111111@s.whatsapp.net' },
      messageTimestamp: 1770000100,
      message: { conversation: 'SECRET BODY MUST NOT BE STORED' }
    }]
  }), 1);

  const stored = JSON.stringify([...manager.autoReadMarkers.values()].flatMap(bucket => [...bucket.values()]));
  assert.match(stored, /LIVE/);
  assert.doesNotMatch(stored, /SECRET BODY MUST NOT BE STORED/);
});

test('Build 152 Auto Mark Read OFF leaves WhatsApp unread state untouched', async t => {
  const folder = mkdtempSync(join(tmpdir(), 'wapromobot-wa-auto-read-off-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const db = join(folder, 'app.sqlite');
  const sessions = join(folder, 'sessions');
  initializeDatabase(db);
  setWhatsAppAutoMarkRead(db, false);
  const account = createWhatsAppAccount(db, { phone: '60111111111' });
  updateWhatsAppAccount(db, account.id, { status: 'ONLINE', lastConnectedAt: new Date().toISOString() });

  const { WhatsAppManager } = await import('../src/whatsapp/manager.js');
  const manager = new WhatsAppManager({ databasePath: db, sessionsPath: sessions });
  let readCount = 0;
  let modifyCount = 0;
  manager.buttonHelper = null;
  manager.captureInboundGroupMarkers(account.id, {
    type: 'notify',
    messages: [{ key: { id: 'IN-OFF-152', remoteJid: '12345@g.us', fromMe: false, participant: '60122222222@s.whatsapp.net' }, messageTimestamp: 1770000000 }]
  });
  manager.sockets.set(account.id, {
    socket: {
      sendMessage: async () => ({ key: { id: 'MSG-OFF-152', remoteJid: '12345@g.us', fromMe: true }, messageTimestamp: 1770000001 }),
      readMessages: async () => { readCount += 1; },
      chatModify: async () => { modifyCount += 1; }
    }
  });

  const result = await manager.sendPostingAd(account.id, '12345@g.us', { kind: 'TEXT', body: 'Iklan test', buttons: [] });
  assert.equal(result.messageId, 'MSG-OFF-152');
  assert.equal(result.autoRead.enabled, false);
  assert.equal(readCount, 0);
  assert.equal(modifyCount, 0);
});

test('Build 152 mark-read failure never converts a successful posting into FAILED', async t => {
  const folder = mkdtempSync(join(tmpdir(), 'wapromobot-wa-auto-read-fail-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const db = join(folder, 'app.sqlite');
  const sessions = join(folder, 'sessions');
  initializeDatabase(db);
  const account = createWhatsAppAccount(db, { phone: '60111111111' });
  updateWhatsAppAccount(db, account.id, { status: 'ONLINE', lastConnectedAt: new Date().toISOString() });

  const { WhatsAppManager } = await import('../src/whatsapp/manager.js');
  const manager = new WhatsAppManager({ databasePath: db, sessionsPath: sessions });
  manager.buttonHelper = null;
  manager.captureInboundGroupMarkers(account.id, {
    type: 'notify',
    messages: [{ key: { id: 'IN-FAIL-152', remoteJid: '12345@g.us', fromMe: false, participant: '60122222222@s.whatsapp.net' }, messageTimestamp: 1770000001 }]
  });
  manager.sockets.set(account.id, {
    socket: {
      sendMessage: async () => ({ key: { id: 'MSG-OK-152', remoteJid: '12345@g.us', fromMe: true }, messageTimestamp: 1770000002 }),
      readMessages: async () => { throw new Error('read receipt unavailable'); },
      chatModify: async () => { throw new Error('should not be reached'); }
    }
  });

  const result = await manager.sendPostingAd(account.id, '12345@g.us', { kind: 'TEXT', body: 'Iklan tetap success', buttons: [] });
  assert.equal(result.messageId, 'MSG-OK-152');
  assert.equal(result.autoRead.applied, false);
  assert.equal(result.autoRead.reason, 'FAILED');
});

