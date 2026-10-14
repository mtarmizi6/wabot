import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {initializeDatabase} from '../src/database/connection.js';
import * as s from '../src/posting/store.js';
import * as wa from '../src/whatsapp/store.js';
import {WhatsAppManager} from '../src/whatsapp/manager.js';
function fixture(t,groups=[['same','a','b'],['same']]){
 const dir=mkdtempSync(join(tmpdir(),'wa-post183-')),db=join(dir,'db.sqlite');initializeDatabase(db);t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const accounts=groups.map((list,i)=>{const a=wa.createWhatsAppAccount(db,{phone:'6011234567'+i});wa.updateWhatsAppAccount(db,a.id,{status:'ONLINE',lastConnectedAt:new Date().toISOString()});wa.syncWhatsAppGroups(db,a.id,list.map(j=>({jid:j+'@g.us',subject:j})));return wa.getWhatsAppAccount(db,a.id);});
 const sql=(q,...args)=>{const c=new DatabaseSync(db);try{return c.prepare(q).all(...args);}finally{c.close();}};
 const make=(mode='CONTINUOUS',target=100,reuse='REPEAT')=>{
  const p=s.createPosting(db,{ownerType:'SENDIRI',displayName:'Kempen '+Math.random()});
  for(let i=1;i<=3;i++){s.createPostingAd(db,p.id,{kind:'TEXT',body:'Iklan '+i});s.addPostingButton(db,p.id,i,{label:'CTA '+i,url:'https://example.com/'+i});}
  s.markPostingReady(db,p.id);s.savePostingPlanAccounts(db,p.id,accounts);
  if(mode==='SUCCESS')s.setPostingSuccessTarget(db,p.id,target,reuse);else if(mode==='DAYS')s.setPostingDaysTarget(db,p.id,3);else s.setPostingContinuous(db,p.id);
  const j=s.createPostingJob(db,p.id);return s.setPostingJobStatus(db,j.id,'RUNNING');
 };
 const ids=accounts.map(a=>a.id),claim=(id)=>s.claimNextCampaignWork(db,id,ids,Date.now()+1000000),done=(w)=>s.completeCampaignWork(db,w,{success:true,messageId:'msg-'+w.attemptToken});
 return {db,dir,accounts,ids,make,sql,claim,done};
}
test('each account retains its own group round and ad cursor in every repeat mode',t=>{
 for(const mode of ['SUCCESS','DAYS','CONTINUOUS']){
  const f=fixture(t),j=f.make(mode);assert.equal(j.totalTargets,4);
  const a=f.claim(f.ids[0]),b=f.claim(f.ids[1]);assert.equal(a.adNo,1);assert.equal(b.adNo,1);assert.equal(s.claimNextCampaignWork(f.db,f.ids[0],f.ids,Date.now()+1000000),null);
  f.done(a);f.done(b);s.setPostingJobStatus(f.db,j.id,'PAUSED');s.setPostingJobStatus(f.db,j.id,'RUNNING');
  const next=f.claim(f.ids[1]);assert.equal(next.roundNo,2);assert.equal(next.adNo,2);assert.equal(s.getPostingJobAd(f.db,j.id,next.adNo).buttons[0].url,'https://example.com/2');
  assert.equal(s.getPostingJob(f.db,j.id).accounts[0].currentRound,1);
 }
});
test('unsent retry keeps the original ad and does not advance the cursor',t=>{
 const f=fixture(t),j=f.make(),a=f.claim(f.ids[0]);assert.equal(s.requeueCampaignWork(f.db,a.id,'offline before send'),true);
 const b=f.claim(f.ids[0]);assert.equal(b.adNo,a.adNo);assert.notEqual(b.attemptToken,a.attemptToken);f.done(b);
 assert.equal(f.claim(f.ids[0]).adNo,2);assert.equal(s.getPostingJob(f.db,j.id).processedCount,1);
});
test('global target reserves uncertain slots, accepts late success once and rejects stale attempt callbacks',t=>{
 const f=fixture(t),j=f.make('SUCCESS',2);const a=f.claim(f.ids[0]),b=f.claim(f.ids[1]);s.markCampaignSendStarted(f.db,a);
 s.completeCampaignWork(f.db,a,{unknown:true,error:'timeout'});assert.equal(s.requeueCampaignWork(f.db,a.id),false);f.done(b);
 assert.equal(f.claim(f.ids[0]),null);assert.equal(s.getPostingJob(f.db,j.id).unknownCount,1);assert.equal(s.getPostingJob(f.db,j.id).status,'PAUSED');
 f.done(a);f.done(a);const after=s.getPostingJob(f.db,j.id);assert.equal(after.successCount,2);assert.equal(after.unknownCount,0);assert.equal(after.processedCount,2);assert.equal(after.status,'COMPLETED');
 assert.equal(s.postingReportSnapshot(f.db,j.id).attempts.length,2);
});
test('a late outcome from a previous group round cannot complete a different attempt',t=>{
 const f=fixture(t,[['one']]),j=f.make(),first=f.claim(f.ids[0]);f.done(first);const second=f.claim(f.ids[0]);assert.equal(second.roundNo,2);
 f.done(first);assert.equal(s.getPostingJob(f.db,j.id).processingCount,1);assert.equal(s.getPostingJob(f.db,j.id).successCount,1);f.done(second);assert.equal(s.getPostingJob(f.db,j.id).successCount,2);
});
test('restart pauses active jobs, requeues unsent work and preserves uncertain work and account waits',t=>{
 const f=fixture(t),j=f.make(),before=f.claim(f.ids[0]),after=f.claim(f.ids[1]);s.markCampaignSendStarted(f.db,after);
 s.setPostingWorkerWait(f.db,f.ids[0],600,{kind:'REST'});const wait=s.getPostingWorker(f.db,f.ids[0]).availableAt;
 const result=s.recoverPostingJobs(f.db);assert.equal(result.resumedJobs,0);const job=s.getPostingJob(f.db,j.id);assert.equal(job.status,'PAUSED');assert.equal(job.failedCount,0);assert.equal(job.unknownCount,1);assert.equal(job.pendingCount,3);assert.equal(s.getPostingWorker(f.db,f.ids[0]).availableAt,wait);
 assert.equal(f.sql('SELECT status FROM posting_job_targets WHERE id=?',before.id)[0].status,'PENDING');assert.equal(f.sql('SELECT status FROM posting_job_targets WHERE id=?',after.id)[0].status,'UNKNOWN');
 s.recoverPostingJobs(f.db);assert.equal(s.getPostingJob(f.db,j.id).unknownCount,1);assert.equal(f.claim(f.ids[0]),null);
});
test('day mode uses Malaysia calendar end and paused expired jobs cannot resume sends',t=>{
 assert.equal(s.malaysiaCampaignEnd('2026-09-29T01:00:00Z',3),'2026-10-01T15:59:59.000Z');
 assert.equal(s.malaysiaCampaignEnd('2026-09-29T15:59:00Z',1),'2026-09-29T15:59:59.000Z');
 const f=fixture(t),j=f.make('DAYS');s.setPostingJobStatus(f.db,j.id,'PAUSED');f.sql('UPDATE posting_jobs SET ends_at=? WHERE id=?','2020-01-01T15:59:59Z',j.id);
 assert.equal(s.setPostingJobStatus(f.db,j.id,'RUNNING').status,'COMPLETED');assert.equal(f.claim(f.ids[0]),null);
});
test('UNIQUE exhaustion records insufficient target instead of waiting forever or claiming success',t=>{
 const f=fixture(t,[['one']]),j=f.make('SUCCESS',5,'UNIQUE'),w=f.claim(f.ids[0]);s.completeCampaignWork(f.db,w,{success:false,error:'rejected'});
 const result=s.getPostingJob(f.db,j.id);assert.equal(result.status,'COMPLETED');assert.match(result.finishReason,/SASARAN HABIS/);assert.equal(result.successCount,0);assert.equal(result.failedCount,1);assert.equal(f.claim(f.ids[0]),null);
});
test('completion persists global account pacing atomically and pause or campaign switching cannot shorten it',t=>{
 const f=fixture(t),j=f.make(),other=f.make(),w=f.claim(f.ids[0]);f.done(w);const worker=s.getPostingWorker(f.db,f.ids[0]);assert.ok(Date.parse(worker.availableAt)>Date.now());
 assert.equal(s.claimNextCampaignWork(f.db,f.ids[0],f.ids),null);s.setPostingJobStatus(f.db,j.id,'PAUSED');s.setPostingJobStatus(f.db,j.id,'RUNNING');s.setPostingWorkerWait(f.db,f.ids[0],0);assert.equal(s.getPostingWorker(f.db,f.ids[0]).availableAt,worker.availableAt);
 assert.ok(f.claim(f.ids[0]));assert.equal(s.randomWorkerWait({delayMinSec:120,delayMaxSec:120,batchSize:1,restMinSec:30,restMaxSec:30},{batchProcessed:1}).seconds,120);
});
test('system defaults snapshot into new drafts and explicit changes do not alter existing jobs',t=>{
 const f=fixture(t),j=f.make();s.setPostingDefaults(f.db,{delayMinSec:30,delayMaxSec:45,batchSize:2,restMinSec:60,restMaxSec:120});const next=f.make();assert.equal(next.delayMinSec,30);assert.equal(s.getPostingJob(f.db,j.id).delayMinSec,60);
 assert.throws(()=>s.setPostingDefaults(f.db,{delayMinSec:120,delayMaxSec:30}));
});
test('report delivery gates cleanup and durable summary retains unknown counts and recent results',t=>{
 const f=fixture(t),j=f.make(),w=f.claim(f.ids[0]);s.markCampaignSendStarted(f.db,w);s.completeCampaignWork(f.db,w,{unknown:true,error:'uncertain'});s.setPostingJobStatus(f.db,j.id,'STOPPED');
 assert.throws(()=>s.cleanupPostingJobData(f.db,j.id));s.markPostingReportFailed(f.db,j.id,'Telegram timeout');assert.equal(s.postingReportSnapshot(f.db,j.id).attempts.length,1);
 s.markPostingReportSent(f.db,j.id,'saved.txt');s.cleanupPostingJobData(f.db,j.id);const snap=s.postingReportSnapshot(f.db,j.id);assert.equal(snap.job.unknownCount,1);assert.equal(snap.accountStats[0].unknownCount,1);assert.equal(snap.recent[0].status,'UNKNOWN');assert.equal(snap.ads.length,3);assert.equal(f.sql('SELECT count(*) AS n FROM posting_job_targets WHERE job_id=?',j.id)[0].n,0);
});
test('native CTA rejection after send started never sends fallback and preserves unknown outcome',async t=>{
 const f=fixture(t,[['one']]),manager=new WhatsAppManager({databasePath:f.db,sessionsPath:join(f.dir,'sessions')});t.after(()=>manager.stop());let fallback=0,started=0;
 manager.sockets.set(f.ids[0],{socket:{sendMessage:async()=>{fallback++;return {key:{id:'duplicate'}};}}});manager.loadButtonHelper=()=>({sendInteractiveMessage:async()=>{throw new Error('connection closed');}});
 await assert.rejects(manager.sendPostingAd(f.ids[0],'one@g.us',{kind:'TEXT',body:'Test',buttons:[{label:'Open',url:'https://example.com'}]},{onSendStarted:()=>started++}),e=>e.sendStarted===true&&!e.definiteRejection);
 assert.equal(started,1);assert.equal(fallback,0);
});
