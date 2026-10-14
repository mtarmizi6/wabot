import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeDatabase } from '../src/database/connection.js';
import {
  createPosting as createCurrentPosting, getPosting, getDraftPosting, getCurrentPosting, markPostingReady, reopenPostingDraft,
  createPostingAd, updatePostingAd, listPostingAds, getPostingAd, deletePostingAd,
  addPostingButton, updatePostingButton, deletePostingButton, postingAdSummary, deletePosting,
  getPostingPlan, savePostingPlanAccounts, setPostingCampaignMode, setPostingSuccessTarget, setPostingDaysTarget,
  setPostingContinuous, setPostingReuseMode, updatePostingScheduleSettings, postingPlanSummary,
  markCampaignSendStarted, malaysiaCampaignEnd,
  createPostingJob, getPostingJob, setPostingJobStatus, recoverPostingJobs, claimNextPostingTarget,
  getPostingJobAd, completePostingTarget, listRecentPostingTargets, randomPostingWait,
  claimNextCampaignWork, completeCampaignWork, requeueCampaignWork, getPostingWorker, setPostingWorkerWait, randomWorkerWait,
  postingReportSnapshot, listPendingPostingReports, markPostingReportSent, listPendingPostingCleanup, cleanupPostingJobData,
  deletePostingReportRecord, deleteAllPostingReportRecords, listPostingJobs
} from '../src/posting/store.js';
import { createWhatsAppAccount, updateWhatsAppAccount, syncWhatsAppGroups } from '../src/whatsapp/store.js';
import {
  routeTelegramUpdate, postingNewMessage, postingNamePromptMessage, postingAdInputMessage,
  postingAdsManageMessage, postingAdDetailMessage, postingAdsReadyMessage,
  postingAccountSelectMessage, postingTargetModeMessage, postingTargetSuccessMessage, postingTargetDaysMessage,
  postingReuseMessage, postingScheduleMessage, postingReviewMessage, postingRunBoundaryMessage,
  postingStartedMessage, postingJobStatusMessage
} from '../src/telegram/controller.js';

const owner = '123456789';
// Legacy engine fixtures retain the pre-186 contract. New Client flow is tested
// through its payment confirmation and unique-group cases in client-flow tests.
function createPosting(path,input){const p=createCurrentPosting(path,input);if(p.ownerType==='CLIENT'){const db=new DatabaseSync(path);try{db.prepare('UPDATE postings SET client_flow_version=0 WHERE id=?').run(p.id);}finally{db.close();}}return getPosting(path,p.id);}


function fixture(t) {
  const folder = mkdtempSync(join(tmpdir(), 'wapromobot-posting-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const path = join(folder, 'db.sqlite');
  initializeDatabase(path);
  return path;
}

test('Build 146 posting container locks Sendiri/Client once and survives READY reopen', t => {
  const path = fixture(t);
  const posting = createPosting(path, { ownerType: 'CLIENT', displayName: 'Ahmad Printing' });
  assert.equal(posting.ownerType, 'CLIENT');
  assert.equal(getDraftPosting(path).displayName, 'Ahmad Printing');
  assert.throws(() => createPosting(path, { ownerType: 'SENDIRI', displayName: 'Other' }), /masih aktif/);
  createPostingAd(path, posting.id, { kind: 'TEXT', body: 'Promo pertama' });
  assert.equal(markPostingReady(path, posting.id).status, 'READY');
  assert.equal(getCurrentPosting(path).id, posting.id);
  assert.equal(reopenPostingDraft(path, posting.id).status, 'DRAFT');
});

test('Build 146 ads remain scoped to posting and renumber safely after delete', t => {
  const path = fixture(t);
  const posting = createPosting(path, { ownerType: 'SENDIRI', displayName: 'Promo WA Blaster' });
  createPostingAd(path, posting.id, { kind: 'TEXT', body: 'A' });
  createPostingAd(path, posting.id, { kind: 'PHOTO', body: 'B', mediaPath: 'media/postings/posting-1/b.jpg', mediaMime: 'image/jpeg', mediaSize: 10 });
  createPostingAd(path, posting.id, { kind: 'VIDEO', body: 'C', mediaPath: 'media/postings/posting-1/c.mp4', mediaMime: 'video/mp4', mediaSize: 20 });
  assert.deepEqual(listPostingAds(path, posting.id).map(ad => ad.adNo), [1, 2, 3]);
  const removed = deletePostingAd(path, posting.id, 2);
  assert.equal(removed.kind, 'PHOTO');
  assert.deepEqual(listPostingAds(path, posting.id).map(ad => ad.adNo), [1, 2]);
  assert.equal(getPostingAd(path, posting.id, 2).kind, 'VIDEO');
});

test('Build 146 limits CTA to two buttons and supports edit/delete', t => {
  const path = fixture(t);
  const posting = createPosting(path, { ownerType: 'CLIENT', displayName: 'Ahmad Printing' });
  createPostingAd(path, posting.id, { kind: 'TEXT', body: 'Promo' });
  addPostingButton(path, posting.id, 1, { label: 'WhatsApp Saya', url: 'https://wa.me/60123456789' });
  addPostingButton(path, posting.id, 1, { label: 'Lihat Promosi', url: 'https://example.com/promo' });
  assert.throws(() => addPostingButton(path, posting.id, 1, { label: 'Third', url: 'https://example.com/3' }), /Maksimum 2/);
  updatePostingButton(path, posting.id, 1, 2, { label: 'Promo Baru', url: 'https://example.com/new' });
  assert.equal(getPostingAd(path, posting.id, 1).buttons[1].label, 'Promo Baru');
  deletePostingButton(path, posting.id, 1, 1);
  const buttons = getPostingAd(path, posting.id, 1).buttons;
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].buttonNo, 1);
});

test('Build 146 edit preserves buttons while replacing ad content', t => {
  const path = fixture(t);
  const posting = createPosting(path, { ownerType: 'SENDIRI', displayName: 'Promo' });
  createPostingAd(path, posting.id, { kind: 'TEXT', body: 'Lama' });
  addPostingButton(path, posting.id, 1, { label: 'Beli', url: 'https://example.com' });
  updatePostingAd(path, posting.id, 1, { kind: 'PHOTO', body: 'Baru', mediaPath: 'media/postings/posting-1/a.jpg', mediaMime: 'image/jpeg', mediaSize: 123 });
  const ad = getPostingAd(path, posting.id, 1);
  assert.equal(ad.kind, 'PHOTO');
  assert.equal(ad.body, 'Baru');
  assert.equal(ad.buttons.length, 1);
});

test('Build 146 summary counts ads and buttons per posting', t => {
  const path = fixture(t);
  const posting = createPosting(path, { ownerType: 'CLIENT', displayName: 'Ahmad Printing' });
  createPostingAd(path, posting.id, { kind: 'TEXT', body: 'A' });
  createPostingAd(path, posting.id, { kind: 'TEXT', body: 'B' });
  addPostingButton(path, posting.id, 1, { label: 'A', url: 'https://example.com/a' });
  addPostingButton(path, posting.id, 2, { label: 'B', url: 'https://example.com/b' });
  const summary = postingAdSummary(path, posting.id);
  assert.equal(summary.adCount, 2);
  assert.equal(summary.buttonCount, 2);
  assert.match(postingAdsReadyMessage(summary), /Iklan\s+: 2/);
  assert.match(postingAdsManageMessage(summary), /AHMAD PRINTING/);
  assert.match(postingAdDetailMessage(posting, getPostingAd(path, posting.id, 1)), /PREVIEW/);
  deletePosting(path, posting.id);
  assert.equal(getCurrentPosting(path), null);
});

test('Build 146 routes locked posting, ad and button commands', () => {
  const cases = [
    ['.mula-cancel', 'posting_cancel'], ['.iklan-tambah', 'ad_add'], ['.iklan-siap', 'ad_done'],
    ['.iklan-urus', 'ad_manage'], ['.iklan-back', 'ad_back'], ['.iklan 2', 'ad_detail'],
    ['.iklan-preview 2', 'ad_preview'], ['.iklan-edit 2', 'ad_edit'], ['.iklan-delete 2', 'ad_delete'],
    ['.button-add', 'button_add'], ['.button-skip', 'button_skip'], ['.button-done', 'button_done'],
    ['.button-manage 2', 'button_manage'], ['.button-edit', 'button_edit'], ['.button-edit 1', 'button_edit'],
    ['.button-delete', 'button_delete'], ['.button-delete 2', 'button_delete'], ['.pilih-akaun', 'posting_account_select']
  ];
  for (const [text, action] of cases) {
    const route = routeTelegramUpdate({ message: { from: { id: Number(owner) }, chat: { id: Number(owner), type: 'private' }, text } }, owner);
    assert.equal(route.action, action, text);
  }
});

test('Build 146 recognizes photo and video ad inputs with captions', () => {
  const photo = routeTelegramUpdate({ message: { from: { id: Number(owner) }, chat: { id: Number(owner), type: 'private' }, photo: [{ file_id: 'small', file_size: 10 }, { file_id: 'large', file_size: 20 }], caption: 'Caption gambar' } }, owner);
  assert.equal(photo.action, 'photo');
  assert.equal(photo.media.fileId, 'large');
  assert.equal(photo.text, 'Caption gambar');
  const video = routeTelegramUpdate({ message: { from: { id: Number(owner) }, chat: { id: Number(owner), type: 'private' }, video: { file_id: 'vid', file_size: 30, mime_type: 'video/mp4' }, caption: 'Caption video' } }, owner);
  assert.equal(video.action, 'video');
  assert.equal(video.media.fileId, 'vid');
});

test('Build 146 locked UX asks owner once and moves directly to Iklan 01', () => {
  assert.match(postingNewMessage(), /01\. 📢 SENDIRI/);
  assert.match(postingNewMessage(), /02\. 💼 CLIENT/);
  assert.match(postingNamePromptMessage('CLIENT'), /Masukkan nama client/);
  assert.match(postingNamePromptMessage('SENDIRI'), /nama untuk posting ini/);
  assert.match(postingAdInputMessage({ displayName: 'Ahmad Printing' }, 1), /IKLAN 01 · AHMAD PRINTING/);
});


test('Build 147 stores selected WhatsApp accounts as posting-scoped snapshots and resets target on reselection', t => {
  const path = fixture(t);
  const posting = createPosting(path, { ownerType: 'CLIENT', displayName: 'Ahmad Printing' });
  createPostingAd(path, posting.id, { kind: 'TEXT', body: 'Promo' });
  markPostingReady(path, posting.id);
  const first = savePostingPlanAccounts(path, posting.id, [
    { id: 1, label: 'Akaun 1', phone: '60111111111', groupCount: 28 },
    { id: 2, label: 'Akaun 2', phone: '60222222222', groupCount: 24 }
  ]);
  assert.equal(first.accountCount, 2);
  assert.equal(first.groupCapacity, 52);
  assert.equal(first.targetValue, null);
  assert.equal(setPostingSuccessTarget(path, posting.id, 20).targetValue, 20);
  const second = savePostingPlanAccounts(path, posting.id, [{ id: 2, label: 'Akaun 2', groupCount: 24 }]);
  assert.equal(second.accountCount, 1);
  assert.equal(second.targetValue, null);
  assert.equal(getPostingPlan(path, posting.id).accounts[0].accountId, 2);
});

test('SUCCESS and UNIQUE retain requested target; exhaustion is reported honestly', t => {
  const path = fixture(t);
  const posting = createPosting(path, { ownerType: 'SENDIRI', displayName: 'Promo WA' });
  createPostingAd(path, posting.id, { kind: 'TEXT', body: 'Promo' });
  markPostingReady(path, posting.id);
  savePostingPlanAccounts(path, posting.id, [{ id: 1, label: 'Akaun 1', groupCount: 28 }]);
  const repeat = setPostingSuccessTarget(path, posting.id, 29, 'REPEAT');
  assert.equal(repeat.targetValue, 29);
  assert.equal(repeat.reuseMode, 'REPEAT');
  assert.equal(setPostingSuccessTarget(path, posting.id, 29, 'UNIQUE').targetValue,29);
  const plan = setPostingSuccessTarget(path, posting.id, 10, 'UNIQUE');
  assert.equal(plan.status, 'READY');
  assert.equal(postingPlanSummary(path, posting.id).plan.targetValue, 10);
});

test('Build 147 routes account selection, target and review commands', () => {
  const cases = [
    ['.pilih-akaun 1', 'posting_account_choose'],
    ['.pilih-akaun 1,2', 'posting_account_choose'],
    ['.pilih-akaun all', 'posting_account_choose'],
    ['.target-success', 'posting_target_success'],
    ['.posting-semak', 'posting_review'],
    ['.posting-mula', 'posting_run']
  ];
  for (const [text, action] of cases) {
    const route = routeTelegramUpdate({ message: { from: { id: Number(owner) }, chat: { id: Number(owner), type: 'private' }, text } }, owner);
    assert.equal(route.action, action, text);
  }
});

test('Build 147 account and target UX stays scoped to the same posting container', t => {
  const path = fixture(t);
  const posting = createPosting(path, { ownerType: 'CLIENT', displayName: 'Ahmad Printing' });
  createPostingAd(path, posting.id, { kind: 'PHOTO', body: 'Promo', mediaPath: 'media/postings/posting-1/a.jpg', mediaMime: 'image/jpeg', mediaSize: 10 });
  addPostingButton(path, posting.id, 1, { label: 'WhatsApp Saya', url: 'https://wa.me/60123456789' });
  markPostingReady(path, posting.id);
  const accounts = [
    { id: 1, label: 'Akaun 1', status: 'ONLINE', groupCount: 28 },
    { id: 2, label: 'Akaun 2', status: 'ONLINE', groupCount: 24 }
  ];
  assert.match(postingAccountSelectMessage(posting, accounts), /AHMAD PRINTING/);
  const plan = savePostingPlanAccounts(path, posting.id, accounts);
  assert.match(postingTargetSuccessMessage(posting, plan), /Akses Group\s+: 52/);
  setPostingSuccessTarget(path, posting.id, 20);
  const summary = postingPlanSummary(path, posting.id);
  assert.match(postingReviewMessage(summary), /SUCCESS · 20/);
  assert.match(postingReviewMessage(summary), /Akaun\s+: 2/);
  assert.match(postingRunBoundaryMessage(summary), /Delay : 60–120s/);
});


test('Snapshots account–group pairs and ads into a persistent posting job', t => {
  const path = fixture(t);
  const a1 = createWhatsAppAccount(path, { phone: '60111111111' });
  updateWhatsAppAccount(path, a1.id, { status: 'ONLINE', lastConnectedAt: new Date().toISOString() });
  const a2 = createWhatsAppAccount(path, { phone: '60122222222' });
  updateWhatsAppAccount(path, a2.id, { status: 'ONLINE', lastConnectedAt: new Date().toISOString() });
  syncWhatsAppGroups(path, a1.id, [
    { jid: '111@g.us', subject: 'Alpha', participantCount: 10 },
    { jid: '222@g.us', subject: 'Beta', participantCount: 20 }
  ]);
  syncWhatsAppGroups(path, a2.id, [
    { jid: '222@g.us', subject: 'Beta', participantCount: 20 },
    { jid: '333@g.us', subject: 'Gamma', participantCount: 30 }
  ]);

  const posting = createPosting(path, { ownerType: 'CLIENT', displayName: 'Ahmad Printing' });
  createPostingAd(path, posting.id, { kind: 'TEXT', body: 'Promo A' });
  createPostingAd(path, posting.id, { kind: 'TEXT', body: 'Promo B' });
  addPostingButton(path, posting.id, 1, { label: 'Beli', url: 'https://example.com/beli' });
  markPostingReady(path, posting.id);
  savePostingPlanAccounts(path, posting.id, [
    { ...a1, groupCount: 2 }, { ...a2, groupCount: 2 }
  ]);
  setPostingSuccessTarget(path, posting.id, 3);

  const job = createPostingJob(path, posting.id, { delayMinSec: 10, delayMaxSec: 10, restMinSec: 0, restMaxSec: 0 });
  assert.equal(job.targetSuccess, 3);
  assert.equal(job.totalTargets, 4, 'same JID belongs to two distinct account targets');
  assert.equal(job.ads.length, 2);
  assert.equal(getPostingJobAd(path, job.id, 1).buttons[0].label, 'Beli');
  assert.deepEqual(job.accounts.map(item => item.accountId), [a1.id, a2.id]);
});

test('Build 148 counts SUCCESS only toward target and completes exactly at target', t => {
  const path = fixture(t);
  const a1 = createWhatsAppAccount(path, { phone: '60111111111' });
  updateWhatsAppAccount(path, a1.id, { status: 'ONLINE', lastConnectedAt: new Date().toISOString() });
  syncWhatsAppGroups(path, a1.id, [
    { jid: '111@g.us', subject: 'Alpha' },
    { jid: '222@g.us', subject: 'Beta' },
    { jid: '333@g.us', subject: 'Gamma' }
  ]);
  const posting = createPosting(path, { ownerType: 'SENDIRI', displayName: 'Promo' });
  createPostingAd(path, posting.id, { kind: 'TEXT', body: 'A' });
  createPostingAd(path, posting.id, { kind: 'TEXT', body: 'B' });
  markPostingReady(path, posting.id);
  savePostingPlanAccounts(path, posting.id, [{ ...a1, groupCount: 3 }]);
  setPostingSuccessTarget(path, posting.id, 2);
  let job = createPostingJob(path, posting.id, { delayMinSec: 10, delayMaxSec: 10, restMinSec: 0, restMaxSec: 0 });
  setPostingJobStatus(path, job.id, 'RUNNING');

  const one = claimNextPostingTarget(path, job.id, [a1.id]);
  assert.equal(one.adNo, 1);
  job = completePostingTarget(path, one.id, { success: false, error: 'No permission' });
  assert.equal(job.successCount, 0);
  assert.equal(job.failedCount, 1);
  assert.equal(job.status, 'RUNNING');

  const two = claimNextPostingTarget(path, job.id, [a1.id]);
  assert.equal(two.adNo, 2);
  job = completePostingTarget(path, two.id, { success: true, messageId: 'm2' });
  assert.equal(job.successCount, 1);
  assert.equal(job.remainingSuccess, 1);

  const three = claimNextPostingTarget(path, job.id, [a1.id]);
  job = completePostingTarget(path, three.id, { success: true, messageId: 'm3' });
  assert.equal(job.status, 'COMPLETED');
  assert.equal(job.successCount, 2);
  assert.equal(job.failedCount, 1);
  assert.equal(job.remainingSuccess, 0);
  assert.equal(listRecentPostingTargets(path, job.id, 10).length, 3);
});

test('Build 149 restart recovery pauses campaign and retains uncertainty without retry', t => {
  const path = fixture(t);
  const a1 = createWhatsAppAccount(path, { phone: '60111111111' });
  updateWhatsAppAccount(path, a1.id, { status: 'ONLINE', lastConnectedAt: new Date().toISOString() });
  syncWhatsAppGroups(path, a1.id, [{ jid: '111@g.us', subject: 'Alpha' }]);
  const posting = createPosting(path, { ownerType: 'SENDIRI', displayName: 'Promo' });
  createPostingAd(path, posting.id, { kind: 'TEXT', body: 'A' });
  markPostingReady(path, posting.id);
  savePostingPlanAccounts(path, posting.id, [{ ...a1, groupCount: 1 }]);
  setPostingSuccessTarget(path, posting.id, 1);
  const job = createPostingJob(path, posting.id, { delayMinSec: 10, delayMaxSec: 10, restMinSec: 0, restMaxSec: 0 });
  setPostingJobStatus(path, job.id, 'RUNNING');
  const work=claimNextCampaignWork(path,a1.id,[a1.id]);assert.ok(work);markCampaignSendStarted(path,work);
  const recovered = recoverPostingJobs(path);
  assert.equal(recovered.interruptedTargets, 1);
  assert.equal(recovered.resumedJobs, 0);
  const after = getPostingJob(path, job.id);
  assert.equal(after.status, 'PAUSED');
  assert.equal(after.failedCount, 0);assert.equal(after.unknownCount,1);
  assert.equal(claimNextPostingTarget(path, job.id, [a1.id]), null, 'uncertain target is not retried automatically');
});

test('Build 148 posting controls route and status UI exposes pause/resume/stop', () => {
  const cases = [
    ['.status 7', 'posting_status'],
    ['.posting-pause 7', 'posting_pause'],
    ['.posting-resume 7', 'posting_resume'],
    ['.posting-stop 7', 'posting_stop']
  ];
  for (const [text, action] of cases) {
    const route = routeTelegramUpdate({ message: { from: { id: Number(owner) }, chat: { id: Number(owner), type: 'private' }, text } }, owner);
    assert.equal(route.action, action, text);
  }
  const job = {
    id: 7, displayName: 'Promo', status: 'RUNNING', targetSuccess: 5, successCount: 2,
    failedCount: 1, remainingSuccess: 3, processedCount: 3, delayMinSec: 60, delayMaxSec: 120,
    batchSize: 5, restMinSec: 300, restMaxSec: 600,
    accounts: [{ accountLabel: 'Akaun 1', successCount: 2, failedCount: 1 }], totalTargets: 20
  };
  assert.match(postingStartedMessage({ ...job, targetMode: 'SUCCESS' }), /KEMPEN 1/);
  assert.match(postingJobStatusMessage(job, []), /posting-pause 1/);
});

test('Build 148 scheduler switches from delay to batch rest deterministically', () => {
  const job = { delayMinSec: 60, delayMaxSec: 120, batchSize: 5, restMinSec: 300, restMaxSec: 600 };
  assert.deepEqual(randomPostingWait(job, { batchProcessed: 4 }, () => 0), { kind: 'DELAY', seconds: 60, resetBatch: false });
  assert.deepEqual(randomPostingWait(job, { batchProcessed: 5 }, () => 0), { kind: 'REST', seconds: 300, resetBatch: true });
});

test('Build 149 routes final campaign mode, reuse, setting and delete controls', () => {
  const cases = [
    ['.target', 'posting_target_mode'],
    ['.target success', 'posting_target_success'],
    ['.target hari', 'posting_target_days'],
    ['.target terus', 'posting_target_continuous'],
    ['.reuse ulang', 'posting_reuse_repeat'],
    ['.reuse unique', 'posting_reuse_unique'],
    ['.setting-posting', 'posting_setting'],
    ['.setting-default', 'posting_setting_default'],
    ['.setting-custom', 'posting_setting_custom'],
    ['.campaigns', 'posting_active'],
    ['.campaign-delete 7', 'posting_delete'],
    ['.campaign-delete 7 CONFIRM', 'posting_delete'],
    ['.report-delete 7', 'report_delete'],
    ['.report-delete 7 CONFIRM', 'report_delete'],
    ['.report-delete all', 'report_delete'],
    ['.report-delete all CONFIRM', 'report_delete']
  ];
  for (const [text, action] of cases) {
    const route = routeTelegramUpdate({ message: { from: { id: Number(owner) }, chat: { id: Number(owner), type: 'private' }, text } }, owner);
    assert.equal(route.action, action, text);
  }
});

test('Build 149 stores SUCCESS, HARI, BERTERUSAN and custom pacing per campaign', t => {
  const path = fixture(t);
  const posting = createPosting(path, { ownerType: 'CLIENT', displayName: 'Kedai Abu' });
  createPostingAd(path, posting.id, { kind: 'TEXT', body: 'Promo' });
  markPostingReady(path, posting.id);
  savePostingPlanAccounts(path, posting.id, [
    { id: 1, label: 'Akaun 1', groupCount: 50 },
    { id: 2, label: 'Akaun 2', groupCount: 30 }
  ]);

  let plan = setPostingSuccessTarget(path, posting.id, 250, 'REPEAT');
  assert.equal(plan.targetMode, 'SUCCESS');
  assert.equal(plan.targetValue, 250);
  assert.equal(plan.reuseMode, 'REPEAT');
  assert.match(postingTargetModeMessage(posting, plan), /SUCCESS/);
  assert.match(postingReuseMessage(posting, plan), /ULANG SAMPAI TARGET/);

  plan = setPostingDaysTarget(path, posting.id, 3);
  assert.equal(plan.targetMode, 'DAYS');
  assert.equal(plan.targetValue, 3);
  assert.match(postingTargetDaysMessage(posting, plan), /HARI/);

  plan = setPostingContinuous(path, posting.id);
  assert.equal(plan.targetMode, 'CONTINUOUS');
  assert.equal(plan.targetValue, null);

  plan = updatePostingScheduleSettings(path, posting.id, {
    delayMinSec: 45, delayMaxSec: 90, batchSize: 7, restMinSec: 480, restMaxSec: 900
  });
  assert.equal(plan.delayMinSec, 45);
  assert.equal(plan.delayMaxSec, 90);
  assert.equal(plan.batchSize, 7);
  assert.equal(plan.restMinSec, 480);
  assert.equal(plan.restMaxSec, 900);
  assert.match(postingScheduleMessage(posting, plan), /45–90/);
});

function makeOnlineAccountWithGroups(path, phone, subjects) {
  const account = createWhatsAppAccount(path, { phone });
  updateWhatsAppAccount(path, account.id, { status: 'ONLINE', lastConnectedAt: new Date().toISOString() });
  syncWhatsAppGroups(path, account.id, subjects.map((subject, index) => ({
    jid: `${account.id}${index + 1}${phone.slice(-3)}@g.us`, subject, participantCount: 10 + index
  })));
  return account;
}

function makeContinuousCampaign(path, name, accounts) {
  const posting = createPosting(path, { ownerType: 'CLIENT', displayName: name });
  createPostingAd(path, posting.id, { kind: 'TEXT', body: `${name} iklan` });
  markPostingReady(path, posting.id);
  savePostingPlanAccounts(path, posting.id, accounts.map(account => ({ ...account, groupCount: 2 })));
  setPostingContinuous(path, posting.id);
  const job = createPostingJob(path, posting.id, { delayMinSec: 10, delayMaxSec: 10, restMinSec: 0, restMaxSec: 0 });
  return setPostingJobStatus(path, job.id, 'RUNNING');
}

test('Build 149 global fair queue gives next campaign to whichever account worker is available', t => {
  const path = fixture(t);
  const accounts = [
    makeOnlineAccountWithGroups(path, '60111111111', ['A1', 'A2']),
    makeOnlineAccountWithGroups(path, '60122222222', ['B1', 'B2']),
    makeOnlineAccountWithGroups(path, '60133333333', ['C1', 'C2'])
  ];
  const jobs = [1, 2, 3, 4].map(n => makeContinuousCampaign(path, `Client ${n}`, accounts));
  const online = accounts.map(a => a.id);

  const w1 = claimNextCampaignWork(path, accounts[0].id, online);
  const w2 = claimNextCampaignWork(path, accounts[1].id, online);
  const w3 = claimNextCampaignWork(path, accounts[2].id, online);
  assert.deepEqual([w1.jobId, w2.jobId, w3.jobId], [jobs[0].id, jobs[1].id, jobs[2].id]);
  completeCampaignWork(path, w1, { success: true, messageId: 'm1' });
  const next = claimNextCampaignWork(path, accounts[0].id, online,Date.now()+1000000);
  assert.equal(next.jobId, jobs[3].id, 'available worker takes next global campaign, not a hard-coded account slot');
});

test('offline account requeues its work while another account completes the same campaign', t => {
  const path = fixture(t);
  const first = makeOnlineAccountWithGroups(path, '60177777771', ['A']);
  const second = makeOnlineAccountWithGroups(path, '60177777772', ['B']);
  const posting = createPosting(path, { ownerType: 'CLIENT', displayName: 'Recovery' });
  createPostingAd(path, posting.id, { kind: 'TEXT', body: 'Iklan' });
  markPostingReady(path, posting.id);
  savePostingPlanAccounts(path, posting.id, [first, second].map(account => ({ ...account, groupCount: 1 })));
  setPostingSuccessTarget(path, posting.id, 2, 'REPEAT');
  const job = setPostingJobStatus(path, createPostingJob(path, posting.id).id, 'RUNNING');

  const interrupted = claimNextCampaignWork(path, first.id, [first.id, second.id]);
  updateWhatsAppAccount(path, first.id, { status: 'OFFLINE' });
  assert.equal(requeueCampaignWork(path, interrupted.id, 'Connection closed'), true);
  assert.equal(claimNextCampaignWork(path, first.id, [second.id]), null);

  const healthy = claimNextCampaignWork(path, second.id, [second.id]);
  assert.equal(healthy.accountId, second.id);
  completeCampaignWork(path, healthy, { success: true, messageId: 'healthy-1' });
  const next = claimNextCampaignWork(path, second.id, [second.id],Date.now()+1000000);
  assert.equal(next.roundNo, 2, 'healthy account repeats its own group without waiting for offline account');
  const completed = completeCampaignWork(path, next, { success: true, messageId: 'healthy-2' });
  assert.equal(completed.status, 'COMPLETED');
  assert.equal(completed.successCount, 2);
  assert.equal(completed.failedCount, 0);
});

test('Build 149 SUCCESS REPEAT advances each account round independently until global target', t => {
  const path = fixture(t);
  const account = makeOnlineAccountWithGroups(path, '60144444444', ['G1', 'G2']);
  const posting = createPosting(path, { ownerType: 'CLIENT', displayName: 'Awareness 4' });
  createPostingAd(path, posting.id, { kind: 'TEXT', body: 'Iklan' });
  markPostingReady(path, posting.id);
  savePostingPlanAccounts(path, posting.id, [{ ...account, groupCount: 2 }]);
  setPostingSuccessTarget(path, posting.id, 4, 'REPEAT');
  let job = createPostingJob(path, posting.id, { delayMinSec: 10, delayMaxSec: 10, restMinSec: 0, restMaxSec: 0 });
  job = setPostingJobStatus(path, job.id, 'RUNNING');
  const online = [account.id];

  const first = claimNextCampaignWork(path, account.id, online);
  completeCampaignWork(path, first, { success: true, messageId: '1' });
  const second = claimNextCampaignWork(path, account.id, online,Date.now()+1000000);
  completeCampaignWork(path, second, { success: true, messageId: '2' });
  const third = claimNextCampaignWork(path, account.id, online,Date.now()+1000000);
  assert.equal(third.roundNo, 2);
  assert.equal(third.groupJid, first.groupJid, 'account loops back to its own Group 01 without waiting for another account');
  completeCampaignWork(path, third, { success: true, messageId: '3' });
  const fourth = claimNextCampaignWork(path, account.id, online,Date.now()+1000000);
  job = completeCampaignWork(path, fourth, { success: true, messageId: '4' });
  assert.equal(job.status, 'COMPLETED');
  assert.equal(job.successCount, 4);
  assert.equal(job.accounts[0].currentRound, 2);
});

test('Build 149 atomic SUCCESS reservation prevents workers overshooting the global quota', t => {
  const path = fixture(t);
  const accounts = [
    makeOnlineAccountWithGroups(path, '60155555551', ['A']),
    makeOnlineAccountWithGroups(path, '60155555552', ['B']),
    makeOnlineAccountWithGroups(path, '60155555553', ['C'])
  ];
  const posting = createPosting(path, { ownerType: 'CLIENT', displayName: 'Target 2' });
  createPostingAd(path, posting.id, { kind: 'TEXT', body: 'Iklan' });
  markPostingReady(path, posting.id);
  savePostingPlanAccounts(path, posting.id, accounts.map(account => ({ ...account, groupCount: 1 })));
  setPostingSuccessTarget(path, posting.id, 2, 'REPEAT');
  const job = setPostingJobStatus(path, createPostingJob(path, posting.id).id, 'RUNNING');
  const online = accounts.map(a => a.id);

  assert.ok(claimNextCampaignWork(path, accounts[0].id, online));
  assert.ok(claimNextCampaignWork(path, accounts[1].id, online));
  assert.equal(claimNextCampaignWork(path, accounts[2].id, online), null);
  assert.equal(getPostingJob(path, job.id).successCount, 0);
});

test('Build 149 DAYS deadline and CONTINUOUS mode are independent stop conditions', t => {
  const path = fixture(t);
  const account = makeOnlineAccountWithGroups(path, '60166666666', ['A', 'B']);

  const daysPosting = createPosting(path, { ownerType: 'CLIENT', displayName: '3 Hari' });
  createPostingAd(path, daysPosting.id, { kind: 'TEXT', body: 'Hari' });
  markPostingReady(path, daysPosting.id);
  savePostingPlanAccounts(path, daysPosting.id, [{ ...account, groupCount: 2 }]);
  setPostingDaysTarget(path, daysPosting.id, 3);
  let daysJob = createPostingJob(path, daysPosting.id);
  daysJob = setPostingJobStatus(path, daysJob.id, 'RUNNING');
  assert.equal(daysJob.targetMode, 'DAYS');
  const ms = Date.parse(daysJob.endsAt) - Date.parse(daysJob.startedAt);
  assert.equal(daysJob.endsAt,malaysiaCampaignEnd(daysJob.startedAt,3));assert.ok(ms>2*86400000&&ms<=3*86400000);

  const continuousPosting = createPosting(path, { ownerType: 'CLIENT', displayName: 'Berterusan' });
  createPostingAd(path, continuousPosting.id, { kind: 'TEXT', body: 'Terus' });
  markPostingReady(path, continuousPosting.id);
  savePostingPlanAccounts(path, continuousPosting.id, [{ ...account, groupCount: 2 }]);
  setPostingContinuous(path, continuousPosting.id);
  const continuousJob = setPostingJobStatus(path, createPostingJob(path, continuousPosting.id).id, 'RUNNING');
  assert.equal(continuousJob.targetMode, 'CONTINUOUS');
  assert.equal(continuousJob.endsAt, null);
});

test('Build 149 report snapshot keeps full group evidence and cleanup waits until Telegram report is SENT', t => {
  const path = fixture(t);
  const account = makeOnlineAccountWithGroups(path, '60177777777', ['Report Group']);
  const posting = createPosting(path, { ownerType: 'CLIENT', displayName: 'Report Client' });
  createPostingAd(path, posting.id, { kind: 'TEXT', body: 'Iklan report' });
  addPostingButton(path, posting.id, 1, { label: 'WhatsApp', url: 'https://wa.me/60111111111' });
  markPostingReady(path, posting.id);
  savePostingPlanAccounts(path, posting.id, [{ ...account, groupCount: 1 }]);
  setPostingSuccessTarget(path, posting.id, 1, 'REPEAT');
  const job = setPostingJobStatus(path, createPostingJob(path, posting.id).id, 'RUNNING');
  const work = claimNextCampaignWork(path, account.id, [account.id]);
  const done = completeCampaignWork(path, work, { success: true, messageId: 'report-msg' });
  assert.equal(done.status, 'COMPLETED');

  const snapshot = postingReportSnapshot(path, job.id);
  assert.equal(snapshot.attempts.length, 1);
  assert.equal(snapshot.attempts[0].status, 'SUCCESS');
  assert.equal(snapshot.attempts[0].groupName, 'Report Group');
  assert.equal(snapshot.ads[0].buttonCount, 1);
  assert.throws(() => cleanupPostingJobData(path, job.id), /Report belum selamat dihantar/);

  markPostingReportSent(path, job.id, 'CAM-001-Report-Client-Report.txt');
  assert.equal(listPendingPostingCleanup(path).some(item => item.id === job.id), true);
  const cleaned = cleanupPostingJobData(path, job.id);
  assert.equal(cleaned.alreadyDone, false);
  const after = getPostingJob(path, job.id);
  assert.ok(after.cleanupAt);
  assert.equal(after.accounts.length, 0);
  assert.equal(postingReportSnapshot(path, job.id).attempts.length, 0);
});

test('Build 149 worker pacing is global per account and batch rest does not reset when campaign changes', t => {
  const path = fixture(t);
  const workerBefore = getPostingWorker(path, 9);
  assert.equal(workerBefore.batchProcessed, 0);
  // Simulate five completed sends from different campaigns by directly validating shared worker wait policy.
  const work = { delayMinSec: 60, delayMaxSec: 120, batchSize: 5, restMinSec: 300, restMaxSec: 600 };
  assert.deepEqual(randomWorkerWait(work, { batchProcessed: 4 }, () => 0), { kind: 'DELAY', seconds: 60, resetBatch: false });
  assert.deepEqual(randomWorkerWait(work, { batchProcessed: 5 }, () => 0), { kind: 'REST', seconds: 300, resetBatch: true });
  const at = setPostingWorkerWait(path, 9, 0, { resetBatch: true, jobId: 99 });
  assert.ok(Date.parse(at) <= Date.now() + 1000);
  assert.equal(getPostingWorker(path, 9).lastJobId, 99);
});


test('Build 149 STOP waits for in-flight WhatsApp work before final TXT becomes reportable', t => {
  const path = fixture(t);
  const account = makeOnlineAccountWithGroups(path, '60188888888', ['In Flight']);
  const posting = createPosting(path, { ownerType: 'CLIENT', displayName: 'Stop Safely' });
  createPostingAd(path, posting.id, { kind: 'TEXT', body: 'Iklan' });
  markPostingReady(path, posting.id);
  savePostingPlanAccounts(path, posting.id, [{ ...account, groupCount: 1 }]);
  setPostingSuccessTarget(path, posting.id, 5, 'REPEAT');
  const job = setPostingJobStatus(path, createPostingJob(path, posting.id).id, 'RUNNING');
  const work = claimNextCampaignWork(path, account.id, [account.id]);
  assert.ok(work);
  setPostingJobStatus(path, job.id, 'STOPPED');
  assert.equal(listPendingPostingReports(path).length, 0, 'report must wait until PROCESSING send settles');
  completeCampaignWork(path, work, { success: true, messageId: 'late-confirmed' });
  assert.equal(listPendingPostingReports(path).some(item => item.id === job.id), true);
  const snapshot = postingReportSnapshot(path, job.id);
  assert.equal(snapshot.attempts.length, 1);
  assert.equal(snapshot.attempts[0].status, 'SUCCESS');
});


test('Build 153 report history supports delete one and delete all only after report+cleanup', t => {
  const path = fixture(t);
  const account = createWhatsAppAccount(path, { phone: '60111111111' });
  updateWhatsAppAccount(path, account.id, { status: 'ONLINE', lastConnectedAt: new Date().toISOString() });
  syncWhatsAppGroups(path, account.id, [{ jid: '15301@g.us', subject: 'Build 153 Group', participantCount: 10 }]);

  function finishedJob(name) {
    const posting = createPosting(path, { ownerType: 'CLIENT', displayName: name });
    createPostingAd(path, posting.id, { kind: 'TEXT', body: 'Promo' });
    markPostingReady(path, posting.id);
    savePostingPlanAccounts(path, posting.id, [{ id: account.id, label: 'Akaun 1', groupCount: 1 }]);
    setPostingSuccessTarget(path, posting.id, 1, 'REPEAT');
    const job = createPostingJob(path, posting.id);
    setPostingJobStatus(path, job.id, 'STOPPED');
    markPostingReportSent(path, job.id, `CAM-${job.id}.txt`);
    cleanupPostingJobData(path, job.id);
    return job.id;
  }

  const first = finishedJob('Client A');
  const second = finishedJob('Client B');
  assert.equal(listPostingJobs(path, { activeOnly: false, page: 1, perPage: 50 }).total, 2);

  const one = deletePostingReportRecord(path, first);
  assert.equal(one.deleted, true);
  assert.equal(getPostingJob(path, first), null);
  assert.ok(getPostingJob(path, second));

  const all = deleteAllPostingReportRecords(path);
  assert.equal(all.deleted, 1);
  assert.equal(getPostingJob(path, second), null);
  assert.equal(listPostingJobs(path, { activeOnly: false, page: 1, perPage: 50 }).total, 0);
});

test('Build 153 refuses to delete active or unsent report history', t => {
  const path = fixture(t);
  const account = createWhatsAppAccount(path, { phone: '60122222222' });
  updateWhatsAppAccount(path, account.id, { status: 'ONLINE', lastConnectedAt: new Date().toISOString() });
  syncWhatsAppGroups(path, account.id, [{ jid: '15302@g.us', subject: 'Build 153 Active Group', participantCount: 10 }]);
  const posting = createPosting(path, { ownerType: 'SENDIRI', displayName: 'Active Campaign' });
  createPostingAd(path, posting.id, { kind: 'TEXT', body: 'Promo' });
  markPostingReady(path, posting.id);
  savePostingPlanAccounts(path, posting.id, [{ id: account.id, label: 'Akaun 1', groupCount: 1 }]);
  setPostingSuccessTarget(path, posting.id, 1, 'REPEAT');
  const job = createPostingJob(path, posting.id);
  assert.throws(() => deletePostingReportRecord(path, job.id), /masih aktif/);
  setPostingJobStatus(path, job.id, 'STOPPED');
  assert.throws(() => deletePostingReportRecord(path, job.id), /belum berjaya dihantar/);
});
