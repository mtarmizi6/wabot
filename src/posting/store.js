import {capturePolicy} from '../system/policy.js';
import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

function withDb(path, fn) {
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
    return fn(db);
  } finally {
    db.close();
  }
}

function normalizeOwnerType(value) {
  const type = String(value || '').trim().toUpperCase();
  if (!['SENDIRI', 'CLIENT'].includes(type)) throw new Error('Jenis posting tidak sah.');
  return type;
}

function normalizeDisplayName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (!name || name.length > 120) throw new Error('Nama posting/client mesti 1–120 aksara.');
  return name;
}

function normalizeKind(value) {
  const kind = String(value || '').trim().toUpperCase();
  if (!['TEXT', 'PHOTO', 'VIDEO'].includes(kind)) throw new Error('Jenis iklan tidak sah.');
  return kind;
}

function postingSelect() {
  return `
    SELECT id, owner_type AS ownerType, display_name AS displayName, client_id AS clientId, client_name AS clientName, client_flow_version AS clientFlowVersion, charge_cents AS chargeCents, paid_full_at AS paidFullAt, payment_fingerprint AS paymentFingerprint, status,
           created_at AS createdAt, updated_at AS updatedAt, ready_at AS readyAt
    FROM postings`;
}

function adSelect() {
  return `
    SELECT id, posting_id AS postingId, ad_no AS adNo, kind, body,
           media_path AS mediaPath, media_mime AS mediaMime, media_size AS mediaSize,
           created_at AS createdAt, updated_at AS updatedAt
    FROM posting_ads`;
}

function buttonSelect() {
  return `
    SELECT id, ad_id AS adId, button_no AS buttonNo, label, url,
           created_at AS createdAt, updated_at AS updatedAt
    FROM posting_ad_buttons`;
}

function getPostingFromDb(db, id) {
  return db.prepare(`${postingSelect()} WHERE id = ?`).get(Number(id)) || null;
}

function getAdFromDb(db, postingId, adNo) {
  return db.prepare(`${adSelect()} WHERE posting_id = ? AND ad_no = ?`).get(Number(postingId), Number(adNo)) || null;
}

export function getDraftPosting(path) {
  return withDb(path, db => db.prepare(`${postingSelect()} WHERE status = 'DRAFT' ORDER BY id DESC LIMIT 1`).get() || null);
}

export function getLatestReadyPosting(path) {
  return withDb(path, db => db.prepare(`${postingSelect()} WHERE status = 'READY' AND id NOT IN (SELECT posting_id FROM posting_archives) ORDER BY updated_at DESC, id DESC LIMIT 1`).get() || null);
}

// A READY setup remains a draft until a campaign job has been created.
export function getUnstartedPosting(path) {
  return withDb(path, db => db.prepare(`${postingSelect()} WHERE status IN ('DRAFT','READY')
    AND id NOT IN (SELECT posting_id FROM posting_jobs)
    AND id NOT IN (SELECT posting_id FROM posting_archives)
    ORDER BY id DESC LIMIT 1`).get() || null);
}

export function getPostingJobForPosting(path, postingId) {
  return withDb(path, db => hydratePostingJob(db, db.prepare(`${postingJobSelect()} WHERE j.posting_id=? ORDER BY j.id DESC LIMIT 1`).get(Number(postingId))));
}

export function getCurrentPosting(path) {
  return getDraftPosting(path) || getLatestReadyPosting(path);
}

export function getPosting(path, id) {
  return withDb(path, db => getPostingFromDb(db, id));
}

export function createPosting(path, { ownerType, displayName }) {
  const type = normalizeOwnerType(ownerType);
  const name = normalizeDisplayName(displayName);
  return withDb(path, db => {
    const current = db.prepare(`${postingSelect()} WHERE status IN ('DRAFT','READY') AND id NOT IN (SELECT posting_id FROM posting_jobs) AND id NOT IN (SELECT posting_id FROM posting_archives) ORDER BY id DESC LIMIT 1`).get();
    if (current) throw new Error(`Draf ${current.displayName} masih aktif.`);
    const now = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO postings (owner_type, display_name, status, created_at, updated_at)
      VALUES (?, ?, 'DRAFT', ?, ?)
    `).run(type, name, now, now);
    if(type==='CLIENT')db.prepare('UPDATE postings SET client_flow_version=186 WHERE id=?').run(Number(result.lastInsertRowid));
    return getPostingFromDb(db, Number(result.lastInsertRowid));
  });
}

export function reopenPostingDraft(path, postingId) {
  return withDb(path, db => {
    const id = Number(postingId);
    const posting = getPostingFromDb(db, id);
    if (!posting) throw new Error('Posting tidak ditemui.');
    if (posting.status === 'DRAFT') return posting;
    const other = db.prepare(`${postingSelect()} WHERE status = 'DRAFT' AND id <> ? LIMIT 1`).get(id);
    if (other) throw new Error(`Draf ${other.displayName} masih aktif.`);
    const now = new Date().toISOString();
    db.prepare("UPDATE postings SET status = 'DRAFT', ready_at = NULL, updated_at = ? WHERE id = ?").run(now, id);
    return getPostingFromDb(db, id);
  });
}

export function markPostingReady(path, postingId) {
  return withDb(path, db => {
    const id = Number(postingId);
    const adCount = Number(db.prepare('SELECT count(*) AS n FROM posting_ads WHERE posting_id = ?').get(id)?.n || 0);
    if (adCount < 1) throw new Error('Masukkan sekurang-kurangnya satu iklan.');
    const now = new Date().toISOString();
    db.prepare("UPDATE postings SET status = 'READY', ready_at = ?, updated_at = ? WHERE id = ?").run(now, now, id);
    return getPostingFromDb(db, id);
  });
}

export function deleteDraftPosting(path, postingId = null) {
  return withDb(path, db => {
    const row = postingId == null
      ? db.prepare(`${postingSelect()} WHERE status = 'DRAFT' ORDER BY id DESC LIMIT 1`).get()
      : db.prepare(`${postingSelect()} WHERE id = ? AND status = 'DRAFT'`).get(Number(postingId));
    if (!row) return null;
    db.prepare('DELETE FROM postings WHERE id = ?').run(Number(row.id));
    return row;
  });
}

export function deletePosting(path, postingId) {
  return withDb(path, db => {
    const row = getPostingFromDb(db, postingId);
    if (!row) return null;
    db.prepare('DELETE FROM postings WHERE id = ?').run(Number(postingId));
    return row;
  });
}

export function listPostingAds(path, postingId) {
  return withDb(path, db => db.prepare(`
    SELECT a.id, a.posting_id AS postingId, a.ad_no AS adNo, a.kind, a.body,
           a.media_path AS mediaPath, a.media_mime AS mediaMime, a.media_size AS mediaSize,
           a.created_at AS createdAt, a.updated_at AS updatedAt,
           count(b.id) AS buttonCount
    FROM posting_ads a
    LEFT JOIN posting_ad_buttons b ON b.ad_id = a.id
    WHERE a.posting_id = ?
    GROUP BY a.id
    ORDER BY a.ad_no
  `).all(Number(postingId)).map(row => ({ ...row, buttonCount: Number(row.buttonCount || 0) })));
}

export function getPostingAd(path, postingId, adNo) {
  return withDb(path, db => {
    const ad = getAdFromDb(db, postingId, adNo);
    if (!ad) return null;
    const buttons = db.prepare(`${buttonSelect()} WHERE ad_id = ? ORDER BY button_no`).all(Number(ad.id));
    return { ...ad, buttons };
  });
}

export function createPostingAd(path, postingId, input = {}) {
  const kind = normalizeKind(input.kind);
  const body = String(input.body || '').trim();
  if (!body) throw new Error(kind === 'TEXT' ? 'Teks iklan tidak boleh kosong.' : 'Caption iklan tidak boleh kosong.');
  if (body.length > 4096) throw new Error('Teks/caption maksimum 4096 aksara.');
  const mediaPath = input.mediaPath ? String(input.mediaPath) : null;
  const mediaMime = input.mediaMime ? String(input.mediaMime) : null;
  const mediaSize = Math.max(0, Number(input.mediaSize || 0));
  if (kind !== 'TEXT' && !mediaPath) throw new Error('Media iklan tidak ditemui.');
  return withDb(path, db => {
    const posting = getPostingFromDb(db, postingId);
    if (!posting) throw new Error('Posting tidak ditemui.');
    const adNo = Number(db.prepare('SELECT coalesce(max(ad_no), 0) + 1 AS n FROM posting_ads WHERE posting_id = ?').get(Number(postingId))?.n || 1);
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO posting_ads
        (posting_id, ad_no, kind, body, media_path, media_mime, media_size, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(Number(postingId), adNo, kind, body, mediaPath, mediaMime, mediaSize, now, now);
    db.prepare('UPDATE postings SET updated_at = ?, status = \'DRAFT\', ready_at = NULL WHERE id = ?').run(now, Number(postingId));
    return getAdFromDb(db, postingId, adNo);
  });
}

export function updatePostingAd(path, postingId, adNo, input = {}) {
  const kind = normalizeKind(input.kind);
  const body = String(input.body || '').trim();
  if (!body) throw new Error(kind === 'TEXT' ? 'Teks iklan tidak boleh kosong.' : 'Caption iklan tidak boleh kosong.');
  if (body.length > 4096) throw new Error('Teks/caption maksimum 4096 aksara.');
  const mediaPath = input.mediaPath ? String(input.mediaPath) : null;
  const mediaMime = input.mediaMime ? String(input.mediaMime) : null;
  const mediaSize = Math.max(0, Number(input.mediaSize || 0));
  if (kind !== 'TEXT' && !mediaPath) throw new Error('Media iklan tidak ditemui.');
  return withDb(path, db => {
    const existing = getAdFromDb(db, postingId, adNo);
    if (!existing) throw new Error('Iklan tidak ditemui.');
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE posting_ads
      SET kind = ?, body = ?, media_path = ?, media_mime = ?, media_size = ?, updated_at = ?
      WHERE id = ?
    `).run(kind, body, mediaPath, mediaMime, mediaSize, now, Number(existing.id));
    db.prepare('UPDATE postings SET updated_at = ?, status = \'DRAFT\', ready_at = NULL WHERE id = ?').run(now, Number(postingId));
    return getAdFromDb(db, postingId, adNo);
  });
}

export function deletePostingAd(path, postingId, adNo) {
  return withDb(path, db => {
    const existing = getAdFromDb(db, postingId, adNo);
    if (!existing) return null;
    db.exec('BEGIN IMMEDIATE;');
    try {
      db.prepare('DELETE FROM posting_ads WHERE id = ?').run(Number(existing.id));
      db.prepare('UPDATE posting_ads SET ad_no = ad_no + 1000000 WHERE posting_id = ? AND ad_no > ?').run(Number(postingId), Number(adNo));
      db.prepare('UPDATE posting_ads SET ad_no = ad_no - 1000001 WHERE posting_id = ? AND ad_no > 1000000').run(Number(postingId));
      db.prepare("UPDATE postings SET updated_at = ?, status = 'DRAFT', ready_at = NULL WHERE id = ?").run(new Date().toISOString(), Number(postingId));
      db.exec('COMMIT;');
      return existing;
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  });
}

export function listPostingButtons(path, postingId, adNo) {
  const ad = getPostingAd(path, postingId, adNo);
  return ad?.buttons || [];
}

export function addPostingButton(path, postingId, adNo, { label, url }) {
  const safeLabel = String(label || '').trim().replace(/\s+/g, ' ');
  const safeUrl = String(url || '').trim();
  if (!safeLabel || safeLabel.length > 64) throw new Error('Nama button mesti 1–64 aksara.');
  let parsed;
  try { parsed = new URL(safeUrl); } catch { throw new Error('Link button tidak sah.'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Link button mesti bermula http:// atau https://');
  return withDb(path, db => {
    const ad = getAdFromDb(db, postingId, adNo);
    if (!ad) throw new Error('Iklan tidak ditemui.');
    const existing = db.prepare(`${buttonSelect()} WHERE ad_id = ? ORDER BY button_no`).all(Number(ad.id));
    if (existing.length >= 2) throw new Error('Maksimum 2 button untuk setiap iklan.');
    const used = new Set(existing.map(item => Number(item.buttonNo)));
    const buttonNo = used.has(1) ? 2 : 1;
    const now = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO posting_ad_buttons (ad_id, button_no, label, url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(Number(ad.id), buttonNo, safeLabel, safeUrl, now, now);
    db.prepare("UPDATE postings SET updated_at = ?, status = 'DRAFT', ready_at = NULL WHERE id = ?").run(now, Number(postingId));
    return db.prepare(`${buttonSelect()} WHERE id = ?`).get(Number(result.lastInsertRowid));
  });
}

export function updatePostingButton(path, postingId, adNo, buttonNo, patch = {}) {
  return withDb(path, db => {
    const ad = getAdFromDb(db, postingId, adNo);
    if (!ad) throw new Error('Iklan tidak ditemui.');
    const existing = db.prepare(`${buttonSelect()} WHERE ad_id = ? AND button_no = ?`).get(Number(ad.id), Number(buttonNo));
    if (!existing) throw new Error('Button tidak ditemui.');
    const label = patch.label == null ? existing.label : String(patch.label).trim().replace(/\s+/g, ' ');
    const url = patch.url == null ? existing.url : String(patch.url).trim();
    if (!label || label.length > 64) throw new Error('Nama button mesti 1–64 aksara.');
    let parsed;
    try { parsed = new URL(url); } catch { throw new Error('Link button tidak sah.'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Link button mesti bermula http:// atau https://');
    const now = new Date().toISOString();
    db.prepare('UPDATE posting_ad_buttons SET label = ?, url = ?, updated_at = ? WHERE id = ?').run(label, url, now, Number(existing.id));
    db.prepare("UPDATE postings SET updated_at = ?, status = 'DRAFT', ready_at = NULL WHERE id = ?").run(now, Number(postingId));
    return db.prepare(`${buttonSelect()} WHERE id = ?`).get(Number(existing.id));
  });
}

export function deletePostingButton(path, postingId, adNo, buttonNo) {
  return withDb(path, db => {
    const ad = getAdFromDb(db, postingId, adNo);
    if (!ad) throw new Error('Iklan tidak ditemui.');
    const existing = db.prepare(`${buttonSelect()} WHERE ad_id = ? AND button_no = ?`).get(Number(ad.id), Number(buttonNo));
    if (!existing) return null;
    db.exec('BEGIN IMMEDIATE;');
    try {
      db.prepare('DELETE FROM posting_ad_buttons WHERE id = ?').run(Number(existing.id));
      db.prepare('UPDATE posting_ad_buttons SET button_no = button_no - 1 WHERE ad_id = ? AND button_no > ?').run(Number(ad.id), Number(buttonNo));
      db.prepare("UPDATE postings SET updated_at = ?, status = 'DRAFT', ready_at = NULL WHERE id = ?").run(new Date().toISOString(), Number(postingId));
      db.exec('COMMIT;');
      return existing;
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  });
}

export function postingAdSummary(path, postingId) {
  return withDb(path, db => {
    const posting = getPostingFromDb(db, postingId);
    if (!posting) return null;
    const ads = db.prepare(`
      SELECT a.id, a.ad_no AS adNo, a.kind, a.body, a.media_path AS mediaPath,
             count(b.id) AS buttonCount
      FROM posting_ads a
      LEFT JOIN posting_ad_buttons b ON b.ad_id = a.id
      WHERE a.posting_id = ?
      GROUP BY a.id
      ORDER BY a.ad_no
    `).all(Number(postingId)).map(row => ({ ...row, buttonCount: Number(row.buttonCount || 0) }));
    const buttonCount = ads.reduce((sum, ad) => sum + Number(ad.buttonCount || 0), 0);
    return { posting, ads, adCount: ads.length, buttonCount };
  });
}

function normalizePostingPlanAccounts(accounts = []) {
  const unique = new Map();
  for (const raw of accounts || []) {
    const id = Number(raw?.id);
    if (!Number.isInteger(id) || id < 1) continue;
    unique.set(id, {
      id,
      label: String(raw?.label || `Akaun ${id}`).trim() || `Akaun ${id}`,
      phone: raw?.phone ? String(raw.phone) : null,
      groupCount: Math.max(0, Number(raw?.groupCount || 0) || 0)
    });
  }
  if (!unique.size) throw new Error('Pilih sekurang-kurangnya satu akaun WhatsApp ONLINE.');
  return [...unique.values()].sort((a, b) => a.id - b.id);
}

function normalizeCampaignMode(value) {
  const mode = String(value || '').trim().toUpperCase();
  if (!['SUCCESS','DAYS','CONTINUOUS'].includes(mode)) throw new Error('Mode campaign tidak sah.');
  return mode;
}

function normalizeReuseMode(value) {
  const mode = String(value || 'REPEAT').trim().toUpperCase();
  if (!['REPEAT','UNIQUE'].includes(mode)) throw new Error('Mode group reuse tidak sah.');
  return mode;
}

export function validatePostingSettings(input = {}) {
  const result = {delayMinSec:60,delayMaxSec:120,batchSize:5,restMinSec:300,restMaxSec:600,...input};
  const {delayMinSec,delayMaxSec,batchSize,restMinSec,restMaxSec}=result;
  if(![delayMinSec,delayMaxSec,batchSize,restMinSec,restMaxSec].every(Number.isInteger) || delayMinSec<10 || delayMaxSec<delayMinSec || delayMaxSec>3600 || batchSize<1 || batchSize>100 || restMinSec<0 || restMaxSec<restMinSec || restMaxSec>21600)throw new Error('Tetapan delay / batch / rehat tidak sah.');
  return {delayMinSec,delayMaxSec,batchSize,restMinSec,restMaxSec};
}

function ensureCampaignPlan(db, postingId) {
  const id = Number(postingId);
  let plan = db.prepare('SELECT * FROM posting_campaign_plans WHERE posting_id = ?').get(id);
  if (plan) return plan;
  const legacy = db.prepare('SELECT * FROM posting_plans WHERE posting_id = ?').get(id);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO posting_campaign_plans
      (posting_id, target_mode, target_value, reuse_mode, delay_min_sec, delay_max_sec,
       batch_size, rest_min_sec, rest_max_sec, status, created_at, updated_at)
    VALUES (?, 'SUCCESS', ?, 'REPEAT', 60, 120, 5, 300, 600, ?, ?, ?)
  `).run(id, legacy?.target_value ?? null, legacy?.status || 'DRAFT', legacy?.created_at || now, now);
  const defaults=db.prepare("SELECT value FROM system_meta WHERE key='posting_defaults'").get();
  if(defaults){const d=validatePostingSettings(JSON.parse(defaults.value));db.prepare('UPDATE posting_campaign_plans SET delay_min_sec=?,delay_max_sec=?,batch_size=?,rest_min_sec=?,rest_max_sec=? WHERE posting_id=?').run(d.delayMinSec,d.delayMaxSec,d.batchSize,d.restMinSec,d.restMaxSec,id);}
  return db.prepare('SELECT * FROM posting_campaign_plans WHERE posting_id = ?').get(id);
}

export function getPostingPlan(path, postingId) {
  return withDb(path, db => {
    const id = Number(postingId);
    const plan = ensureCampaignPlan(db, id);
    if (!plan) return null;
    const accounts = db.prepare(`
      SELECT account_id AS accountId, account_label AS accountLabel,
             phone_snapshot AS phone, group_count_snapshot AS groupCount,
             created_at AS createdAt
      FROM posting_plan_accounts WHERE posting_id = ? ORDER BY account_id
    `).all(id).map(row => ({ ...row, accountId: Number(row.accountId), groupCount: Number(row.groupCount || 0) }));
    return {
      review:plan.review_json?JSON.parse(plan.review_json):null,
      postingId: id,
      targetMode: plan.target_mode,
      targetValue: plan.target_value == null ? null : Number(plan.target_value),
      reuseMode: plan.reuse_mode,
      delayMinSec: Number(plan.delay_min_sec), delayMaxSec: Number(plan.delay_max_sec),
      batchSize: Number(plan.batch_size), restMinSec: Number(plan.rest_min_sec), restMaxSec: Number(plan.rest_max_sec),
      status: plan.account_selection_dirty ? 'DRAFT' : plan.status, accountsNeedReview:Boolean(plan.account_selection_dirty), createdAt: plan.created_at, updatedAt: plan.updated_at,
      accounts, accountCount: accounts.length,
      groupCapacity: accounts.reduce((sum, item) => sum + Number(item.groupCount || 0), 0)
    };
  });
}

export function savePostingPlanAccounts(path, postingId, accounts = []) {
  const selected = normalizePostingPlanAccounts(accounts);
  return withDb(path, db => {
    const posting = getPostingFromDb(db, postingId);
    if (!posting) throw new Error('Posting tidak ditemui.');
    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE;');
    try {
      ensureCampaignPlan(db, postingId);
      db.prepare(`UPDATE posting_campaign_plans SET target_value = NULL, status = 'DRAFT', account_selection_dirty = 0, updated_at = ? WHERE posting_id = ?`).run(now, Number(postingId));
      db.prepare('DELETE FROM posting_plan_accounts WHERE posting_id = ?').run(Number(postingId));
      const insert = db.prepare(`
        INSERT INTO posting_plan_accounts
          (posting_id, account_id, account_label, phone_snapshot, group_count_snapshot, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const account of selected) insert.run(Number(postingId), account.id, account.label, account.phone, account.groupCount, now);
      db.prepare('UPDATE postings SET updated_at = ? WHERE id = ?').run(now, Number(postingId));
      db.exec('COMMIT;');
    } catch (error) { db.exec('ROLLBACK;'); throw error; }
    return getPostingPlan(path, postingId);
  });
}

export function setPostingCampaignMode(path, postingId, mode) {
  const targetMode = normalizeCampaignMode(mode);
  return withDb(path, db => {
    if (!getPostingFromDb(db, postingId)) throw new Error('Posting tidak ditemui.');
    ensureCampaignPlan(db, postingId);
    const count = Number(db.prepare('SELECT count(*) AS n FROM posting_plan_accounts WHERE posting_id = ?').get(Number(postingId))?.n || 0);
    if (!count) throw new Error('Pilih akaun WhatsApp dahulu.');
    const now = new Date().toISOString();
    db.prepare(`UPDATE posting_campaign_plans SET target_mode = ?, target_value = NULL, status = ?, updated_at = ? WHERE posting_id = ?`)
      .run(targetMode, targetMode === 'CONTINUOUS' ? 'READY' : 'DRAFT', now, Number(postingId));
    return getPostingPlan(path, postingId);
  });
}

export function setPostingSuccessTarget(path, postingId, targetValue, reuseMode = null) {
  const target = Number(targetValue);
  if (!Number.isInteger(target) || target < 1 || target > 1000000) throw new Error('Jumlah SUCCESS mesti nombor bulat 1–1,000,000.');
  return withDb(path, db => {
    if (!getPostingFromDb(db, postingId)) throw new Error('Posting tidak ditemui.');
    const plan = ensureCampaignPlan(db, postingId);
    const stats = db.prepare(`SELECT count(*) AS accountCount, coalesce(sum(group_count_snapshot),0) AS groupCapacity FROM posting_plan_accounts WHERE posting_id = ?`).get(Number(postingId));
    const accountCount = Number(stats?.accountCount || 0), groupCapacity = Number(stats?.groupCapacity || 0);
    if (!accountCount) throw new Error('Pilih akaun WhatsApp dahulu.');
    if (groupCapacity < 1) throw new Error('Akaun dipilih belum mempunyai group. Sync group dahulu.');
    const clientPackage=isClientPosting(getPostingFromDb(db,postingId));
    const capacity=clientPackage?clientTargets(db,postingId).length:groupCapacity;
    if(clientPackage&&target>capacity)throw new Error(`Target ${target} Group WhatsApp melebihi ${capacity} group unik tersedia. Sync / pilih akaun lain atau kurangkan target.`);
    const reuse = clientPackage?'UNIQUE':normalizeReuseMode(reuseMode || plan.reuse_mode || 'REPEAT');
    const now = new Date().toISOString();
    db.prepare(`UPDATE posting_campaign_plans SET target_mode='SUCCESS', target_value=?, reuse_mode=?, status='READY', updated_at=? WHERE posting_id=?`)
      .run(target, reuse, now, Number(postingId));
    return getPostingPlan(path, postingId);
  });
}

export function setPostingDaysTarget(path, postingId, days) {
  const value = Number(days);
  if (!Number.isInteger(value) || value < 1 || value > 3650) throw new Error('Tempoh HARI mesti nombor bulat 1–3650.');
  return withDb(path, db => {
    if (!getPostingFromDb(db, postingId)) throw new Error('Posting tidak ditemui.');
    ensureCampaignPlan(db, postingId);
    const count = Number(db.prepare('SELECT count(*) AS n FROM posting_plan_accounts WHERE posting_id = ?').get(Number(postingId))?.n || 0);
    if (!count) throw new Error('Pilih akaun WhatsApp dahulu.');
    const now = new Date().toISOString();
    db.prepare(`UPDATE posting_campaign_plans SET target_mode='DAYS', target_value=?, reuse_mode='REPEAT', status='READY', updated_at=? WHERE posting_id=?`)
      .run(value, now, Number(postingId));
    return getPostingPlan(path, postingId);
  });
}

export function setPostingContinuous(path, postingId) {
  return withDb(path, db => {
    if (!getPostingFromDb(db, postingId)) throw new Error('Posting tidak ditemui.');
    ensureCampaignPlan(db, postingId);
    const count = Number(db.prepare('SELECT count(*) AS n FROM posting_plan_accounts WHERE posting_id = ?').get(Number(postingId))?.n || 0);
    if (!count) throw new Error('Pilih akaun WhatsApp dahulu.');
    const now = new Date().toISOString();
    db.prepare(`UPDATE posting_campaign_plans SET target_mode='CONTINUOUS', target_value=NULL, reuse_mode='REPEAT', status='READY', updated_at=? WHERE posting_id=?`)
      .run(now, Number(postingId));
    return getPostingPlan(path, postingId);
  });
}

export function setPostingReuseMode(path, postingId, reuseMode) {
  const reuse = normalizeReuseMode(reuseMode);
  return withDb(path, db => {
    const plan = ensureCampaignPlan(db, postingId);
    if(isClientPosting(getPostingFromDb(db,postingId))&&reuse!=='UNIQUE')throw new Error('Pakej client SUCCESS menggunakan group unik tanpa ulang.');
    if (plan.target_mode !== 'SUCCESS') throw new Error('Group reuse hanya untuk mode SUCCESS.');
    const target = Number(plan.target_value || 0);
    const capacity = Number(db.prepare('SELECT coalesce(sum(group_count_snapshot),0) AS n FROM posting_plan_accounts WHERE posting_id=?').get(Number(postingId))?.n || 0);
    db.prepare('UPDATE posting_campaign_plans SET reuse_mode=?, updated_at=? WHERE posting_id=?').run(reuse, new Date().toISOString(), Number(postingId));
    return getPostingPlan(path, postingId);
  });
}

export function updatePostingScheduleSettings(path, postingId, input = {}) {
  const settings = validatePostingSettings(input);
  return withDb(path, db => {
    ensureCampaignPlan(db, postingId);
    db.prepare(`UPDATE posting_campaign_plans SET delay_min_sec=?, delay_max_sec=?, batch_size=?, rest_min_sec=?, rest_max_sec=?, updated_at=? WHERE posting_id=?`)
      .run(settings.delayMinSec, settings.delayMaxSec, settings.batchSize, settings.restMinSec, settings.restMaxSec, new Date().toISOString(), Number(postingId));
    return getPostingPlan(path, postingId);
  });
}

export function postingPlanSummary(path, postingId) {
  const summary = postingAdSummary(path, postingId);
  if (!summary) return null;
  return { ...summary, plan: getPostingPlan(path, postingId), payment: postingPaymentState(path,postingId) };
}

function postingJobSelect() {
  return `
    SELECT j.id, j.posting_id AS postingId, j.status, j.charge_cents AS chargeCents, j.paid_full_at AS paidFullAt, j.target_unit AS targetUnit,
           j.target_success AS targetSuccess,
           j.target_mode AS targetMode, j.target_days AS targetDays, j.reuse_mode AS reuseMode,
           j.ends_at AS endsAt, j.last_claimed_at AS lastClaimedAt, j.next_ad_no AS nextAdNo,
           j.report_status AS reportStatus, j.report_attempts AS reportAttempts,
           j.report_retry_at AS reportRetryAt, j.report_filename AS reportFilename,
           j.report_sent_at AS reportSentAt, j.cleanup_at AS cleanupAt, j.delete_after_report AS deleteAfterReport,
           j.success_count AS successCount, j.unknown_count AS unknownCount, j.finish_reason AS finishReason, j.pause_reason AS pauseReason, j.summary_json AS summaryJson, j.flow_version AS flowVersion,
           j.failed_count AS failedCount,
           j.processed_count AS processedCount,
           j.delay_min_sec AS delayMinSec, j.delay_max_sec AS delayMaxSec,
           j.batch_size AS batchSize, j.rest_min_sec AS restMinSec, j.rest_max_sec AS restMaxSec,
           j.created_at AS createdAt, j.started_at AS startedAt,
           j.completed_at AS completedAt, j.updated_at AS updatedAt,
           p.owner_type AS ownerType, p.display_name AS displayName, p.client_id AS clientId, p.client_name AS clientName
    FROM posting_jobs j
    JOIN postings p ON p.id = j.posting_id`;
}

function hydratePostingJob(db, row) {
  if (!row) return null;
  const jobId = Number(row.id);
  const accounts = db.prepare(`
    SELECT account_id AS accountId, account_label AS accountLabel, position,
           success_count AS successCount, failed_count AS failedCount,
           processed_count AS processedCount, batch_processed AS batchProcessed,
           available_at AS availableAt, current_round AS currentRound, round_done AS roundDone, next_ad_no AS nextAdNo, unknown_count AS unknownCount
    FROM posting_job_accounts WHERE job_id = ? ORDER BY position
  `).all(jobId).map(item => ({
    ...item,
    accountId: Number(item.accountId), position: Number(item.position),
    successCount: Number(item.successCount || 0), failedCount: Number(item.failedCount || 0),
    processedCount: Number(item.processedCount || 0), batchProcessed: Number(item.batchProcessed || 0),
    currentRound: Number(item.currentRound || 1), roundDone: Number(item.roundDone || 0)
  }));
  const counts = db.prepare(`
    SELECT count(*) AS total,
           sum(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) AS pending,
           sum(CASE WHEN status = 'PROCESSING' THEN 1 ELSE 0 END) AS processing,
           sum(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) AS success,
           sum(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed,
           sum(CASE WHEN status = 'SKIPPED' THEN 1 ELSE 0 END) AS skipped
    FROM posting_job_targets WHERE job_id = ?
  `).get(jobId) || {};
  const ads = db.prepare(`
    SELECT ad_no AS adNo, kind, body, media_path AS mediaPath,
           media_mime AS mediaMime, media_size AS mediaSize
    FROM posting_job_ads WHERE job_id = ? ORDER BY ad_no
  `).all(jobId).map(ad => ({ ...ad, adNo: Number(ad.adNo), mediaSize: Number(ad.mediaSize || 0) }));
  return {
    ...row,
    id: jobId,
    postingId: Number(row.postingId),
    targetSuccess: Number(row.targetSuccess || 0),
    targetDays: row.targetDays == null ? null : Number(row.targetDays),
    nextAdNo: Number(row.nextAdNo || 1),
    reportAttempts: Number(row.reportAttempts || 0),
    deleteAfterReport: Number(row.deleteAfterReport || 0),
    successCount: Number(row.successCount || 0),
    failedCount: Number(row.failedCount || 0),
    processedCount: Number(row.processedCount || 0),
    delayMinSec: Number(row.delayMinSec || 60), delayMaxSec: Number(row.delayMaxSec || 120),
    batchSize: Number(row.batchSize || 5), restMinSec: Number(row.restMinSec || 300), restMaxSec: Number(row.restMaxSec || 600),
    accounts: accounts.map(a=>({...a,...db.prepare(`SELECT count(*) AS groupTotal,sum(CASE WHEN status NOT IN ('PENDING','PROCESSING') THEN 1 ELSE 0 END) AS groupDone FROM posting_job_targets WHERE job_id=? AND account_id=?`).get(jobId,a.accountId)})),
    ads,
    totalTargets: Number(counts.total || 0), pendingCount: Number(counts.pending || 0),
    processingCount: Number(counts.processing || 0), skippedCount: Number(counts.skipped || 0),
    remainingSuccess: row.targetMode === 'SUCCESS' ? Math.max(0, Number(row.targetSuccess || 0) - Number(row.successCount || 0)) : null
  };
}

export function getPostingJob(path, jobId) {
  return withDb(path, db => hydratePostingJob(db, db.prepare(`${postingJobSelect()} WHERE j.id = ?`).get(Number(jobId)) || null));
}

export function getLatestPostingJob(path, { activeOnly = false } = {}) {
  return withDb(path, db => {
    const where = activeOnly ? "WHERE j.status IN ('WAITING','RUNNING','PAUSED')" : '';
    return hydratePostingJob(db, db.prepare(`${postingJobSelect()} ${where} ORDER BY j.id DESC LIMIT 1`).get() || null);
  });
}

export function listPostingJobs(path, { page = 1, perPage = 10, activeOnly = false } = {}) {
  return withDb(path, db => {
    const safePerPage = Math.max(1, Math.min(50, Number(perPage) || 10));
    const where = activeOnly ? "WHERE j.status IN ('WAITING','RUNNING','PAUSED')" : '';
    const total = Number(db.prepare(`SELECT count(*) AS n FROM posting_jobs j ${where}`).get()?.n || 0);
    const totalPages = Math.max(1, Math.ceil(total / safePerPage));
    const safePage = Math.max(1, Math.min(Number(page) || 1, totalPages));
    const rows = db.prepare(`${postingJobSelect()} ${where} ORDER BY j.id DESC LIMIT ? OFFSET ?`).all(safePerPage, (safePage - 1) * safePerPage);
    return { items: rows.map(row => hydratePostingJob(db, row)), total, page: safePage, perPage: safePerPage, totalPages };
  });
}

function collectPostingTargets(db, accountIds = []) {
  const queues = accountIds.map(accountId => ({
    accountId: Number(accountId),
    index: 0,
    items: db.prepare(`
      SELECT jid, subject AS groupName, participant_count AS participantCount
      FROM whatsapp_groups
      WHERE account_id = ? AND is_available = 1
      ORDER BY subject COLLATE NOCASE, jid
    `).all(Number(accountId))
  }));
  const ordered = [];
  let progress = true;
  while (progress) {
    progress = false;
    for (const queue of queues) {
      while (queue.index < queue.items.length) {
        const row = queue.items[queue.index++];
        ordered.push({
          accountId: queue.accountId,
          groupJid: String(row.jid),
          groupName: String(row.groupName || 'Group WhatsApp'),
          participantCount: Math.max(0, Number(row.participantCount || 0))
        });
        progress = true;
        break;
      }
    }
  }
  return ordered;
}

export function createPostingJob(path, postingId, settings = {}) {
  return withDb(path, db => {
    const id = Number(postingId);
    const posting = getPostingFromDb(db, id);
    if (!posting) throw new Error('Posting tidak ditemui.');
    if (posting.status !== 'READY') throw new Error('Posting belum READY. Selesaikan iklan dahulu.');
    const plan = ensureCampaignPlan(db, id);
    if (plan?.account_selection_dirty) throw new Error('Pilihan akaun telah berubah. Pilih akaun semula melalui .pilih-akaun.');
    if (!plan || plan.status !== 'READY') throw new Error('Setup akaun/mode belum lengkap.');

    const existing = db.prepare(`${postingJobSelect()} WHERE j.posting_id = ? AND j.status IN ('WAITING','RUNNING','PAUSED') ORDER BY j.id DESC LIMIT 1`).get(id);
    if (existing) return hydratePostingJob(db, existing);

    const accounts = db.prepare(`
      SELECT account_id AS accountId, account_label AS accountLabel
      FROM posting_plan_accounts WHERE posting_id = ? ORDER BY account_id
    `).all(id).map(row => ({ accountId: Number(row.accountId), accountLabel: String(row.accountLabel) }));
    if (!accounts.length) throw new Error('Pilih akaun WhatsApp dahulu.');

    const ads = db.prepare(`
      SELECT id, ad_no AS adNo, kind, body, media_path AS mediaPath,
             media_mime AS mediaMime, media_size AS mediaSize
      FROM posting_ads WHERE posting_id = ? ORDER BY ad_no
    `).all(id);
    if (!ads.length) throw new Error('Posting tiada iklan.');

    const clientPackage=isClientPosting(posting);
    if(clientPackage&&!paymentIsValid(db,posting))throw new Error('Sahkan BAYARAN PENUH dalam .posting-review sebelum mula.');
    const targets = clientPackage&&plan.target_mode==='SUCCESS'?clientTargets(db,id):collectPostingTargets(db, accounts.map(item => item.accountId));
    if(clientPackage&&plan.target_mode==='SUCCESS'&&Number(plan.target_value)>targets.length)throw new Error('Group unik tidak cukup untuk target. Semak akaun dan target semula.');
    if (!targets.length) throw new Error('Tiada group tersedia untuk akaun yang dipilih. Sync group dahulu.');

    const targetMode = normalizeCampaignMode(plan.target_mode);
    const targetValue = plan.target_value == null ? null : Number(plan.target_value);
    const reuseMode = clientPackage&&targetMode==='SUCCESS'?'UNIQUE':normalizeReuseMode(plan.reuse_mode || 'REPEAT');
    if (targetMode === 'SUCCESS' && (!Number.isInteger(targetValue) || targetValue < 1)) throw new Error('Jumlah SUCCESS belum ditetapkan.');
    if (targetMode === 'DAYS' && (!Number.isInteger(targetValue) || targetValue < 1)) throw new Error('Tempoh HARI belum ditetapkan.');

    const mergedSettings = validatePostingSettings({
      delayMinSec: settings.delayMinSec ?? plan.delay_min_sec,
      delayMaxSec: settings.delayMaxSec ?? plan.delay_max_sec,
      batchSize: settings.batchSize ?? plan.batch_size,
      restMinSec: settings.restMinSec ?? plan.rest_min_sec,
      restMaxSec: settings.restMaxSec ?? plan.rest_max_sec
    });
    const now = new Date().toISOString();
    const targetSuccess = targetMode === 'SUCCESS' ? targetValue : 1;
    const targetDays = targetMode === 'DAYS' ? targetValue : null;

    db.exec('BEGIN IMMEDIATE;');
    try {
      const inserted = db.prepare(`
        INSERT INTO posting_jobs
          (posting_id, status, target_success, target_mode, target_days, reuse_mode,
           delay_min_sec, delay_max_sec, batch_size, rest_min_sec, rest_max_sec,
           report_status, created_at, updated_at)
        VALUES (?, 'WAITING', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NONE', ?, ?)
      `).run(id, targetSuccess, targetMode, targetDays, reuseMode,
        mergedSettings.delayMinSec, mergedSettings.delayMaxSec, mergedSettings.batchSize,
        mergedSettings.restMinSec, mergedSettings.restMaxSec, now, now);
      const jobId = Number(inserted.lastInsertRowid);
      capturePolicy(db,'post',jobId);
      db.prepare('UPDATE posting_jobs SET flow_version=183,charge_cents=?,paid_full_at=?,target_unit=? WHERE id=?').run(clientPackage?posting.chargeCents:0,clientPackage?posting.paidFullAt:null,clientPackage&&targetMode==='SUCCESS'?'UNIQUE_GROUPS':'SENDS',jobId);

      const insertAccount = db.prepare(`
        INSERT INTO posting_job_accounts (job_id, account_id, account_label, position, current_round, round_done)
        VALUES (?, ?, ?, ?, 1, 0)
      `);
      accounts.forEach((account, index) => insertAccount.run(jobId, account.accountId, account.accountLabel, index + 1));

      const insertAd = db.prepare(`
        INSERT INTO posting_job_ads (job_id, ad_no, kind, body, media_path, media_mime, media_size)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const insertButton = db.prepare(`
        INSERT INTO posting_job_buttons (job_id, ad_no, button_no, label, url)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const ad of ads) {
        insertAd.run(jobId, Number(ad.adNo), ad.kind, ad.body, ad.mediaPath || null, ad.mediaMime || null, Number(ad.mediaSize || 0));
        const buttons = db.prepare(`${buttonSelect()} WHERE ad_id = ? ORDER BY button_no`).all(Number(ad.id));
        for (const button of buttons) insertButton.run(jobId, Number(ad.adNo), Number(button.buttonNo), button.label, button.url);
      }

      const insertTarget = db.prepare(`
        INSERT INTO posting_job_targets
          (job_id, position, account_id, group_jid, group_name, participant_count, status, round_no)
        VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 1)
      `);
      targets.forEach((target, index) => insertTarget.run(jobId, index + 1, target.accountId, target.groupJid, target.groupName, target.participantCount));
      db.exec('COMMIT;');
      return hydratePostingJob(db, db.prepare(`${postingJobSelect()} WHERE j.id = ?`).get(jobId));
    } catch (error) { db.exec('ROLLBACK;'); throw error; }
  });
}

export function setPostingJobStatus(path, jobId, status) {
  const value = String(status || '').toUpperCase();
  if (!['WAITING','RUNNING','PAUSED','STOPPED','COMPLETED'].includes(value)) throw new Error('Status posting tidak sah.');
  return withDb(path, db => {
    const job = db.prepare(`${postingJobSelect()} WHERE j.id = ?`).get(Number(jobId));
    if (!job) throw new Error('Job posting tidak ditemui.');
    const now = new Date().toISOString();
    const startedAt = value === 'RUNNING' && !job.startedAt ? now : job.startedAt;
    let endsAt = job.endsAt || null;
    if (value === 'RUNNING' && job.targetMode === 'DAYS' && !endsAt) {
      endsAt = malaysiaCampaignEnd(startedAt || now,job.targetDays || 1);
    }
    if(value==='RUNNING'&&['STOPPED','COMPLETED'].includes(job.status))throw new Error('Kempen sudah tamat. Cipta draf baharu.');
    if(value==='RUNNING'&&endsAt&&Date.parse(endsAt)<=Date.now())return finishJob(db,Number(jobId),'TEMPOH TAMAT',now);
    if(value==='RUNNING'&&job.targetMode==='SUCCESS'&&job.successCount+job.unknownCount>=job.targetSuccess&&job.unknownCount)throw new Error('Slot target masih ditempah oleh hasil Belum Pasti. Semak laporan sebelum sambung.');
    const completedAt = ['STOPPED','COMPLETED'].includes(value) ? now : null;
    const reportStatus = ['STOPPED','COMPLETED'].includes(value) ? 'PENDING' : job.reportStatus || 'NONE';
    db.prepare(`UPDATE posting_jobs SET status=?, started_at=?, ends_at=?, completed_at=?, report_status=?, report_retry_at=?, updated_at=? WHERE id=?`)
      .run(value, startedAt, endsAt, completedAt, reportStatus,
        ['STOPPED','COMPLETED'].includes(value) ? now : job.reportRetryAt || null,
        now, Number(jobId));
    if(value==='RUNNING')db.prepare('UPDATE posting_jobs SET pause_reason=NULL WHERE id=?').run(Number(jobId));
    if(value==='STOPPED')db.prepare("UPDATE posting_jobs SET finish_reason='DIHENTIKAN PENGGUNA' WHERE id=?").run(Number(jobId));
    if (['STOPPED','COMPLETED'].includes(value)) {
      db.prepare("UPDATE posting_job_targets SET status='SKIPPED', completed_at=? WHERE job_id=? AND status='PENDING'").run(now, Number(jobId));
    }
    return hydratePostingJob(db, db.prepare(`${postingJobSelect()} WHERE j.id = ?`).get(Number(jobId)));
  });
}

export function recoverPostingJobs(path) {
 const rows=withDb(path,db=>db.prepare(`SELECT id,job_id AS jobId,account_id AS accountId,attempt_token AS attemptToken,send_started AS sendStarted FROM posting_job_targets WHERE status='PROCESSING'`).all());
 withDb(path,db=>db.prepare("UPDATE posting_jobs SET status='PAUSED',pause_reason='Dipulihkan selepas restart; semak dan sambung melalui .status.' WHERE status='RUNNING'").run());
 for(const target of rows){
  if(target.sendStarted)completeCampaignWork(path,target,{unknown:true,error:'Restart selepas penghantaran bermula; hasil belum disahkan.'});
  else requeueCampaignWork(path,target.id,'Belum dihantar sebelum restart.');
 }
 return {interruptedTargets:rows.length,resumedJobs:0,pausedJobs:withDb(path,db=>Number(db.prepare("SELECT count(*) AS n FROM posting_jobs WHERE status='PAUSED'").get().n))};
}

export function claimNextPostingTarget(path, jobId, onlineAccountIds = []) {
  const ids = [...new Set((onlineAccountIds || []).map(Number).filter(Number.isInteger))];
  if (!ids.length) return null;
  return withDb(path, db => {
    const job = db.prepare('SELECT status, success_count AS successCount, target_success AS targetSuccess FROM posting_jobs WHERE id = ?').get(Number(jobId));
    if (!job || job.status !== 'RUNNING' || Number(job.successCount || 0) >= Number(job.targetSuccess || 0)) return null;
    const placeholders = ids.map(() => '?').join(',');
    db.exec('BEGIN IMMEDIATE;');
    try {
      const target = db.prepare(`
        SELECT id, position, account_id AS accountId, group_jid AS groupJid,
               group_name AS groupName, participant_count AS participantCount
        FROM posting_job_targets
        WHERE job_id = ? AND status = 'PENDING' AND account_id IN (${placeholders})
        ORDER BY position LIMIT 1
      `).get(Number(jobId), ...ids);
      if (!target) { db.exec('COMMIT;'); return null; }
      const adCount = Number(db.prepare('SELECT count(*) AS n FROM posting_job_ads WHERE job_id = ?').get(Number(jobId))?.n || 0);
      const adNo = adCount ? ((Number(target.position) - 1) % adCount) + 1 : 1;
      const now = new Date().toISOString();
      db.prepare("UPDATE posting_job_targets SET status = 'PROCESSING', ad_no = ?, attempted_at = ? WHERE id = ? AND status = 'PENDING'")
        .run(adNo, now, Number(target.id));
      const changed = db.prepare('SELECT changes() AS n').get()?.n || 0;
      db.exec('COMMIT;');
      if (!changed) return null;
      return { ...target, id: Number(target.id), position: Number(target.position), accountId: Number(target.accountId), participantCount: Number(target.participantCount || 0), adNo };
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  });
}

export function getPostingJobAd(path, jobId, adNo) {
  return withDb(path, db => {
    const ad = db.prepare(`
      SELECT ad_no AS adNo, kind, body, media_path AS mediaPath,
             media_mime AS mediaMime, media_size AS mediaSize
      FROM posting_job_ads WHERE job_id = ? AND ad_no = ?
    `).get(Number(jobId), Number(adNo));
    if (!ad) return null;
    const buttons = db.prepare(`
      SELECT button_no AS buttonNo, label, url
      FROM posting_job_buttons WHERE job_id = ? AND ad_no = ? ORDER BY button_no
    `).all(Number(jobId), Number(adNo)).map(item => ({ ...item, buttonNo: Number(item.buttonNo) }));
    return { ...ad, adNo: Number(ad.adNo), mediaSize: Number(ad.mediaSize || 0), buttons };
  });
}

export function completePostingTarget(path, targetId, result = {}) {
  return withDb(path, db => {
    const target = db.prepare(`SELECT id, job_id AS jobId, account_id AS accountId, status FROM posting_job_targets WHERE id = ?`).get(Number(targetId));
    if (!target) throw new Error('Target posting tidak ditemui.');
    if (target.status !== 'PROCESSING') return hydratePostingJob(db, db.prepare(`${postingJobSelect()} WHERE j.id = ?`).get(Number(target.jobId)));
    const success = result.success === true;
    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE;');
    try {
      db.prepare(`
        UPDATE posting_job_targets
        SET status = ?, message_id = ?, error_text = ?, completed_at = ?
        WHERE id = ?
      `).run(success ? 'SUCCESS' : 'FAILED', result.messageId || null, success ? null : String(result.error || 'Hantar tidak berjaya.').slice(0, 500), now, Number(targetId));
      db.prepare(`
        UPDATE posting_jobs
        SET success_count = success_count + ?, failed_count = failed_count + ?,
            processed_count = processed_count + 1, updated_at = ?
        WHERE id = ?
      `).run(success ? 1 : 0, success ? 0 : 1, now, Number(target.jobId));
      db.prepare(`
        UPDATE posting_job_accounts
        SET success_count = success_count + ?, failed_count = failed_count + ?,
            processed_count = processed_count + 1, batch_processed = batch_processed + 1
        WHERE job_id = ? AND account_id = ?
      `).run(success ? 1 : 0, success ? 0 : 1, Number(target.jobId), Number(target.accountId));
      const job = db.prepare('SELECT status, success_count AS successCount, target_success AS targetSuccess FROM posting_jobs WHERE id = ?').get(Number(target.jobId));
      if (job?.status === 'RUNNING' && Number(job?.successCount || 0) >= Number(job?.targetSuccess || 0)) {
        db.prepare("UPDATE posting_jobs SET status = 'COMPLETED', completed_at = ?, updated_at = ? WHERE id = ?").run(now, now, Number(target.jobId));
        db.prepare("UPDATE posting_job_targets SET status = 'SKIPPED', completed_at = ? WHERE job_id = ? AND status = 'PENDING'").run(now, Number(target.jobId));
      }
      db.exec('COMMIT;');
      return hydratePostingJob(db, db.prepare(`${postingJobSelect()} WHERE j.id = ?`).get(Number(target.jobId)));
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  });
}

export function requeuePostingTarget(path, targetId, errorText = null) {
  return withDb(path, db => {
    const now = new Date().toISOString();
    return db.prepare(`
      UPDATE posting_job_targets
      SET status = 'PENDING', error_text = ?, attempted_at = NULL, completed_at = NULL
      WHERE id = ? AND status = 'PROCESSING'
    `).run(errorText ? String(errorText).slice(0, 500) : null, Number(targetId)).changes > 0;
  });
}

export function setPostingAccountWait(path, jobId, accountId, waitSec, { resetBatch = false } = {}) {
  return withDb(path, db => {
    const seconds = Math.max(0, Number(waitSec || 0));
    const availableAt = new Date(Date.now() + seconds * 1000).toISOString();
    if (resetBatch) {
      db.prepare('UPDATE posting_job_accounts SET available_at = ?, batch_processed = 0 WHERE job_id = ? AND account_id = ?')
        .run(availableAt, Number(jobId), Number(accountId));
    } else {
      db.prepare('UPDATE posting_job_accounts SET available_at = ? WHERE job_id = ? AND account_id = ?')
        .run(availableAt, Number(jobId), Number(accountId));
    }
    return availableAt;
  });
}

export function listRecentPostingTargets(path, jobId, limit = 10) {
  return withDb(path, db => {
    const safeLimit = Math.max(1, Math.min(50, Number(limit) || 10));
    const attempts = db.prepare(`
      SELECT id, account_id AS accountId, group_name AS groupName, status,
             ad_no AS adNo, round_no AS roundNo, error_text AS errorText,
             completed_at AS completedAt
      FROM posting_job_attempts WHERE job_id=?
      ORDER BY id DESC LIMIT ?
    `).all(Number(jobId), safeLimit);
    if (attempts.length) return attempts.map(row => ({
      ...row, id: Number(row.id), accountId: Number(row.accountId), adNo: Number(row.adNo), roundNo: Number(row.roundNo || 1)
    }));
    return db.prepare(`
      SELECT id, position, account_id AS accountId, group_name AS groupName,
             status, ad_no AS adNo, round_no AS roundNo, error_text AS errorText, completed_at AS completedAt
      FROM posting_job_targets
      WHERE job_id=? AND status IN ('SUCCESS','FAILED','UNKNOWN')
      ORDER BY coalesce(completed_at, attempted_at) DESC, id DESC LIMIT ?
    `).all(Number(jobId), safeLimit).map(row => ({
      ...row, id: Number(row.id), position: Number(row.position), accountId: Number(row.accountId),
      adNo: row.adNo == null ? null : Number(row.adNo), roundNo: Number(row.roundNo || 1)
    }));
  });
}

export function randomPostingWait(job, account, random = Math.random) {
  const safeRandom = () => {
    const value = Number(random());
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
  };
  const randomInt = (min, max) => {
    const lo = Math.max(0, Math.floor(Number(min || 0)));
    const hi = Math.max(lo, Math.floor(Number(max || lo)));
    return lo + Math.floor(safeRandom() * (hi - lo + 1));
  };
  const batchProcessed = Number(account?.batchProcessed || 0);
  if (batchProcessed >= Number(job?.batchSize || 5)) {
    return { kind: 'REST', seconds: randomInt(job.restMinSec, job.restMaxSec), resetBatch: true };
  }
  return { kind: 'DELAY', seconds: randomInt(job.delayMinSec, job.delayMaxSec), resetBatch: false };
}

export function postingJobCounts(path) {
  return withDb(path, db => {
    const row = db.prepare(`
      SELECT
        sum(CASE WHEN status IN ('WAITING','RUNNING','PAUSED') THEN 1 ELSE 0 END) AS active,
        sum(CASE WHEN status IN ('COMPLETED','STOPPED') THEN 1 ELSE 0 END) AS records
      FROM posting_jobs
    `).get() || {};
    return { active: Number(row.active || 0), records: Number(row.records || 0) };
  });
}

// Build 149: global campaign queue + account worker pool.
function ensurePostingWorkerRow(db, accountId) {
  const id = Number(accountId);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO posting_workers (account_id, available_at, batch_processed, last_job_id, updated_at)
    VALUES (?, NULL, 0, NULL, ?)
    ON CONFLICT(account_id) DO NOTHING
  `).run(id, now);
  return db.prepare(`SELECT account_id AS accountId, available_at AS availableAt,
                            batch_processed AS batchProcessed, last_job_id AS lastJobId,
                            updated_at AS updatedAt, wait_kind AS waitKind
                     FROM posting_workers WHERE account_id=?`).get(id);
}

export function getPostingWorker(path, accountId) {
  return withDb(path, db => {
    const row = ensurePostingWorkerRow(db, accountId);
    return { ...row, accountId: Number(row.accountId), batchProcessed: Number(row.batchProcessed || 0), lastJobId: row.lastJobId == null ? null : Number(row.lastJobId) };
  });
}

export function setPostingWorkerWait(path, accountId, waitSec, { resetBatch = false, jobId = null, kind = null } = {}) {
  return withDb(path, db => {
    const row = ensurePostingWorkerRow(db, accountId);
    const seconds = Math.max(0, Number(waitSec || 0));
    const availableAt = new Date(Date.now() + seconds * 1000).toISOString();
    db.prepare(`UPDATE posting_workers
                SET available_at=max(coalesce(available_at,''),?), batch_processed=?, last_job_id=?, updated_at=?,wait_kind=?
                WHERE account_id=?`)
      .run(availableAt, resetBatch ? 0 : Number(row.batchProcessed || 0), jobId == null ? row.lastJobId : Number(jobId), new Date().toISOString(), kind, Number(accountId));
    return availableAt;
  });
}

function finishJob(db,id,reason,now=new Date().toISOString()) {
 db.prepare("UPDATE posting_jobs SET status='COMPLETED',finish_reason=?,completed_at=?,report_status='PENDING',report_retry_at=?,updated_at=? WHERE id=?").run(reason,now,now,now,id);
 db.prepare("UPDATE posting_job_targets SET status='SKIPPED',completed_at=? WHERE job_id=? AND status='PENDING'").run(now,id);
 return hydratePostingJob(db,db.prepare(`${postingJobSelect()} WHERE j.id=?`).get(id));
}
export function finalizeExpiredPostingJobs(path,nowMs=Date.now()) {
 return withDb(path,db=>{const rows=db.prepare("SELECT id FROM posting_jobs WHERE status IN ('RUNNING','PAUSED') AND target_mode='DAYS' AND ends_at<=?").all(new Date(nowMs).toISOString());for(const row of rows)finishJob(db,row.id,'TEMPOH TAMAT',new Date(nowMs).toISOString());return rows.map(r=>r.id);});
}
export function claimNextCampaignWork(path,accountId,onlineAccountIds=[],nowMs=Date.now()) {
 const id=Number(accountId);if(!onlineAccountIds.map(Number).includes(id))return null;
 return withDb(path,db=>{db.exec('BEGIN IMMEDIATE');try{
  const now=new Date(nowMs).toISOString(),worker=ensurePostingWorkerRow(db,id);
  if(Date.parse(worker.availableAt||'')>nowMs || db.prepare("SELECT 1 FROM posting_job_targets WHERE account_id=? AND status='PROCESSING'").get(id)){db.exec('COMMIT');return null;}
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='group_status_targets'").get() && db.prepare("SELECT 1 FROM group_status_targets WHERE account_id=? AND status='IN_FLIGHT'").get(id)){db.exec('COMMIT');return null;}
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='group_status_account_schedule'").get() && db.prepare("SELECT 1 FROM group_status_account_schedule WHERE account_id=? AND COALESCE(next_run_at,'')>? LIMIT 1").get(id,now)){db.exec('COMMIT');return null;}
  const jobs=db.prepare(`${postingJobSelect()} JOIN posting_job_accounts a ON a.job_id=j.id WHERE j.status='RUNNING' AND a.account_id=? ORDER BY coalesce(j.last_claimed_at,''),j.id`).all(id);
  for(const job of jobs){
   if(job.endsAt&&Date.parse(job.endsAt)<=nowMs){finishJob(db,job.id,'TEMPOH TAMAT',now);continue;}
   const inFlight=Number(db.prepare("SELECT count(*) AS n FROM posting_job_targets WHERE job_id=? AND status='PROCESSING'").get(job.id).n);
   if(job.targetMode==='SUCCESS'&&job.successCount+job.unknownCount+inFlight>=job.targetSuccess){
    if(!inFlight&&job.unknownCount)db.prepare("UPDATE posting_jobs SET status='PAUSED',pause_reason='Slot target ditempah oleh hasil Belum Pasti; semak laporan.' WHERE id=?").run(job.id);
    continue;
   }
   const account=db.prepare('SELECT * FROM posting_job_accounts WHERE job_id=? AND account_id=?').get(job.id,id);
   const getTarget=()=>db.prepare("SELECT * FROM posting_job_targets WHERE job_id=? AND account_id=? AND status='PENDING' ORDER BY position LIMIT 1").get(job.id,id);
   let target=getTarget();
   if(!target){
    if(job.targetMode==='SUCCESS'&&job.reuseMode==='UNIQUE'){
     if(!inFlight&&!db.prepare("SELECT 1 FROM posting_job_targets WHERE job_id=? AND status='PENDING'").get(job.id))finishJob(db,job.id,'SASARAN HABIS — TARGET BELUM CUKUP',now);
     continue;
    }
    if(!db.prepare("SELECT 1 FROM posting_job_targets WHERE job_id=? AND account_id=? AND status IN ('SUCCESS','FAILED')").get(job.id,id)){
     if(!inFlight&&!db.prepare("SELECT 1 FROM posting_job_targets WHERE job_id=? AND status IN ('PENDING','SUCCESS','FAILED')").get(job.id))db.prepare("UPDATE posting_jobs SET status='PAUSED',pause_reason='Tiada sasaran pasti yang boleh diteruskan. Semak hasil Belum Pasti.' WHERE id=?").run(job.id);
     continue;
    }
    db.prepare('UPDATE posting_job_accounts SET current_round=current_round+1,round_done=0 WHERE job_id=? AND account_id=?').run(job.id,id);
    db.prepare("UPDATE posting_job_targets SET status='PENDING',ad_no=NULL,message_id=NULL,error_text=NULL,attempted_at=NULL,completed_at=NULL,attempt_token=NULL,send_started=0,round_no=? WHERE job_id=? AND account_id=? AND status IN ('SUCCESS','FAILED')").run(account.current_round+1,job.id,id);
    target=getTarget();
   }
   if(!target)continue;
   const adCount=Number(db.prepare('SELECT count(*) AS n FROM posting_job_ads WHERE job_id=?').get(job.id).n);if(!adCount)continue;
   const adNo=target.ad_no||Math.min(adCount,Math.max(1,account.next_ad_no)),attemptToken=randomUUID();
   db.prepare("UPDATE posting_job_targets SET status='PROCESSING',ad_no=?,attempted_at=?,attempt_token=?,send_started=0 WHERE id=?").run(adNo,now,attemptToken,target.id);
   db.prepare('UPDATE posting_jobs SET last_claimed_at=?,updated_at=? WHERE id=?').run(now,now,job.id);
   db.prepare('UPDATE posting_workers SET last_job_id=?,updated_at=? WHERE account_id=?').run(job.id,now,id);
   db.exec('COMMIT');
   return {id:target.id,jobId:job.id,accountId:id,groupJid:target.group_jid,groupName:target.group_name,participantCount:target.participant_count,roundNo:target.round_no,adNo,attemptToken,delayMinSec:job.delayMinSec,delayMaxSec:job.delayMaxSec,batchSize:job.batchSize,restMinSec:job.restMinSec,restMaxSec:job.restMaxSec};
  }
  db.exec('COMMIT');return null;
 }catch(error){db.exec('ROLLBACK');throw error;}});
}
export function markCampaignSendStarted(path,work) {
 return withDb(path,db=>db.prepare("UPDATE posting_job_targets SET send_started=1 WHERE id=? AND status='PROCESSING' AND attempt_token=?").run(Number(work.id),work.attemptToken).changes>0);
}
export function pauseCampaignForMedia(path,work,reason) {
 requeueCampaignWork(path,work.id,reason);
 return withDb(path,db=>db.prepare("UPDATE posting_jobs SET status='PAUSED',pause_reason=? WHERE id=? AND status='RUNNING'").run(reason,work.jobId));
}
export function completeCampaignWork(path,work,result={}) {
 return withDb(path,db=>{db.exec('BEGIN IMMEDIATE');try{
  const t=db.prepare('SELECT * FROM posting_job_targets WHERE id=?').get(Number(work?.id));
  if(!t){db.exec('COMMIT');return null;}
  const job=()=>hydratePostingJob(db,db.prepare(`${postingJobSelect()} WHERE j.id=?`).get(t.job_id));
  const late=t.status==='UNKNOWN'&&result.success===true&&!!result.messageId;
  if((t.status!=='PROCESSING'&&!late)||(work.attemptToken&&t.attempt_token!==work.attemptToken)){db.exec('COMMIT');return job();}
  const status=result.success===true&&result.messageId?'SUCCESS':result.unknown||result.success===true?'UNKNOWN':'FAILED';
  const now=new Date().toISOString(),err=status==='SUCCESS'?null:String(result.error||'Keputusan penghantaran belum disahkan.').slice(0,500);
  db.prepare('UPDATE posting_job_targets SET status=?,message_id=?,error_text=?,completed_at=? WHERE id=?').run(status,result.messageId||null,err,now,t.id);
  const success=Number(status==='SUCCESS'),failed=Number(status==='FAILED'),unknown=Number(status==='UNKNOWN')-(late?1:0);
  db.prepare('UPDATE posting_jobs SET success_count=success_count+?,failed_count=failed_count+?,unknown_count=unknown_count+?,processed_count=processed_count+?,updated_at=? WHERE id=?').run(success,failed,unknown,late?0:1,now,t.job_id);
  const adCount=Number(db.prepare('SELECT count(*) AS n FROM posting_job_ads WHERE job_id=?').get(t.job_id).n);
  db.prepare('UPDATE posting_job_accounts SET success_count=success_count+?,failed_count=failed_count+?,unknown_count=unknown_count+?,processed_count=processed_count+?,next_ad_no=CASE WHEN ? THEN next_ad_no ELSE ? END WHERE job_id=? AND account_id=?').run(success,failed,unknown,late?0:1,late?1:0,t.ad_no>=adCount?1:t.ad_no+1,t.job_id,t.account_id);
  if(late)db.prepare("UPDATE posting_job_attempts SET status='SUCCESS',message_id=?,error_text=NULL,completed_at=? WHERE attempt_token=?").run(result.messageId,now,t.attempt_token);
  else {
   db.prepare('INSERT INTO posting_job_attempts(job_id,target_id,account_id,round_no,group_jid,group_name,ad_no,status,message_id,error_text,attempted_at,completed_at,attempt_token) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(t.job_id,t.id,t.account_id,t.round_no,t.group_jid,t.group_name,t.ad_no||1,status,result.messageId||null,err,t.attempted_at||now,now,t.attempt_token);
   const w=ensurePostingWorkerRow(db,t.account_id),j=job();
   const wait=randomWorkerWait(j,{batchProcessed:Number(w.batchProcessed)+1});
   const until=new Date(Date.now()+wait.seconds*1000).toISOString();
   db.prepare("UPDATE posting_workers SET batch_processed=?,available_at=max(coalesce(available_at,''),?),wait_kind=?,updated_at=? WHERE account_id=?").run(wait.resetBatch?0:Number(w.batchProcessed)+1,until,wait.kind,now,t.account_id);
  }
  const j=job();
  if(['RUNNING','PAUSED'].includes(j.status)&&j.targetMode==='SUCCESS'&&j.successCount>=j.targetSuccess)finishJob(db,j.id,'TARGET SUCCESS CUKUP',now);
  else if(['RUNNING','PAUSED'].includes(j.status)&&j.endsAt&&Date.parse(j.endsAt)<=Date.now())finishJob(db,j.id,'TEMPOH TAMAT',now);
  else if(['RUNNING','PAUSED'].includes(j.status)&&j.targetMode==='SUCCESS'&&j.reuseMode==='UNIQUE'&&!j.pendingCount&&!j.processingCount)finishJob(db,j.id,'SASARAN HABIS — TARGET BELUM CUKUP',now);
  db.exec('COMMIT');return job();
 }catch(error){db.exec('ROLLBACK');throw error;}});
}
export function requeueCampaignWork(path,targetId,errorText=null) {
 return withDb(path,db=>db.prepare("UPDATE posting_job_targets SET status='PENDING',error_text=?,attempted_at=NULL,completed_at=NULL,attempt_token=NULL WHERE id=? AND status='PROCESSING' AND send_started=0").run(errorText?String(errorText).slice(0,500):null,Number(targetId)).changes>0);
}
export function randomWorkerWait(work,worker,random=Math.random) {
 const pick=(min,max)=>{const v=Number(random()),r=Number.isFinite(v)?Math.max(0,Math.min(0.999999999,v)):0.5;return Number(min)+Math.floor(r*(Number(max)-Number(min)+1));};
 const delay=pick(work.delayMinSec,work.delayMaxSec);
 if(Number(worker?.batchProcessed||0)>=Number(work.batchSize||5))return {kind:'REST',seconds:Math.max(delay,pick(work.restMinSec,work.restMaxSec)),resetBatch:true};
 return {kind:'DELAY',seconds:delay,resetBatch:false};
}

export function listPendingPostingReports(path, nowMs = Date.now()) {
  return withDb(path, db => db.prepare(`${postingJobSelect()} WHERE j.report_status='PENDING'
    AND (j.report_retry_at IS NULL OR j.report_retry_at <= ?)
    AND NOT EXISTS (SELECT 1 FROM posting_job_targets t WHERE t.job_id=j.id AND t.status='PROCESSING')
    ORDER BY j.id`).all(new Date(nowMs).toISOString()).map(row => hydratePostingJob(db, row)));
}

export function listPendingPostingCleanup(path) {
  return withDb(path, db => db.prepare(`${postingJobSelect()} WHERE j.report_status='SENT' AND j.cleanup_at IS NULL ORDER BY j.id`).all().map(row => hydratePostingJob(db, row)));
}

export function postingReportSnapshot(path, jobId) {
  return withDb(path, db => {
    const job = hydratePostingJob(db, db.prepare(`${postingJobSelect()} WHERE j.id=?`).get(Number(jobId)));
    if (!job) return null;
    if(job.cleanupAt&&job.summaryJson){const saved=JSON.parse(job.summaryJson);return {...saved,job:{...saved.job,...job,accounts:saved.job.accounts,ads:saved.job.ads}};}
    const accountStats = db.prepare(`SELECT account_id AS accountId,account_label AS accountLabel,success_count AS successCount,
      failed_count AS failedCount,unknown_count AS unknownCount,processed_count AS processedCount,current_round AS currentRound
      FROM posting_job_accounts WHERE job_id=? ORDER BY position`).all(Number(jobId)).map(r => ({...r,accountId:Number(r.accountId),successCount:Number(r.successCount||0),failedCount:Number(r.failedCount||0),processedCount:Number(r.processedCount||0),currentRound:Number(r.currentRound||1)}));
    const attempts = db.prepare(`SELECT id,account_id AS accountId,round_no AS roundNo,group_name AS groupName,group_jid AS groupJid,
      ad_no AS adNo,status,message_id AS messageId,error_text AS errorText,attempted_at AS attemptedAt,completed_at AS completedAt
      FROM posting_job_attempts WHERE job_id=? ORDER BY id`).all(Number(jobId)).map(r => ({...r,id:Number(r.id),accountId:Number(r.accountId),roundNo:Number(r.roundNo),adNo:Number(r.adNo)}));
    const ads = db.prepare(`SELECT a.ad_no AS adNo,a.kind,count(b.button_no) AS buttonCount FROM posting_job_ads a
      LEFT JOIN posting_job_buttons b ON b.job_id=a.job_id AND b.ad_no=a.ad_no WHERE a.job_id=? GROUP BY a.ad_no,a.kind ORDER BY a.ad_no`).all(Number(jobId)).map(r=>({...r,adNo:Number(r.adNo),buttonCount:Number(r.buttonCount||0)}));
    return { job, accountStats, attempts, ads };
  });
}

export function markPostingReportFailed(path, jobId, errorText = null) {
  return withDb(path, db => {
    const current = db.prepare('SELECT report_attempts AS n FROM posting_jobs WHERE id=?').get(Number(jobId));
    const attempts = Number(current?.n || 0) + 1;
    const waitSec = Math.min(3600, 60 * Math.max(1, attempts));
    const retryAt = new Date(Date.now() + waitSec * 1000).toISOString();
    db.prepare(`UPDATE posting_jobs SET report_attempts=?,report_retry_at=?,updated_at=? WHERE id=?`).run(attempts, retryAt, new Date().toISOString(), Number(jobId));
    return { attempts, retryAt, errorText: errorText ? String(errorText) : null };
  });
}

export function markPostingReportSent(path, jobId, filename) {
  return withDb(path, db => {
    const now = new Date().toISOString();
    db.prepare(`UPDATE posting_jobs SET report_status='SENT',report_filename=?,report_sent_at=?,report_retry_at=NULL,updated_at=? WHERE id=?`)
      .run(String(filename || ''), now, now, Number(jobId));
    return hydratePostingJob(db, db.prepare(`${postingJobSelect()} WHERE j.id=?`).get(Number(jobId)));
  });
}

export function cleanupPostingJobData(path, jobId) {
  return withDb(path, db => {
    const job = db.prepare('SELECT posting_id AS postingId,report_status AS reportStatus,cleanup_at AS cleanupAt,delete_after_report AS deleteAfterReport FROM posting_jobs WHERE id=?').get(Number(jobId));
    if (!job) throw new Error('Job posting tidak ditemui.');
    if (job.reportStatus !== 'SENT') throw new Error('Report belum selamat dihantar ke Telegram.');
    if (job.cleanupAt) return { postingId: Number(job.postingId), mediaPaths: [], alreadyDone: true };
    const mediaPaths = [...new Set([
      ...db.prepare(`SELECT media_path AS mediaPath FROM posting_job_ads WHERE job_id=? AND media_path IS NOT NULL`).all(Number(jobId)),
      ...db.prepare(`SELECT media_path AS mediaPath FROM posting_ads WHERE posting_id=? AND media_path IS NOT NULL`).all(Number(job.postingId))
    ].map(r => String(r.mediaPath || '')).filter(Boolean))];
    const snapshot=postingReportSnapshot(path,jobId);
    snapshot.recent=snapshot.attempts.slice(-10).reverse();snapshot.attempts=[];snapshot.job.ads=snapshot.ads;delete snapshot.job.summaryJson;
    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE;');
    try {
      db.prepare('UPDATE posting_jobs SET summary_json=? WHERE id=?').run(JSON.stringify(snapshot),Number(jobId));
      db.prepare(`INSERT INTO posting_archives(posting_id,job_id,archived_at) VALUES (?,?,?) ON CONFLICT(posting_id) DO UPDATE SET job_id=excluded.job_id,archived_at=excluded.archived_at`).run(Number(job.postingId), Number(jobId), now);
      db.prepare('DELETE FROM posting_job_attempts WHERE job_id=?').run(Number(jobId));
      db.prepare('DELETE FROM posting_job_targets WHERE job_id=?').run(Number(jobId));
      db.prepare('DELETE FROM posting_job_buttons WHERE job_id=?').run(Number(jobId));
      db.prepare('DELETE FROM posting_job_ads WHERE job_id=?').run(Number(jobId));
      db.prepare('DELETE FROM posting_job_accounts WHERE job_id=?').run(Number(jobId));
      db.prepare('DELETE FROM posting_ads WHERE posting_id=?').run(Number(job.postingId));
      db.prepare('DELETE FROM posting_plan_accounts WHERE posting_id=?').run(Number(job.postingId));
      db.prepare('DELETE FROM posting_campaign_plans WHERE posting_id=?').run(Number(job.postingId));
      db.prepare('DELETE FROM posting_plans WHERE posting_id=?').run(Number(job.postingId));
      if (Number(job.deleteAfterReport || 0) === 1) {
        db.prepare('DELETE FROM postings WHERE id=?').run(Number(job.postingId));
      } else {
        db.prepare('UPDATE posting_jobs SET cleanup_at=?,updated_at=? WHERE id=?').run(now, now, Number(jobId));
      }
      db.exec('COMMIT;');
      return { postingId: Number(job.postingId), mediaPaths, alreadyDone: false, deleted: Number(job.deleteAfterReport || 0) === 1 };
    } catch (error) { db.exec('ROLLBACK;'); throw error; }
  });
}


export function deletePostingReportRecord(path, jobId) {
  return withDb(path, db => {
    const id = Number(jobId);
    const row = db.prepare(`SELECT id,posting_id AS postingId,status,report_status AS reportStatus,cleanup_at AS cleanupAt
      FROM posting_jobs WHERE id=?`).get(id);
    if (!row) throw new Error('Rekod report tidak ditemui.');
    if (!['STOPPED','COMPLETED'].includes(String(row.status))) throw new Error('Campaign masih aktif. STOP atau tunggu campaign tamat dahulu.');
    if (String(row.reportStatus) !== 'SENT') throw new Error('Report TXT belum berjaya dihantar ke Telegram.');
    if (!row.cleanupAt) throw new Error('Cleanup local belum selesai. Cuba semula sebentar lagi.');

    db.exec('BEGIN IMMEDIATE;');
    try {
      db.prepare('DELETE FROM posting_jobs WHERE id=?').run(id);
      if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='system_job_archive'").get()){db.prepare("DELETE FROM system_job_archive WHERE kind='post' AND id=?").run(id);db.prepare("DELETE FROM system_job_policy WHERE kind='post' AND id=?").run(id);}
      const remaining = Number(db.prepare('SELECT count(*) AS n FROM posting_jobs WHERE posting_id=?').get(Number(row.postingId))?.n || 0);
      if (remaining === 0) db.prepare('DELETE FROM postings WHERE id=?').run(Number(row.postingId));
      db.exec('COMMIT;');
      return { id, postingId: Number(row.postingId), deleted: true };
    } catch (error) { db.exec('ROLLBACK;'); throw error; }
  });
}

export function deleteAllPostingReportRecords(path) {
  return withDb(path, db => {
    const rows = db.prepare(`SELECT id,posting_id AS postingId FROM posting_jobs
      WHERE status IN ('STOPPED','COMPLETED') AND report_status='SENT' AND cleanup_at IS NOT NULL
      ORDER BY id`).all();
    if (!rows.length) return { deleted: 0, ids: [] };

    db.exec('BEGIN IMMEDIATE;');
    try {
      const ids = rows.map(row => Number(row.id));
      const postingIds = [...new Set(rows.map(row => Number(row.postingId)))];
      const delJob = db.prepare('DELETE FROM posting_jobs WHERE id=?');
      for (const id of ids) delJob.run(id);
      const countJobs = db.prepare('SELECT count(*) AS n FROM posting_jobs WHERE posting_id=?');
      const delPosting = db.prepare('DELETE FROM postings WHERE id=?');
      for (const postingId of postingIds) {
        const remaining = Number(countJobs.get(postingId)?.n || 0);
        if (remaining === 0) delPosting.run(postingId);
      }
      db.exec('COMMIT;');
      return { deleted: ids.length, ids };
    } catch (error) { db.exec('ROLLBACK;'); throw error; }
  });
}

export function requestPostingCampaignDelete(path, jobId) {
  return withDb(path, db => {
    const row = db.prepare('SELECT id,status FROM posting_jobs WHERE id=?').get(Number(jobId));
    if (!row) throw new Error('Campaign tidak ditemui.');
    const now = new Date().toISOString();
    db.prepare(`UPDATE posting_jobs SET status='STOPPED',completed_at=?,report_status='PENDING',report_retry_at=?,delete_after_report=1,updated_at=? WHERE id=?`)
      .run(now, now, now, Number(jobId));
    db.prepare("UPDATE posting_job_targets SET status='SKIPPED',completed_at=? WHERE job_id=? AND status='PENDING'").run(now, Number(jobId));
    return hydratePostingJob(db, db.prepare(`${postingJobSelect()} WHERE j.id=?`).get(Number(jobId)));
  });
}

// Display numbers belong to a view; IDs remain immutable.
export function campaignView(path,scope='active') {
 return withDb(path,db=>{const where=scope==='active'?"WHERE j.status IN ('WAITING','RUNNING','PAUSED')":scope==='records'?"WHERE j.status IN ('STOPPED','COMPLETED')":"";
 return db.prepare(`${postingJobSelect()} ${where} ORDER BY j.id`).all().map((r,i)=>({...hydratePostingJob(db,r),displayNumber:i+1}));});
}
export function savePostingFlowState(path,key,value){return withDb(path,db=>value==null?db.prepare('DELETE FROM posting_flow_state WHERE key=?').run(key):db.prepare('INSERT INTO posting_flow_state VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value)));}
export function readPostingFlowState(path,key){return withDb(path,db=>{const r=db.prepare('SELECT value FROM posting_flow_state WHERE key=?').get(key);return r?JSON.parse(r.value):null;});}
export function savedPostingDashboards(path){return withDb(path,db=>db.prepare('SELECT job_id AS jobId,chat_id AS chatId,message_id AS messageId,display_number AS displayNumber FROM posting_dashboards').all());}
export function savePostingDashboard(path,jobId,chatId,messageId,displayNumber=null){return withDb(path,db=>db.prepare('INSERT INTO posting_dashboards VALUES(?,?,?,?,?) ON CONFLICT(job_id) DO UPDATE SET chat_id=excluded.chat_id,message_id=excluded.message_id,updated_at=excluded.updated_at,display_number=excluded.display_number').run(jobId,String(chatId),messageId,new Date().toISOString(),displayNumber));}
export function malaysiaCampaignEnd(start,days){const day=Math.floor((Date.parse(start)+28800000)/86400000);return new Date((day+Number(days))*86400000-28800000-1000).toISOString();}
export function setPostingClient(path,postingId,client){return withDb(path,db=>db.prepare('UPDATE postings SET client_id=?,client_name=? WHERE id=?').run(client.id,client.name,postingId));}
export function postingReviewState(path,postingId,now=Date.now()) {
 return withDb(path,db=>{const plan=ensureCampaignPlan(db,postingId),accounts=db.prepare('SELECT account_id FROM posting_plan_accounts WHERE posting_id=? ORDER BY account_id').all(postingId);
 const posting=getPostingFromDb(db,postingId);
 const targets=isClientPosting(posting)&&plan.target_mode==='SUCCESS'?clientTargets(db,postingId):collectPostingTargets(db,accounts.map(a=>a.account_id));
 const ads=db.prepare('SELECT * FROM posting_ads WHERE posting_id=? ORDER BY ad_no').all(postingId);
 const buttons=db.prepare('SELECT b.* FROM posting_ad_buttons b JOIN posting_ads a ON a.id=b.ad_id WHERE a.posting_id=? ORDER BY a.ad_no,b.button_no').all(postingId);
 const copy={...plan};delete copy.review_json;delete copy.updated_at;
 return {fingerprint:createHash('sha256').update(JSON.stringify({targets,ads,buttons,plan:copy,billing:billingState(db,posting)})).digest('hex'),targetCount:targets.length,endsAt:plan.target_mode==='DAYS'?malaysiaCampaignEnd(new Date(now).toISOString(),plan.target_value):null};});
}
export function capturePostingReview(path,postingId,now=Date.now()){const state=postingReviewState(path,postingId,now);withDb(path,db=>db.prepare('UPDATE posting_campaign_plans SET review_json=? WHERE posting_id=?').run(JSON.stringify(state),postingId));return state;}

export function getPostingDefaults(path){return withDb(path,db=>{const r=db.prepare("SELECT value FROM system_meta WHERE key='posting_defaults'").get();return validatePostingSettings(r?JSON.parse(r.value):{});});}
export function setPostingDefaults(path,input){const d=validatePostingSettings(input);withDb(path,db=>db.prepare("INSERT INTO system_meta(key,value) VALUES('posting_defaults',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(d)));return d;}
export function isPostingMediaReferenced(path,mediaPath){return withDb(path,db=>!!(db.prepare('SELECT 1 FROM posting_ads WHERE media_path=?').get(mediaPath)||db.prepare('SELECT 1 FROM posting_job_ads WHERE media_path=?').get(mediaPath)));}

// Client SUCCESS reserves one owner per group JID. No reassignment or repeat.
export const isClientPosting=p=>p?.ownerType==='CLIENT'&&p.clientFlowVersion>=186;
function clientTargets(db,id){const ids=db.prepare('SELECT account_id FROM posting_plan_accounts WHERE posting_id=? ORDER BY account_id').all(id);const seen=new Set();return collectPostingTargets(db,ids.map(a=>a.account_id)).filter(t=>{if(seen.has(t.groupJid))return false;seen.add(t.groupJid);return true;});}
function billingState(db,p){if(!isClientPosting(p))return null;const plan=ensureCampaignPlan(db,p.id);return {id:p.id,clientId:p.clientId,clientName:p.clientName,name:p.displayName,chargeCents:p.chargeCents,mode:plan.target_mode,target:plan.target_value};}
function billingHash(db,p){return createHash('sha256').update(JSON.stringify(billingState(db,p))).digest('hex');}
function paymentIsValid(db,p){return !!(p.clientId&&p.chargeCents>0&&p.paidFullAt&&p.paymentFingerprint===billingHash(db,p));}
function editableClient(db,id){const p=getPostingFromDb(db,id);if(!isClientPosting(p))throw new Error('Caj ini hanya untuk draf client.');if(db.prepare('SELECT 1 FROM posting_jobs WHERE posting_id=?').get(id))throw new Error('Kempen sudah bermula. Caj dan bayaran dikunci.');return p;}
export function setPostingCharge(path,id,cents){if(!Number.isSafeInteger(cents)||cents<=0||cents>9999999999)throw new Error('Caj mesti lebih RM0 dan maksimum RM99,999,999.99.');return withDb(path,db=>{editableClient(db,id);db.prepare('UPDATE postings SET charge_cents=?,paid_full_at=NULL,payment_fingerprint=NULL WHERE id=?').run(cents,id);return getPostingFromDb(db,id);});}
export function postingPaymentState(path,id){return withDb(path,db=>{const p=getPostingFromDb(db,id);return {required:isClientPosting(p),paid:isClientPosting(p)&&paymentIsValid(db,p),fingerprint:billingHash(db,p),chargeCents:p?.chargeCents||0};});}
export function confirmPostingPayment(path,id,fingerprint){return withDb(path,db=>{db.exec('BEGIN IMMEDIATE');try{const p=editableClient(db,id),plan=ensureCampaignPlan(db,id);if(!p.clientId||p.chargeCents<=0||plan.status!=='READY'||billingHash(db,p)!==fingerprint)throw new Error('Butiran tempahan berubah. Semak dan sahkan semula.');if(plan.target_mode==='SUCCESS'&&Number(plan.target_value)>clientTargets(db,id).length)throw new Error('Group unik tidak cukup. Semak target dan akaun semula.');if(p.paidFullAt&&paymentIsValid(db,p))throw new Error('Bayaran penuh sudah disahkan.');db.prepare('UPDATE postings SET paid_full_at=?,payment_fingerprint=? WHERE id=?').run(new Date().toISOString(),fingerprint,id);db.exec('COMMIT');return getPostingFromDb(db,id);}catch(e){db.exec('ROLLBACK');throw e;}});}
