import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeDatabase } from '../src/database/connection.js';
import { parseWhatsAppInviteLinks, nextAutoJoinWait, DEFAULT_AUTO_JOIN_SCHEDULER, classifyAutoJoinError, autoJoinRetryDelayMs } from '../src/whatsapp/join.js';
import {
  createWhatsAppAccount, updateWhatsAppAccount,
  createAutoJoinJob, getAutoJoinJobAccounts, setAutoJoinJobStatus,
  claimNextAutoJoinTarget, completeAutoJoinTarget, refreshAutoJoinJobStats,
  listAutoJoinTargets, recoverAutoJoinJobs, recordAutoJoinAccountSchedule, listRecentAutoJoinTargets, requeueAutoJoinTarget, setAutoJoinAccountWait, getAutoJoinSettings, updateAutoJoinSettings, resetAutoJoinSettings
} from '../src/whatsapp/store.js';
import { WhatsAppManager } from '../src/whatsapp/manager.js';
import { routeTelegramUpdate, joinReviewMessage, joinStatusMessage, joinInputMessage, joinReportDetailMessage } from '../src/telegram/controller.js';

function fixture(t) {
  const folder = mkdtempSync(join(tmpdir(), 'wapromobot-autojoin-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const db = join(folder, 'app.sqlite');
  initializeDatabase(db);
  return { folder, db, sessions: join(folder, 'sessions') };
}

function onlineAccount(db, phone = '60111111111') {
  const account = createWhatsAppAccount(db, { phone });
  return updateWhatsAppAccount(db, account.id, { status: 'ONLINE', lastConnectedAt: new Date().toISOString() });
}

test('Auto Join parser accepts WhatsApp invite links and removes duplicates', () => {
  const parsed = parseWhatsAppInviteLinks(`
https://chat.whatsapp.com/ABCDEFGHIJKLmnop123456
https://chat.whatsapp.com/ABCDEFGHIJKLmnop123456
not-a-whatsapp-link
https://chat.whatsapp.com/invite/ZYXWVUTSRQPOnmlk654321
  `);
  assert.equal(parsed.totalInput, 3);
  assert.equal(parsed.validCount, 2);
  assert.equal(parsed.duplicateCount, 1);
  assert.equal(parsed.invalidCount, 0);
  assert.equal(parsed.targets[0].inviteCode, 'ABCDEFGHIJKLmnop123456');
});

test('Auto Join job persists queue, account selection and atomic target progress', t => {
  const { db } = fixture(t);
  const a1 = onlineAccount(db, '60111111111');
  const a2 = onlineAccount(db, '60222222222');
  const parsed = parseWhatsAppInviteLinks('https://chat.whatsapp.com/ABCDEFGHIJKLmnop123456\nhttps://chat.whatsapp.com/ZYXWVUTSRQPOnmlk654321');
  const job = createAutoJoinJob(db, { accountIds: [a1.id, a2.id], mode: 'all', parsed });
  assert.deepEqual(getAutoJoinJobAccounts(db, job.id).map(x => x.id), [a1.id, a2.id]);
  setAutoJoinJobStatus(db, job.id, 'RUNNING');
  const first = claimNextAutoJoinTarget(db, job.id, a1.id);
  assert.equal(first.position, 1);
  completeAutoJoinTarget(db, first.id, { success: true, groupJid: '1@g.us', groupName: 'Group One', participantCount: 123 });
  const second = claimNextAutoJoinTarget(db, job.id, a2.id);
  completeAutoJoinTarget(db, second.id, { success: false, error: 'Invite invalid' });
  const progress = refreshAutoJoinJobStats(db, job.id);
  assert.equal(progress.processed, 2);
  assert.equal(progress.successCount, 1);
  assert.equal(progress.failedCount, 1);
  assert.equal(listAutoJoinTargets(db, job.id).items[0].groupName, 'Group One');
});

test('Controller restart recovers RUNNING Auto Join as PAUSED and requeues processing target', t => {
  const { db } = fixture(t);
  const account = onlineAccount(db);
  const parsed = parseWhatsAppInviteLinks('https://chat.whatsapp.com/ABCDEFGHIJKLmnop123456');
  const job = createAutoJoinJob(db, { accountIds: [account.id], mode: 'single', parsed });
  setAutoJoinJobStatus(db, job.id, 'RUNNING');
  claimNextAutoJoinTarget(db, job.id, account.id);
  const recovered = recoverAutoJoinJobs(db);
  assert.equal(recovered.pausedJobs, 1);
  assert.equal(recovered.resetTargets, 1);
  const progress = refreshAutoJoinJobStats(db, job.id);
  assert.equal(progress.status, 'PAUSED');
  assert.equal(progress.pending, 1);
  assert.equal(progress.processing, 0);
});

test('WhatsApp manager joins invite using live account socket and returns minimal metadata', async t => {
  const { db, sessions } = fixture(t);
  const account = onlineAccount(db);
  const manager = new WhatsAppManager({ databasePath: db, sessionsPath: sessions });
  t.after(() => manager.stop());
  manager.sockets.set(account.id, {
    socket: {
      groupGetInviteInfo: async () => ({ subject: 'Preview Group', size: 100 }),
      groupAcceptInvite: async code => { assert.equal(code, 'ABCDEFGHIJKLmnop123456'); return '999@g.us'; },
      groupMetadata: async jid => ({ id: jid, subject: 'Joined Group', participants: Array.from({ length: 4 }, () => ({})) })
    },
    autoReconnect: true
  });
  const result = await manager.joinGroupInvite(account.id, 'ABCDEFGHIJKLmnop123456');
  assert.equal(result.groupJid, '999@g.us');
  assert.equal(result.groupName, 'Joined Group');
  assert.equal(result.participantCount, 4);
});

test('Auto Join classic commands and TXT document route owner-only', () => {
  const owner = '123456789';
  const cases = new Map([
    ['.join 1', 'join_select'], ['.join all', 'join_select'], ['.join-link', 'join_link'], ['.join-txt', 'join_txt'],
    ['.join-start 7', 'join_run'], ['.join-pause 7', 'join_pause'], ['.join-resume 7', 'join_resume'],
    ['.join-stop 7', 'join_stop'], ['.join-status 7', 'join_status'], ['.join-report-info 7 2', 'join_report_info'], ['.join-setting', 'join_setting'], ['.join-setting custom', 'join_setting_custom']
  ]);
  for (const [text, action] of cases) {
    const route = routeTelegramUpdate({ message: { from: { id: Number(owner) }, chat: { id: Number(owner), type: 'private' }, text } }, owner);
    assert.equal(route.action, action);
  }
  const doc = routeTelegramUpdate({ message: { from: { id: Number(owner) }, chat: { id: Number(owner), type: 'private' }, document: { file_id: 'f1', file_name: 'groups.txt', mime_type: 'text/plain', file_size: 20 } } }, owner);
  assert.equal(doc.action, 'document');
  assert.equal(doc.document.fileName, 'groups.txt');
});

test('Auto Join review and status UI keep classic command flow', () => {
  const job = { id: 3, mode: 'single', totalInput: 5, validCount: 3, duplicateCount: 1, invalidCount: 1, status: 'PAUSED', targetTotal: 3, processed: 1, successCount: 1, failedCount: 0 };
  assert.match(joinReviewMessage(job, [{ label: 'Akaun 1' }]), /→ \.join-start 3/);
  assert.match(joinStatusMessage(job, [{ label: 'Akaun 1' }]), /→ \.join-resume 3/);
  assert.doesNotMatch(joinStatusMessage(job, [{ label: 'Akaun 1' }]), /@g\.us/);
});

test('Auto Join input screen accepts direct paste or TXT after account selection', () => {
  const text = joinInputMessage('Semua Akaun · 2 ONLINE');
  assert.match(text, /Hantar senarai group sekarang/);
  assert.match(text, /Tampal link terus/);
  assert.match(text, /Atau hantar fail \.txt/);
  assert.match(text, /Auto Detect/);
});


test('Auto Join scheduler uses locked random delay, batch rest and cooldown defaults', () => {
  assert.deepEqual(DEFAULT_AUTO_JOIN_SCHEDULER, {
    delayMinSec: 60, delayMaxSec: 120, batchSize: 5, restMinSec: 300, restMaxSec: 600, cooldownEvery: 25, cooldownSec: 900
  });
  const normal = nextAutoJoinWait({}, { processedCount: 0, batchProcessed: 0 }, () => 0);
  assert.equal(normal.type, 'delay');
  assert.equal(normal.waitSec, 60);
  const rest = nextAutoJoinWait({}, { processedCount: 4, batchProcessed: 4 }, () => 0);
  assert.equal(rest.type, 'batch-rest');
  assert.equal(rest.restSec, 300);
  const cooldown = nextAutoJoinWait({}, { processedCount: 24, batchProcessed: 4 }, () => 0);
  assert.equal(cooldown.type, 'cooldown');
  assert.equal(cooldown.restSec, 900);
});

test('Auto Join schedule persists per-account wait and recent results are capped to 10', t => {
  const { db } = fixture(t);
  const account = onlineAccount(db);
  const lines = Array.from({ length: 12 }, (_, i) => `https://chat.whatsapp.com/INVITECODE${String(i).padStart(10, '0')}`).join('\n');
  const parsed = parseWhatsAppInviteLinks(lines);
  const job = createAutoJoinJob(db, { accountIds: [account.id], mode: 'single', parsed });
  setAutoJoinJobStatus(db, job.id, 'RUNNING');
  for (let i = 0; i < 12; i += 1) {
    const target = claimNextAutoJoinTarget(db, job.id, account.id);
    completeAutoJoinTarget(db, target.id, { success: true, groupJid: `${i}@g.us`, groupName: `Group ${i + 1}`, participantCount: i + 10 });
  }
  recordAutoJoinAccountSchedule(db, job.id, account.id, { delaySec: 75, restSec: 0, resetBatch: false });
  const scheduled = getAutoJoinJobAccounts(db, job.id)[0];
  assert.equal(scheduled.lastDelaySec, 75);
  assert.ok(Date.parse(scheduled.availableAt) > Date.now());
  const recent = listRecentAutoJoinTargets(db, job.id, 10);
  assert.equal(recent.length, 10);
  assert.equal(recent[0].groupName, 'Group 12');
  assert.equal(recent[9].groupName, 'Group 3');
  const ui = joinStatusMessage(refreshAutoJoinJobStats(db, job.id), [scheduled], recent);
  assert.match(ui, /10 TERKINI/);
  assert.doesNotMatch(ui, /Group 1\n/);
});


test('STOPPED Auto Join with baki exposes resume command without resetting processed links', () => {
  const job = { id: 9, mode: 'all', totalInput: 50, validCount: 50, status: 'STOPPED', targetTotal: 50, processed: 44, successCount: 35, failedCount: 9 };
  const message = joinStatusMessage(job, [{ label: 'Akaun 1' }, { label: 'Akaun 2' }], []);
  assert.match(message, /Sambung Baki/);
  assert.match(message, /→ \.join-resume 9/);
  assert.match(message, /Baki\s+: 6/);
});


test('Auto Join classifies temporary errors for retry but invalid links as final', () => {
  assert.equal(classifyAutoJoinError(Object.assign(new Error('ETIMEDOUT network timeout'), {joinDispatched:false})).retryable, true);
  assert.equal(classifyAutoJoinError(new Error('invite invalid or expired')).retryable, false);
  assert.match(classifyAutoJoinError(new Error('invite invalid or expired')).userMessage, /tidak sah \/ tamat tempoh/i);
  assert.deepEqual([1, 2, 3, 9].map(autoJoinRetryDelayMs), [3000, 10000, 30000, 30000]);
});

test('Temporary account failure can requeue target without counting it failed', t => {
  const { db } = fixture(t);
  const account = onlineAccount(db);
  const parsed = parseWhatsAppInviteLinks('https://chat.whatsapp.com/ABCDEFGHIJKLmnop123456');
  const job = createAutoJoinJob(db, { accountIds: [account.id], mode: 'single', parsed });
  setAutoJoinJobStatus(db, job.id, 'RUNNING');
  const target = claimNextAutoJoinTarget(db, job.id, account.id);
  requeueAutoJoinTarget(db, target.id, 'Sambungan terganggu');
  const progress = refreshAutoJoinJobStats(db, job.id);
  assert.equal(progress.pending, 1);
  assert.equal(progress.processing, 0);
  assert.equal(progress.failedCount, 0);
});

test('Circuit wait does not increment processed account counter', t => {
  const { db } = fixture(t);
  const account = onlineAccount(db);
  const parsed = parseWhatsAppInviteLinks('https://chat.whatsapp.com/ABCDEFGHIJKLmnop123456');
  const job = createAutoJoinJob(db, { accountIds: [account.id], mode: 'single', parsed });
  const before = getAutoJoinJobAccounts(db, job.id)[0];
  const result = setAutoJoinAccountWait(db, job.id, account.id, 300);
  const after = getAutoJoinJobAccounts(db, job.id)[0];
  assert.ok(Date.parse(result.availableAt) > Date.now());
  assert.equal(after.processedCount, before.processedCount);
});


test('Auto Join settings default to STANDARD and new jobs snapshot custom values', t => {
  const { db } = fixture(t);
  const account = onlineAccount(db);
  const standard = getAutoJoinSettings(db);
  assert.equal(standard.mode, 'STANDARD');
  assert.equal(standard.delayMinSec, 60);
  const custom = updateAutoJoinSettings(db, { mode: 'CUSTOM', delayMinSec: 75, delayMaxSec: 150, batchSize: 4, restMinSec: 360, restMaxSec: 720, cooldownEvery: 20, cooldownSec: 1200 });
  assert.equal(custom.mode, 'CUSTOM');
  const parsed = parseWhatsAppInviteLinks('https://chat.whatsapp.com/ABCDEFGHIJKLmnop123456');
  const job = createAutoJoinJob(db, { accountIds: [account.id], mode: 'single', parsed });
  assert.equal(job.delayMinSec, 75);
  assert.equal(job.delayMaxSec, 150);
  assert.equal(job.batchSize, 4);
  const reset = resetAutoJoinSettings(db);
  assert.equal(reset.mode, 'STANDARD');
  assert.equal(reset.delayMinSec, 60);
});

test('Auto Join report page keeps live summary visible above paginated history', () => {
  const job = { id: 4, status: 'RUNNING', targetTotal: 50, validCount: 50, processed: 21, successCount: 18, failedCount: 3 };
  const message = joinReportDetailMessage(job, { items: [], page: 2, totalPages: 5 });
  assert.match(message, /Progress\s+: 21 \/ 50/);
  assert.match(message, /Baki\s+: 29/);
  assert.match(message, /→ \.join-status 4/);
  assert.match(message, /Page : 2 \/ 5/);
});
