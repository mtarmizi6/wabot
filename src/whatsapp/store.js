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

function accountSelect() {
  return `
    SELECT id, label, phone, jid, status, auth_dir AS authDir,
           group_count AS groupCount, created_at AS createdAt,
           updated_at AS updatedAt, last_connected_at AS lastConnectedAt,
           last_group_sync_at AS lastGroupSyncAt,
           CASE WHEN last_connected_at IS NULL THEN NULL ELSE
             (SELECT count(*) FROM whatsapp_accounts numbered
              WHERE numbered.deleted_at IS NULL AND numbered.last_connected_at IS NOT NULL
                AND numbered.id <= whatsapp_accounts.id) END AS displayNumber
    FROM whatsapp_accounts`;
}

function getWhatsAppAccountFromDb(db, id) {
  return db.prepare(`${accountSelect()} WHERE id = ? AND deleted_at IS NULL`).get(Number(id)) || null;
}

function nextInternalId(db) {
  return Math.max(Number(db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'whatsapp_accounts'").get()?.seq || 0),
    Number(db.prepare('SELECT coalesce(max(id),0) AS n FROM whatsapp_accounts').get().n)) + 1;
}

export function listWhatsAppAccounts(path, { includePending = false } = {}) {
  return withDb(path, db => {
    const where = includePending ? 'WHERE deleted_at IS NULL' : 'WHERE deleted_at IS NULL AND last_connected_at IS NOT NULL';
    return db.prepare(`${accountSelect()} ${where} ORDER BY id`).all();
  });
}

export function listAllWhatsAppAccounts(path) {
  return listWhatsAppAccounts(path, { includePending: true });
}

export function getWhatsAppAccount(path, id) {
  return withDb(path, db => getWhatsAppAccountFromDb(db, id));
}

export function nextWhatsAppSlot(path) {
  return withDb(path, db => nextInternalId(db));
}

export function createWhatsAppAccount(path, { phone = null } = {}) {
  return withDb(path, db => {
    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE;');
    try {
      if (phone && db.prepare('SELECT id FROM whatsapp_accounts WHERE deleted_at IS NULL AND phone = ?').get(phone)) {
        throw new Error('Nombor ini sudah ada. Buka .accounts untuk urus akaun sedia ada.');
      }
      const id = nextInternalId(db);
      const label = `Akaun ${id}`;
      const authDir = `account-${String(id).padStart(3, '0')}`;
      db.prepare(`
        INSERT INTO whatsapp_accounts
          (id, label, phone, status, auth_dir, created_at, updated_at)
        VALUES (?, ?, ?, 'CONNECTING', ?, ?, ?)
      `).run(id, label, phone, authDir, now, now);
      db.exec('COMMIT;');
      return getWhatsAppAccountFromDb(db, id);
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  });
}

export function updateWhatsAppAccount(path, id, patch = {}) {
  const allowed = new Map([
    ['phone', 'phone'], ['authDir', 'auth_dir'], ['jid', 'jid'], ['status', 'status'], ['groupCount', 'group_count'],
    ['lastConnectedAt', 'last_connected_at'], ['lastGroupSyncAt', 'last_group_sync_at']
  ]);
  const entries = Object.entries(patch).filter(([key]) => allowed.has(key));
  if (!entries.length) return getWhatsAppAccount(path, id);
  return withDb(path, db => {
    const fields = entries.map(([key]) => `${allowed.get(key)} = ?`);
    const values = entries.map(([, value]) => value);
    fields.push('updated_at = ?');
    values.push(new Date().toISOString(), Number(id));
    db.prepare(`UPDATE whatsapp_accounts SET ${fields.join(', ')} WHERE id = ? AND deleted_at IS NULL`).run(...values);
    return getWhatsAppAccountFromDb(db, id);
  });
}

export function deleteWhatsAppAccount(path, id) {
  return withDb(path, db => {
    db.exec('BEGIN IMMEDIATE;');
    try {
      assertAccountAvailableForRemovalDb(db, id);
      const account = getWhatsAppAccountFromDb(db, id);
      if (!account) { db.exec('COMMIT;'); return false; }
      const now = new Date().toISOString();
      // Keep the historical identity and foreign-key associations for reports.
      // Only current account access and unfinished selections are removed.
      db.prepare("UPDATE posting_campaign_plans SET status='DRAFT', account_selection_dirty=1, updated_at=? WHERE posting_id IN (SELECT posting_id FROM posting_plan_accounts WHERE account_id=?)").run(now, Number(id));
      db.prepare("UPDATE posting_plans SET status='DRAFT', updated_at=? WHERE posting_id IN (SELECT posting_id FROM posting_plan_accounts WHERE account_id=?)").run(now, Number(id));
      db.prepare('DELETE FROM posting_plan_accounts WHERE account_id=?').run(Number(id));
      for (const job of db.prepare("SELECT id, selected_accounts FROM group_status_jobs WHERE status IN ('DRAFT','READY')").all()) {
        const ids = JSON.parse(job.selected_accounts);
        if (!ids.includes(Number(id))) continue;
        db.prepare("UPDATE group_status_jobs SET selected_accounts=?,status='DRAFT',updated_at=? WHERE id=?").run(JSON.stringify(ids.filter(x => x !== Number(id))), now, job.id);
        db.prepare('DELETE FROM group_status_targets WHERE job_id=? AND account_id=?').run(job.id, Number(id));
      }
      db.prepare("UPDATE auto_join_jobs SET selection_dirty=1,draft_stage='ACCOUNTS' WHERE status='DRAFT' AND id IN (SELECT job_id FROM auto_join_job_accounts WHERE account_id=?)").run(Number(id));
      db.prepare("DELETE FROM auto_join_targets WHERE job_id IN (SELECT id FROM auto_join_jobs WHERE status='DRAFT' AND selection_dirty=1)").run();
      db.prepare("DELETE FROM auto_join_job_accounts WHERE account_id=? AND job_id IN (SELECT id FROM auto_join_jobs WHERE status='DRAFT')").run(Number(id));
      db.prepare('DELETE FROM whatsapp_group_sync_stage WHERE account_id=?').run(Number(id));
      db.prepare('DELETE FROM whatsapp_groups WHERE account_id=?').run(Number(id));
      db.prepare('DELETE FROM posting_workers WHERE account_id=?').run(Number(id));
      db.prepare("UPDATE whatsapp_accounts SET deleted_at=?,status='LOGGED_OUT',group_count=0,updated_at=? WHERE id=?").run(now, now, Number(id));
      db.exec('COMMIT;');
      return true;
    } catch (error) { db.exec('ROLLBACK;'); throw error; }
  });
}

function accountDependenciesDb(db, id) {
  const rows = db.prepare(`SELECT DISTINCT 'CAM-' || j.id AS name, j.status
    FROM posting_jobs j JOIN posting_job_accounts a ON a.job_id=j.id
    WHERE a.account_id=? AND (j.status IN ('WAITING','RUNNING','PAUSED') OR EXISTS
      (SELECT 1 FROM posting_job_targets t WHERE t.job_id=j.id AND t.account_id=a.account_id AND t.status='PROCESSING'))
    UNION SELECT DISTINCT 'JOIN-' || j.id, j.status FROM auto_join_jobs j
    JOIN auto_join_job_accounts a ON a.job_id=j.id
    WHERE a.account_id=? AND (j.status IN ('RUNNING','PAUSED') OR EXISTS
      (SELECT 1 FROM auto_join_targets t WHERE t.job_id=j.id AND t.account_id=a.account_id AND t.status='PROCESSING'))
    UNION SELECT DISTINCT 'GS-' || j.id, j.status FROM group_status_jobs j
    WHERE (EXISTS (SELECT 1 FROM json_each(j.selected_accounts) WHERE value=?)
      OR EXISTS (SELECT 1 FROM group_status_targets t WHERE t.job_id=j.id AND t.account_id=?))
      AND (j.status IN ('RUNNING','PAUSED') OR EXISTS
        (SELECT 1 FROM group_status_targets t WHERE t.job_id=j.id AND t.account_id=? AND t.status='IN_FLIGHT'))
  `).all(Number(id),Number(id),Number(id),Number(id),Number(id));
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='fu_jobs'").get())rows.push(...db.prepare(`SELECT 'FU-'||j.id name,j.status FROM fu_jobs j WHERE EXISTS(SELECT 1 FROM json_each(j.data,'$.accounts') a WHERE json_extract(a.value,'$.id')=?) AND (j.status IN ('RUNNING','PAUSED','QUOTA') OR EXISTS(SELECT 1 FROM fu_targets t WHERE t.job_id=j.id AND t.account_id=? AND t.status='PROCESSING'))`).all(Number(id),Number(id)));
  return rows;
}
function assertAccountAvailableForRemovalDb(db, id) {
  const rows = accountDependenciesDb(db, id);
  if (rows.length) throw new Error('Akaun masih digunakan: ' + rows.map(x => x.name + ' · ' + x.status).join(', ') + '. Hentikan kempen atau keluarkan akaun dahulu; tunggu penghantaran selesai.');
}
export function accountDependencies(path, id) { return withDb(path, db => accountDependenciesDb(db, id)); }
export function assertAccountAvailableForRemoval(path, id) { return withDb(path, db => assertAccountAvailableForRemovalDb(db, id)); }
export function accountActiveCampaignCount(path, id) { return accountDependencies(path, id).filter(x => /^(CAM|GS)-/.test(x.name)).length; }
export function findWhatsAppAccountByPhone(path, phone, excludeId = 0) {
  const digits = String(phone || '').replace(/\D/g, '');
  return listAllWhatsAppAccounts(path).find(x => x.id !== Number(excludeId) && String(x.phone || '').replace(/\D/g, '') === digits) || null;
}

export function deletePendingWhatsAppAccount(path, id) {
  return withDb(path, db => {
    const numericId = Number(id);
    const row = db.prepare('SELECT id, last_connected_at AS lastConnectedAt FROM whatsapp_accounts WHERE id = ?').get(numericId);
    if (!row || row.lastConnectedAt) return false;
    return db.prepare('DELETE FROM whatsapp_accounts WHERE id = ? AND last_connected_at IS NULL').run(numericId).changes > 0;
  });
}

export function whatsappAccountSummary(path) {
  return withDb(path, db => {
    const row = db.prepare(`
      SELECT count(*) AS total,
             sum(CASE WHEN status = 'ONLINE' THEN 1 ELSE 0 END) AS connected,
             coalesce(sum(group_count), 0) AS groups
      FROM whatsapp_accounts
      WHERE last_connected_at IS NOT NULL AND deleted_at IS NULL
    `).get();
    return {
      total: Number(row.total || 0),
      connected: Number(row.connected || 0),
      groups: Number(row.groups || 0)
    };
  });
}

export function markWhatsAppAccountsOffline(path) {
  return withDb(path, db => db.prepare(`
    UPDATE whatsapp_accounts SET status = 'OFFLINE', updated_at = ?
    WHERE status IN ('ONLINE','CONNECTING') AND last_connected_at IS NOT NULL AND deleted_at IS NULL
  `).run(new Date().toISOString()).changes);
}

const AUTO_MARK_READ_KEY = 'whatsapp_auto_mark_read';

export function getWhatsAppAutoMarkRead(path) {
  return withDb(path, db => {
    const row = db.prepare('SELECT value FROM system_meta WHERE key = ?').get(AUTO_MARK_READ_KEY);
    if (!row) return true;
    return String(row.value || '').trim() !== '0';
  });
}

export function setWhatsAppAutoMarkRead(path, enabled) {
  const value = enabled ? '1' : '0';
  return withDb(path, db => {
    db.prepare(`
      INSERT INTO system_meta (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(AUTO_MARK_READ_KEY, value);
    return value === '1';
  });
}

function normalizeGroup(group = {}) {
  const jid = String(group.jid || group.id || '').trim();
  if (!jid.endsWith('@g.us')) return null;
  const subject = String(group.subject || 'Group WhatsApp').trim() || 'Group WhatsApp';
  const rawCount = group.participantCount ?? group.size ?? group.participants?.length;
  const participantCountKnown = group.participantCountKnown !== false && rawCount != null && Number.isSafeInteger(Number(rawCount)) && Number(rawCount)>=0;
  const participantCount = participantCountKnown ? Number(rawCount) : 0;
  const accountRole = ['ADMIN','MEMBER'].includes(group.accountRole) ? group.accountRole : null;
  const announcement = typeof group.announcement==='boolean' ? Number(group.announcement) : [0,1].includes(group.announcement) ? group.announcement : null;
  return { jid, subject, participantCount, participantCountKnown:Number(participantCountKnown), accountRole, announcement };
}

export function recoverWhatsAppGroupSync(path) {
  return withDb(path,db=>db.prepare('DELETE FROM whatsapp_group_sync_stage').run().changes);
}

export function assertSavedGroupAccess(path,accountId,jid) {
  return withDb(path,db=>{
    const row=db.prepare('SELECT is_available AS available FROM whatsapp_groups WHERE account_id=? AND jid=?').get(Number(accountId),String(jid));
    if(row?.available===0)throw Object.assign(new Error('Group tidak lagi tersedia untuk akaun ini berdasarkan sync terakhir.'),{code:'GROUP_ACCESS_UNAVAILABLE'});
  });
}

export function beginWhatsAppGroupSync(path, accountId, runId) {
  return withDb(path, db => {
    const numericId = Number(accountId);
    const account = getWhatsAppAccountFromDb(db, numericId);
    if (!account) throw new Error('Akaun WhatsApp tidak ditemui.');
    db.prepare('DELETE FROM whatsapp_group_sync_stage WHERE account_id = ?').run(numericId);
    return { account, runId: String(runId) };
  });
}

export function stageWhatsAppGroupBatch(path, accountId, runId, groups = []) {
  return withDb(path, db => {
    const numericId = Number(accountId);
    const now = new Date().toISOString();
    const unique = new Map();
    for (const raw of groups) {
      const group = normalizeGroup(raw);
      if (group) unique.set(group.jid, group);
    }
    const incoming = [...unique.values()];
    db.exec('BEGIN IMMEDIATE;');
    try {
      const upsert = db.prepare(`
        INSERT INTO whatsapp_group_sync_stage
          (account_id, run_id, jid, subject, participant_count, staged_at, participant_count_known, account_role, announcement)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(account_id, run_id, jid) DO UPDATE SET
          subject = excluded.subject,
          participant_count = excluded.participant_count,
          participant_count_known = excluded.participant_count_known,
          account_role = excluded.account_role,
          announcement = excluded.announcement,
          staged_at = excluded.staged_at
      `);
      for (const group of incoming) {
        upsert.run(numericId, String(runId), group.jid, group.subject, group.participantCount, now, group.participantCountKnown, group.accountRole, group.announcement);
      }
      const staged = Number(db.prepare(`
        SELECT count(*) AS n FROM whatsapp_group_sync_stage
        WHERE account_id = ? AND run_id = ?
      `).get(numericId, String(runId))?.n || 0);
      db.exec('COMMIT;');
      return { staged, accepted: incoming.length };
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  });
}

export function abortWhatsAppGroupSync(path, accountId, runId = null) {
  return withDb(path, db => {
    if (runId === null || runId === undefined) {
      return db.prepare('DELETE FROM whatsapp_group_sync_stage WHERE account_id = ?').run(Number(accountId)).changes;
    }
    return db.prepare('DELETE FROM whatsapp_group_sync_stage WHERE account_id = ? AND run_id = ?')
      .run(Number(accountId), String(runId)).changes;
  });
}

export function finalizeWhatsAppGroupSync(path, accountId, runId) {
  return withDb(path, db => {
    const numericId = Number(accountId);
    const run = String(runId);
    const account = getWhatsAppAccountFromDb(db, numericId);
    if (!account) throw new Error('Akaun WhatsApp tidak ditemui.');
    const stagedCount = Number(db.prepare(`
      SELECT count(*) AS n FROM whatsapp_group_sync_stage
      WHERE account_id = ? AND run_id = ?
    `).get(numericId, run)?.n || 0);
    const now = new Date().toISOString();

    db.exec('BEGIN IMMEDIATE;');
    try {
      const knownRows = db.prepare('SELECT jid, is_available AS isAvailable FROM whatsapp_groups WHERE account_id = ?').all(numericId);
      const known = new Map(knownRows.map(row => [String(row.jid), Number(row.isAvailable)]));
      const previousAvailable = new Set(knownRows.filter(row => Number(row.isAvailable) === 1).map(row => String(row.jid)));
      const stagedRows = db.prepare(`
        SELECT jid, subject, participant_count AS participantCount,
          participant_count_known AS participantCountKnown, account_role AS accountRole, announcement
        FROM whatsapp_group_sync_stage
        WHERE account_id = ? AND run_id = ?
      `).all(numericId, run);
      const current = new Set(stagedRows.map(row => String(row.jid)));
      const newCount = stagedRows.filter(group => !known.has(group.jid)).length;
      const restored = stagedRows.filter(group => known.has(group.jid) && known.get(group.jid) === 0).length;
      const removed = [...previousAvailable].filter(jid => !current.has(jid)).length;

      db.prepare('UPDATE whatsapp_groups SET is_available = 0, synced_at = ? WHERE account_id = ?').run(now, numericId);
      const upsert = db.prepare(`
        INSERT INTO whatsapp_groups
          (account_id, jid, subject, participant_count, is_available, first_seen_at, last_seen_at, synced_at, participant_count_known, account_role, announcement)
        VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(account_id, jid) DO UPDATE SET
          subject = excluded.subject,
          participant_count = excluded.participant_count,
          participant_count_known = excluded.participant_count_known,
          account_role = excluded.account_role,
          announcement = excluded.announcement,
          is_available = 1,
          last_seen_at = excluded.last_seen_at,
          synced_at = excluded.synced_at
      `);
      for (const group of stagedRows) {
        upsert.run(numericId, group.jid, group.subject, group.participantCount, now, now, now, group.participantCountKnown, group.accountRole, group.announcement);
      }
      db.prepare(`
        UPDATE whatsapp_accounts
        SET group_count = ?, last_group_sync_at = ?, updated_at = ?
        WHERE id = ?
      `).run(stagedCount, now, now, numericId);
      db.prepare('DELETE FROM whatsapp_group_sync_stage WHERE account_id = ?').run(numericId);

      db.exec('COMMIT;');
      return {
        account: getWhatsAppAccountFromDb(db, numericId),
        before: previousAvailable.size,
        detected: stagedCount,
        newCount,
        existingCount: stagedCount - newCount - restored,
        restoredCount: restored,
        removedCount: removed,
        syncedAt: now
      };
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  });
}

export function syncWhatsAppGroups(path, accountId, groups = []) {
  const runId = `direct-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  beginWhatsAppGroupSync(path, accountId, runId);
  try {
    stageWhatsAppGroupBatch(path, accountId, runId, groups);
    return finalizeWhatsAppGroupSync(path, accountId, runId);
  } catch (error) {
    abortWhatsAppGroupSync(path, accountId, runId);
    throw error;
  }
}

export function listWhatsAppGroups(path, accountId, { page = 1, perPage = 10, availableOnly = true } = {}) {
  return withDb(path, db => {
    const numericId = Number(accountId);
    const safePerPage = Math.max(1, Math.min(50, Number(perPage) || 10));
    const whereAvailable = availableOnly ? 'AND is_available = 1' : '';
    const total = Number(db.prepare(`SELECT count(*) AS n FROM whatsapp_groups WHERE account_id = ? ${whereAvailable}`).get(numericId)?.n || 0);
    const totalPages = Math.max(1, Math.ceil(total / safePerPage));
    const safePage = Math.max(1, Math.min(Number(page) || 1, totalPages));
    const offset = (safePage - 1) * safePerPage;
    const items = db.prepare(`
      SELECT id, account_id AS accountId, jid, subject,
             participant_count AS participantCount,
             is_available AS isAvailable,
             first_seen_at AS firstSeenAt,
             last_seen_at AS lastSeenAt,
             synced_at AS syncedAt
      FROM whatsapp_groups
      WHERE account_id = ? ${whereAvailable}
      ORDER BY subject COLLATE NOCASE, jid
      LIMIT ? OFFSET ?
    `).all(numericId, safePerPage, offset);
    return { items, total, page: safePage, perPage: safePerPage, totalPages, offset };
  });
}

export function getWhatsAppGroupByPosition(path, accountId, position, { availableOnly = true } = {}) {
  return withDb(path, db => {
    const numericId = Number(accountId);
    const ordinal = Math.max(1, Number(position) || 1);
    const whereAvailable = availableOnly ? 'AND is_available = 1' : '';
    return db.prepare(`
      SELECT id, account_id AS accountId, jid, subject,
             participant_count AS participantCount,
             is_available AS isAvailable,
             first_seen_at AS firstSeenAt,
             last_seen_at AS lastSeenAt,
             synced_at AS syncedAt
      FROM whatsapp_groups
      WHERE account_id = ? ${whereAvailable}
      ORDER BY subject COLLATE NOCASE, jid
      LIMIT 1 OFFSET ?
    `).get(numericId, ordinal - 1) || null;
  });
}

export function countWhatsAppGroups(path, accountId = null) {
  return withDb(path, db => {
    if (accountId === null || accountId === undefined) {
      return Number(db.prepare('SELECT count(*) AS n FROM whatsapp_groups WHERE is_available = 1').get()?.n || 0);
    }
    return Number(db.prepare('SELECT count(*) AS n FROM whatsapp_groups WHERE account_id = ? AND is_available = 1').get(Number(accountId))?.n || 0);
  });
}

export * from './autojoin-store.js';
