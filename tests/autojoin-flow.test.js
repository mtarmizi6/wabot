import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {initializeDatabase} from '../src/database/connection.js';
import {createWhatsAppAccount,updateWhatsAppAccount,getWhatsAppAccount,deleteWhatsAppAccount} from '../src/whatsapp/store.js';
import * as s from '../src/whatsapp/autojoin-store.js';
import {parseWhatsAppInviteLinks,nextAutoJoinWait} from '../src/whatsapp/join.js';
import {AutoJoinRunner} from '../src/whatsapp/autojoin-runner.js';
import {AutoJoinFlow} from '../src/telegram/autojoin-flow.js';
import {WhatsAppManager} from '../src/whatsapp/manager.js';
import {routeTelegramUpdate,formatTelegramMessage} from '../src/telegram/controller.js';
import * as ui from '../src/telegram/autojoin-ui.js';
const link=n=>`https://chat.whatsapp.com/InviteCode${String(n).padStart(12,'0')}`;
function fixture(t,n=2) {
 const dir=mkdtempSync(join(tmpdir(),'wa-join-flow-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const db=join(dir,'app.sqlite');initializeDatabase(db);
 const accounts=Array.from({length:n},(_,i)=>{const a=createWhatsAppAccount(db,{phone:'6011234567'+i});return updateWhatsAppAccount(db,a.id,{status:'ONLINE',lastConnectedAt:new Date().toISOString()});});
 const sent=[],edits=[],calls=[];let clock=Date.now();
 const manager={get:id=>getWhatsAppAccount(db,id),joinGroupInvite:async(id,code,{beforeSend})=>{assert.equal(beforeSend(),true);calls.push([id,code]);return {status:'SUCCESS',groupJid:'1@g.us',groupName:'Group benar'};}};
 const runner=new AutoJoinRunner({databasePath:db,manager});runner.ensure=()=>{};
 const flow=new AutoJoinFlow({databasePath:db,manager,runner,now:()=>clock,send:async(chat,text)=>{sent.push(text);return {message_id:sent.length};},edit:async(chat,id,text)=>{edits.push(text);},readDocument:async d=>Buffer.from(d.content||'')});
 t.after(()=>flow.close());
 const route=async(text)=>{const r=routeTelegramUpdate({message:{from:{id:1},chat:{id:1,type:'private'},text}},'1');assert.notEqual(r.action,'ignore');return flow.handle(r);};
 const sql=(q,...args)=>{const c=new DatabaseSync(db);try{return c.prepare(q).run(...args);}finally{c.close();}};
 const draft=(ids=accounts.map(a=>a.id),dist='ROUND_ROBIN',count=4)=>{const j=s.createAutoJoinJob(db);s.setAutoJoinDraftAccounts(db,j.id,ids);s.setAutoJoinDistribution(db,j.id,dist);s.addAutoJoinLinks(db,j.id,Array.from({length:count},(_,i)=>link(i)).join('\n'));s.setAutoJoinDraftStage(db,j.id,'FINAL');return s.getAutoJoinJob(db,j.id);};
 return {dir,db,accounts,sent,edits,calls,manager,runner,flow,route,sql,draft,advance:ms=>{clock+=ms;}};
}

test('new text routes are owner-only and keep optional job arguments',()=>{
 for(const command of ['.join-new','.join-draft','.join-add','.join-next','.join-run','.join-pause','.join-resume','.join-stop','.join-list 2','.join-delete 3','.join-report 3','.join-invalid 2','.join 1,2']) {
  const update={message:{from:{id:1},chat:{id:1,type:'private'},text:command}};
  assert.ok(routeTelegramUpdate(update,'1').action.startsWith('join'));
  assert.equal(routeTelegramUpdate(update,'2').action,'ignore');
 }
 assert.equal(routeTelegramUpdate({message:{from:{id:1},chat:{id:1,type:'private'},text:'.join-report 3'}},'1').action,'join_report');
});
test('parser ignores surrounding prose, preserves case, rejects partial malformed codes and normalizes query duplicates',()=>{
 const p=parseWhatsAppInviteLinks(`tajuk senarai\n${link(1)}?mode=abc\n${link(1)}/\nhttps://chat.whatsapp.com/short\nhttps://example.org/other\nhttps://chat.whatsapp.com/InviteCode000000000001EXTRA!bad\nhttps://chat.whatsapp.com/invitecode000000000001`);
 assert.equal(p.totalInput,6);assert.equal(p.validCount,2);assert.equal(p.duplicateCount,1);assert.equal(p.invalidCount,3);
});
test('draft persists across flow recreation, repeated create is idempotent, multi accounts require explicit distribution',async t=>{
 const f=fixture(t);await f.route('.join-new');await f.route('.join-new');assert.equal(s.autoJoinSummary(f.db).DRAFT,1);
 await f.route('.join-draft');await f.route('1,2');let j=s.getDraftAutoJoinJob(f.db);assert.equal(j.stage,'DISTRIBUTION');assert.equal(j.distribution,'');
 await f.route('2');await f.route(link(1)+'\n'+link(2));j=s.getDraftAutoJoinJob(f.db);assert.equal(j.validCount,2);assert.equal(s.refreshAutoJoinJobStats(f.db,j.id).targetTotal,4);
 f.flow.leave('1');await f.route('99');assert.equal(s.getDraftAutoJoinJob(f.db).stage,'REVIEW');await f.route('.join-draft');assert.match(f.sent.at(-1),/LANGKAH 3\/5/);
 await f.route('.join-next');await f.route('.join-next');await f.route('.join-run');assert.equal(s.getAutoJoinJob(f.db,j.id).status,'RUNNING');await f.route('.join-run');assert.equal(s.listAutoJoinJobs(f.db).total,1);
 assert.match(formatTelegramMessage(f.sent[0]),/<b>🔗 AUTO JOIN/);
});
test('TXT input adds to one draft, rejects unsupported/empty/oversized files without truncation',async t=>{
 const f=fixture(t);await f.route('.join-new');await f.route('1');await f.route(link(1));await f.route('.join-add');
 await f.flow.handle({action:'document',chatId:'1',document:{fileName:'groups.txt',content:link(1)+'\n'+link(2)}});
 let j=s.getDraftAutoJoinJob(f.db);assert.equal(j.validCount,2);assert.equal(j.duplicateCount,1);
 await f.route('.join-add');await f.flow.handle({action:'document',chatId:'1',document:{fileName:'groups.csv',content:link(3)}});assert.match(f.sent.at(-1),/\.txt sahaja/);
 await f.flow.handle({action:'document',chatId:'1',document:{fileName:'groups.txt',fileSize:2*1024*1024}});assert.match(f.sent.at(-1),/1 MB/);
 await f.flow.handle({action:'document',chatId:'1',document:{fileName:'groups.txt',content:''}});assert.match(f.sent.at(-1),/kosong/);
 assert.equal(s.getDraftAutoJoinJob(f.db).validCount,2);
 assert.throws(()=>s.addAutoJoinLinks(f.db,j.id,Array.from({length:1001},(_,i)=>link(i+50)).join('\n')),/1,000/);
 assert.equal(s.getDraftAutoJoinJob(f.db).validCount,2);
});
test('fixed assignments are case-sensitive and round robin / all each have correct pair totals',t=>{
 const f=fixture(t);const j=f.draft(undefined,'ROUND_ROBIN',5);let data=s.listAutoJoinTargets(f.db,j.id).items;
 assert.deepEqual(data.map(x=>x.accountId),[f.accounts[0].id,f.accounts[1].id,f.accounts[0].id,f.accounts[1].id,f.accounts[0].id]);
 s.setAutoJoinDistribution(f.db,j.id,'ALL_EACH');assert.equal(s.refreshAutoJoinJobStats(f.db,j.id).targetTotal,10);
 assert.equal(new Set(s.listAutoJoinTargets(f.db,j.id).items.map(x=>x.accountId+':'+x.inviteUrl)).size,10);
});
test('stale account choices require reselection and all excludes reserved / offline accounts',async t=>{
 const f=fixture(t,3);const first=f.draft([f.accounts[0].id]);s.setAutoJoinJobStatus(f.db,first.id,'RUNNING');
 updateWhatsAppAccount(f.db,f.accounts[1].id,{status:'OFFLINE'});
 await f.route('.join-new');await f.route('all');let j=s.getDraftAutoJoinJob(f.db);assert.deepEqual(s.getAutoJoinJobAccounts(f.db,j.id).map(x=>x.id),[f.accounts[2].id]);
 await f.route('.join-accounts');deleteWhatsAppAccount(f.db,f.accounts[2].id);await f.route('3');assert.match(f.sent.slice(-2).join('\n'),/Senarai akaun berubah/);assert.equal(s.getDraftAutoJoinJob(f.db).selectionDirty,true);
});
test('job settings save only after review SAH and cannot mutate system defaults or another job',async t=>{
 const f=fixture(t);f.draft();await f.route('.join-setting');
 await f.route('120 60');assert.match(f.sent.at(-1),/julat/);assert.equal(s.getDraftAutoJoinJob(f.db).stage,'SETTING_DELAY');
 for(const x of ['75 150','4','6 12','20','18'])await f.route(x);
 assert.equal(s.getDraftAutoJoinJob(f.db).stage,'SETTING_REVIEW');assert.equal(s.getDraftAutoJoinJob(f.db).delayMinSec,60);
 await f.route('SAH');assert.equal(s.getDraftAutoJoinJob(f.db).delayMinSec,75);assert.equal(s.getAutoJoinSettings(f.db).delayMinSec,60);
 assert.equal(nextAutoJoinWait({delayMinSec:60,delayMaxSec:60,batchSize:5,restMinSec:1800,restMaxSec:1800,cooldownEvery:5,cooldownSec:900},{processedCount:4,batchProcessed:4},()=>0).waitSec,1800);
});
test('one operation globally, offline assignments retained, ready accounts of another job continue',async t=>{
 const f=fixture(t,3);const j=f.draft([f.accounts[0].id,f.accounts[1].id],undefined,2);s.setAutoJoinJobStatus(f.db,j.id,'RUNNING');
 const j2=f.draft([f.accounts[2].id],undefined,1);s.setAutoJoinJobStatus(f.db,j2.id,'RUNNING');updateWhatsAppAccount(f.db,f.accounts[0].id,{status:'OFFLINE'});
 let release;f.manager.joinGroupInvite=async(id,code,{beforeSend})=>{assert.ok(beforeSend());f.calls.push([id,code]);await new Promise(r=>{release=r;});return {status:'SUCCESS'};};
 const pending=f.runner.tick();await new Promise(r=>setImmediate(r));assert.equal(await f.runner.tick(),false);assert.equal(f.calls.length,1);release();await pending;
 f.manager.joinGroupInvite=async(id,code,{beforeSend})=>{assert.ok(beforeSend());f.calls.push([id,code]);return {status:'SUCCESS'};};
 await f.runner.tick();assert.equal(f.calls[0][0],f.accounts[1].id);assert.equal(f.calls[1][0],f.accounts[2].id);
 assert.equal(s.refreshAutoJoinJobStats(f.db,j.id).pending,1);assert.equal(s.listAutoJoinTargets(f.db,j.id).items[0].accountId,f.accounts[0].id);
 assert.equal(s.getAutoJoinJob(f.db,j2.id).status,'COMPLETED');
});
test('pause during in-flight join records outcome and wait; resume cannot bypass rest',async t=>{
 const f=fixture(t,1),j=f.draft(undefined,undefined,2);s.setAutoJoinJobStatus(f.db,j.id,'RUNNING');
 let release;f.manager.joinGroupInvite=async(id,code,{beforeSend})=>{beforeSend();await new Promise(r=>release=r);return {status:'APPROVAL'};};
 const running=f.runner.tick();await new Promise(r=>setImmediate(r));s.setAutoJoinJobStatus(f.db,j.id,'PAUSED');release();await running;
 assert.equal(s.refreshAutoJoinJobStats(f.db,j.id).approvalCount,1);
 const a=s.getAutoJoinJobAccounts(f.db,j.id)[0];assert.equal(a.processedCount,1);assert.ok(Date.parse(a.availableAt)>Date.now());
 s.setAutoJoinJobStatus(f.db,j.id,'RUNNING');assert.equal(s.claimNextAutoJoinTarget(f.db,j.id,a.id),null);
 assert.equal(s.getAutoJoinJobAccounts(f.db,j.id)[0].availableAt,a.availableAt);
});
test('restart distinguishes never dispatched from uncertain and never repeats terminal outcomes',t=>{
 const f=fixture(t,1),j=f.draft(undefined,undefined,3);s.setAutoJoinJobStatus(f.db,j.id,'RUNNING');
 const a=f.accounts[0].id,t1=s.claimNextAutoJoinTarget(f.db,j.id,a);let r=s.recoverAutoJoinJobs(f.db);assert.equal(r.resetTargets,1);
 s.setAutoJoinJobStatus(f.db,j.id,'RUNNING');const t2=s.claimNextAutoJoinTarget(f.db,j.id,a);assert.equal(t2.id,t1.id);s.markAutoJoinDispatched(f.db,t2.id);
 r=s.recoverAutoJoinJobs(f.db);assert.equal(r.uncertainTargets,1);assert.equal(s.refreshAutoJoinJobStats(f.db,j.id).unknownCount,1);
 assert.equal(s.completeAutoJoinTarget(f.db,t2.id,{status:'SUCCESS',schedule:true}),null);
 f.sql('UPDATE auto_join_job_accounts SET available_at=NULL WHERE job_id=?',j.id);s.setAutoJoinJobStatus(f.db,j.id,'RUNNING');assert.notEqual(s.claimNextAutoJoinTarget(f.db,j.id,a).id,t2.id);
});
test('unknown after dispatch does not retry; explicitly unsent transient gets at most 3 retries and server wait is preserved',async t=>{
 const f=fixture(t,1),j=f.draft(undefined,undefined,2);s.setAutoJoinJobStatus(f.db,j.id,'RUNNING');let count=0;
 f.manager.joinGroupInvite=async(id,code,{beforeSend})=>{count++;beforeSend();throw Object.assign(new Error('network timeout'),{joinDispatched:true});};await f.runner.tick();assert.equal(count,1);assert.equal(s.refreshAutoJoinJobStats(f.db,j.id).unknownCount,1);
 f.manager.joinGroupInvite=async()=>{count++;throw Object.assign(new Error('rate limit'),{statusCode:429,joinDispatched:true,retryAfterSec:900});};
 for(let i=0;i<4;i++){f.sql('UPDATE auto_join_job_accounts SET available_at=NULL WHERE job_id=?',j.id);await f.runner.tick();assert.ok(Date.parse(s.getAutoJoinJobAccounts(f.db,j.id)[0].availableAt)>Date.now()+899000);}
 assert.equal(count,5);assert.equal(s.refreshAutoJoinJobStats(f.db,j.id).failedCount,1);
});
test('job context never silently selects latest, stale numbers / expired SAH cannot delete wrong job',async t=>{
 const f=fixture(t,2);const j1=f.draft([f.accounts[0].id]);s.setAutoJoinJobStatus(f.db,j1.id,'STOPPED');const j2=f.draft([f.accounts[1].id]);s.setAutoJoinJobStatus(f.db,j2.id,'STOPPED');
 await f.route('.join-report');assert.match(f.sent.at(-1),/Pilih job sasaran dahulu/);
 await f.route('.join-status 2');await f.route('.join-delete');f.advance(180001);await f.route('SAH');assert.ok(s.getAutoJoinJob(f.db,j2.id));
 await f.route('.join-delete 2');s.deleteAutoJoinJob(f.db,j1.id);await f.route('SAH');assert.ok(s.getAutoJoinJob(f.db,j2.id));assert.match(f.sent.at(-1),/senarai berubah/);
 await f.route('.join-status 1');await f.route('.join-delete');await f.route('SAH');assert.equal(s.listAutoJoinJobs(f.db).total,0);await f.route('SAH');
 const next=f.draft([f.accounts[0].id]);assert.ok(next.id>j2.id);assert.equal(next.displayNumber,1);
});
test('stop requires one-use confirmation, preserves queue and resume checks ownership anew',async t=>{
 const f=fixture(t,1),j=f.draft();await f.route('.join-draft');await f.route('.join-run');await f.route('.join-stop');assert.equal(s.getAutoJoinJob(f.db,j.id).status,'RUNNING');
 await f.route('SAH');assert.equal(s.getAutoJoinJob(f.db,j.id).status,'STOPPED');assert.equal(s.refreshAutoJoinJobStats(f.db,j.id).pending,4);
 const j2=f.draft();await f.route('.join-resume');assert.match(f.sent.at(-1),/job lain/);assert.equal(s.getAutoJoinJob(f.db,j.id).status,'STOPPED');
 s.deleteAutoJoinJob(f.db,j2.id);await f.route('.join-resume');assert.equal(s.getAutoJoinJob(f.db,j.id).status,'RUNNING');
});
test('partial offline start explains targets and requires confirmation; all offline never starts',async t=>{
 const f=fixture(t),j=f.draft();await f.route('.join-draft');updateWhatsAppAccount(f.db,f.accounts[0].id,{status:'OFFLINE'});await f.route('.join-run');assert.match(f.sent.at(-1),/SEBAHAGIAN AKAUN OFFLINE/);assert.equal(s.getAutoJoinJob(f.db,j.id).status,'DRAFT');
 await f.route('SAH');assert.equal(s.getAutoJoinJob(f.db,j.id).status,'RUNNING');
 s.setAutoJoinJobStatus(f.db,j.id,'PAUSED');updateWhatsAppAccount(f.db,f.accounts[1].id,{status:'OFFLINE'});await f.route('.join-resume');assert.equal(s.getAutoJoinJob(f.db,j.id).status,'PAUSED');
});
test('report categories and per-account sums match, details capped at 10 with fallback link labels',t=>{
 const f=fixture(t),j=f.draft(undefined,'ALL_EACH',6);s.setAutoJoinJobStatus(f.db,j.id,'RUNNING');
 const statuses=['SUCCESS','ALREADY','APPROVAL','FAILED','UNKNOWN'];
 for(let i=0;i<statuses.length;i++){const a=f.accounts[i%2].id;const target=s.claimNextAutoJoinTarget(f.db,j.id,a);s.completeAutoJoinTarget(f.db,target.id,{status:statuses[i]});}
 const p=s.refreshAutoJoinJobStats(f.db,j.id);assert.equal(p.successCount+p.alreadyCount+p.approvalCount+p.failedCount+p.unknownCount+p.pending+p.processing,p.targetTotal);
 const results=s.autoJoinAccountResults(f.db,j.id);assert.equal(results.reduce((n,a)=>n+Object.values(a.counts).reduce((x,y)=>x+y,0),0),12);
 const detail=s.listAutoJoinTargets(f.db,j.id);assert.equal(detail.items.length,10);assert.equal(detail.totalPages,2);assert.match(ui.detailsScreen(p,detail),/Link 01/);assert.match(ui.reportScreen(p,results),/Malaysia/);
});
test('dashboard edits one message and Telegram failures cannot delete or fail job results',async t=>{
 const f=fixture(t,1),j=f.draft(undefined,undefined,1);await f.flow.show('1',j.id);const sent=f.sent.length;f.advance(16000);await f.flow.show('1',j.id);assert.equal(f.sent.length,sent);assert.equal(f.edits.length,1);
 f.flow.edit=async()=>{throw new Error('message to edit not found');};f.advance(16000);await f.flow.show('1',j.id);assert.equal(f.sent.length,sent+1);
 f.runner.onUpdate=async()=>{throw new Error('Telegram down');};s.setAutoJoinJobStatus(f.db,j.id,'RUNNING');await f.runner.tick();assert.equal(s.refreshAutoJoinJobStats(f.db,j.id).successCount,1);
});
test('manager does not treat preview JID as success; distinguishes already member and approval',async t=>{
 const f=fixture(t,1);const manager=new WhatsAppManager({databasePath:f.db,sessionsPath:join(f.dir,'sessions')});t.after(()=>manager.stop());
 const socket={user:{id:f.accounts[0].phone+'@s.whatsapp.net'},groupGetInviteInfo:async()=>({id:'123@g.us',subject:'Real Group',joinApprovalMode:true}),groupAcceptInvite:async()=>undefined,groupMetadata:async()=>({id:'123@g.us',participants:[]})};
 manager.sockets.set(f.accounts[0].id,{socket});let out=await manager.joinGroupInvite(f.accounts[0].id,'InviteCode000000000001');assert.equal(out.status,'UNKNOWN');
 socket.groupAcceptInvite=async()=> '123@g.us';out=await manager.joinGroupInvite(f.accounts[0].id,'InviteCode000000000001');assert.equal(out.status,'APPROVAL');
 socket.groupGetInviteInfo=async()=>({id:'123@g.us',participants:[{id:socket.user.id}]});let joins=0;socket.groupAcceptInvite=async()=>{joins++;};out=await manager.joinGroupInvite(f.accounts[0].id,'InviteCode000000000001');assert.equal(out.status,'ALREADY');assert.equal(joins,0);
});

test('run without a number respects opened job context when another draft exists',async t=>{
 const f=fixture(t,2);const j1=f.draft([f.accounts[0].id]);s.setAutoJoinJobStatus(f.db,j1.id,'STOPPED');const j2=f.draft([f.accounts[1].id]);
 await f.route('.join-list');await f.route('.join-status 1');await f.route('.join-run');
 assert.equal(s.getAutoJoinJob(f.db,j1.id).status,'RUNNING');assert.equal(s.getAutoJoinJob(f.db,j2.id).status,'DRAFT');
});

test('pause acknowledges immediately while an older dashboard edit is blocked, then displays latest state',async t=>{
 const f=fixture(t,1),j=f.draft();s.setAutoJoinJobStatus(f.db,j.id,'RUNNING');await f.flow.show('1',j.id);
 let release,active=0,maxActive=0;const gate=new Promise(r=>release=r);
 f.flow.edit=async(chat,id,text)=>{active++;maxActive=Math.max(maxActive,active);if(!f.edits.length)await gate;f.edits.push(text);active--;};
 const refresh=f.flow.show('1',j.id);
 try {
  await f.route('.join-pause');await f.route('.join-pause');
  assert.equal(s.getAutoJoinJob(f.db,j.id).status,'PAUSED');
  assert.match(f.sent.at(-1),/Job 1/);assert.match(f.sent.at(-1),/Dijeda/i);
 } finally {release();await refresh;}
 assert.equal(maxActive,1);assert.equal(f.sent.filter(x=>x.startsWith('📊 AUTO JOIN')).length,1);
 assert.match(f.edits.at(-1),/↳ ⏸ Dijeda/);assert.doesNotMatch(f.edits.at(-1),/\.join-pause/);
});

test('in-flight join settles on paused dashboard even within refresh throttle and starts no further target',async t=>{
 const f=fixture(t,1),j=f.draft();s.setAutoJoinJobStatus(f.db,j.id,'RUNNING');await f.flow.show('1',j.id);
 f.runner.onUpdate=id=>f.flow.updateLive(id);
 let release;const gate=new Promise(r=>release=r);
 f.manager.joinGroupInvite=async(id,code,{beforeSend})=>{assert.ok(beforeSend());f.calls.push(code);await gate;return {status:'SUCCESS',groupName:'Group selesai'};};
 const tick=f.runner.tick();await new Promise(r=>setImmediate(r));
 try {await f.route('.join-pause');assert.match(f.sent.at(-1),/Operasi yang sudah bermula/);}
 finally {release();await tick;}
 assert.match(f.edits.at(-1),/↳ ⏸ Dijeda/);assert.match(f.edits.at(-1),/Sedang Diproses : 0/);
 assert.match(f.edits.at(-1),/Berjaya Join : 1/);await f.runner.tick();assert.equal(f.calls.length,1);
});

function liveTimers(f) {
 const timers=new Set();
 f.flow.setTimer=(fn,delay)=>{const timer={fn,due:f.flow.now()+delay};timers.add(timer);return timer;};
 f.flow.clearTimer=timer=>timers.delete(timer);
 return {timers,async next(){const timer=[...timers].sort((a,b)=>a.due-b.due)[0];assert.ok(timer,'Expected a scheduled dashboard update');timers.delete(timer);f.advance(Math.max(0,timer.due-f.flow.now()));await timer.fn();}};
}

test('failed pause edit retries without a running job and never resends a WhatsApp request',async t=>{
 const f=fixture(t,1),j=f.draft(),time=liveTimers(f);s.setAutoJoinJobStatus(f.db,j.id,'RUNNING');await f.flow.show('1',j.id);
 let attempts=0;f.flow.edit=async(chat,id,text)=>{if(++attempts===1)throw new Error('network timeout');f.edits.push(text);};
 await f.route('.join-pause');assert.equal(time.timers.size,1);assert.equal(f.runner.jobs().length,0);
 await time.next();assert.match(f.edits.at(-1),/↳ ⏸ Dijeda/);assert.equal(time.timers.size,0);assert.equal(f.calls.length,0);
 assert.equal(f.sent.filter(x=>x.startsWith('📊 AUTO JOIN')).length,1);
});

test('throttled progress is eventually delivered; missing dashboard gets one controlled replacement',async t=>{
 const f=fixture(t,1),j=f.draft(),time=liveTimers(f);s.setAutoJoinJobStatus(f.db,j.id,'RUNNING');await f.flow.show('1',j.id);
 f.runner.onUpdate=id=>f.flow.updateLive(id);await f.runner.tick();assert.equal(time.timers.size,1);
 await time.next();assert.match(f.edits.at(-1),/Berjaya Join : 1/);
 f.flow.edit=async()=>{throw new Error('message to edit not found');};
 await f.route('.join-pause');await f.flow.updateLive(j.id);assert.equal(f.sent.filter(x=>x.startsWith('📊 AUTO JOIN')).length,1);
 await time.next();assert.equal(f.sent.filter(x=>x.startsWith('📊 AUTO JOIN')).length,2);assert.match(f.sent.at(-1),/↳ ⏸ Dijeda/);assert.equal(time.timers.size,0);
});

test('dashboard failures have bounded retries and close cancels pending refreshes',async t=>{
 const f=fixture(t,1),j=f.draft(),time=liveTimers(f);s.setAutoJoinJobStatus(f.db,j.id,'RUNNING');await f.flow.show('1',j.id);
 let attempts=0;f.flow.edit=async()=>{attempts++;throw new Error('Telegram unavailable');};
 await f.route('.join-pause');for(let i=0;i<3;i++)await time.next();assert.equal(attempts,4);assert.equal(time.timers.size,0);
 await f.flow.updateLive(j.id);assert.equal(attempts,4);
 await f.flow.show('1',j.id);assert.equal(time.timers.size,1);f.flow.close();assert.equal(time.timers.size,0);
 await f.flow.show('1',j.id);assert.equal(attempts,5);
});

test('latest ten results use separate name and status lines with safe Telegram formatting',t=>{
 const f=fixture(t,1),j=f.draft();
 const recent=Array.from({length:12},(_,i)=>({groupName:i===1?'':`Group ${i+1} <A&B>`,linkPosition:i+1,status:i%2?'FAILED':'SUCCESS'}));
 const text=ui.dashboard(s.refreshAutoJoinJobStats(f.db,j.id),recent);
 assert.match(text,/\| 10 HASIL TERKINI \|/);assert.match(text,/1\. Group 1 <A&B>\n   ↳ ✅ Berjaya Join\n\n2\. Link 02\n   ↳ ❌ Gagal/);
 assert.match(text,/10\. Group 10/);assert.doesNotMatch(text,/11\. Group 11|12\. Group 12/);
 const html=formatTelegramMessage(text);assert.match(html,/<b>10 HASIL TERKINI<\/b>/);assert.match(html,/Group 1 &lt;A&amp;B&gt;/);
});
