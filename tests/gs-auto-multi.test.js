import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {initializeDatabase} from '../src/database/connection.js';
import {createGsJob,setGsAccounts,setGsContent,prepareGsTargets,setGsPace,setGsStatus,
  claimGsNext,finishGsTarget,gsNextWaitMs,gsAccountProgress,gsSnapshot,gsListPosts,
  requeueGsUnsent,recoverGsJobs} from '../src/groupstatus/store.js';
import {gsPreviewMessage,gsDashboard,gsAccountPrompt} from '../src/telegram/controller.js';
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'gs-multi-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const p=join(dir,'db.sqlite');initializeDatabase(p);const db=new DatabaseSync(p);const at=new Date().toISOString();
 for(const id of [2,4]){
   db.prepare('INSERT INTO whatsapp_accounts(id,label,status,auth_dir,created_at,updated_at,last_connected_at,group_count) VALUES (?,?,?,?,?,?,?,?)')
     .run(id,`Akaun ${id}`,'ONLINE','auth-'+id,at,at,at,id===2?2:3);
   const count=id===2?2:3;
   for(let n=1;n<=count;n++)db.prepare('INSERT INTO whatsapp_groups(account_id,jid,subject,participant_count,first_seen_at,last_seen_at,synced_at) VALUES (?,?,?,?,?,?,?)')
     .run(id,`${id}${n}@g.us`,`Group ${id}:${n}`,12,at,at,at);
 }
 db.close();return p;
}
test('AUTO ALL plans every synced group for each selected account, no mixed identities',t=>{
 const p=fixture(t),j=createGsJob(p);setGsAccounts(p,j.id,[2,4]);setGsContent(p,j.id,{kind:'PHOTO',body:'Caption',mediaPath:`media/group-status/gs-${j.id}/a.jpg`});
 const plan=prepareGsTargets(p,j.id,{mode:'ALL'});
 assert.equal(plan.total,5);
 assert.deepEqual(gsAccountProgress(p,j.id).map(a=>[a.accountId,a.total]),[[2,2],[4,3]]);
 const text=gsPreviewMessage(plan,[{accountId:2,n:2},{accountId:4,n:3}]);
 assert.match(text,/Sasaran Akaun–Group/);assert.match(text,/Akaun 2.*2 group/);assert.match(text,/Akaun 4.*3 group/);
 assert.doesNotMatch(text,/Pilih SATU group/);
});
test('ACCOUNT REST clock remains independent and runner alternates ready accounts',t=>{
 const p=fixture(t),j=createGsJob(p);setGsAccounts(p,j.id,[2,4]);setGsContent(p,j.id,{kind:'TEXT',body:'Test'});
 setGsPace(p,j.id,{delayMinSec:60,delayMaxSec:60,batchSize:1,restMinSec:300,restMaxSec:300});
 prepareGsTargets(p,j.id);setGsStatus(p,j.id,'RUNNING');
 const first=claimGsNext(p,j.id);assert.equal(first.account_id,2);finishGsTarget(p,first.id,'ACCEPTED','M1','',()=>0);
 const second=claimGsNext(p,j.id);assert.equal(second.account_id,4);finishGsTarget(p,second.id,'ACCEPTED','M2','',()=>0);
 assert.equal(claimGsNext(p,j.id),null,'neither account may bypass its own rest');
 assert.ok(gsNextWaitMs(p,j.id)>290000);
 const rows=gsAccountProgress(p,j.id);assert.equal(rows[0].pending,1);assert.equal(rows[1].pending,2);
 assert.ok(rows[0].restUntil&&rows[1].restUntil);
 const future=Date.now()+301000;let advanced=claimGsNext(p,j.id,future);assert.equal(advanced.account_id,2);
 finishGsTarget(p,advanced.id,'SKIPPED','','403 forbidden',()=>0);
 advanced=claimGsNext(p,j.id,future);assert.equal(advanced.account_id,4);
 finishGsTarget(p,advanced.id,'ACCEPTED','M3','',()=>0);
 assert.equal(gsSnapshot(p,j.id).total,5);
 assert.equal(gsSnapshot(p,j.id).accepted,3);
});
test('offline account is requeued before sending and other account can continue',t=>{
 const p=fixture(t),j=createGsJob(p);setGsAccounts(p,j.id,[2,4]);setGsContent(p,j.id,{kind:'TEXT',body:'Test'});prepareGsTargets(p,j.id);setGsStatus(p,j.id,'RUNNING');
 const a=claimGsNext(p,j.id);assert.equal(a.account_id,2);
 assert.ok(requeueGsUnsent(p,a.id,60));
 const b=claimGsNext(p,j.id);assert.equal(b.account_id,4);
 const d=new DatabaseSync(p,{readOnly:true});const rec=d.prepare('SELECT status,attempts FROM group_status_targets WHERE id=?').get(a.id);d.close();
 assert.equal(rec.status,'PENDING');assert.equal(rec.attempts,0);
 finishGsTarget(p,b.id,'ACCEPTED','ID-OK');
 const counts=gsAccountProgress(p,j.id);assert.equal(counts.find(x=>x.accountId===2).pending,2);
});
test('post records expose stored message IDs and statuses without fabricated view counts',t=>{
 const p=fixture(t),j=createGsJob(p);setGsAccounts(p,j.id,[2]);setGsContent(p,j.id,{kind:'TEXT',body:'Test'});prepareGsTargets(p,j.id);setGsStatus(p,j.id,'RUNNING');
 const a=claimGsNext(p,j.id);finishGsTarget(p,a.id,'ACCEPTED','MID-OK');
 const v=gsListPosts(p,j.id);assert.equal(v.total,2);assert.equal(v.items[0].status,'ACCEPTED');
 assert.equal(v.items[0].messageId,'MID-OK');assert.equal('views' in v.items[0],false);
 const display=gsDashboard(gsSnapshot(p,j.id),[],gsAccountProgress(p,j.id));
 assert.match(display,/ACK OK bukan bukti/);
});
test('STOPPED resumes only pending targets and keeps the original rest clock',t=>{
 const p=fixture(t),j=createGsJob(p);setGsAccounts(p,j.id,[2]);setGsContent(p,j.id,{kind:'TEXT',body:'Test'});prepareGsTargets(p,j.id);setGsPace(p,j.id,{delayMinSec:60,delayMaxSec:60,batchSize:1,restMinSec:300,restMaxSec:300});setGsStatus(p,j.id,'RUNNING');const target=claimGsNext(p,j.id);finishGsTarget(p,target.id,'UNKNOWN','uncertain');const clock=gsAccountProgress(p,j.id)[0].nextAt;setGsStatus(p,j.id,'STOPPED');setGsStatus(p,j.id,'RUNNING');assert.equal(gsAccountProgress(p,j.id)[0].nextAt,clock);assert.equal(claimGsNext(p,j.id),null);const next=claimGsNext(p,j.id,Date.now()+301000);assert.notEqual(next.id,target.id);assert.equal(gsSnapshot(p,j.id).unknown,1);
});
test('one draft is reused while a running campaign retains an independent material snapshot',t=>{
 const p=fixture(t),first=createGsJob(p);assert.equal(createGsJob(p).id,first.id);setGsAccounts(p,first.id,[2]);setGsContent(p,first.id,{kind:'TEXT',body:'Original'});prepareGsTargets(p,first.id);setGsStatus(p,first.id,'RUNNING');const draft=createGsJob(p);assert.notEqual(draft.id,first.id);setGsContent(p,draft.id,{kind:'TEXT',body:'New material'});assert.equal(gsSnapshot(p,first.id).body,'Original');
});
test('Auto Status respects an Auto Post account rest and another ready account can continue',t=>{
 const p=fixture(t),j=createGsJob(p);setGsAccounts(p,j.id,[2,4]);setGsContent(p,j.id,{kind:'TEXT',body:'Test'});prepareGsTargets(p,j.id);setGsStatus(p,j.id,'RUNNING');const db=new DatabaseSync(p);const now=new Date().toISOString();db.prepare('INSERT INTO posting_workers(account_id,available_at,updated_at) VALUES(?,?,?)').run(2,new Date(Date.now()+300000).toISOString(),now);db.close();const target=claimGsNext(p,j.id);assert.equal(target.account_id,4);
});
