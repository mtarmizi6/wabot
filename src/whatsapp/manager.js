import { sendGroupStatusProtocol } from '../groupstatus/protocol.js';
import { assessGsMetadata } from '../groupstatus/diagnostics.js';
import { EventEmitter } from 'node:events';
import { mkdirSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { projectRoot } from '../system/paths.js';
import {
  listWhatsAppAccounts, listAllWhatsAppAccounts, getWhatsAppAccount, createWhatsAppAccount,
  updateWhatsAppAccount, deleteWhatsAppAccount, deletePendingWhatsAppAccount, markWhatsAppAccountsOffline,
  beginWhatsAppGroupSync, stageWhatsAppGroupBatch, finalizeWhatsAppGroupSync, abortWhatsAppGroupSync, recoverWhatsAppGroupSync,
  getWhatsAppAutoMarkRead, findWhatsAppAccountByPhone, assertAccountAvailableForRemoval, assertSavedGroupAccess
} from './store.js';

const require = createRequire(import.meta.url);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Only the last few already-sent encrypted message envelopes are kept in RAM.
// Baileys getMessage uses these if a recipient requests an E2EE retry. No media
// buffers, chat histories, session keys or message text are written to disk.
const RETRY_CACHE_MAX_PER_ACCOUNT = 64;
const RETRY_CACHE_TTL_MS = 20 * 60 * 1000;


const BAILEYS_LOGIN_SUCCESS_EVENT = 'CB:success';
const guardedBaileysLoginListener = Symbol('wapromobot-guarded-baileys-login');

/**
 * Baileys 6.7.24 registers an async WebSocket CB:success listener that awaits
 * uploadPreKeys/sendPassiveIq without catching rejection. An IQ 408 there can
 * become an unhandled rejection and terminate Node, taking every account and
 * Telegram down. Wrap *that listener only*: reject -> socket.end(error) ->
 * normal per-account connection.update(close) / existing reconnect backoff.
 * Do not globally swallow other unhandled rejections or modify node_modules.
 */
export function guardBaileysLoginSuccess(socket, onFailure = () => {}) {
  const ws = socket?.ws;
  if (!ws || typeof ws.listeners !== 'function' || typeof ws.off !== 'function' || typeof ws.on !== 'function') {
    return false;
  }
  const candidates = ws.listeners(BAILEYS_LOGIN_SUCCESS_EVENT)
    .filter(fn => typeof fn === 'function' && fn.constructor?.name === 'AsyncFunction' && !fn[guardedBaileysLoginListener]);
  if (!candidates.length) return false;

  let ending = false;
  for (const original of candidates) {
    const wrapped = (...args) => {
      let result;
      try {
        result = original.apply(ws, args);
      } catch (error) {
        result = Promise.reject(error);
      }
      // Explicit catch is attached in the same event-loop turn: no unhandled
      // rejection can escape from the Baileys login-success callback.
      Promise.resolve(result).catch(error => {
        if (ending) return;
        ending = true;
        try { onFailure(error); } catch {}
        try {
          Promise.resolve(socket.end?.(error)).catch(endError => {
            try { onFailure(endError); } catch {}
          });
        } catch (endError) {
          try { onFailure(endError); } catch {}
        }
      });
    };
    wrapped[guardedBaileysLoginListener] = true;
    ws.off(BAILEYS_LOGIN_SUCCESS_EVENT, original);
    ws.on(BAILEYS_LOGIN_SUCCESS_EVENT, wrapped);
  }
  return true;
}

export function shouldIgnoreIncomingJid(jid = '') {
  const value = String(jid || '').toLowerCase();
  // Build 152: group events must reach messages.upsert so we can retain only
  // the tiny inbound message keys required by Baileys readMessages().
  // Broadcast/newsletter traffic remains ignored and full history sync stays off.
  return value === 'status@broadcast'
    || value.endsWith('@broadcast')
    || value.endsWith('@newsletter');
}

const MAX_AUTO_READ_KEYS_PER_GROUP = 512;

function normalizeMessageTimestamp(value) {
  try {
    if (typeof value === 'bigint') return Number(value);
    if (value && typeof value.toNumber === 'function') return Number(value.toNumber());
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  } catch {}
  return Math.floor(Date.now() / 1000);
}

function createSerializedAuthWriter(state, saveCreds, onError = () => {}) {
  let tail = Promise.resolve();
  const enqueue = work => {
    const task = tail.then(work, work);
    tail = task.catch(error => {
      try { onError(error); } catch {}
    });
    return task;
  };

  if (state?.keys && typeof state.keys.set === 'function') {
    const rawSet = state.keys.set.bind(state.keys);
    state.keys.set = data => enqueue(() => rawSet(data));
  }

  return {
    saveCreds: () => enqueue(() => saveCreds()),
    flush: () => tail.catch(() => {})
  };
}

export function reconnectBackoffMs(attempt = 1, random = Math.random) {
  const steps = [3000, 10000, 30000, 60000];
  const index = Math.max(0, Math.min(steps.length - 1, Number(attempt || 1) - 1));
  const base = steps[index];
  const value = Number(random());
  const safe = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
  const factor = 0.8 + (safe * 0.4);
  return Math.max(1000, Math.round(base * factor));
}

function silentLogger() {
  const logger = {};
  for (const method of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) logger[method] = () => {};
  logger.child = () => logger;
  return logger;
}

function normalizePhone(value = '') {
  const raw = String(value || '').trim();
  if (!/^\+?[0-9 ()-]+$/.test(raw)) throw new Error('Gunakan nombor telefon dengan kod negara, contoh 60123456789.');
  const digits = raw.replace(/[ ()+-]/g, '').replace(/^00/, '');
  if (!/^[1-9][0-9]{7,14}$/.test(digits)) {
    throw new Error('Nombor WhatsApp tidak sah. Gunakan kod negara, contoh 60123456789.');
  }
  return digits;
}


function postingBody(ad = {}) {
  return String(ad.body || '').trim();
}

function postingFallbackBody(ad = {}) {
  const body = postingBody(ad);
  const buttons = Array.isArray(ad.buttons) ? ad.buttons.slice(0, 2) : [];
  if (!buttons.length) return body;
  const cta = buttons.map(button => `🔘 ${String(button.label || 'Link').trim()}\n${String(button.url || '').trim()}`).join('\n\n');
  return `${body}\n\n${cta}`.trim();
}

function postingNativeButtons(ad = {}) {
  return (Array.isArray(ad.buttons) ? ad.buttons : []).slice(0, 2).map(button => {
    const label = String(button.label || 'Buka Link').trim().slice(0, 64);
    const url = String(button.url || '').trim();
    return {
      name: 'cta_url',
      buttonParamsJson: JSON.stringify({ display_text: label, url, merchant_url: url })
    };
  }).filter(button => {
    try { const data = JSON.parse(button.buttonParamsJson); return /^https?:\/\//iu.test(data.url); } catch { return false; }
  });
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
      timer.unref?.();
    })
  ]).finally(() => clearTimeout(timer));
}

function statusCodeFromDisconnect(lastDisconnect) {
  return Number(lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.statusCode || 0);
}

export class WhatsAppManager extends EventEmitter {
  constructor({ databasePath, sessionsPath, connectWatchdogMs = 120000 }) {
    super();
    this.databasePath = databasePath;
    this.sessionsPath = sessionsPath;
    this.sockets = new Map();
    this.reconnectTimers = new Map();
    this.connectionWatchdogs = new Map();
    const watchdogMs = Number(connectWatchdogMs);
    this.connectWatchdogMs = Number.isFinite(watchdogMs) && watchdogMs >= 10 ? watchdogMs : 120000;
    this.connecting = new Map();
    this.connectionTokens = new Map();
    this.reconnectAttempts = new Map();
    this.pendingLoginTimers = new Map();
    this.pendingPairingCancels = new Map();
    this.loginAttempt = null;
    this.groupSyncs = new Map();
    this.runtimeHealth = new Map();
    // Ephemeral only: account+group -> recent inbound message keys. We never
    // store inbound body/media. These keys exist solely to emulate WhatsApp's
    // "mark as read / scroll to bottom" state after a successful posting.
    this.autoReadMarkers = new Map();
    this.recentOutgoing = new Map(); // account ID -> Map(message ID -> encrypted envelope)
    this.deliveryAcks = new Map(); // account ID + message ID -> last status

    this.shuttingDown = false;
    this.library = null;
    this.buttonHelper = undefined;
    mkdirSync(this.sessionsPath, { recursive: true, mode: 0o700 });
  }

  rememberOutgoing(accountId, sent, remoteJid = '') {
    const messageId = String(sent?.key?.id || '').trim();
    if (!messageId || !sent?.message || typeof sent.message !== 'object') return false;
    const acct = Number(accountId);
    let bucket = this.recentOutgoing.get(acct);
    if (!bucket) { bucket = new Map(); this.recentOutgoing.set(acct, bucket); }
    const timestamp = Date.now();
    for (const [key, entry] of bucket) if (timestamp >= entry.expiresAt) bucket.delete(key);
    // A second send with the same ID is not expected, but Map.set refreshes it.
    bucket.delete(messageId);
    bucket.set(messageId, { jid: String(sent?.key?.remoteJid || remoteJid), message: sent.message, expiresAt: timestamp + RETRY_CACHE_TTL_MS });
    while (bucket.size > RETRY_CACHE_MAX_PER_ACCOUNT) bucket.delete(bucket.keys().next().value);
    return true;
  }

  getRecentOutgoing(accountId, key) {
    const bucket = this.recentOutgoing.get(Number(accountId));
    const messageId = String(key?.id || '').trim();
    const entry = bucket?.get(messageId);
    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAt) { bucket.delete(messageId); return undefined; }
    // Account-scoped and ID-scoped. Do not accidentally return a different chat.
    if (String(key?.remoteJid || '') !== entry.jid) return undefined;
    return entry.message;
  }

  recordDeliveryAck(accountId, item) {
    const messageId = String(item?.key?.id || '').trim();
    const status = Number(item?.update?.status ?? -1);
    if (!item?.key?.fromMe || !messageId || status < 2) return false;
    const account = Number(accountId);
    const cacheKey = `${account}:${messageId}`;
    const old = this.deliveryAcks.get(cacheKey);
    const current = { accountId: account, messageId, status: Math.max(status, old?.status || 0), at: Date.now() };
    this.deliveryAcks.delete(cacheKey);
    this.deliveryAcks.set(cacheKey, current);
    while (this.deliveryAcks.size > 200) this.deliveryAcks.delete(this.deliveryAcks.keys().next().value);
    this.emit('delivery_ack', current);
    return true;
  }

  async waitForDeliveryAck(accountId, messageId, timeoutMs = 15000) {
    const account = Number(accountId);
    const key = `${account}:${String(messageId)}`;
    const prior = this.deliveryAcks.get(key);
    if (prior?.status >= 3) return prior;
    return new Promise(resolve => {
      let latest = prior || null;
      const onAck = event => {
        if (event.accountId !== account || event.messageId !== String(messageId)) return;
        latest = event;
        if (event.status >= 3) finish();
      };
      const finish = () => { clearTimeout(timer); this.off('delivery_ack', onAck); resolve(latest); };
      this.on('delivery_ack', onAck);
      const timer = setTimeout(finish, Math.min(30000, Math.max(100, Number(timeoutMs) || 15000)));
    });
  }

  async loadLibrary() {
    if (!this.library) {
      try { this.library = await import('@whiskeysockets/baileys'); }
      catch { throw new Error('WhatsApp Engine belum dipasang. Jalankan npm install dalam folder WAPromoBot.'); }
    }
    return this.library;
  }

  loadButtonHelper() {
    if (this.buttonHelper !== undefined) return this.buttonHelper;
    try { this.buttonHelper = require('baileys_helper'); }
    catch {
      try { this.buttonHelper = require('zqbaileys_helper'); }
      catch { this.buttonHelper = null; }
    }
    return this.buttonHelper;
  }

  async start() {
    if(!this.groupSyncs.size)recoverWhatsAppGroupSync(this.databasePath);
    markWhatsAppAccountsOffline(this.databasePath);
    const keptAuth = new Set(listAllWhatsAppAccounts(this.databasePath).map(a => a.authDir));
    for (const dir of readdirSync(this.sessionsPath, { withFileTypes: true })) {
      if (dir.isDirectory() && /^login-\d+-[a-f0-9-]+$/.test(dir.name) && !keptAuth.has(dir.name)) {
        rmSync(join(this.sessionsPath, dir.name), { recursive: true, force: true });
      }
    }

    // Pending first-login bukan akaun sebenar. Bersihkan cubaan lama yang
    // tidak pernah sampai ONLINE sebelum senarai akaun dipaparkan.
    const orphaned = listAllWhatsAppAccounts(this.databasePath).filter(account => !account.lastConnectedAt);
    for (const account of orphaned) this.removeLocalAccount(account.id, { pendingOnly: true });

    const accounts = listWhatsAppAccounts(this.databasePath).filter(account => account.status !== 'LOGGED_OUT');
    for (const account of accounts) {
      this.connect(account.id, { autoReconnect: true }).catch(error => {
        this.emit('error', { account, error });
        if (!this.shuttingDown && this.get(account.id)?.status !== 'LOGGED_OUT') this.scheduleReconnect(account.id);
      });
      await sleep(250);
    }
  }

  list() {
    return listWhatsAppAccounts(this.databasePath);
  }

  get(id) {
    return getWhatsAppAccount(this.databasePath, id);
  }

  async createPairing(phone, onEvent = () => {}) {
    return this.beginLogin({ phone: normalizePhone(phone), onEvent });
  }

  async createQr(onEvent = () => {}) { return this.beginLogin({ onEvent }); }

  async replacePairing(id, phone, onEvent = () => {}) {
    return this.beginLogin({ accountId: Number(id), phone: normalizePhone(phone), onEvent });
  }

  async replaceQr(id, onEvent = () => {}) { return this.beginLogin({ accountId: Number(id), onEvent }); }

  async beginLogin({ accountId = null, phone = null, onEvent = () => {} } = {}) {
    if (this.loginAttempt) throw new Error('Satu proses login masih aktif. Guna .login atau .batal dahulu.');
    const duplicate = phone && findWhatsAppAccountByPhone(this.databasePath, phone, accountId);
    if (duplicate) throw new Error('Nombor sudah didaftarkan. Buka .accounts untuk memilih akaun sedia ada.');
    let account;
    if (accountId) {
      account = this.get(accountId);
      if (!account?.lastConnectedAt) throw new Error('Akaun asal tidak ditemui.');
      if (phone && phone !== normalizePhone(account.phone)) throw new Error('Login semula mesti menggunakan nombor asal. Tambah nombor lain melalui .login.');
      if (account.status === 'ONLINE') throw new Error('Akaun masih ONLINE. Gunakan .account-reconnect untuk sambung semula.');
    } else account = createWhatsAppAccount(this.databasePath, { phone });
    const safeEvent = event => { try { Promise.resolve(onEvent(event)).catch(() => {}); } catch {} };
    const attempt = { id: account.id, replacement: !!accountId, previousStatus: account.status,
      originalAuthDir: account.authDir, authDir: accountId ? `login-${account.id}-${randomUUID()}` : account.authDir,
      expectedPhone: accountId ? normalizePhone(account.phone) : phone, onEvent: safeEvent };
    this.loginAttempt = attempt;
    safeEvent({ type:'created', account, replacement:attempt.replacement });
    this.schedulePendingLoginExpiry(account.id, safeEvent, { replacement:attempt.replacement });
    try {
      if (accountId) {
        this.invalidateConnection(account.id);
        this.clearReconnectTimer(account.id);
        await this.stopSocketAndFlush(account.id, 'Login semula nombor asal');
      }
      if (this.loginAttempt !== attempt) throw new Error('Login dibatalkan.');
      await this.connect(account.id, { pairingPhone:phone, onEvent:safeEvent, autoReconnect:true,
        firstLogin:!accountId, replacement:!!accountId, expectedPhone:attempt.expectedPhone,
        authDirOverride:attempt.authDir, forceNewSocket:!!accountId });
      return this.get(account.id);
    } catch (error) {
      if (this.loginAttempt === attempt) await this.cancelLogin(account.id);
      throw error;
    }
  }

  async cancelLogin(id) {
    const attempt = this.loginAttempt;
    if (!attempt || Number(id) !== attempt.id) return false;
    const account = this.get(id);
    if (account?.status === 'ONLINE') return false;
    this.loginAttempt = null;
    this.clearPendingLoginTimer(id);
    this.clearReconnectTimer(id);
    this.invalidateConnection(id);
    this.pendingPairingCancels.get(Number(id))?.();
    this.pendingPairingCancels.delete(Number(id));
    await this.stopSocketAndFlush(id, 'Login cancelled');
    rmSync(join(this.sessionsPath, attempt.authDir), { recursive:true, force:true });
    if (attempt.replacement) {
      updateWhatsAppAccount(this.databasePath,id,{status:attempt.previousStatus === 'LOGGED_OUT' ? 'LOGGED_OUT' : 'OFFLINE'});
    } else deletePendingWhatsAppAccount(this.databasePath,id);
    return true;
  }

  nextConnectionToken(id) {
    const key = Number(id);
    const token = Symbol(`wa-connection-${key}`);
    this.connectionTokens.set(key, token);
    return token;
  }

  invalidateConnection(id) {
    this.clearConnectionWatchdog(id);
    const key = Number(id);
    this.connectionTokens.set(key, Symbol(`wa-invalid-${key}`));
  }

  isCurrentConnection(id, token) {
    return this.connectionTokens.get(Number(id)) === token;
  }

  async connect(id, options = {}) {
    const key = Number(id);
    if (this.shuttingDown) throw new Error('Controller sedang ditutup.');

    const forceNewSocket = options.forceNewSocket === true;
    if (!forceNewSocket && this.connecting.has(key)) return this.connecting.get(key);
    if (!forceNewSocket && this.sockets.has(key)) return this.sockets.get(key).socket;

    const token = this.nextConnectionToken(key);
    const task = this.connectOnce(key, options, token);
    this.connecting.set(key, task);
    try { return await task; }
    finally { if (this.connecting.get(key) === task) this.connecting.delete(key); }
  }

  async connectOnce(id, options = {}, connectionToken = null) {
    const account = this.get(id);
    if (!account) throw new Error('Akaun WhatsApp tidak ditemui.');

    const token = connectionToken || this.nextConnectionToken(account.id);
    const pairingPhone = options.pairingPhone ? normalizePhone(options.pairingPhone) : null;
    if (!options.forceNewSocket && !pairingPhone && this.sockets.has(account.id)) return this.sockets.get(account.id).socket;

    const lib = await this.loadLibrary();
    const makeWASocket = lib.default || lib.makeWASocket;
    const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = lib;
    if (typeof makeWASocket !== 'function' || typeof useMultiFileAuthState !== 'function') {
      throw new Error('WhatsApp Engine tidak serasi.');
    }

    if (!this.isCurrentConnection(account.id, token) || !this.get(id)) throw new Error('Login dibatalkan.');
    const authPath = join(this.sessionsPath, options.authDirOverride || account.authDir);
    if (pairingPhone && options.freshAuth) {
      await this.stopSocketAndFlush(account.id, 'Fresh pairing');
      try { rmSync(authPath, { recursive: true, force: true }); } catch {}
    }
    mkdirSync(authPath, { recursive: true, mode: 0o700 });

    const { state, saveCreds } = await useMultiFileAuthState(authPath);
    const authWriter = createSerializedAuthWriter(state, saveCreds, error => {
      this.emit('error', { account: this.get(account.id) || account, error });
    });
    let version;
    try { version = (await fetchLatestBaileysVersion()).version; } catch {}

    if (this.shuttingDown || !this.get(id) || !this.isCurrentConnection(account.id, token)) {
      if (options.firstLogin || options.replacement) rmSync(authPath,{recursive:true,force:true});
      throw new Error('Cubaan sambungan dibatalkan atau diganti oleh sambungan baru.');
    }
    updateWhatsAppAccount(this.databasePath, account.id, { status: 'CONNECTING' });
    options.onEvent?.({ type: 'status', status: 'CONNECTING', account: this.get(account.id), replacement: !!options.replacement });

    // Pairing fix: guna config minimal/default seperti flow lama yang stabil.
    // requestPairingCode TIDAK dipanggil di sini; tunggu QR/ref event dahulu.
    const socket = makeWASocket({
      auth: state,
      ...(version ? { version } : {}),
      printQRInTerminal: false,
      logger: silentLogger(),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      shouldIgnoreJid: shouldIgnoreIncomingJid,
      // Necessary for WhatsApp E2EE retry requests when a device cannot decrypt
      // an earlier outbound message. Bounded RAM only, scoped per account.
      getMessage: async key => this.getRecentOutgoing(account.id, key)
    });

    if (!this.isCurrentConnection(account.id, token)) {
      try { socket.end?.(new Error('Superseded WhatsApp connection')); } catch {}
      throw new Error('Cubaan sambungan telah diganti oleh sambungan baru.');
    }
    this.sockets.set(account.id, { socket, authPath, autoReconnect: options.autoReconnect !== false, token, authWriter });
    const loginGuardReady = guardBaileysLoginSuccess(socket, error => {
      this.emit('diagnostic', {
        type: 'wa_login_iq_failed',
        accountId: Number(account.id),
        code: statusCodeFromDisconnect({ error }),
        message: String(error?.message || error || 'Login IQ failed').slice(0, 120)
      });
    });
    if (!loginGuardReady && socket.ws) {
      this.emit('diagnostic', { type: 'wa_login_guard_unavailable', accountId: Number(account.id) });
    }
    socket.ev.on('creds.update', () => {
      if (!this.isCurrentConnection(account.id, token)) return;
      authWriter.saveCreds().catch(error => this.emit('error', { account: this.get(account.id) || account, error }));
    });
    socket.ev.on('messages.upsert', event => {
      // Capture our own envelopes for retry when Baileys emits outgoing updates.
      // This is best effort: the synchronous send path also caches its result.
      if (this.isCurrentConnection(account.id, token)) {
        for (const message of event?.messages || []) {
          if (message?.key?.fromMe && message?.message)
            this.rememberOutgoing(account.id, message);
        }
      }
      try { this.captureInboundGroupMarkers(account.id, event); }
      catch (error) {
        this.emit('diagnostic', {
          type: 'auto_mark_read_capture_failed',
          accountId: Number(account.id),
          error: String(error?.message || error || 'Unknown marker capture error')
        });
      }
    });
    socket.ev.on('messages.update', updates => {
      if (!this.isCurrentConnection(account.id, token)) return;
      for (const item of updates || []) this.recordDeliveryAck(account.id, item);
    });
    let attemptConnected = false;
    let pairingRequested = false;
    let pairingSettled = false;
    let resolvePairing;
    let rejectPairing;

    const pairingPromise = pairingPhone && !state.creds.registered
      ? new Promise((resolve, reject) => { resolvePairing = resolve; rejectPairing = reject; })
      : null;

    const pairingReadyTimeout = pairingPromise ? setTimeout(() => {
      if (pairingSettled) return;
      pairingSettled = true;
      const error = new Error('Pairing code belum dapat dijana. Cuba semula untuk dapatkan kod fresh.');
      rejectPairing(error);
      options.onEvent?.({ type: 'pairing_ready_timeout', account: this.get(account.id) || account, replacement: !!options.replacement });
      if (options.firstLogin) this.removeLocalAccount(account.id, { pendingOnly: true });
      else if (options.replacement) this.failReplacement(account.id);
    }, 45000) : null;
    pairingReadyTimeout?.unref?.();

    const settlePairingError = error => {
      if (!pairingPromise || pairingSettled) return;
      pairingSettled = true;
      if (pairingReadyTimeout) clearTimeout(pairingReadyTimeout);
      rejectPairing(error);
    };

    this.pendingPairingCancels.set(Number(account.id), () => settlePairingError(new Error('Login dibatalkan.')));

    socket.ev.on('connection.update', async update => {
      try {
      if (this.shuttingDown || !this.isCurrentConnection(account.id, token) || this.sockets.get(account.id)?.socket !== socket) return;
      const { connection, lastDisconnect, qr } = update;

      if (qr && pairingPromise && !pairingRequested && !state.creds.registered) {
        pairingRequested = true;
        try {
          const code = await socket.requestPairingCode(pairingPhone);
          if (!this.isCurrentConnection(account.id, token)) return;
          if (!pairingSettled) {
            pairingSettled = true;
            if (pairingReadyTimeout) clearTimeout(pairingReadyTimeout);
            resolvePairing(code);
          }
          options.onEvent?.({
            type: 'pairing_code', code,
            account: this.get(account.id) || account,
            replacement: !!options.replacement
          });
          this.schedulePendingLoginExpiry(account.id, options.onEvent, { replacement: !!options.replacement });
        } catch (error) {
          if (!this.isCurrentConnection(account.id, token)) return;
          settlePairingError(error);
          options.onEvent?.({ type: 'error', account: this.get(account.id) || account, error, replacement: !!options.replacement });
          this.emit('error', { account: this.get(account.id) || account, error });
          if (options.firstLogin) this.removeLocalAccount(account.id, { pendingOnly: true });
          else if (options.replacement) this.failReplacement(account.id);
        }
      }

      if (qr && !pairingPhone) {
        options.onEvent?.({ type: 'qr', qr, account: this.get(account.id) || account });
      }

      if (connection === 'open') {
        const jid = socket.user?.id || null;
        const resolvedPhone = jid ? String(jid).split(':')[0].split('@')[0] : (pairingPhone || account.phone);
        const duplicate = findWhatsAppAccountByPhone(this.databasePath, resolvedPhone, account.id);
        if (this.loginAttempt?.id === account.id && (!resolvedPhone || duplicate || (options.expectedPhone && resolvedPhone !== options.expectedPhone))) {
          const original = this.get(account.id) || account;
          await this.cancelLogin(account.id);
          options.onEvent?.({ type:'login_failed', account:original, replacement:!!options.replacement,
            reason:duplicate ? 'Nombor ini sudah didaftarkan pada akaun lain.' : 'Nombor yang disambungkan tidak sepadan dengan nombor asal.' });
          return;
        }
        this.clearConnectionWatchdog(account.id);
        attemptConnected = true;
        this.reconnectAttempts.delete(Number(account.id));
        this.runtimeHealth.set(Number(account.id), { state:'OPERATIONAL', changedAt:Date.now() });
        this.clearPendingLoginTimer(account.id);
        this.pendingPairingCancels.delete(Number(account.id));
        if (pairingReadyTimeout) clearTimeout(pairingReadyTimeout);
        const connected = updateWhatsAppAccount(this.databasePath, account.id, {
          status:'ONLINE', jid, phone:resolvedPhone,
          ...(options.authDirOverride ? { authDir:options.authDirOverride } : {}),
          lastConnectedAt:new Date().toISOString()
        });
        const attempt = this.loginAttempt;
        if (attempt?.id === account.id) {
          this.loginAttempt = null;
          if (attempt.replacement && attempt.originalAuthDir !== connected.authDir) {
            try { rmSync(join(this.sessionsPath, attempt.originalAuthDir), { recursive:true, force:true }); }
            catch { this.emit('diagnostic',{type:'old_auth_cleanup_failed',accountId:account.id}); }
          }
        }
        options.onEvent?.({ type:'connected', account:connected, replacement:!!options.replacement });
        this.emit('connected', connected);
      }

      if (connection === 'close') {
        this.clearConnectionWatchdog(account.id);
        this.sockets.delete(account.id);
        const code = statusCodeFromDisconnect(lastDisconnect);
        const current = this.get(account.id);
        const loggedOutCode = Number(DisconnectReason?.loggedOut || 401);
        const loggedOut = [loggedOutCode, Number(DisconnectReason?.badSession || 500), Number(DisconnectReason?.multideviceMismatch || 411)].includes(code);
        if (loggedOut) this.reconnectAttempts.delete(Number(account.id));
        const registered = state.creds.registered === true;
        const pendingFirstLogin = !!options.firstLogin || !!options.pendingFirstLogin || !!(current && !current.lastConnectedAt);

        // Pairing WhatsApp lazimnya boleh menutup socket selepas credentials
        // berjaya didaftarkan (contohnya restart-required) sebelum OPEN.
        // Bila creds sudah registered, JANGAN anggap pairing gagal: reconnect
        // menggunakan auth yang sama sehingga connection benar-benar OPEN.
        if (!attemptConnected && (pairingPhone || pendingFirstLogin || options.replacement)) {
          if (registered && !loggedOut && current) {
            updateWhatsAppAccount(this.databasePath, account.id, { status: 'CONNECTING' });
            options.onEvent?.({ type: 'pairing_restart', account: current, code, replacement: !!options.replacement });
            if (!this.shuttingDown && options.autoReconnect !== false) {
              this.scheduleReconnect(account.id, {
                ...options, pairingPhone:null, freshAuth:false, forceNewSocket:false,
                onEvent: options.onEvent, replacement: !!options.replacement, pendingFirstLogin
              });
            }
            return;
          }

          settlePairingError(new Error(`WhatsApp connection ditutup sebelum pairing siap (code ${code || 'unknown'}).`));
          this.clearPendingLoginTimer(account.id);
          if (pendingFirstLogin) {
            this.removeLocalAccount(account.id, { pendingOnly: true });
          } else if (options.replacement) {
            this.failReplacement(account.id);
          }
          options.onEvent?.({ type: 'login_failed', account: current || account, code, replacement: !!options.replacement });
          return;
        }

        if (!current) return;
        const status = loggedOut ? 'LOGGED_OUT' : 'OFFLINE';
        this.runtimeHealth.set(Number(account.id), { state: status, changedAt: Date.now() });
        const changed = updateWhatsAppAccount(this.databasePath, account.id, { status });
        options.onEvent?.({ type: 'disconnected', account: changed, loggedOut, code });
        this.emit('disconnected', changed);
        if (!loggedOut && !this.shuttingDown && options.autoReconnect !== false) this.scheduleReconnect(account.id);
      }
      } catch (error) {
        this.emit('error', { account:this.get(account.id) || account, error });
        if (this.loginAttempt?.id === account.id) await this.cancelLogin(account.id);
        options.onEvent?.({ type:'error', account:this.get(account.id) || account, replacement:!!options.replacement });
      }
    });

    // Established account only. A first-ever pairing keeps its separate login
    // timeout semantics; do not abort an owner in the middle of linking.
    this.armConnectionWatchdog(account, socket, token, state.creds.registered === true);

    if (state.creds.registered) return socket;
    if (pairingPromise) {
      await pairingPromise;
      return socket;
    }
    return socket;
  }

  clearConnectionWatchdog(id) {
    const key = Number(id);
    const timer = this.connectionWatchdogs.get(key);
    if (timer) clearTimeout(timer);
    this.connectionWatchdogs.delete(key);
  }

  armConnectionWatchdog(account, socket, token, registered) {
    if (!registered || !account?.lastConnectedAt) return;
    const id = Number(account.id);
    this.clearConnectionWatchdog(id);
    const timer = setTimeout(async () => {
      this.connectionWatchdogs.delete(id);
      if (this.shuttingDown || !this.isCurrentConnection(id, token)
          || this.sockets.get(id)?.socket !== socket || this.get(id)?.status !== 'CONNECTING') return;
      this.emit('diagnostic', { type: 'wa_connect_stalled', accountId: id });
      try {
        // Stop only this transport; retain the session and serialized auth.
        // Its close event normally schedules reconnect automatically.
        await this.stopSocketAndFlush(id, 'WhatsApp connect watchdog timeout');
      } catch (error) {
        this.emit('diagnostic', {
          type: 'wa_watchdog_socket_stop_failed', accountId: id,
          message: String(error?.message || error || 'socket stop failed').slice(0, 120)
        });
      }
      if (this.shuttingDown || !this.isCurrentConnection(id, token)) return;
      const current = this.get(id);
      if (!current || current.status === 'LOGGED_OUT' || current.status === 'ONLINE') return;
      if (current.status === 'CONNECTING') {
        updateWhatsAppAccount(this.databasePath, id, { status: 'OFFLINE' });
      }
      // scheduleReconnect de-duplicates an already scheduled close event.
      this.scheduleReconnect(id);
    }, this.connectWatchdogMs);
    timer.unref?.();
    this.connectionWatchdogs.set(id, timer);
  }

  clearPendingLoginTimer(id) {
    const timer = this.pendingLoginTimers.get(Number(id));
    if (timer) clearTimeout(timer);
    this.pendingLoginTimers.delete(Number(id));
  }

  clearReconnectTimer(id) {
    const timer = this.reconnectTimers.get(Number(id));
    if (timer) clearTimeout(timer);
    this.reconnectTimers.delete(Number(id));
  }

  stopSocket(id, reason = 'Socket stopped') {
    this.clearConnectionWatchdog(id);
    const entry = this.sockets.get(Number(id));
    if (!entry) return;
    try { entry.socket.end?.(new Error(reason)); } catch {}
    this.sockets.delete(Number(id));
  }

  async stopSocketAndFlush(id, reason = 'Socket stopped') {
    this.clearConnectionWatchdog(id);
    const key = Number(id);
    const entry = this.sockets.get(key);
    if (!entry) return;
    try { entry.socket.end?.(new Error(reason)); } catch {}
    this.sockets.delete(key);
    try {
      await Promise.race([
        Promise.resolve(entry.authWriter?.flush?.()),
        sleep(2000)
      ]);
    } catch {}
  }

  healthSummary() {
    const accounts = this.list();
    let online = 0;
    let connecting = 0;
    let loggedOut = 0;
    for (const account of accounts) {
      const socketCurrent = this.sockets.has(Number(account.id));
      if (account.status === 'ONLINE' && socketCurrent) online += 1;
      else if (account.status === 'CONNECTING' || this.connecting.has(Number(account.id)) || this.reconnectTimers.has(Number(account.id))) connecting += 1;
      else if (account.status === 'LOGGED_OUT') loggedOut += 1;
    }
    const total = accounts.length;
    const state = total > 0 && online === total ? 'OPERATIONAL' : (connecting > 0 ? 'RECOVERING' : (online > 0 ? 'DEGRADED' : 'OFFLINE'));
    return { state, total, online, connecting, loggedOut };
  }

  schedulePendingLoginExpiry(id, onEvent = () => {}, { replacement = false } = {}) {
    this.clearPendingLoginTimer(id);
    const timer = setTimeout(async () => {
      this.pendingLoginTimers.delete(Number(id));
      const account = this.get(id);
      if (!account || account.status === 'ONLINE') return;
      await this.cancelLogin(id);
      onEvent?.({ type:'login_timeout', account, replacement });
    }, 120000);
    timer.unref?.();
    this.pendingLoginTimers.set(Number(id), timer);
  }

  scheduleReconnect(id, extraOptions = {}) {
    const numericId = Number(id);
    if (this.reconnectTimers.has(numericId) || this.shuttingDown) return;
    const attempt = Number(this.reconnectAttempts.get(numericId) || 0) + 1;
    this.reconnectAttempts.set(numericId, attempt);
    const delayMs = reconnectBackoffMs(attempt);
    const timer = setTimeout(async () => {
      this.reconnectTimers.delete(numericId);
      try {
        await this.connect(numericId, { autoReconnect: true, ...extraOptions });
      } catch (error) {
        this.emit('error', { account: this.get(numericId), error });
        const current = this.get(numericId);
        if (current && current.status !== 'LOGGED_OUT') this.scheduleReconnect(numericId, extraOptions);
      }
    }, delayMs);
    timer.unref?.();
    this.reconnectTimers.set(numericId, timer);
  }


  async joinGroupInvite(id, inviteCode, { beforeSend = () => true } = {}) {
    const numericId=Number(id); let dispatched=false;
    let groupJid=null,groupName=null,participantCount=0,info=null;
    const result=status=>({status,account:this.get(numericId),groupJid,groupName,participantCount});
    const normalize=jid=>String(jid||'').replace(/:\d+(?=@)/u,'');
    try {
      const account=this.get(numericId), entry=this.sockets.get(numericId), socket=entry?.socket;
      if(!account||account.status!=='ONLINE'||!socket) throw new Error('Akaun belum ONLINE / tiada connection aktif.');
      if(typeof socket.groupAcceptInvite!=='function') throw new Error('WhatsApp Engine tidak menyokong Auto Join.');
      const code=String(inviteCode||'').trim();
      if(!/^[A-Za-z0-9_-]{10,64}$/.test(code)) throw new Error('Invite code tidak sah.');
      const identities=new Set([socket.user?.id,socket.user?.lid,account.jid,account.phone?account.phone+'@s.whatsapp.net':null].filter(Boolean).map(normalize));
      const containsSelf=metadata=>Array.isArray(metadata?.participants)&&metadata.participants.some(p=>[p.id,p.phoneNumber,p.lid].some(j=>j&&identities.has(normalize(j))));
      const capture=metadata=>{
        if(metadata?.subject) groupName=String(metadata.subject);
        if(metadata?.id&&String(metadata.id).endsWith('@g.us')) groupJid=String(metadata.id);
        participantCount=Number(metadata?.size)||metadata?.participants?.length||participantCount;
      };
      if(typeof socket.groupGetInviteInfo==='function') { info=await socket.groupGetInviteInfo(code);capture(info); }
      if(containsSelf(info)) return result('ALREADY');
      // A fresh membership query can identify an existing member without sending another request.
      if(groupJid&&typeof socket.groupMetadata==='function') {
        try { const current=await socket.groupMetadata(groupJid); if(containsSelf(current)){capture(current);return result('ALREADY');} } catch {}
      }
      if(this.get(numericId)?.status!=='ONLINE'||this.sockets.get(numericId)!==entry) throw new Error('Sambungan akaun belum ONLINE.');
      if(!beforeSend()) throw new Error('Job dijeda sebelum permintaan dihantar.');
      dispatched=true;
      let accepted;
      try { accepted=await socket.groupAcceptInvite(code); }
      catch(error) {
        const text=String(error?.message||'');
        if(/already.*(?:participant|member)|already in (?:the )?group|participant already exists/iu.test(text)) return result('ALREADY');
        if(/(?:request|join).*(?:pending|awaiting approval)|membership_approval_request/iu.test(text)) return result('APPROVAL');
        throw error;
      }
      // Invite-preview metadata alone is never evidence that a join succeeded.
      const acceptedJid=typeof accepted==='string'&&accepted.endsWith('@g.us')?accepted:null;
      if(acceptedJid) groupJid=acceptedJid;
      let joined=false;
      if(groupJid&&typeof socket.groupMetadata==='function') {
        try {const metadata=await socket.groupMetadata(groupJid);capture(metadata);joined=containsSelf(metadata);} catch {}
      }
      if(joined) return result('SUCCESS');
      if(info?.joinApprovalMode) return result(acceptedJid?'APPROVAL':'UNKNOWN');
      return result(acceptedJid?'SUCCESS':'UNKNOWN');
    } catch(error) {
      error.joinDispatched=dispatched;
      throw error;
    }
  }

  autoReadBucketKey(accountId, jid) {
    return `${Number(accountId)}:${String(jid || '')}`;
  }

  captureInboundGroupMarkers(accountId, event = {}) {
    // Only fresh online notifications are useful for unread state. History,
    // resend/request payloads and our own messages are intentionally ignored.
    if (String(event?.type || '') !== 'notify' || event?.requestId) return 0;
    const messages = Array.isArray(event?.messages) ? event.messages : [];
    let accepted = 0;

    for (const message of messages) {
      const rawKey = message?.key || {};
      const jid = String(rawKey.remoteJid || '').trim();
      const id = String(rawKey.id || '').trim();
      if (!jid.endsWith('@g.us') || rawKey.fromMe || !id) continue;

      const key = { remoteJid: jid, fromMe: false, id };
      if (rawKey.participant) key.participant = String(rawKey.participant);
      if (rawKey.participantAlt) key.participantAlt = String(rawKey.participantAlt);
      if (rawKey.remoteJidAlt) key.remoteJidAlt = String(rawKey.remoteJidAlt);

      const bucketKey = this.autoReadBucketKey(accountId, jid);
      let bucket = this.autoReadMarkers.get(bucketKey);
      if (!bucket) {
        bucket = new Map();
        this.autoReadMarkers.set(bucketKey, bucket);
      }
      const uniqueKey = `${key.participant || ''}:${id}`;
      // Refresh insertion order for duplicate notification keys.
      bucket.delete(uniqueKey);
      bucket.set(uniqueKey, { key, messageTimestamp: normalizeMessageTimestamp(message?.messageTimestamp) });
      while (bucket.size > MAX_AUTO_READ_KEYS_PER_GROUP) {
        const oldest = bucket.keys().next().value;
        if (oldest === undefined) break;
        bucket.delete(oldest);
      }
      accepted += 1;
    }

    return accepted;
  }

  clearAutoReadMarkersForAccount(accountId) {
    const prefix = `${Number(accountId)}:`;
    for (const key of this.autoReadMarkers.keys()) {
      if (key.startsWith(prefix)) this.autoReadMarkers.delete(key);
    }
  }

  async markPostedGroupRead(accountId, socket, jid) {
    if (!getWhatsAppAutoMarkRead(this.databasePath)) return { enabled: false, applied: false, reason: 'OFF' };

    const bucketKey = this.autoReadBucketKey(accountId, jid);
    const bucket = this.autoReadMarkers.get(bucketKey);
    const markers = bucket ? [...bucket.entries()] : [];
    if (!markers.length) return { enabled: true, applied: false, reason: 'NO_UNREAD_KEYS' };

    const readKeys = markers.map(([, marker]) => marker.key);
    const latest = markers.at(-1)?.[1];
    let receiptsApplied = false;
    let chatStateApplied = false;

    try {
      if (typeof socket?.readMessages !== 'function') {
        return { enabled: true, applied: false, reason: 'UNAVAILABLE' };
      }

      // Baileys requires actual inbound WAMessageKey values for read receipts.
      // We intentionally keep only keys, never the inbound text/media payload.
      await withTimeout(
        socket.readMessages(readKeys),
        8000,
        'WhatsApp readMessages timeout.'
      );
      receiptsApplied = true;

      // Best-effort app-state cursor using a REAL inbound marker. This mirrors
      // the visual "opened/scrolled to bottom" state on linked WhatsApp UIs.
      // Failure here never changes posting SUCCESS and never deletes content.
      if (latest && typeof socket?.chatModify === 'function') {
        try {
          await withTimeout(
            socket.chatModify({ markRead: true, lastMessages: [latest] }, jid),
            8000,
            'WhatsApp chat read-state timeout.'
          );
          chatStateApplied = true;
        } catch (error) {
          this.emit('diagnostic', {
            type: 'auto_mark_read_chat_state_failed',
            jid,
            accountId: Number(accountId),
            error: String(error?.message || error || 'Unknown chat read-state error')
          });
        }
      }

      // Remove only the keys we actually submitted. Any newer message arriving
      // during the network call remains queued for the next successful post.
      const current = this.autoReadMarkers.get(bucketKey);
      if (current) {
        for (const [markerId] of markers) current.delete(markerId);
        if (!current.size) this.autoReadMarkers.delete(bucketKey);
      }

      return {
        enabled: true,
        applied: true,
        reason: 'MARKED',
        count: readKeys.length,
        chatStateApplied
      };
    } catch (error) {
      // Auto Mark Read is UX only. A successful advert remains SUCCESS even if
      // WhatsApp cannot update read receipts/state at this moment.
      this.emit('diagnostic', {
        type: 'auto_mark_read_failed',
        jid,
        accountId: Number(accountId),
        receiptsApplied,
        error: String(error?.message || error || 'Unknown mark-read error')
      });
      return { enabled: true, applied: false, reason: 'FAILED' };
    }
  }

  // Diagnostic query ONLY after a definite server rejection. Do not use chat
  // announce=true as an upfront Group Status eligibility test: they are different controls.
  async diagnoseGroupStatusFailure(id, groupJid) {
    const socket=this.sockets.get(Number(id))?.socket;
    if(!socket||typeof socket.groupMetadata!=='function')
      return {kind:'UNVERIFIED',note:'No live metadata query is available.'};
    let timer;
    try {
      const metadata=await Promise.race([
        Promise.resolve().then(()=>socket.groupMetadata(String(groupJid))),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('METADATA_TIMEOUT')),4000);timer.unref?.();})
      ]);
      return assessGsMetadata(metadata,{
        id:socket.user?.id,lid:socket.user?.lid,
        // Some sockets expose their sender identity on authState.
        phoneNumber:socket.authState?.creds?.me?.id,
        phoneNumberJid:socket.authState?.creds?.meLid
      });
    } catch(error){return assessGsMetadata(null,{},error);}
    finally {clearTimeout(timer);}
  }

  async sendGroupStatus(id, groupJid, content = {}) {
    assertSavedGroupAccess(this.databasePath,id,groupJid);
    const numericId = Number(id);
    const account = this.get(numericId);
    if (!account || account.status !== 'ONLINE') throw new Error(`Akaun ${numericId} belum ONLINE.`);
    const socket = this.sockets.get(numericId)?.socket;
    if (!socket) throw new Error('Sambungan WhatsApp tiada.');
    let buffer=null;
    if (['PHOTO','VIDEO'].includes(content.kind)) {
      const relative=String(content.mediaPath||'');
      if (!/^media\/group-status\/gs-\d+\/[a-zA-Z0-9._-]+$/.test(relative)) throw new Error('Laluan media Status tidak sah.');
      const file=join(projectRoot,relative);
      if (!existsSync(file)) throw new Error('Media Group Status tidak ditemui.');
      buffer=readFileSync(file);
      if (buffer.length>20*1024*1024) throw new Error('Media melebihi 20 MB.');
    }
    const module = await this.loadLibrary();
    let required = {};
    try { required = require('@whiskeysockets/baileys'); } catch {}
    const lib = { ...(module.default && typeof module.default === 'object' ? module.default : {}), ...required, ...module };
    return sendGroupStatusProtocol(lib,socket,String(groupJid), {
      kind:content.kind,body:content.body,buffer,mime:content.mediaMime,pilotMode:'nexus_meta'
    });
  }

  async sendPostingAd(id, groupJid, ad = {}, hooks = {}) {
    let started=false;
    try{return await this.sendPostingAdInternal(id,groupJid,ad,{...hooks,onSendStarted:()=>{hooks.onSendStarted?.();started=true;}});}
    catch(error){error.sendStarted=started;const code=Number(error.output?.statusCode||error.statusCode||0);error.definiteRejection=[400,401,403,404,405,406,410,413].includes(code);throw error;}
  }
  async sendFollowupAd(id, phone, ad = {}, hooks = {}) {
    if(!/^[1-9]\d{7,14}$/.test(String(phone)))throw Error('Nombor penerima tidak sah.');
    let started=false;
    try{return await this.sendPostingAdInternal(id,String(phone)+'@s.whatsapp.net',ad,{...hooks,onSendStarted:()=>{hooks.onSendStarted?.();started=true;}},true);}
    catch(error){error.sendStarted=started;const code=Number(error.output?.statusCode||error.statusCode||0);error.definiteRejection=[400,401,403,404,405,406,410,413].includes(code);throw error;}
  }
  async sendPostingAdInternal(id, groupJid, ad = {}, hooks = {}, direct = false) {
    let dispatched=false;
    const transmit=(fn,label)=>{hooks.onSendStarted?.();dispatched=true;const promise=Promise.resolve().then(fn);promise.then(sent=>{try{hooks.onSendResult?.(sent);}catch{}},()=>{});return withTimeout(promise,45000,label);};
    if(!direct)assertSavedGroupAccess(this.databasePath,id,groupJid);
    const numericId = Number(id);
    const account = this.get(numericId);
    if (!account) throw new Error('Akaun WhatsApp tidak ditemui.');
    if (account.status !== 'ONLINE') throw new Error(`${account.label} belum ONLINE.`);
    const entry = this.sockets.get(numericId);
    if (!entry?.socket) throw new Error(`${account.label} tiada connection aktif.`);
    const socket = entry.socket;
    const jid = String(groupJid || '').trim();
    if (direct ? !/^[1-9]\d{7,14}@s\.whatsapp\.net$/.test(jid) : !jid.endsWith('@g.us')) throw new Error('Target WhatsApp tidak sah.');

    const kind = String(ad.kind || '').toUpperCase();
    const body = postingBody(ad);
    if (!body) throw new Error('Kandungan iklan kosong.');
    const nativeButtons = postingNativeButtons(ad);

    let mediaBuffer = null;
    if (kind === 'PHOTO' || kind === 'VIDEO') {
      const relative = String(ad.mediaPath || '').trim();
      if (!relative || relative.includes('..')) throw new Error('Fail media iklan tidak sah.');
      const absolute = join(projectRoot, relative);
      if (!existsSync(absolute)) throw new Error('Fail media iklan tidak ditemui.');
      mediaBuffer = readFileSync(absolute);
    } else if (kind !== 'TEXT') {
      throw new Error('Jenis iklan tidak disokong.');
    }

    const standardSend = async (withFallbackCta = false) => {
      const text = withFallbackCta ? postingFallbackBody(ad) : body;
      let content;
      if (kind === 'TEXT') content = { text };
      else if (kind === 'PHOTO') content = { image: mediaBuffer, caption: text, mimetype: ad.mediaMime || 'image/jpeg' };
      else content = { video: mediaBuffer, caption: text, mimetype: ad.mediaMime || 'video/mp4' };
      return transmit(()=>socket.sendMessage(jid, content),'WhatsApp send timeout.');
    };

    let sent;
    let buttonMode = nativeButtons.length ? 'FALLBACK' : 'NONE';
    let buttonError = '';

    if (nativeButtons.length) {
      const helper = this.loadButtonHelper();
      if (helper?.sendInteractiveMessage) {
        try {
          if (kind === 'TEXT') {
            sent = await transmit(()=>helper.sendInteractiveMessage(socket, jid, {text:body,interactiveButtons:nativeButtons}),'WhatsApp interactive send timeout.');
          } else {
            const library = await this.loadLibrary();
            const prepare = library?.prepareWAMessageMedia;
            const proto = library?.proto;
            const upload = socket.waUploadToServer;
            if (typeof prepare !== 'function' || !proto?.Message?.InteractiveMessage?.fromObject || typeof upload !== 'function') {
              throw new Error('WhatsApp interactive media bridge tidak tersedia.');
            }
            const prepared = kind === 'PHOTO'
              ? await prepare({ image: mediaBuffer }, { upload })
              : await prepare({ video: mediaBuffer, mimetype: ad.mediaMime || 'video/mp4' }, { upload });
            const header = {
              hasMediaAttachment: true,
              ...(prepared?.imageMessage ? { imageMessage: prepared.imageMessage } : {}),
              ...(prepared?.videoMessage ? { videoMessage: prepared.videoMessage } : {})
            };
            const interactiveMessage = proto.Message.InteractiveMessage.fromObject({
              header,
              body: { text: body || '\u200B' },
              nativeFlowMessage: { buttons: nativeButtons, messageParamsJson: '' }
            });
            sent = await transmit(()=>helper.sendInteractiveMessage(socket,jid,{interactiveMessage}),'WhatsApp interactive send timeout.');
          }
          buttonMode = 'NATIVE';
        } catch (error) {
          if(dispatched)throw error; // A request already started must never trigger a blind fallback send.
          buttonError = String(error?.message || error || 'Native CTA gagal.');
          sent = await standardSend(true);
          buttonMode = 'FALLBACK';
        }
      } else {
        buttonError = 'Interactive button helper tidak tersedia.';
        sent = await standardSend(true);
      }
    } else {
      sent = await standardSend(false);
    }

    const messageId = String(sent?.key?.id || '').trim();
    if (!messageId) throw new Error('WhatsApp tidak mengesahkan message ID.');
    // Retain the prepared payload, not the raw image/video buffer. This lets a
    // recipient request retry for a failed decrypt without inventing a resend.
    this.rememberOutgoing(numericId, sent, jid);

    const autoRead = direct ? {enabled:false,applied:false} : await this.markPostedGroupRead(numericId, socket, jid).catch(()=>({enabled:true,applied:false,reason:'ERROR'}));
    return {
      account: this.get(numericId) || account,
      groupJid: jid,
      messageId,
      buttonMode,
      autoRead,
      ...(buttonError ? { buttonError } : {})
    };
  }


  async syncGroups(id, onEvent = () => {}) {
    const notify = async event => {
      const state=this.groupSyncs.get(Number(id));if(state)state.progress=event;
      try { this.emit('group-sync',event); } catch {}
      try { await onEvent(event); } catch {}
    };
    const numericId = Number(id);
    if (this.groupSyncs.has(numericId)) throw new Error('Sync group untuk akaun ini sedang berjalan.');

    const account = this.get(numericId);
    if (!account) throw new Error('Akaun WhatsApp tidak ditemui.');
    if (account.status !== 'ONLINE') throw new Error(`${account.label} belum ONLINE. Sambungkan akaun dahulu.`);

    const entry = this.sockets.get(numericId);
    if (!entry?.socket) throw new Error(`${account.label} tiada connection aktif. Cuba .account-reconnect ${account.displayNumber ?? account.id}.`);
    const socket = entry.socket;
    if (typeof socket.groupFetchAllParticipating !== 'function') throw new Error('WhatsApp Engine tidak menyokong Group Sync.');

    const runId = randomUUID();
    const batchSize = 50;
    this.groupSyncs.set(numericId, { runId, startedAt: Date.now() });
    try {
      beginWhatsAppGroupSync(this.databasePath, numericId, runId);
      await notify({ type:'group_sync_start',account,runId });
      let response;
      let fetchAttempt = 0;
      while (fetchAttempt < 2) {
        fetchAttempt += 1;
        try {
          await Promise.resolve(notify({ type: 'group_sync_fetch', account, attempt: fetchAttempt }));
          if(this.shuttingDown||this.get(numericId)?.status!=='ONLINE'||this.sockets.get(numericId)?.socket!==socket)throw new Error('Sambungan terputus; senarai group sebelumnya dikekalkan.');
          response = await withTimeout(socket.groupFetchAllParticipating(),60000,'Group sync timeout.');
          break;
        } catch (error) {
          const code=Number(error?.output?.statusCode||error?.statusCode||error?.status);
          const temporary=[408,429,500,502,503,504,515].includes(code)||/timeout|timed out|network|ECONN|ETIMEDOUT|EAI_AGAIN/i.test(String(error?.message||''));
          if (fetchAttempt >= 2||!temporary||this.shuttingDown||this.get(numericId)?.status!=='ONLINE') throw error;
          await Promise.resolve(notify({ type: 'group_sync_retry', account, attempt: fetchAttempt, error }));
          await sleep(1500);
        }
      }

      if(!response||typeof response!=='object'||Array.isArray(response))throw new Error('Senarai group tidak lengkap. Data lama dikekalkan.');
      const entries = Object.entries(response);
      if(entries.some(([key,g])=>!g||typeof g!=='object'||!String(g.id||key).endsWith('@g.us')))throw new Error('Senarai group tidak lengkap. Data lama dikekalkan.');
      const normalize=jid=>String(jid||'').replace(/:\d+(?=@)/u,'');
      const identities=new Set([socket.user?.id,socket.user?.lid,account.jid,account.phone?account.phone+'@s.whatsapp.net':null].filter(Boolean).map(normalize));
      const total = entries.length;
      let processed = 0;
      let accepted = 0;
      await Promise.resolve(notify({ type: 'group_sync_detected', account, total, runId }));

      for (let start = 0; start < total; start += batchSize) {
        if(this.shuttingDown||this.get(numericId)?.status!=='ONLINE'||this.sockets.get(numericId)?.socket!==socket)throw new Error('Sambungan terputus; senarai group sebelumnya dikekalkan.');
        const slice = entries.slice(start, start + batchSize);
        const minimal = [];
        for (const [key, group] of slice) {
          const jid = String(group?.id || key || '').trim();
          if (!jid.endsWith('@g.us')) continue;
          const self=Array.isArray(group.participants)?group.participants.find(p=>[p.id,p.phoneNumber,p.lid].some(j=>j&&identities.has(normalize(j)))):null;
          const count=Number.isSafeInteger(group.size)&&group.size>=0?group.size:Array.isArray(group.participants)?group.participants.length:null;
          minimal.push({
            jid, subject:String(group.subject||'Belum diketahui'),
            participantCount:count,
            accountRole:self?(['admin','superadmin'].includes(self.admin)||self.isAdmin===true||self.isSuperAdmin===true?'ADMIN':self.admin===null||self.admin===false||self.isAdmin===false&&self.isSuperAdmin===false?'MEMBER':null):null,
            announcement:typeof group.announce==='boolean'?group.announce:null
          });
          // Release heavy participant metadata as early as possible on large accounts.
          if (response && Object.prototype.hasOwnProperty.call(response, key)) delete response[key];
        }
        const staged = stageWhatsAppGroupBatch(this.databasePath, numericId, runId, minimal);
        processed = Math.min(total, start + slice.length);
        accepted = staged.staged;
        await Promise.resolve(notify({ type: 'group_sync_progress', account, processed, total, accepted, runId }));
        await sleep(0);
      }

      if (this.shuttingDown || this.get(numericId)?.status !== 'ONLINE' || this.sockets.get(numericId)?.socket !== socket) throw new Error('Sambungan terputus; senarai group sebelumnya dikekalkan.');
      const result = finalizeWhatsAppGroupSync(this.databasePath, numericId, runId);
      await Promise.resolve(notify({ type: 'group_sync_done', ...result, runId }));
      this.emit('groups-synced', result);
      return result;
    } catch (error) {
      abortWhatsAppGroupSync(this.databasePath, numericId, runId);
      await Promise.resolve(notify({ type: 'group_sync_error', account: this.get(numericId) || account, error, runId }));
      throw error;
    } finally {
      this.groupSyncs.delete(numericId);
    }
  }

  async syncAllGroups(onEvent = () => {}) {
    const accounts = this.list().filter(account => account.status === 'ONLINE');
    const results = [];
    for (const account of accounts) {
      try {
        const result = await this.syncGroups(account.id, onEvent);
        results.push({ account: result.account, ok: true, result });
      } catch (error) {
        results.push({ account: this.get(account.id) || account, ok: false, error });
        onEvent?.({ type: 'group_sync_error', account: this.get(account.id) || account, error });
      }
    }
    return results;
  }

  async reconnect(id) {
    const key = Number(id);
    this.reconnectAttempts.delete(key);
    this.clearReconnectTimer(key);
    this.clearPendingLoginTimer(key);

    const account = this.get(key);
    if (!account) throw new Error('Akaun WhatsApp tidak ditemui.');
    if (account.status === 'LOGGED_OUT') {
      throw new Error(`Akaun telah logout. Guna .account-login ${account.displayNumber ?? account.id} untuk login semula pada slot yang sama.`);
    }

    // Manual reconnect mesti benar-benar membina socket baru. Auth/session
    // sedia ada dikekalkan; kita hanya hentikan transport/socket lama.
    await this.stopSocketAndFlush(key, 'Manual WhatsApp reconnect');
    updateWhatsAppAccount(this.databasePath, key, { status: 'CONNECTING' });
    return this.connect(key, { autoReconnect: true, forceNewSocket: true });
  }

  async logout(id) {
    assertAccountAvailableForRemoval(this.databasePath,id);
    if (this.groupSyncs.has(Number(id))) throw new Error('Tunggu sync group selesai dahulu.');
    const account = this.get(id);
    if (!account) throw new Error('Akaun WhatsApp tidak ditemui.');
    updateWhatsAppAccount(this.databasePath,id,{status:'LOGGED_OUT'});
    this.clearAutoReadMarkersForAccount(id);
    this.invalidateConnection(id);
    const entry = this.sockets.get(Number(id));
    if (entry) {
      try { await withTimeout(entry.socket.logout(),8000,'Logout tamat masa.'); } catch {}
      try { entry.socket.end?.(new Error('Account logged out')); } catch {}
      try { await Promise.race([Promise.resolve(entry.authWriter?.flush?.()), sleep(2000)]); } catch {}
      this.sockets.delete(Number(id));
    }
    this.clearReconnectTimer(id);
    this.clearPendingLoginTimer(id);
    rmSync(join(this.sessionsPath, account.authDir), { recursive: true, force: true });
    return updateWhatsAppAccount(this.databasePath, id, { status: 'LOGGED_OUT', jid: null });
  }

  async delete(id) {
    assertAccountAvailableForRemoval(this.databasePath,id);
    if (this.groupSyncs.has(Number(id))) throw new Error('Tunggu sync group selesai dahulu.');
    const account = this.get(id);
    if (!account) return false;
    updateWhatsAppAccount(this.databasePath,id,{status:'LOGGED_OUT'});
    this.clearAutoReadMarkersForAccount(id);
    this.invalidateConnection(id);
    await this.stopSocketAndFlush(id, 'Account deleted');
    this.clearReconnectTimer(id);
    this.clearPendingLoginTimer(id);
    rmSync(join(this.sessionsPath, account.authDir), { recursive: true, force: true });
    return deleteWhatsAppAccount(this.databasePath, id);
  }

  failReplacement(id) {
    // A failed re-login must never erase the established profile or old auth.
    return this.cancelLogin(id);
  }

  removeLocalAccount(id, { pendingOnly = false } = {}) {
    const existing = this.get(id);
    if (pendingOnly && existing?.lastConnectedAt) return false;
    if (this.loginAttempt?.id === Number(id)) this.loginAttempt = null;
    this.pendingPairingCancels.get(Number(id))?.();
    this.pendingPairingCancels.delete(Number(id));
    this.clearAutoReadMarkersForAccount(id);
    this.clearPendingLoginTimer(id);
    this.invalidateConnection(id);
    this.stopSocket(id, 'Login cancelled');
    this.clearReconnectTimer(id);
    const account = this.get(id);
    if (!account) return;
    rmSync(join(this.sessionsPath, account.authDir), { recursive: true, force: true });
    if (pendingOnly) deletePendingWhatsAppAccount(this.databasePath, id);
    else if (!deletePendingWhatsAppAccount(this.databasePath, id)) deleteWhatsAppAccount(this.databasePath, id);
  }

  async stop() {
    this.shuttingDown = true;
    try { if (this.loginAttempt) await this.cancelLogin(this.loginAttempt.id); } catch { this.loginAttempt = null; }
    for (const timer of this.connectionWatchdogs.values()) clearTimeout(timer);
    this.connectionWatchdogs.clear();
    for (const id of new Set([...this.sockets.keys(), ...this.connecting.keys()])) this.invalidateConnection(id);
    for (const timer of this.reconnectTimers.values()) clearTimeout(timer);
    this.reconnectTimers.clear();
    this.reconnectAttempts.clear();
    for (const timer of this.pendingLoginTimers.values()) clearTimeout(timer);
    this.pendingLoginTimers.clear();
    const activeEntries = [...this.sockets.values()];
    for (const { socket } of activeEntries) {
      try { socket.end?.(new Error('WAPromoBot stopping')); } catch {}
    }
    this.sockets.clear();
    this.autoReadMarkers.clear();
    await Promise.allSettled(activeEntries.map(entry => Promise.race([
      Promise.resolve(entry.authWriter?.flush?.()),
      sleep(2000)
    ])));
  }
}

export { normalizePhone };
