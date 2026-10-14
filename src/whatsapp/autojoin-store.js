import { DatabaseSync } from 'node:sqlite';
import { nextAutoJoinWait, parseWhatsAppInviteLinks } from './join.js';

function withDb(path, fn) {
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
    return fn(db);
  } finally {
    db.close();
  }
}

const AUTO_JOIN_STANDARD_SETTINGS = Object.freeze({
  mode: 'STANDARD',
  delayMinSec: 60,
  delayMaxSec: 120,
  batchSize: 5,
  restMinSec: 300,
  restMaxSec: 600,
  cooldownEvery: 25,
  cooldownSec: 900
});

function autoJoinSettingsFromRow(row = {}) {
  return {
    mode: row.mode || 'STANDARD',
    delayMinSec: Number(row.delay_min_sec ?? row.delayMinSec ?? 60),
    delayMaxSec: Number(row.delay_max_sec ?? row.delayMaxSec ?? 120),
    batchSize: Number(row.batch_size ?? row.batchSize ?? 5),
    restMinSec: Number(row.rest_min_sec ?? row.restMinSec ?? 300),
    restMaxSec: Number(row.rest_max_sec ?? row.restMaxSec ?? 600),
    cooldownEvery: Number(row.cooldown_every ?? row.cooldownEvery ?? 25),
    cooldownSec: Number(row.cooldown_sec ?? row.cooldownSec ?? 900),
    updatedAt: row.updated_at ?? row.updatedAt ?? null
  };
}

export function getAutoJoinSettings(path) {
  return withDb(path, db => {
    const row = db.prepare('SELECT * FROM auto_join_settings WHERE id = 1').get();
    return row ? autoJoinSettingsFromRow(row) : { ...AUTO_JOIN_STANDARD_SETTINGS, updatedAt: null };
  });
}

export function validateAutoJoinSettings(input = {}) {
  const value = {
    mode: input.mode === 'CUSTOM' ? 'CUSTOM' : 'STANDARD',
    delayMinSec: Number(input.delayMinSec),
    delayMaxSec: Number(input.delayMaxSec),
    batchSize: Number(input.batchSize),
    restMinSec: Number(input.restMinSec),
    restMaxSec: Number(input.restMaxSec),
    cooldownEvery: Number(input.cooldownEvery),
    cooldownSec: Number(input.cooldownSec)
  };
  if (!Number.isInteger(value.delayMinSec) || value.delayMinSec < 10 || value.delayMinSec > 3600) throw new Error('Delay Min mesti 10–3600 saat.');
  if (!Number.isInteger(value.delayMaxSec) || value.delayMaxSec < value.delayMinSec || value.delayMaxSec > 3600) throw new Error('Delay Max mesti sama/lebih besar daripada Delay Min.');
  if (!Number.isInteger(value.batchSize) || value.batchSize < 1 || value.batchSize > 100) throw new Error('Batch mesti 1–100.');
  if (!Number.isInteger(value.restMinSec) || value.restMinSec < 0 || value.restMinSec > 21600) throw new Error('Rehat Min tidak sah.');
  if (!Number.isInteger(value.restMaxSec) || value.restMaxSec < value.restMinSec || value.restMaxSec > 21600) throw new Error('Rehat Max tidak sah.');
  if (!Number.isInteger(value.cooldownEvery) || value.cooldownEvery < 1 || value.cooldownEvery > 1000) throw new Error('Kiraan cooldown tidak sah.');
  if (!Number.isInteger(value.cooldownSec) || value.cooldownSec < 0 || value.cooldownSec > 43200) throw new Error('Tempoh cooldown tidak sah.');
  return value;
}

export function updateAutoJoinSettings(path, input = {}) {
  const value = validateAutoJoinSettings({ ...getAutoJoinSettings(path), ...input, mode: input.mode || 'CUSTOM' });
  return withDb(path, db => {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE auto_join_settings SET
        mode = ?, delay_min_sec = ?, delay_max_sec = ?, batch_size = ?,
        rest_min_sec = ?, rest_max_sec = ?, cooldown_every = ?, cooldown_sec = ?, updated_at = ?
      WHERE id = 1
    `).run(value.mode, value.delayMinSec, value.delayMaxSec, value.batchSize, value.restMinSec, value.restMaxSec, value.cooldownEvery, value.cooldownSec, now);
    return autoJoinSettingsFromRow(db.prepare('SELECT * FROM auto_join_settings WHERE id = 1').get());
  });
}

export function resetAutoJoinSettings(path) {
  return updateAutoJoinSettings(path, { ...AUTO_JOIN_STANDARD_SETTINGS, mode: 'STANDARD' });
}

const stamp = () => new Date().toISOString();
function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const value=fn(); db.exec('COMMIT'); return value; }
  catch(error) { db.exec('ROLLBACK'); throw error; }
}
const jobSelect = `SELECT j.*, (SELECT count(*) FROM auto_join_jobs n WHERE n.id<=j.id) AS displayNumber FROM auto_join_jobs j`;
function jobRow(row) {
  if (!row) return null;
  return { id:row.id, displayNumber:row.displayNumber, status:row.status, mode:row.mode,
    distribution:row.distribution, stage:row.draft_stage, selectionDirty:!!row.selection_dirty,
    totalInput:row.total_input, validCount:row.valid_count, duplicateCount:row.duplicate_count,
    invalidCount:row.invalid_count, invalid:JSON.parse(row.invalid_json),
    settingDraft:row.setting_draft_json ? JSON.parse(row.setting_draft_json) : null,
    successCount:row.success_count, failedCount:row.failed_count, cursor:row.cursor,
    ...autoJoinSettingsFromRow(row), mode:row.mode,
    createdAt:row.created_at, startedAt:row.started_at, completedAt:row.completed_at, updatedAt:row.updated_at };
}
function getJob(db,id) { return jobRow(db.prepare(jobSelect+' WHERE j.id=?').get(Number(id))); }
function draftOnly(db,id) {
  const job=getJob(db,id);
  if (!job || job.status!=='DRAFT') throw new Error('Draf tidak tersedia. Buka .join-draft.');
  return job;
}
function accounts(db,id) {
  return db.prepare(`SELECT a.id,a.label,a.phone,a.status,a.deleted_at AS deletedAt,a.group_count AS groupCount,
   CASE WHEN a.deleted_at IS NULL THEN (SELECT count(*) FROM whatsapp_accounts n WHERE n.id<=a.id AND n.deleted_at IS NULL AND n.last_connected_at IS NOT NULL) ELSE NULL END AS displayNumber,
   ja.position,ja.processed_count AS processedCount,ja.batch_processed AS batchProcessed,
   ja.available_at AS availableAt,ja.last_delay_sec AS lastDelaySec,ja.last_rest_sec AS lastRestSec,
   (SELECT count(*) FROM auto_join_targets t WHERE t.job_id=ja.job_id AND t.account_id=a.id AND t.status='PENDING') AS pending
   FROM auto_join_job_accounts ja JOIN whatsapp_accounts a ON a.id=ja.account_id WHERE ja.job_id=? ORDER BY ja.position`).all(Number(id));
}
function conflicts(db,ids,exclude) {
  return db.prepare(`SELECT DISTINCT ja.account_id AS accountId,j.id,
   (SELECT count(*) FROM auto_join_jobs n WHERE n.id<=j.id) AS displayNumber,j.status
   FROM auto_join_job_accounts ja JOIN auto_join_jobs j ON j.id=ja.job_id
   WHERE ja.account_id IN (SELECT value FROM json_each(?)) AND j.id<>?
   AND (j.status IN ('DRAFT','RUNNING','PAUSED') OR EXISTS(SELECT 1 FROM auto_join_targets t WHERE t.job_id=j.id AND t.status='PROCESSING'))`)
   .all(JSON.stringify(ids),Number(exclude||0));
}
export function autoJoinAccountConflicts(path,ids,exclude=0) { return withDb(path,db=>conflicts(db,ids,exclude)); }
export function getAutoJoinJob(path,id) { return withDb(path,db=>getJob(db,id)); }
export function getDraftAutoJoinJob(path) { return withDb(path,db=>jobRow(db.prepare(jobSelect+" WHERE j.status='DRAFT' LIMIT 1").get())); }
export function listAutoJoinJobs(path,{page=1,perPage=10}={}) {
  return withDb(path,db=>{
    const total=db.prepare('SELECT count(*) AS n FROM auto_join_jobs').get().n;
    perPage=Math.max(1,Math.min(50,Number(perPage)||10));
    const totalPages=Math.max(1,Math.ceil(total/perPage)); page=Math.max(1,Math.min(Number(page)||1,totalPages));
    return {items:db.prepare(jobSelect+' ORDER BY j.id LIMIT ? OFFSET ?').all(perPage,(page-1)*perPage).map(jobRow),total,page,perPage,totalPages,offset:(page-1)*perPage};
  });
}
export function autoJoinSummary(path) { return withDb(path,db=>Object.fromEntries(db.prepare('SELECT status,count(*) AS n FROM auto_join_jobs GROUP BY status').all().map(r=>[r.status,r.n]))); }
export function getAutoJoinJobAccounts(path,id) { return withDb(path,db=>accounts(db,id)); }
function rebuildTargets(db,id) {
  const j=draftOnly(db,id); const selected=accounts(db,id);
  db.prepare('DELETE FROM auto_join_targets WHERE job_id=?').run(id);
  if (!selected.length || !j.distribution || j.selectionDirty) return;
  const links=db.prepare('SELECT * FROM auto_join_links WHERE job_id=? ORDER BY position').all(id);
  const insert=db.prepare('INSERT INTO auto_join_targets(job_id,position,link_position,invite_code,invite_url,account_id) VALUES(?,?,?,?,?,?)');
  let position=0;
  for (const link of links) {
    const assigned=j.distribution==='ALL_EACH' ? selected : [selected[(link.position-1)%selected.length]];
    for (const a of assigned) insert.run(id,++position,link.position,link.invite_code,link.invite_url,a.id);
  }
}
function saveAccounts(db,id,ids,{requireOnline=true}={}) {
  draftOnly(db,id); ids=[...new Set(ids.map(Number))];
  if (!ids.length || ids.some(x=>!Number.isSafeInteger(x)||x<1)) throw new Error('Pilih sekurang-kurangnya satu akaun.');
  if (conflicts(db,ids,id).length) throw new Error('Akaun masih digunakan oleh job Auto Join lain. Semak .join-list.');
  for (const aid of ids) {
    const a=db.prepare('SELECT * FROM whatsapp_accounts WHERE id=? AND deleted_at IS NULL AND last_connected_at IS NOT NULL').get(aid);
    if (!a || (requireOnline && a.status!=='ONLINE')) throw new Error('Akaun tidak tersedia / belum ONLINE. Pilih semula.');
  }
  db.prepare('DELETE FROM auto_join_job_accounts WHERE job_id=?').run(id);
  const insert=db.prepare('INSERT INTO auto_join_job_accounts(job_id,account_id,position) VALUES(?,?,?)');
  ids.forEach((aid,i)=>insert.run(id,aid,i+1));
  db.prepare('UPDATE auto_join_jobs SET distribution=?,mode=?,draft_stage=?,selection_dirty=0,updated_at=? WHERE id=?')
    .run(ids.length===1?'ROUND_ROBIN':'',ids.length===1?'single':'all',ids.length===1?'INPUT':'DISTRIBUTION',stamp(),id);
  rebuildTargets(db,id);
}
export function createAutoJoinJob(path,{accountIds=[],mode='single',parsed}={}) {
  return withDb(path,db=>transaction(db,()=>{
    const old=db.prepare("SELECT id FROM auto_join_jobs WHERE status='DRAFT'").get();
    if (old) return getJob(db,old.id);
    const s=autoJoinSettingsFromRow(db.prepare('SELECT * FROM auto_join_settings WHERE id=1').get()); const now=stamp();
    const id=Number(db.prepare(`INSERT INTO auto_join_jobs(status,mode,draft_stage,distribution,delay_min_sec,delay_max_sec,batch_size,rest_min_sec,rest_max_sec,cooldown_every,cooldown_sec,created_at,updated_at)
     VALUES('DRAFT',?,'ACCOUNTS','',?,?,?,?,?,?,?,?,?)`).run(mode==='all'?'all':'single',s.delayMinSec,s.delayMaxSec,s.batchSize,s.restMinSec,s.restMaxSec,s.cooldownEvery,s.cooldownSec,now,now).lastInsertRowid);
    if (accountIds.length) saveAccounts(db,id,accountIds);
    // Compatibility helper; interactive flow always asks multi-account distribution explicitly.
    if (parsed) {
      db.prepare("UPDATE auto_join_jobs SET distribution='ROUND_ROBIN' WHERE id=?").run(id);
      appendParsed(db,id,parsed);
    }
    return getJob(db,id);
  }));
}
export function setAutoJoinDraftAccounts(path,id,ids) { return withDb(path,db=>transaction(db,()=>{saveAccounts(db,id,ids);return getJob(db,id);})); }
export function setAutoJoinDistribution(path,id,value) {
  if (!['ROUND_ROBIN','ALL_EACH'].includes(value)) throw new Error('Balas 1 atau 2 untuk agihan.');
  return withDb(path,db=>transaction(db,()=>{draftOnly(db,id);db.prepare("UPDATE auto_join_jobs SET distribution=?,draft_stage='INPUT',updated_at=? WHERE id=?").run(value,stamp(),id);rebuildTargets(db,id);return getJob(db,id);}));
}
export function setAutoJoinDraftStage(path,id,stage,settingDraft=undefined) {
  if (!['ACCOUNTS','DISTRIBUTION','INPUT','REVIEW','SETTINGS','FINAL','SETTING_DELAY','SETTING_BATCH','SETTING_REST','SETTING_EVERY','SETTING_COOLDOWN','SETTING_REVIEW'].includes(stage)) throw new Error('Langkah tidak sah.');
  return withDb(path,db=>{draftOnly(db,id); db.prepare('UPDATE auto_join_jobs SET draft_stage=?,updated_at=? WHERE id=?').run(stage,stamp(),id);
    if (settingDraft!==undefined) db.prepare('UPDATE auto_join_jobs SET setting_draft_json=? WHERE id=?').run(settingDraft===null?null:JSON.stringify(settingDraft),id);
    return getJob(db,id);});
}
function appendParsed(db,id,parsed) {
  const j=draftOnly(db,id);
  const old=db.prepare('SELECT invite_code FROM auto_join_links WHERE job_id=? ORDER BY position').all(id);
  const seen=new Set(old.map(x=>x.invite_code)); let duplicate=Number(parsed.duplicateCount||0);
  const fresh=[];
  for (const link of parsed.targets||[]) { if(seen.has(link.inviteCode)) duplicate++; else {seen.add(link.inviteCode); fresh.push(link);} }
  if (seen.size>1000) throw new Error('Had 1,000 link unik setiap job. Tiada link daripada input ini disimpan; kecilkan fail / senarai.');
  const invalid=[...j.invalid,...(parsed.invalid||[])];
  if (invalid.length>2000) throw new Error('Had 2,000 input tidak sah dalam draf. Buang draf atau bersihkan senarai dahulu.');
  const add=db.prepare('INSERT INTO auto_join_links(job_id,position,invite_code,invite_url) VALUES(?,?,?,?)');
  fresh.forEach((link,i)=>add.run(id,old.length+i+1,link.inviteCode,link.inviteUrl));
  db.prepare(`UPDATE auto_join_jobs SET total_input=total_input+?,valid_count=?,duplicate_count=duplicate_count+?,invalid_count=invalid_count+?,invalid_json=?,draft_stage=?,updated_at=? WHERE id=?`)
   .run(Number(parsed.totalInput||0),seen.size,duplicate,Number(parsed.invalidCount||0),JSON.stringify(invalid),seen.size?'REVIEW':'INPUT',stamp(),id);
  rebuildTargets(db,id); return getJob(db,id);
}
export function addAutoJoinLinks(path,id,text) {
  if (Buffer.byteLength(text,'utf8')>1024*1024) throw new Error('Had input / fail TXT ialah 1 MB. Tiada input dipotong.');
  const parsed=parseWhatsAppInviteLinks(text);
  return withDb(path,db=>transaction(db,()=>appendParsed(db,id,parsed)));
}
export function saveAutoJoinDraftSettings(path,id,input) {
  const s=validateAutoJoinSettings(input);
  return withDb(path,db=>{draftOnly(db,id);db.prepare(`UPDATE auto_join_jobs SET delay_min_sec=?,delay_max_sec=?,batch_size=?,rest_min_sec=?,rest_max_sec=?,cooldown_every=?,cooldown_sec=?,draft_stage='SETTINGS',setting_draft_json=NULL,updated_at=? WHERE id=?`)
    .run(s.delayMinSec,s.delayMaxSec,s.batchSize,s.restMinSec,s.restMaxSec,s.cooldownEvery,s.cooldownSec,stamp(),id);return getJob(db,id);});
}
export function setAutoJoinJobStatus(path,id,status) {
  if(!['DRAFT','RUNNING','PAUSED','STOPPED','COMPLETED'].includes(status)) throw new Error('Status Auto Join tidak sah.');
  return withDb(path,db=>transaction(db,()=>{
    const j=getJob(db,id); if(!j) throw new Error('Job tidak ditemui.');
    if(status==='RUNNING') {
      if(j.status==='COMPLETED') throw new Error('Job sudah selesai.');
      if(j.selectionDirty || !j.distribution) throw new Error('Pilih akaun dan agihan semula melalui .join-draft.');
      const a=accounts(db,id); if(!a.length||a.some(x=>x.deletedAt)) throw new Error('Akaun job tidak tersedia. Semak .accounts.');
      if(conflicts(db,a.map(x=>x.id),id).length) throw new Error('Akaun sedang digunakan job lain. Semak .join-list.');
      if(!a.some(x=>x.status==='ONLINE'&&x.pending>0)) throw new Error('Tiada akaun ONLINE dengan baki PENDING. Job belum dimulakan.');
      db.prepare("UPDATE auto_join_jobs SET status='RUNNING',started_at=coalesce(started_at,?),completed_at=NULL,updated_at=? WHERE id=?").run(stamp(),stamp(),id);
    } else db.prepare('UPDATE auto_join_jobs SET status=?,completed_at=?,updated_at=? WHERE id=?').run(status,['COMPLETED','STOPPED'].includes(status)?stamp():null,stamp(),id);
    return getJob(db,id);
  }));
}
function stats(db,id) {
  const j=getJob(db,id); if(!j) return null;
  const rows=db.prepare('SELECT status,count(*) AS n FROM auto_join_targets WHERE job_id=? GROUP BY status').all(id);
  const n=Object.fromEntries(rows.map(r=>[r.status,r.n]));
  const total=rows.reduce((sum,r)=>sum+r.n,0); const pending=n.PENDING||0,processing=n.PROCESSING||0;
  return {...j,targetTotal:total,processed:total-pending-processing,pending,processing,successCount:n.SUCCESS||0,
    alreadyCount:n.ALREADY||0,approvalCount:n.APPROVAL||0,failedCount:(n.FAILED||0)+(n.SKIPPED||0),unknownCount:n.UNKNOWN||0};
}
export function refreshAutoJoinJobStats(path,id) {return withDb(path,db=>stats(db,Number(id)));}
export function claimNextAutoJoinTarget(path,id,aid) {
  return withDb(path,db=>transaction(db,()=>{
    if(getJob(db,id)?.status!=='RUNNING') return null;
    // A DB guard also prevents overlap between different Auto Join jobs.
    if(db.prepare("SELECT 1 FROM auto_join_targets WHERE status='PROCESSING' LIMIT 1").get()) return null;
    const schedule=accounts(db,id).find(a=>a.id===Number(aid));
    if(!schedule||schedule.deletedAt||schedule.status!=='ONLINE'||Date.parse(schedule.availableAt||0)>Date.now()) return null;
    const t=db.prepare("SELECT id,job_id AS jobId,position,link_position AS linkPosition,invite_code AS inviteCode,invite_url AS inviteUrl,account_id AS accountId,retry_count AS retryCount FROM auto_join_targets WHERE job_id=? AND account_id=? AND status='PENDING' ORDER BY position LIMIT 1").get(id,aid);
    if(!t) return null;
    const now=stamp();db.prepare("UPDATE auto_join_targets SET status='PROCESSING',attempted_at=?,dispatched_at=NULL WHERE id=?").run(now,t.id);
    db.prepare('UPDATE auto_join_jobs SET cursor=?,updated_at=? WHERE id=?').run(schedule.position,now,id);
    return {...t,attemptedAt:now};
  }));
}
export function markAutoJoinDispatched(path,id) { return withDb(path,db=>db.prepare("UPDATE auto_join_targets SET dispatched_at=? WHERE id=? AND status='PROCESSING'").run(stamp(),id).changes>0); }
export function incrementAutoJoinRetry(path,id) {return withDb(path,db=>{db.prepare('UPDATE auto_join_targets SET retry_count=retry_count+1 WHERE id=?').run(id);return db.prepare('SELECT retry_count AS n FROM auto_join_targets WHERE id=?').get(id).n;});}
function scheduleInDb(db,jobId,aid,{delaySec=0,restSec=0,resetBatch=false}={}) {
  const row=accounts(db,jobId).find(a=>a.id===Number(aid)); if(!row) return null;
  const waitSec=Math.max(0,delaySec,restSec);const availableAt=new Date(Math.max(Date.now()+waitSec*1000,Date.parse(row.availableAt||0)||0)).toISOString();
  db.prepare('UPDATE auto_join_job_accounts SET processed_count=processed_count+1,batch_processed=?,available_at=?,last_delay_sec=?,last_rest_sec=? WHERE job_id=? AND account_id=?')
    .run(resetBatch?0:row.batchProcessed+1,availableAt,delaySec,restSec,jobId,aid);
  return {processedCount:row.processedCount+1,batchProcessed:resetBatch?0:row.batchProcessed+1,availableAt,delaySec,restSec};
}
export function recordAutoJoinAccountSchedule(path,id,aid,plan) {return withDb(path,db=>scheduleInDb(db,id,aid,plan));}
export function completeAutoJoinTarget(path,id,result={}) {
  return withDb(path,db=>transaction(db,()=>{
    const t=db.prepare("SELECT * FROM auto_join_targets WHERE id=? AND status='PROCESSING'").get(id); if(!t) return null;
    const status=result.status||(result.success?'SUCCESS':'FAILED');
    if(!['SUCCESS','ALREADY','APPROVAL','FAILED','UNKNOWN'].includes(status)) throw new Error('Keputusan join tidak sah.');
    db.prepare('UPDATE auto_join_targets SET status=?,group_jid=?,group_name=?,participant_count=?,error_text=?,completed_at=?,schedule_recorded=? WHERE id=?')
     .run(status,result.groupJid||null,result.groupName||null,Math.max(0,Number(result.participantCount)||0),result.error?String(result.error).slice(0,300):null,stamp(),result.schedule?1:0,id);
    if(result.schedule&&!t.schedule_recorded) scheduleInDb(db,t.job_id,t.account_id,nextAutoJoinWait(getJob(db,t.job_id),accounts(db,t.job_id).find(a=>a.id===t.account_id)||{}));
    const s=stats(db,t.job_id);db.prepare('UPDATE auto_join_jobs SET success_count=?,failed_count=?,updated_at=? WHERE id=?').run(s.successCount,s.failedCount,stamp(),t.job_id);
    if(!s.pending&&!s.processing) db.prepare("UPDATE auto_join_jobs SET status='COMPLETED',completed_at=?,updated_at=? WHERE id=? AND status='RUNNING'").run(stamp(),stamp(),t.job_id);
    return stats(db,t.job_id);
  }));
}
export function requeueAutoJoinTarget(path,id,reason='Menunggu sambungan') {
  return withDb(path,db=>{ const t=db.prepare('SELECT job_id FROM auto_join_targets WHERE id=?').get(id);if(!t)return null;
    db.prepare("UPDATE auto_join_targets SET status='PENDING',dispatched_at=NULL,error_text=?,completed_at=NULL WHERE id=? AND status='PROCESSING'").run(reason,id);return stats(db,t.job_id);});
}
export function setAutoJoinAccountWait(path,id,aid,seconds=0,labelSec=null) {return withDb(path,db=>{
  const a=accounts(db,id).find(a=>a.id===Number(aid));if(!a)return null;
  const availableAt=new Date(Math.max(Date.now()+Math.max(0,seconds)*1000,Date.parse(a.availableAt||0)||0)).toISOString();
  db.prepare('UPDATE auto_join_job_accounts SET available_at=?,last_rest_sec=? WHERE job_id=? AND account_id=?').run(availableAt,Math.max(0,labelSec??seconds),id,aid);
  return {availableAt,waitSec:seconds};
});}
export function resetAutoJoinAccountBatch(path,id,aid) { return withDb(path,db=>db.prepare('UPDATE auto_join_job_accounts SET batch_processed=0 WHERE job_id=? AND account_id=?').run(id,aid).changes>0); }
export function recoverAutoJoinJobs(path) {
  return withDb(path,db=>transaction(db,()=>{
    let resetTargets=0,uncertainTargets=0;
    for(const t of db.prepare("SELECT * FROM auto_join_targets WHERE status='PROCESSING'").all()) {
      if(t.dispatched_at) {
        db.prepare("UPDATE auto_join_targets SET status='UNKNOWN',error_text='Proses terputus selepas permintaan mungkin dihantar.',completed_at=?,schedule_recorded=1 WHERE id=?").run(stamp(),t.id);
        if(!t.schedule_recorded) scheduleInDb(db,t.job_id,t.account_id,nextAutoJoinWait(getJob(db,t.job_id),accounts(db,t.job_id).find(a=>a.id===t.account_id)||{}));
        uncertainTargets++;
      } else {db.prepare("UPDATE auto_join_targets SET status='PENDING' WHERE id=?").run(t.id);resetTargets++;}
    }
    const pausedJobs=db.prepare("UPDATE auto_join_jobs SET status='PAUSED',updated_at=? WHERE status='RUNNING'").run(stamp()).changes;
    return {pausedJobs,resetTargets,uncertainTargets};
  }));
}
const targetSelect=`SELECT t.id,t.position,t.link_position AS linkPosition,t.invite_url AS inviteUrl,t.status,t.account_id AS accountId,
 a.label AS accountLabel,a.phone AS accountPhone,
 CASE WHEN a.deleted_at IS NULL THEN (SELECT count(*) FROM whatsapp_accounts n WHERE n.id<=a.id AND n.deleted_at IS NULL AND n.last_connected_at IS NOT NULL) ELSE NULL END AS accountNumber,
 t.group_jid AS groupJid,t.group_name AS groupName,t.participant_count AS participantCount,t.error_text AS errorText,t.attempted_at AS attemptedAt,t.completed_at AS completedAt
 FROM auto_join_targets t LEFT JOIN whatsapp_accounts a ON a.id=t.account_id`;
export function listAutoJoinTargets(path,id,{page=1,perPage=10}={}) {return withDb(path,db=>{
  const total=db.prepare('SELECT count(*) AS n FROM auto_join_targets WHERE job_id=?').get(id).n;perPage=Math.min(10,Math.max(1,Number(perPage)||10));
  const totalPages=Math.max(1,Math.ceil(total/perPage));page=Math.min(totalPages,Math.max(1,Number(page)||1));
  return {items:db.prepare(targetSelect+' WHERE t.job_id=? ORDER BY t.position LIMIT ? OFFSET ?').all(id,perPage,(page-1)*perPage),total,page,totalPages,perPage};
});}
export function listRecentAutoJoinTargets(path,id,limit=10) {return withDb(path,db=>db.prepare(targetSelect+" WHERE t.job_id=? AND t.status NOT IN ('PENDING','PROCESSING') ORDER BY t.completed_at DESC,t.id DESC LIMIT ?").all(id,Math.min(10,Math.max(1,limit))));}
export function autoJoinAccountResults(path,id) {return withDb(path,db=>accounts(db,id).map(a=>{
  const n=Object.fromEntries(db.prepare('SELECT status,count(*) AS n FROM auto_join_targets WHERE job_id=? AND account_id=? GROUP BY status').all(id,a.id).map(r=>[r.status,r.n]));return {...a,counts:n};
}));}
export function deleteAutoJoinJob(path,id) {return withDb(path,db=>transaction(db,()=>{
  const j=getJob(db,id);if(!j)return false;
  if(j.status==='RUNNING'||db.prepare("SELECT 1 FROM auto_join_targets WHERE job_id=? AND status='PROCESSING'").get(id)) throw new Error('Hentikan job dan tunggu operasi semasa selesai dahulu.');
  return db.prepare('DELETE FROM auto_join_jobs WHERE id=?').run(id).changes>0;
}));}
export function deleteDraftAutoJoinJob(path,id) {if(getAutoJoinJob(path,id)?.status!=='DRAFT')return false;return deleteAutoJoinJob(path,id);}
export function getRunningAutoJoinJob(path,exclude=0) {return withDb(path,db=>jobRow(db.prepare(jobSelect+" WHERE j.status='RUNNING' AND j.id<>? ORDER BY j.id LIMIT 1").get(Number(exclude||0))));}
