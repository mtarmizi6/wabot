import {diskReady} from '../system/disk.js';
import {capturePolicy,archivedFromDb} from '../system/policy.js';
import { DatabaseSync } from 'node:sqlite';

function withDb(path, fn) {
  const db = new DatabaseSync(path);
  try { db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;'); return fn(db); }
  finally { db.close(); }
}
// Per-account persistent clock: each selected account owns its delay/rest.
// Lazily created to preserve the existing schema-v16 and backwards-compatible rollback.
function ensureAccountSchedule(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS group_status_account_schedule (
    job_id INTEGER NOT NULL REFERENCES group_status_jobs(id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL,
    processed_since_rest INTEGER NOT NULL DEFAULT 0,
    next_run_at TEXT,
    rest_until TEXT,
    last_served_at TEXT,
    PRIMARY KEY(job_id,account_id)
  ) STRICT`);
  // Upgrade the existing schedule lazily without replacing stored jobs.
  const cols=new Set(db.prepare('PRAGMA table_info(group_status_account_schedule)').all().map(c=>c.name));
  if(!cols.has('fault_streak'))db.exec('ALTER TABLE group_status_account_schedule ADD COLUMN fault_streak INTEGER NOT NULL DEFAULT 0');
  if(!cols.has('last_fault'))db.exec('ALTER TABLE group_status_account_schedule ADD COLUMN last_fault TEXT');
  if(!cols.has('blocked_at'))db.exec('ALTER TABLE group_status_account_schedule ADD COLUMN blocked_at TEXT');
}
function seedAccountSchedule(db,job) {
  ensureAccountSchedule(db);
  const accounts=db.prepare('SELECT DISTINCT account_id FROM group_status_targets WHERE job_id=? ORDER BY account_id').all(job.id);
  const seed=db.prepare('INSERT OR IGNORE INTO group_status_account_schedule(job_id,account_id,next_run_at,rest_until,processed_since_rest) VALUES (?,?,?,?,?)');
  for(const a of accounts)seed.run(job.id,a.account_id,job.next_run_at||null,job.rest_until||null,accounts.length===1?job.processed_since_rest:0);
}
function updateGlobalGsWait(db,jobId) {
  const pending=db.prepare(`SELECT MIN(COALESCE(s.next_run_at, '1970-01-01T00:00:00.000Z')) AS due
    FROM group_status_account_schedule s WHERE s.job_id=? AND s.blocked_at IS NULL AND EXISTS
    (SELECT 1 FROM group_status_targets t WHERE t.job_id=s.job_id AND t.account_id=s.account_id AND t.status='PENDING')`).get(jobId);
  db.prepare('UPDATE group_status_jobs SET next_run_at=? WHERE id=?').run(pending?.due||null,jobId);
}
const stamp = () => new Date().toISOString();
const isoAfter = seconds => new Date(Date.now()+Math.round(seconds*1000)).toISOString();
export const GS_DEFAULT_PACE = Object.freeze({delayMinSec:60,delayMaxSec:120,batchSize:25,restMinSec:300,restMaxSec:600});
export function validateGsPace({delayMinSec,delayMaxSec,batchSize,restMinSec,restMaxSec}) {
 const a=[delayMinSec,delayMaxSec,batchSize,restMinSec,restMaxSec].map(Number);
 if(a.some(x=>!Number.isSafeInteger(x)))throw new Error('Tetapan mestilah nombor bulat.');
 const [dMin,dMax,b,rMin,rMax]=a;
 if(dMin<5||dMax>600||dMin>dMax||b<1||b>500||rMin<0||rMax>3600||rMin>rMax)throw new Error('Delay 5–600s, batch 1–500 dan rehat 0–3600s; min tidak boleh melebihi max.');
 return {delayMinSec:dMin,delayMaxSec:dMax,batchSize:b,restMinSec:rMin,restMaxSec:rMax};
}
export function setGsPace(path,id,values) {
 const v=validateGsPace(values);
 return withDb(path,db=>{
   const job=getGsRow(db,id);
   if(!job||!['DRAFT','READY','PAUSED'].includes(job.status))throw new Error('Tetapan hanya boleh diubah sebelum RUN atau ketika PAUSED.');
   db.prepare('UPDATE group_status_jobs SET delay_min_sec=?,delay_max_sec=?,batch_size=?,rest_min_sec=?,rest_max_sec=?,updated_at=? WHERE id=?')
    .run(v.delayMinSec,v.delayMaxSec,v.batchSize,v.restMinSec,v.restMaxSec,stamp(),job.id);
   return getGsRow(db,id);
 });
}
export function gsNextWaitMs(path,id,now=Date.now()) {
 return withDb(path,db=>{
   const job=getGsRow(db,id);if(!job||job.status!=='RUNNING')return null;
   seedAccountSchedule(db,job);
   const item=db.prepare(`SELECT MIN(COALESCE(s.next_run_at, '1970-01-01T00:00:00.000Z')) AS due
     FROM group_status_account_schedule s WHERE s.job_id=? AND s.blocked_at IS NULL AND EXISTS
     (SELECT 1 FROM group_status_targets t WHERE t.job_id=s.job_id AND t.account_id=s.account_id AND t.status='PENDING')`).get(job.id);
   return item?.due?Math.max(0,new Date(item.due).getTime()-now||0):0; // all blocked: runner will pause after inspecting account states
 });
}
export function gsAccountProgress(path,id){
 return withDb(path,db=>{
   const job=getGsRow(db,id);if(!job)return [];
   const archive=archivedFromDb(db,'gs',id);if(archive&&!db.prepare('SELECT 1 FROM group_status_targets WHERE job_id=? LIMIT 1').get(id))return archive.summary.accounts||[];
   seedAccountSchedule(db,job);
   return db.prepare(`SELECT s.account_id AS accountId,s.next_run_at AS nextAt,s.rest_until AS restUntil,
      s.processed_since_rest AS batchProgress,s.fault_streak AS faultStreak,s.last_fault AS lastFault,s.blocked_at AS blockedAt,
      sum(CASE WHEN t.status='ACCEPTED' THEN 1 ELSE 0 END) AS accepted,
      sum(CASE WHEN t.status='SKIPPED' THEN 1 ELSE 0 END) AS skipped,
      sum(CASE WHEN t.status='FAILED' THEN 1 ELSE 0 END) AS failed,
      sum(CASE WHEN t.status='UNKNOWN' THEN 1 ELSE 0 END) AS unknown,
      sum(CASE WHEN t.status='PENDING' THEN 1 ELSE 0 END) AS pending,
      count(t.id) AS total
      FROM group_status_account_schedule s JOIN group_status_targets t
      ON t.job_id=s.job_id AND t.account_id=s.account_id
      WHERE s.job_id=? GROUP BY s.account_id ORDER BY s.account_id`).all(job.id);
 });
}
// Historical per-group posting records, without any view tracking.
export function gsListPosts(path,jobId,page=1,pageSize=10){
 const safePage=Math.max(1,Number(page)||1),size=Math.min(20,Math.max(1,Number(pageSize)||10));
 return withDb(path,db=>{
   const id=idOf(jobId);
   const total=db.prepare('SELECT COUNT(*) AS n FROM group_status_targets WHERE job_id=?').get(id).n;
   const items=db.prepare(`SELECT id,account_id AS accountId,group_name AS groupName,status,
      message_id AS messageId,attempted_at AS attemptedAt,last_error AS error
      FROM group_status_targets WHERE job_id=? ORDER BY id ASC LIMIT ? OFFSET ?`).all(id,size,(safePage-1)*size);
   return {items,total,page:safePage,pages:Math.max(1,Math.ceil(total/size)),expired:!total&&Boolean(archivedFromDb(db,'gs',id))};
 });
}

// Group rejection/missing ACK is not evidence of an unhealthy account.
// Preserve observations and pacing; only explicit unsupported protocol blocks here.
export function gsRecordAccountHealth(path,jobId,accountId,fault='',threshold=3){
 const failure=String(fault||'').slice(0,64);
 return withDb(path,db=>{
  const job=getGsRow(db,jobId);if(!job)return null;
  seedAccountSchedule(db,job);
  db.exec('BEGIN IMMEDIATE;');
  try{
   const row=db.prepare('SELECT fault_streak AS streak,last_fault AS lastFault,blocked_at AS blockedAt FROM group_status_account_schedule WHERE job_id=? AND account_id=?').get(job.id,Number(accountId));
   if(!row){db.exec('COMMIT;');return null;}
   if(row.blockedAt){db.exec('COMMIT;');return {blocked:true,streak:row.streak,fault:row.lastFault};}
   const streak=failure?(row.lastFault===failure?row.streak+1:1):0;
   const blocked=failure==='UNSUPPORTED';
   const blockedAt=blocked?stamp():null;
   db.prepare('UPDATE group_status_account_schedule SET fault_streak=?,last_fault=?,blocked_at=? WHERE job_id=? AND account_id=?')
     .run(streak,failure||null,blockedAt,job.id,Number(accountId));
   if(blocked)updateGlobalGsWait(db,job.id);
   db.exec('COMMIT;');return {blocked,streak,fault:failure};
  }catch(error){db.exec('ROLLBACK;');throw error;}
 });
}
export function gsRetryBlockedAccount(path,jobId,accountId){
 return withDb(path,db=>{
  const job=getGsRow(db,jobId);
  if(!job||job.status!=='PAUSED')throw new Error('Hanya boleh cuba semula akaun ketika kempen PAUSED.');
  seedAccountSchedule(db,job);
  const row=db.prepare('SELECT blocked_at FROM group_status_account_schedule WHERE job_id=? AND account_id=?').get(job.id,Number(accountId));
  if(!row?.blocked_at)throw new Error('Akaun ini tidak disekat.');
  db.prepare('UPDATE group_status_account_schedule SET fault_streak=0,last_fault=NULL,blocked_at=NULL,next_run_at=? WHERE job_id=? AND account_id=?')
    .run(stamp(),job.id,Number(accountId));
  updateGlobalGsWait(db,job.id);
  return {jobId:job.id,accountId:Number(accountId)};
 });
}

function randomSeconds(min,max,random=Math.random) {
 const n=Math.max(0,Math.min(0.999999999,Number(random())||0));
 return Number(min)+Math.floor(n*(Number(max)-Number(min)+1));
}
const idOf = x => { const n = Number(x); if (!Number.isSafeInteger(n) || n <= 0) throw new Error('ID job tidak sah.'); return n; };
export function createGsJob(path) {
  return withDb(path, db => {
    const current = db.prepare("SELECT id FROM group_status_jobs WHERE status IN ('DRAFT','READY') ORDER BY id DESC LIMIT 1").get();
    if (current) return getGsRow(db,current.id);
    const at = stamp();
    const id = db.prepare('INSERT INTO group_status_jobs (created_at,updated_at) VALUES (?,?)').run(at,at).lastInsertRowid;
    capturePolicy(db,'gs',id);
    const saved=db.prepare("SELECT value FROM system_meta WHERE key='gs_defaults'").get();if(saved){const p=validateGsPace(JSON.parse(saved.value));db.prepare('UPDATE group_status_jobs SET delay_min_sec=?,delay_max_sec=?,batch_size=?,rest_min_sec=?,rest_max_sec=? WHERE id=?').run(p.delayMinSec,p.delayMaxSec,p.batchSize,p.restMinSec,p.restMaxSec,id);}
    return getGsRow(db,id);
  });
}
function getGsRow(db,id) { return db.prepare('SELECT * FROM group_status_jobs WHERE id=?').get(idOf(id)) || null; }
export const getGsJob = (path,id) => withDb(path,db=>getGsRow(db,id));
export const latestGsJob = path => withDb(path,db=>db.prepare('SELECT * FROM group_status_jobs ORDER BY id DESC LIMIT 1').get()||null);
export const listGsJobs = (path,limit=10) => withDb(path,db=>db.prepare('SELECT * FROM group_status_jobs ORDER BY id DESC LIMIT ?').all(Math.min(30,Math.max(1,Number(limit)||10))));
export function setGsContent(path,id,{kind,body='',mediaPath=null,mediaMime=null}) {
  const valid = ['TEXT','PHOTO','VIDEO'];
  if (!valid.includes(kind)) throw new Error('Hanya TEXT, PHOTO atau VIDEO dibenarkan.');
  const max=kind==='TEXT'?600:500;
  if (Array.from(String(body)).length>max) throw new Error(`Had ${max} aksara dilepasi.`);
  if ((kind==='PHOTO'||kind==='VIDEO')&&!mediaPath) throw new Error('Media tidak ditemui.');
  if (mediaPath && (!/^media\/group-status\/gs-\d+\/[a-zA-Z0-9._-]+$/.test(mediaPath))) throw new Error('Laluan media tidak sah.');
  return withDb(path, db => {
    const job=getGsRow(db,id); if (!job||!['DRAFT','READY'].includes(job.status)) throw new Error('Job tidak boleh diubah.');
    db.prepare("UPDATE group_status_jobs SET kind=?,body=?,media_path=?,media_mime=?,status='DRAFT',updated_at=? WHERE id=?")
      .run(kind,String(body),mediaPath,mediaMime,stamp(),job.id);
    return getGsRow(db,id);
  });
}
export function setGsAccounts(path,id,accountIds) {
  const ids=[...new Set(accountIds.map(Number))].filter(x=>Number.isSafeInteger(x)&&x>0).sort((a,b)=>a-b);
  if (!ids.length) throw new Error('Pilih sekurang-kurangnya satu akaun.');
  return withDb(path,db=>{
    const job=getGsRow(db,id); if (!job||!['DRAFT','READY'].includes(job.status)) throw new Error('Job tidak boleh diubah.');
    const select=db.prepare('SELECT id, status FROM whatsapp_accounts WHERE id=? AND last_connected_at IS NOT NULL');
    for(const account of ids){ const a=select.get(account); if(!a||a.status!=='ONLINE') throw new Error(`Akaun ${account} belum ONLINE.`); }
    db.prepare("UPDATE group_status_jobs SET selected_accounts=?,status='DRAFT',updated_at=? WHERE id=?").run(JSON.stringify(ids),stamp(),job.id);
    db.prepare('DELETE FROM group_status_targets WHERE job_id=?').run(job.id);
    return getGsRow(db,id);
  });
}
export function prepareGsTargets(path,id,{mode='ALL',selections=[]}={}) {
  return withDb(path,db=>{
    const job=getGsRow(db,id); if(!job||!['DRAFT','READY'].includes(job.status)) throw new Error('Job tidak boleh diubah.');
    if(!job.kind) throw new Error('Sediakan kandungan dahulu.');
    const ids=JSON.parse(job.selected_accounts||'[]');
    if(!ids.length) throw new Error('Pilih akaun dahulu.');
    const targets=[];
    if(mode==='ALL') {
      const statement=db.prepare('SELECT account_id, jid, subject FROM whatsapp_groups WHERE account_id=? AND is_available=1 ORDER BY subject COLLATE NOCASE, jid');
      for(const accountId of ids) targets.push(...statement.all(accountId));
    } else if (mode==='SELECTED') {
      if(!Array.isArray(selections)||selections.length===0) throw new Error('Tiada group dipilih.');
      const select=db.prepare('SELECT account_id,jid,subject FROM whatsapp_groups WHERE account_id=? AND is_available=1 ORDER BY subject COLLATE NOCASE, jid LIMIT 1 OFFSET ?');
      for(const item of selections){
        const accountId=Number(item.accountId), position=Number(item.position);
        if(!ids.includes(accountId)||!Number.isSafeInteger(position)||position<1) throw new Error('Pilihan group tidak sah.');
        const found=select.get(accountId,position-1);
        if(!found) throw new Error(`Group ${accountId}:${position} tidak ditemui.`);
        targets.push(found);
      }
    } else throw new Error('Mod group tidak sah.');
    if(!targets.length) throw new Error('Tiada group tersedia. Jalankan .group-sync dahulu.');
    if(targets.length>10000) throw new Error('Had keselamatan 10,000 sasaran satu job.');
    const at=stamp(); db.exec('BEGIN IMMEDIATE;');
    try{
      db.prepare('DELETE FROM group_status_targets WHERE job_id=?').run(job.id);
      const insert=db.prepare('INSERT OR IGNORE INTO group_status_targets(job_id,account_id,group_jid,group_name,updated_at) VALUES (?,?,?,?,?)');
      for(const item of targets) insert.run(job.id,item.account_id,item.jid,item.subject,at);
      db.prepare("UPDATE group_status_jobs SET target_mode=?,status='READY',processed_since_rest=0,next_run_at=NULL,rest_until=NULL,updated_at=? WHERE id=?").run(mode,at,job.id);
      ensureAccountSchedule(db);
      db.prepare('DELETE FROM group_status_account_schedule WHERE job_id=?').run(job.id);
      const add=db.prepare('INSERT INTO group_status_account_schedule(job_id,account_id) VALUES (?,?)');
      for(const a of [...new Set(targets.map(item=>item.account_id))])add.run(job.id,a);
      db.exec('COMMIT;');
    }catch(err){db.exec('ROLLBACK;');throw err;}
    return gsSnapshotDb(db,job.id);
  });
}
function gsSnapshotDb(db,id){
 const job=getGsRow(db,id); if(!job)return null;
 const archive=archivedFromDb(db,'gs',id);if(archive&&!db.prepare('SELECT 1 FROM group_status_targets WHERE job_id=? LIMIT 1').get(id))return {...archive.summary.job,...job};
 const counts=db.prepare('SELECT status,count(*) n FROM group_status_targets WHERE job_id=? GROUP BY status').all(job.id);
 const uniqueGroups=db.prepare('SELECT COUNT(DISTINCT group_jid) n FROM group_status_targets WHERE job_id=?').get(job.id).n;
 const result={...job,uniqueGroups,total:0,pending:0,inFlight:0,accepted:0,skipped:0,failed:0,unknown:0};
 const names={PENDING:'pending',IN_FLIGHT:'inFlight',ACCEPTED:'accepted',SKIPPED:'skipped',FAILED:'failed',UNKNOWN:'unknown'};
 for(const c of counts){result.total+=Number(c.n);result[names[c.status]]=Number(c.n);}
 return result;
}
export const gsSnapshot = (path,id) => withDb(path,db=>gsSnapshotDb(db,id));
export const listGsRecent = (path,id,limit=8) => withDb(path,db=>db.prepare('SELECT account_id AS accountId,group_name AS groupName,status,last_error AS error FROM group_status_targets WHERE job_id=? AND status<>\'PENDING\' ORDER BY updated_at DESC,id DESC LIMIT ?').all(idOf(id),Math.min(20,Math.max(1,Number(limit)||8))));
export function setGsStatus(path,id,status){
 const transitions={READY:['RUNNING','STOPPED'],RUNNING:['PAUSED','STOPPED','COMPLETED'],PAUSED:['RUNNING','STOPPED'],STOPPED:['RUNNING'],DRAFT:['STOPPED']};
 return withDb(path,db=>{
  const job=getGsRow(db,id); if(!job||!transitions[job.status]?.includes(status)) throw new Error(`Status ${job?.status||'-'} tidak boleh ditukar kepada ${status}.`);
  if(status==='RUNNING'){
   if(!db.prepare("SELECT id FROM group_status_targets WHERE job_id=? AND status='PENDING' LIMIT 1").get(job.id))throw new Error('Tiada baki untuk disambung.');
   const other=db.prepare("SELECT id FROM group_status_jobs WHERE id<>? AND status='RUNNING' LIMIT 1").get(job.id);
   if(other)throw new Error(`Job GS-${other.id} masih berjalan.`);
   // Upgrade recovery: release old group-level breakers without resetting targets or rest deadlines.
   db.prepare("UPDATE group_status_account_schedule SET blocked_at=NULL,fault_streak=0,last_fault=NULL WHERE job_id=? AND blocked_at IS NOT NULL AND (last_fault='UNKNOWN' OR last_fault LIKE 'REJECTED:%')").run(job.id);
   updateGlobalGsWait(db,job.id);
  }
  const now=stamp();
  db.prepare('UPDATE group_status_jobs SET status=?,started_at=COALESCE(started_at,?),completed_at=CASE WHEN ? IN (\'STOPPED\',\'COMPLETED\') THEN ? WHEN ?=\'RUNNING\' THEN NULL ELSE completed_at END,updated_at=? WHERE id=?')
    .run(status,now,status,now,status,now,job.id);
  return gsSnapshotDb(db,job.id);
 });
}
export function claimGsNext(path,id,now=Date.now()){
 if(!diskReady(path))return null;
 return withDb(path,db=>{
  db.exec('BEGIN IMMEDIATE;');
  try{
   const job=getGsRow(db,id);if(!job||job.status!=='RUNNING'){db.exec('COMMIT;');return null;}
   seedAccountSchedule(db,job);
   // Earliest available account first. Tie-break by last served account for fairness.
   const due=new Date(now).toISOString();
   const row=db.prepare(`SELECT t.* FROM group_status_targets t
      JOIN group_status_account_schedule s ON s.job_id=t.job_id AND s.account_id=t.account_id
      WHERE t.job_id=? AND t.status='PENDING' AND s.blocked_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM group_status_targets other WHERE other.account_id=t.account_id AND other.status='IN_FLIGHT')
      AND NOT EXISTS (SELECT 1 FROM group_status_account_schedule clock WHERE clock.account_id=t.account_id AND clock.job_id<>t.job_id AND COALESCE(clock.next_run_at,'')>?)
      ${db.prepare("SELECT 1 FROM sqlite_master WHERE name='posting_workers'").get()?"AND NOT EXISTS (SELECT 1 FROM posting_workers w WHERE w.account_id=t.account_id AND COALESCE(w.available_at,'')>?) AND NOT EXISTS (SELECT 1 FROM posting_job_targets p WHERE p.account_id=t.account_id AND p.status='PROCESSING')":''} AND COALESCE(s.next_run_at,'1970-01-01T00:00:00.000Z')<=?
      AND t.id=(SELECT MIN(t2.id) FROM group_status_targets t2
          WHERE t2.job_id=t.job_id AND t2.account_id=t.account_id AND t2.status='PENDING')
      ORDER BY COALESCE(s.last_served_at,'1970-01-01T00:00:00.000Z'),t.account_id LIMIT 1`).get(...(db.prepare("SELECT 1 FROM sqlite_master WHERE name='posting_workers'").get()?[job.id,due,due,due]:[job.id,due,due]));
   if(row){
     db.prepare("UPDATE group_status_targets SET status='IN_FLIGHT', attempts=attempts+1,attempted_at=?,updated_at=? WHERE id=?").run(stamp(),stamp(),row.id);
     db.prepare('UPDATE group_status_account_schedule SET last_served_at=? WHERE job_id=? AND account_id=?').run(stamp(),job.id,row.account_id);
   }
   db.exec('COMMIT;');return row?{...row,attempts:row.attempts+1}:null;
  }catch(err){db.exec('ROLLBACK;');throw err;}
 });
}
export function requeueGsUnsent(path,targetId,waitSeconds=60){
 return withDb(path,db=>{
  db.exec('BEGIN IMMEDIATE;');
  try{
   const row=db.prepare('SELECT * FROM group_status_targets WHERE id=?').get(idOf(targetId));
   if(!row||row.status!=='IN_FLIGHT'){db.exec('COMMIT;');return false;}
   const job=getGsRow(db,row.job_id);seedAccountSchedule(db,job);
   const at=stamp();
   db.prepare("UPDATE group_status_targets SET status='PENDING',attempts=MAX(0,attempts-1),attempted_at=NULL,updated_at=? WHERE id=?").run(at,row.id);
   db.prepare('UPDATE group_status_account_schedule SET next_run_at=?,rest_until=NULL WHERE job_id=? AND account_id=?')
    .run(isoAfter(Math.max(10,waitSeconds)),job.id,row.account_id);
   updateGlobalGsWait(db,job.id);
   db.exec('COMMIT;');return true;
  }catch(err){db.exec('ROLLBACK;');throw err;}
 });
}
export function finishGsTarget(path,id,result,messageId='',error='',random=Math.random){
 if(!['ACCEPTED','SKIPPED','FAILED','UNKNOWN'].includes(result)) throw new Error('Keputusan tidak sah.');
 return withDb(path,db=>{
  db.exec('BEGIN IMMEDIATE;');
  try{
   const row=db.prepare('SELECT id,status,job_id,account_id FROM group_status_targets WHERE id=?').get(idOf(id));
   if(!row||row.status!=='IN_FLIGHT'){db.exec('COMMIT;');return false;}
   const now=stamp();
   db.prepare('UPDATE group_status_targets SET status=?,message_id=?,last_error=?,updated_at=? WHERE id=?')
    .run(result,String(messageId),String(error).slice(0,280),now,row.id);
   const job=getGsRow(db,row.job_id);seedAccountSchedule(db,job);
   const account=db.prepare('SELECT processed_since_rest AS n FROM group_status_account_schedule WHERE job_id=? AND account_id=?').get(job.id,row.account_id);
   const count=Number(account?.n||0)+1;
   const pendingForAccount=db.prepare("SELECT COUNT(*) n FROM group_status_targets WHERE job_id=? AND account_id=? AND status='PENDING'").get(job.id,row.account_id).n;
   let restUntil=null,nextAt=null,nextCount=count;
   if(pendingForAccount>0){
    if(count>=job.batch_size){
     const rest=randomSeconds(job.rest_min_sec,job.rest_max_sec,random);
     restUntil=rest?isoAfter(rest):null;
     nextAt=restUntil||isoAfter(randomSeconds(job.delay_min_sec,job.delay_max_sec,random));
     nextCount=0;
    }else nextAt=isoAfter(randomSeconds(job.delay_min_sec,job.delay_max_sec,random));
   }
   db.prepare('UPDATE group_status_account_schedule SET processed_since_rest=?,next_run_at=?,rest_until=? WHERE job_id=? AND account_id=?')
     .run(nextCount,nextAt,restUntil,job.id,row.account_id);
   // Preserve old summary fields for one-account dashboards/tests.
   const naccounts=db.prepare('SELECT COUNT(*) n FROM group_status_account_schedule WHERE job_id=?').get(job.id).n;
   if(naccounts===1)db.prepare('UPDATE group_status_jobs SET processed_since_rest=?,rest_until=?,updated_at=? WHERE id=?').run(nextCount,restUntil,now,job.id);
   else db.prepare('UPDATE group_status_jobs SET rest_until=NULL,updated_at=? WHERE id=?').run(now,job.id);
   updateGlobalGsWait(db,job.id);
   db.exec('COMMIT;');return true;
  }catch(e){db.exec('ROLLBACK;');throw e;}
 });
}
// Unknown responses must NOT be retried automatically: could already be visible in WhatsApp.
export function recoverGsJobs(path){
 return withDb(path,db=>{
  const now=stamp();
  db.exec('BEGIN IMMEDIATE;');
  try{
   const uncertain=db.prepare("UPDATE group_status_targets SET status='UNKNOWN',last_error='Controller stopped during in-flight send',updated_at=? WHERE status='IN_FLIGHT'").run(now).changes;
   const paused=db.prepare("UPDATE group_status_jobs SET status='PAUSED',updated_at=? WHERE status='RUNNING'").run(now).changes;
   db.exec('COMMIT;');return {uncertain,paused};
  }catch(error){db.exec('ROLLBACK;');throw error;}
 });
}
export function deleteGsJob(path,id){
 return withDb(path,db=>{
  const job=getGsRow(db,id);if(!job)throw new Error('Job tidak ditemui.');
  if(job.status==='RUNNING')throw new Error('STOP job dahulu sebelum DELETE.');
  db.prepare('DELETE FROM group_status_jobs WHERE id=?').run(job.id);
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='system_job_archive'").get()){db.prepare("DELETE FROM system_job_archive WHERE kind='gs' AND id=?").run(job.id);db.prepare("DELETE FROM system_job_policy WHERE kind='gs' AND id=?").run(job.id);}
  return job;
 });
}
export function cloneGsJob(path,id){
 return withDb(path,db=>{
   const job=getGsRow(db,id);if(!job||!['STOPPED','COMPLETED'].includes(job.status))throw new Error('RUN AGAIN hanya untuk job selesai/stop.');
   const active=db.prepare("SELECT id FROM group_status_jobs WHERE status IN ('DRAFT','READY','RUNNING','PAUSED') LIMIT 1").get();
   if(active)throw new Error(`Job GS-${active.id} masih aktif.`);
   const at=stamp(); const next=db.prepare('INSERT INTO group_status_jobs(status,kind,body,media_path,media_mime,selected_accounts,target_mode,delay_min_sec,delay_max_sec,batch_size,rest_min_sec,rest_max_sec,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('DRAFT',job.kind,job.body,job.media_path,job.media_mime,job.selected_accounts,job.target_mode,job.delay_min_sec,job.delay_max_sec,job.batch_size,job.rest_min_sec,job.rest_max_sec,at,at).lastInsertRowid;
   capturePolicy(db,'gs',Number(next));
   // Clone only target selection, never old progress. Check account/group availability at RUN stage.
   db.prepare("INSERT INTO group_status_targets(job_id,account_id,group_jid,group_name,updated_at) SELECT ?,account_id,group_jid,group_name,? FROM group_status_targets WHERE job_id=?").run(next,at,job.id);
   const total=db.prepare('SELECT count(*) n FROM group_status_targets WHERE job_id=?').get(next).n;
   if(total)db.prepare("UPDATE group_status_jobs SET status='READY' WHERE id=?").run(next);
   if(total){ensureAccountSchedule(db);seedAccountSchedule(db,{id:next,next_run_at:null,rest_until:null,processed_since_rest:0});}
   return gsSnapshotDb(db,next);
 });
}

export function gsAccountStats(path,id){
 return withDb(path,db=>{const rows=db.prepare('SELECT account_id AS accountId, status, count(*) AS n FROM group_status_targets WHERE job_id=? GROUP BY account_id,status ORDER BY account_id,status').all(idOf(id));return rows.length?rows:archivedFromDb(db,'gs',id)?.summary?.stats||[];});
}
export function gsTargetsChanged(path,id){return withDb(path,db=>{const job=getGsRow(db,id);if(!job||job.target_mode!=='ALL')return false;const selected=JSON.parse(job.selected_accounts||'[]');const current=[];for(const a of selected)current.push(...db.prepare('SELECT account_id, jid AS group_jid FROM whatsapp_groups WHERE account_id=? AND is_available=1').all(a));const old=db.prepare('SELECT account_id,group_jid FROM group_status_targets WHERE job_id=?').all(id);const keys=rows=>rows.map(x=>x.account_id+':'+x.group_jid).sort().join('\n');return keys(current)!==keys(old);});}

export const listAllGsJobs = path => withDb(path,db=>db.prepare('SELECT * FROM group_status_jobs ORDER BY id').all());
