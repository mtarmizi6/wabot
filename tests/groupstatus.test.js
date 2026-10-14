import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {initializeDatabase} from '../src/database/connection.js';
import {createGsJob,setGsContent,setGsAccounts,prepareGsTargets,gsSnapshot,claimGsNext,finishGsTarget,setGsStatus,recoverGsJobs,cloneGsJob,deleteGsJob,setGsPace,gsNextWaitMs} from '../src/groupstatus/store.js';
import {sendGroupStatusProtocol,classifyGsError,GroupStatusUnsupportedError} from '../src/groupstatus/protocol.js';
import {routeTelegramUpdate} from '../src/telegram/controller.js';
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'gs-test-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'db.sqlite');initializeDatabase(path);
 const db=new DatabaseSync(path);const at=new Date().toISOString();
 db.prepare("INSERT INTO whatsapp_accounts(id,label,status,auth_dir,created_at,updated_at,last_connected_at,group_count) VALUES (1,'Akaun 1','ONLINE','one',?,?,?,2)").run(at,at,at);
 for (const [jid,name] of [['111@g.us','Group A'],['222@g.us','Group B']]) db.prepare('INSERT INTO whatsapp_groups(account_id,jid,subject,participant_count,first_seen_at,last_seen_at,synced_at) VALUES (1,?,?,1,?,?,?)').run(jid,name,at,at,at);
 db.close();return path;
}
test('One-shot job records targets and never repeats accepted group on resume',t=>{
 const path=fixture(t);const job=createGsJob(path);setGsContent(path,job.id,{kind:'TEXT',body:'Hello'});setGsAccounts(path,job.id,[1]);
 const plan=prepareGsTargets(path,job.id,{mode:'ALL'});assert.equal(plan.total,2);
 setGsStatus(path,job.id,'RUNNING');const a=claimGsNext(path,job.id);assert.ok(a);finishGsTarget(path,a.id,'ACCEPTED','ID-A');
 setGsStatus(path,job.id,'PAUSED');setGsStatus(path,job.id,'RUNNING');
 assert.equal(claimGsNext(path,job.id),null,'Resume must not bypass the persisted account delay');
 const b=claimGsNext(path,job.id,Date.now()+121000);
 assert.notEqual(b.id,a.id);finishGsTarget(path,b.id,'SKIPPED');setGsStatus(path,job.id,'COMPLETED');
 const snap=gsSnapshot(path,job.id);assert.equal(snap.accepted,1);assert.equal(snap.skipped,1);assert.equal(snap.pending,0);
 const clone=cloneGsJob(path,job.id);assert.equal(clone.total,2);assert.equal(clone.pending,2);assert.equal(clone.accepted,0);assert.equal(clone.status,'READY');
});
test('Interrupted request becomes UNKNOWN instead of automatically resending',t=>{
 const path=fixture(t);const j=createGsJob(path);setGsContent(path,j.id,{kind:'TEXT',body:'Pilot'});setGsAccounts(path,j.id,[1]);prepareGsTargets(path,j.id,{mode:'SELECTED',selections:[{accountId:1,position:1}]});setGsStatus(path,j.id,'RUNNING');claimGsNext(path,j.id);
 const r=recoverGsJobs(path);assert.deepEqual(r,{uncertain:1,paused:1});assert.equal(gsSnapshot(path,j.id).unknown,1);assert.equal(gsSnapshot(path,j.id).pending,0);
 setGsStatus(path,j.id,'STOPPED');deleteGsJob(path,j.id);assert.equal(gsSnapshot(path,j.id),null);
});
test('Group Status content rejects captions over limit and unsupported types',t=>{
 const path=fixture(t);const j=createGsJob(path);
 assert.throws(()=>setGsContent(path,j.id,{kind:'TEXT',body:'x'.repeat(601)}),/600/);
 assert.throws(()=>setGsContent(path,j.id,{kind:'PHOTO',body:'x'.repeat(501),mediaPath:'media/group-status/gs-1/status.jpg'}),/500/);
 assert.throws(()=>setGsContent(path,j.id,{kind:'VOICE',body:'hi'}),/TEXT/);
});
test('Unsupported proto refuses to send ordinary group message',async()=>{
 let calls=0;
 const socket={user:{id:'100@s.whatsapp.net'},relayMessage:async()=>{calls++;}};
 const lib={proto:{Message:{fromObject:o=>({}),encode:o=>({finish:()=>Buffer.from('{}')}),decode:b=>JSON.parse(b.toString())}},jidNormalizedUser:s=>s,generateWAMessageFromContent:()=>{calls++;}};
 await assert.rejects(sendGroupStatusProtocol(lib,socket,'111@g.us',{kind:'TEXT',body:'hi'}),GroupStatusUnsupportedError);
 assert.equal(calls,0);
});
test('Compatible mocked proto relays Group Status V2 envelope (not normal chat)',async()=>{
 let sent=null;const proto={Message:{fromObject:x=>x,encode:x=>({finish:()=>Buffer.from(JSON.stringify(x))}),decode:x=>JSON.parse(x.toString())}};
 const lib={proto,jidNormalizedUser:x=>x,generateWAMessageFromContent:(jid,content)=>({key:{id:'GS-100'},message:content}),prepareWAMessageMedia:async content=>({imageMessage:{caption:content.caption}})};
 const socket={user:{id:'100@s.whatsapp.net'},waUploadToServer:async()=>{},relayMessage:async(jid,msg,options)=>{sent={jid,msg,options};}};
 const result=await sendGroupStatusProtocol(lib,socket,'111@g.us',{kind:'PHOTO',body:'Photo',buffer:Buffer.from('photo'),mime:'image/jpeg'});
 assert.equal(result.messageId,'GS-100');assert.equal(sent.jid,'111@g.us');assert.equal(sent.msg.groupStatusMessageV2.message.imageMessage.contextInfo.isGroupStatus,true);
 assert.equal(sent.msg.conversation,undefined);
});
test('Generic forbidden error fails without inferring permission, delivery uncertainty is not retried',()=>{
 assert.equal(classifyGsError(new Error('403 forbidden')),'FAILED');
 assert.equal(classifyGsError(new Error('timeout while relaying')),'UNKNOWN');
 assert.equal(classifyGsError(new GroupStatusUnsupportedError('no wrapper')),'UNSUPPORTED');
});
test('New Telegram Group Status commands route only for owner private chat',()=>{
 const route=(text,id=99)=>routeTelegramUpdate({message:{from:{id},chat:{id:99,type:'private'},text}},99);
 assert.equal(route('.group-status').action,'gs_menu');
 assert.equal(route('.gs-new').action,'gs_new');
 assert.deepEqual(route('.gs-target 1:2,1:3').args,['1:2,1:3']);
 assert.equal(route('.gs-resume 12').action,'gs_resume');
 assert.equal(route('.gs-stop 12').action,'gs_stop');
 assert.equal(route('.gs-delete 12 CONFIRM').action,'gs_delete');
 assert.equal(route('.gs-new',5).action,'ignore');
});

test('Build 175 pace persists random delay and 25-group rest (with configurable small batch)',t=>{
 const path=fixture(t);const j=createGsJob(path);
 const v=setGsPace(path,j.id,{delayMinSec:60,delayMaxSec:120,batchSize:1,restMinSec:300,restMaxSec:600});
 assert.equal(v.batch_size,1);
 setGsContent(path,j.id,{kind:'TEXT',body:'Test'});setGsAccounts(path,j.id,[1]);prepareGsTargets(path,j.id);
 setGsStatus(path,j.id,'RUNNING');const target=claimGsNext(path,j.id);
 finishGsTarget(path,target.id,'ACCEPTED','MID','',()=>0);
 const snap=gsSnapshot(path,j.id);
 assert.equal(snap.processed_since_rest,0);
 assert.ok(snap.rest_until);
 assert.ok(gsNextWaitMs(path,j.id)>295000);
 setGsStatus(path,j.id,'PAUSED');assert.equal(gsNextWaitMs(path,j.id),null);
 setGsStatus(path,j.id,'RUNNING');assert.ok(gsNextWaitMs(path,j.id)>290000);
});
test('Build 175 validates delay/rest and never lets unauthorised job states mutate pacing',t=>{
 const path=fixture(t);const j=createGsJob(path);
 assert.throws(()=>setGsPace(path,j.id,{delayMinSec:120,delayMaxSec:60,batchSize:25,restMinSec:300,restMaxSec:600}),/Delay/);
 assert.throws(()=>setGsPace(path,j.id,{delayMinSec:1,delayMaxSec:60,batchSize:25,restMinSec:300,restMaxSec:600}),/Delay/);
 setGsPace(path,j.id,{delayMinSec:60,delayMaxSec:120,batchSize:25,restMinSec:300,restMaxSec:600});
 setGsContent(path,j.id,{kind:'TEXT',body:'Test'});setGsAccounts(path,j.id,[1]);prepareGsTargets(path,j.id);setGsStatus(path,j.id,'RUNNING');
 assert.throws(()=>setGsPace(path,j.id,{delayMinSec:60,delayMaxSec:120,batchSize:25,restMinSec:300,restMaxSec:600}),/sebelum RUN/);
});

test('Group Status settings and posting records remain, view commands removed',()=>{
  const route=t=>routeTelegramUpdate({message:{from:{id:99},chat:{id:99,type:'private'},text:t}},99);
  assert.equal(route('.gs-setting').action,'gs_setting_help');
  assert.deepEqual(route('.gs-setting 60 120 25 5 10').args,['60','120','25','5','10']);
  assert.equal(route('.gs-posts 1').action,'gs_posts');
  assert.equal(route('.gs-views 1').action,'text');
  assert.equal(route('.gs-view-scan 1').action,'text');
});
