import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {initializeDatabase} from '../src/database/connection.js';
import {createGsJob,setGsContent,setGsAccounts,prepareGsTargets,setGsStatus,
  claimGsNext,finishGsTarget,gsSnapshot,gsAccountProgress,gsNextWaitMs,
  gsRecordAccountHealth,gsRetryBlockedAccount,gsListPosts
} from '../src/groupstatus/store.js';
import {routeTelegramUpdate,gsDashboard} from '../src/telegram/controller.js';
function fixture(t,{groups=4,accounts=[2,4]}={}){
 const dir=mkdtempSync(join(tmpdir(),'gs-resilience-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'db.sqlite');initializeDatabase(path);const db=new DatabaseSync(path),now=new Date().toISOString();
 for(const id of accounts){
  db.prepare('INSERT INTO whatsapp_accounts(id,label,status,auth_dir,created_at,updated_at,last_connected_at,group_count) VALUES (?,?,?,?,?,?,?,?)')
    .run(id,`Akaun ${id}`,'ONLINE',`auth-${id}`,now,now,now,groups);
  for(let n=1;n<=groups;n++)db.prepare('INSERT INTO whatsapp_groups(account_id,jid,subject,participant_count,first_seen_at,last_seen_at,synced_at) VALUES (?,?,?,?,?,?,?)')
    .run(id,`${id}-${n}@g.us`,`Group ${id}:${n}`,25,now,now,now);
 }
 db.close();const job=createGsJob(path);setGsAccounts(path,job.id,accounts);setGsContent(path,job.id,{kind:'TEXT',body:'Test'});prepareGsTargets(path,job.id);
 setGsStatus(path,job.id,'RUNNING');return {path,jobId:job.id};
}
function groupError(path,jobId,target,fault='REJECTED:479'){
 finishGsTarget(path,target.id,'FAILED','',`SERVER ACK ${fault}` ,()=>0);
 return gsRecordAccountHealth(path,jobId,target.account_id,fault);
}
test('first 479 fails one group without pausing job, next group remains runnable',t=>{
 const {path,jobId}=fixture(t,{accounts:[2],groups:3});
 const one=claimGsNext(path,jobId);const h=groupError(path,jobId,one);
 assert.deepEqual({blocked:h.blocked,streak:h.streak},{blocked:false,streak:1});
 assert.equal(gsSnapshot(path,jobId).status,'RUNNING');
 const two=claimGsNext(path,jobId,Date.now()+121000);
 assert.ok(two);assert.notEqual(two.id,one.id);
 finishGsTarget(path,two.id,'ACCEPTED','ACK-2');gsRecordAccountHealth(path,jobId,2,'');
 const r=gsAccountProgress(path,jobId)[0];assert.equal(r.faultStreak,0);assert.equal(r.blockedAt,null);
});
for (const fault of ['UNKNOWN','REJECTED:479','REJECTED:403']) {
 test(`repeated ${fault} continues pending groups without replay and preserves pacing`,t=>{
  const {path,jobId}=fixture(t,{accounts:[2],groups:5});
  const ids=new Set();
  for(let n=0;n<4;n++){
   const target=claimGsNext(path,jobId,Date.now()+10000000);assert.ok(target);assert.ok(!ids.has(target.id));ids.add(target.id);
   finishGsTarget(path,target.id,fault==='UNKNOWN'?'UNKNOWN':'FAILED','',fault,()=>0);
   assert.equal(gsRecordAccountHealth(path,jobId,2,fault).blocked,false);
   assert.equal(claimGsNext(path,jobId),null); // delay still applies
  }
  assert.equal(gsSnapshot(path,jobId).pending,1);
  assert.equal(gsAccountProgress(path,jobId)[0].blockedAt,null);
  const last=claimGsNext(path,jobId,Date.now()+10000000);assert.ok(last);assert.ok(!ids.has(last.id));
 });
}
test('resume clears legacy UNKNOWN breaker but preserves rest and previously tried targets',t=>{
 const {path,jobId}=fixture(t,{accounts:[2],groups:4});
 const first=claimGsNext(path,jobId);finishGsTarget(path,first.id,'UNKNOWN');
 setGsStatus(path,jobId,'PAUSED');
 const db=new DatabaseSync(path);const due=new Date(Date.now()+300000).toISOString();
 db.prepare("UPDATE group_status_account_schedule SET blocked_at=?,last_fault='UNKNOWN',fault_streak=3,next_run_at=? WHERE job_id=?").run(new Date().toISOString(),due,jobId);db.close();
 setGsStatus(path,jobId,'RUNNING');
 assert.equal(gsAccountProgress(path,jobId)[0].blockedAt,null);
 assert.equal(claimGsNext(path,jobId),null);
 assert.equal(gsSnapshot(path,jobId).unknown,1);
 assert.notEqual(claimGsNext(path,jobId,Date.now()+10000000).id,first.id);
});
test('explicit unsupported protocol retains account pause',t=>{
 const {path,jobId}=fixture(t,{accounts:[2],groups:4});
 assert.equal(gsRecordAccountHealth(path,jobId,2,'UNSUPPORTED').blocked,true);
 setGsStatus(path,jobId,'PAUSED');setGsStatus(path,jobId,'RUNNING');
 assert.ok(gsAccountProgress(path,jobId)[0].blockedAt);
});
test('explicit skip and success reset UNKNOWN streak',t=>{
 const {path,jobId}=fixture(t,{accounts:[2],groups:4});
 const future=Date.now()+10000000;
 const first=claimGsNext(path,jobId,future);finishGsTarget(path,first.id,'UNKNOWN');assert.equal(gsRecordAccountHealth(path,jobId,2,'UNKNOWN').streak,1);
 const second=claimGsNext(path,jobId,future);finishGsTarget(path,second.id,'SKIPPED');gsRecordAccountHealth(path,jobId,2,'');
 const third=claimGsNext(path,jobId,future);finishGsTarget(path,third.id,'UNKNOWN');assert.equal(gsRecordAccountHealth(path,jobId,2,'UNKNOWN').streak,1);
});
test('post history remains accessible without views tracker',t=>{
 const {path,jobId}=fixture(t,{accounts:[2],groups:2});const future=Date.now()+10000000;
 const one=claimGsNext(path,jobId,future);finishGsTarget(path,one.id,'ACCEPTED','MID-1');
 const two=claimGsNext(path,jobId,future);finishGsTarget(path,two.id,'SKIPPED');
 const rows=gsListPosts(path,jobId);
 assert.equal(rows.total,2);assert.equal(rows.items[0].status,'ACCEPTED');
 assert.equal(rows.items[0].messageId,'MID-1');
 assert.equal(rows.items[1].status,'SKIPPED');
 assert.match(gsDashboard(gsSnapshot(path,jobId),[],gsAccountProgress(path,jobId)),/ACK OK bukan bukti/);
});
test('new commands route through classic private owner-only text flow',()=>{
 const route=(text,owner=9)=>routeTelegramUpdate({message:{from:{id:owner},chat:{id:9,type:'private'},text}},9);
 assert.equal(route('.gs-account-retry 2').action,'gs_retry_account');
 assert.equal(route('.gs-view-set 451 21').action,'text');
 assert.equal(route('.gs-posts 1').action,'gs_posts');
 assert.notEqual(route('.gs-posts 1',10)?.action,'gs_posts');
});
