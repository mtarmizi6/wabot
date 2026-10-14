import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {initializeDatabase} from '../src/database/connection.js';
import * as wa from '../src/whatsapp/store.js';
import {groupSnapshot,groupSummary,groupPage} from '../src/whatsapp/group-store.js';
import {WhatsAppManager} from '../src/whatsapp/manager.js';
import {GroupFlow} from '../src/telegram/group-flow.js';
import {AccountsFlow} from '../src/telegram/accounts-flow.js';
import {LiveMessage} from '../src/telegram/live-message.js';
import * as ui from '../src/telegram/group-ui.js';
import {routeTelegramUpdate,formatTelegramMessage,mainMenuText} from '../src/telegram/controller.js';
import {createPosting,createPostingAd,markPostingReady,savePostingPlanAccounts,setPostingSuccessTarget,createPostingJob} from '../src/posting/store.js';
import {classifyGsError} from '../src/groupstatus/protocol.js';
const later=()=>new Promise(r=>setImmediate(r));
const gate=()=>{let release;const promise=new Promise(r=>release=r);return {promise,release};};
const g=(n,subject='Group '+n)=>({jid:n+'@g.us',subject,participantCount:20,accountRole:'MEMBER',announcement:false});
function fixture(t,count=2) {
 const dir=mkdtempSync(join(tmpdir(),'wa-group-flow-')),db=join(dir,'app.sqlite');initializeDatabase(db);
 const accounts=Array.from({length:count},(_,i)=>{const a=wa.createWhatsAppAccount(db,{phone:'6011111111'+i});return wa.updateWhatsAppAccount(db,a.id,{status:'ONLINE',lastConnectedAt:new Date().toISOString()});});
 const manager=new WhatsAppManager({databasePath:db,sessionsPath:join(dir,'sessions')}),sent=[],edits=[];
 let now=Date.now();
 const send=async(chat,text)=>{sent.push(text);return {message_id:sent.length};};
 const accountsFlow=new AccountsFlow({manager,databasePath:db,send,photo:async()=>{},now:()=>now});
 const flow=new GroupFlow({databasePath:db,manager,accountsFlow,send,edit:async(chat,id,text)=>edits.push(text),now:()=>now});accountsFlow.groupFlow=flow;
 t.after(async()=>{flow.close();await manager.stop();rmSync(dir,{recursive:true,force:true});});
 const route=async text=>{const r=routeTelegramUpdate({message:{from:{id:1},chat:{id:1,type:'private'},text}},'1');if(await accountsFlow.handle(r))return true;return flow.handle(r);};
 const sql=(q,...params)=>{const c=new DatabaseSync(db);try{return /^SELECT|^PRAGMA/i.test(q)?c.prepare(q).all(...params):c.prepare(q).run(...params);}finally{c.close();}};
 const socket=(a,fetch)=>{const s={user:{id:a.phone+':4@s.whatsapp.net'},groupFetchAllParticipating:fetch};manager.sockets.set(a.id,{socket:s});return s;};
 return {db,dir,accounts,manager,accountsFlow,flow,sent,edits,route,sql,socket,advance:ms=>now+=ms};
}

test('group routes preserve scopes, pages and owner-only access',()=>{
 for(const [text,action,args] of [['.group all 2','group_all',['2']],['.group-info all 11','group_info',['all','11']],['.group-search 2 Kedah Utara','group_search',['2','kedah utara']],['.group-result 12','group_result',['12']],['.group-search-page 2','group_search_page',['2']],['.group-sync-status all 2','group_sync_status',['all','2']],['.group-sync-status 1','group_sync_status',['1']],['.group-menu 2','group_menu',['2']]]) {
  const update={message:{from:{id:1},chat:{id:1,type:'private'},text}};
  const result=routeTelegramUpdate(update,'1');assert.equal(result.action,action);assert.deepEqual(result.args,args);assert.equal(routeTelegramUpdate(update,'2').action,'ignore');
 }
 assert.equal(routeTelegramUpdate({message:{from:{id:1},chat:{id:1,type:'private'},text:'.group-status'}},'1').action,'gs_menu');
});
test('saved unique groups merge by JID, keep same-name groups and newest available metadata',t=>{
 const f=fixture(t),[a,b]=f.accounts;
 wa.syncWhatsAppGroups(f.db,a.id,[g('a','Nama Lama'),g('b','Nama Sama')]);wa.syncWhatsAppGroups(f.db,b.id,[{...g('a','Nama Baru'),participantCount:90,accountRole:'ADMIN'},g('c','Nama Sama')]);
 f.sql('UPDATE whatsapp_groups SET synced_at=? WHERE account_id=?','2026-09-29T01:00:00.000Z',a.id);f.sql('UPDATE whatsapp_groups SET synced_at=? WHERE account_id=?','2026-09-29T02:00:00.000Z',b.id);
 wa.updateWhatsAppAccount(f.db,b.id,{status:'OFFLINE'});
 const all=groupSnapshot(f.db);assert.equal(all.uniqueCount,3);assert.equal(all.accessCount,4);assert.equal(all.items.filter(x=>x.subject==='Nama Sama').length,2);
 const shared=all.items.find(x=>x.jid==='a@g.us');assert.equal(shared.subject,'Nama Baru');assert.equal(shared.participantCount,90);assert.equal(shared.access.length,2);assert.equal(shared.access[0].accountRole,'MEMBER');assert.equal(shared.access[1].accountRole,'ADMIN');
 assert.match(ui.details(shared),/🔴 Offline/);assert.match(ui.details(shared),/Malaysia/);assert.equal(groupSnapshot(f.db,a.id).items.find(x=>x.jid==='a@g.us').subject,'Nama Lama');
 wa.syncWhatsAppGroups(f.db,a.id,[]);assert.equal(groupSummary(f.db).accessCount,2);assert.equal(groupSnapshot(f.db).items.find(x=>x.jid==='a@g.us').access.length,1);
});
test('no accounts, never synced, empty complete sync and offline saved list are distinct',async t=>{
 const empty=fixture(t,0);await empty.route('.group');assert.match(empty.sent.at(-1),/Tiada akaun WhatsApp/);
 const f=fixture(t,1),a=f.accounts[0];await f.route('.group');await f.route('.group 1');assert.match(f.sent.at(-1),/belum disync/);
 wa.syncWhatsAppGroups(f.db,a.id,[]);await f.route('.group 1');assert.match(f.sent.at(-1),/Tiada group ditemui pada sync terakhir/);
 wa.syncWhatsAppGroups(f.db,a.id,[g(1)]);wa.updateWhatsAppAccount(f.db,a.id,{status:'OFFLINE'});await f.route('.group 1');assert.match(f.sent.at(-1),/Group 1/);
 await f.route('.group-sync 1');assert.match(f.sent.at(-1),/perlu ONLINE/);assert.equal(groupSummary(f.db).accessCount,1);
});
test('pagination continues 11–20, sorts names with JID tie-break, details preserve full names and reject changed lists',async t=>{
 const f=fixture(t,1),a=f.accounts[0],groups=Array.from({length:22},(_,i)=>g(String(i).padStart(2,'0'),'Nama '+String(i).padStart(2,'0')));
 groups[11].subject='Nama 11 '+ 'panjang '.repeat(16);wa.syncWhatsAppGroups(f.db,a.id,groups.reverse());
 await f.route('.group');await f.route('.group 1 2');assert.match(f.sent.at(-1),/11\. Nama 10/);assert.match(f.sent.at(-1),/20\. Nama 19/);assert.doesNotMatch(f.sent.at(-1),/21\. Nama 20/);
 await f.route('.group-info 1 12');assert.match(f.sent.at(-1),/panjang panjang panjang/);assert.ok(f.sent.at(-1).includes(groups.find(x=>x.jid==='11@g.us').subject.trim()));assert.doesNotMatch(f.sent.at(-1),/@g\.us/);
 wa.syncWhatsAppGroups(f.db,a.id,[g('new','A first'),...groups]);await f.route('.group-info 1 12');assert.match(f.sent.at(-1),/Pilihan lama/);assert.doesNotMatch(f.sent.at(-1),/^👥 BUTIRAN GROUP/);
 await f.route('.group all');await f.route('.group-info all 1');assert.match(f.sent.at(-1),/Nama : A first/);
});
test('search has its own numbering, literal case-insensitive words, expiry and changed-result protection',async t=>{
 const f=fixture(t),[a,b]=f.accounts;wa.syncWhatsAppGroups(f.db,a.id,[g('a','AAA'),...Array.from({length:12},(_,i)=>g(i,'Kedah '+String(i).padStart(2,'0')))]);wa.syncWhatsAppGroups(f.db,b.id,[g(0,'Kedah 00')]);
 await f.route('.group');await f.route('.group 1');await f.route('.group-search all KEDAH');assert.match(f.sent.at(-1),/Ditemui : 12/);
 await f.route('.group-result 1');assert.match(f.sent.at(-1),/Nama : Kedah 00/);await f.route('.group-info 1 1');assert.match(f.sent.at(-1),/Nama : AAA/);
 await f.route('.group-search-page 2');assert.match(f.sent.at(-1),/11\. Kedah 10/);await f.route('.group-result 12');assert.match(f.sent.at(-1),/Nama : Kedah 11/);
 f.advance(600001);await f.route('.group-result 1');assert.match(f.sent.at(-1),/TAMAT TEMPOH/);
 await f.route('.group-search 1 kedah');wa.syncWhatsAppGroups(f.db,a.id,[g(0,'Kedah Z')]);await f.route('.group-result 1');assert.match(f.sent.at(-1),/BERUBAH/);
 await f.route('.group-search all %');assert.match(f.sent.at(-1),/Tiada hasil/);
});
test('renumbered accounts cannot redirect old group or sync commands; account-menu links use new group flow',async t=>{
 const f=fixture(t),[a,b]=f.accounts;wa.syncWhatsAppGroups(f.db,b.id,[g(1,'Kekal')]);await f.route('.accounts');await f.route('.account-group 2');assert.match(f.sent.at(-1),/GROUP AKAUN 2/);
 await f.route('.group-info 2 1');assert.match(f.sent.at(-1),/Nama : Kekal/);wa.deleteWhatsAppAccount(f.db,a.id);
 await f.route('.group-sync 1');assert.match(f.sent.at(-1),/Senarai akaun berubah/);assert.equal(f.manager.groupSyncs.size,0);
 await f.route('.group 1');assert.match(f.sent.at(-1),/Kekal/);assert.equal(groupSnapshot(f.db,b.id).items[0].accountId,b.id);
});
test('sync extracts own PN/LID role and chat setting, keeps unknown metadata unknown, and stages batches of 50',async t=>{
 const f=fixture(t,1),a=f.accounts[0],events=[];
 const data=Object.fromEntries(Array.from({length:125},(_,i)=>[i+'@g.us',{id:i+'@g.us',subject:'Group '+i,size:88,participants:[{id:a.phone+'@s.whatsapp.net',admin:i%2?'admin':null}],announce:i%2===0}]));
 data['unknown@g.us']={id:'unknown@g.us',subject:'Unknown'};
 const socket=f.socket(a,async()=>structuredClone(data));socket.user.lid='2222@lid';data['lid@g.us']={id:'lid@g.us',subject:'LID',participants:[{id:'2222@lid',admin:'superadmin'}],announce:false};
 const result=await f.manager.syncGroups(a.id,e=>events.push(e));assert.equal(result.detected,127);assert.deepEqual(events.filter(x=>x.type==='group_sync_progress').map(x=>x.processed),[50,100,127]);
 const rows=groupSnapshot(f.db,a.id).items;assert.equal(rows.find(x=>x.jid==='1@g.us').accountRole,'ADMIN');assert.equal(rows.find(x=>x.jid==='0@g.us').accountRole,'MEMBER');assert.equal(rows.find(x=>x.jid==='lid@g.us').accountRole,'ADMIN');
 assert.equal(rows.find(x=>x.jid==='0@g.us').participantCount,88);assert.equal(rows.find(x=>x.jid==='unknown@g.us').participantCountKnown,0);assert.match(ui.details(rows.find(x=>x.jid==='unknown@g.us')),/Belum diketahui/);
 assert.equal(f.sql('SELECT * FROM whatsapp_group_sync_stage').length,0);
});
test('sync failure, malformed response and restart discard staging without replacing last complete snapshot',async t=>{
 const f=fixture(t,1),a=f.accounts[0];wa.syncWhatsAppGroups(f.db,a.id,[g('stable','Kekal')]);
 f.socket(a,async()=>null);await assert.rejects(f.manager.syncGroups(a.id),/tidak lengkap/);assert.equal(groupSnapshot(f.db,a.id).items[0].subject,'Kekal');
 f.socket(a,async()=>Object.fromEntries(Array.from({length:60},(_,i)=>[i+'@g.us',{id:i+'@g.us',subject:'New '+i}])));
 await assert.rejects(f.manager.syncGroups(a.id,e=>{if(e.type==='group_sync_progress')wa.updateWhatsAppAccount(f.db,a.id,{status:'OFFLINE'});}),/terputus/);
 assert.equal(groupSnapshot(f.db,a.id).items[0].subject,'Kekal');assert.equal(f.sql('SELECT * FROM whatsapp_group_sync_stage').length,0);
 wa.beginWhatsAppGroupSync(f.db,a.id,'interrupted');wa.stageWhatsAppGroupBatch(f.db,a.id,'interrupted',[g('partial')]);assert.equal(wa.recoverWhatsAppGroupSync(f.db),1);assert.equal(groupSnapshot(f.db,a.id).items[0].subject,'Kekal');
});
test('only temporary fetch errors retry once; invalid session does not retry',async t=>{
 const f=fixture(t,1),a=f.accounts[0];let calls=0;
 f.socket(a,async()=>{calls++;if(calls===1)throw new Error('network timeout');return {};});await f.manager.syncGroups(a.id);assert.equal(calls,2);
 calls=0;f.socket(a,async()=>{calls++;throw Object.assign(new Error('invalid session'),{statusCode:401});});await assert.rejects(f.manager.syncGroups(a.id));assert.equal(calls,1);
});
test('single sync is background, repeated sync reuses the process, and failed Telegram edits do not fail data',async t=>{
 const f=fixture(t,1),a=f.accounts[0],wait=gate();let calls=0;
 f.socket(a,async()=>{calls++;await wait.promise;return {'1@g.us':{id:'1@g.us',subject:'Baru'}};});await f.route('.group');
 await f.route('.group-sync 1');assert.match(f.sent.at(-1),/Sedang mendapatkan/);await f.route('.group-sync 1');await f.route('.account-sync 1');assert.equal(calls,1);
 await f.route('.group');assert.match(f.sent.at(-1),/URUS GROUP/);await f.route('.group-sync-status 1');
 f.flow.syncs.get(a.id).live.edit=async()=>{throw new Error('network failure');};wait.release();await f.flow.idle();assert.equal(groupSummary(f.db).accessCount,1);assert.equal(f.flow.syncs.get(a.id).status,'DONE');
});
test('sync all snapshots online accounts, skips offline, runs sequentially and continues after one failure',async t=>{
 const f=fixture(t,3),[a,b,c]=f.accounts,wait=gate(),order=[];wa.updateWhatsAppAccount(f.db,c.id,{status:'OFFLINE'});wa.syncWhatsAppGroups(f.db,c.id,[g('offline')]);
 f.socket(a,async()=>{order.push(a.id);await wait.promise;throw Object.assign(new Error('invalid session'),{statusCode:401});});f.socket(b,async()=>{order.push(b.id);return {'b@g.us':{id:'b@g.us',subject:'B'}};});
 await f.route('.group');await f.route('.group-sync all');await f.route('.group-sync all');assert.deepEqual(order,[a.id]);
 await f.route('.group-sync 2');assert.match(f.sent.at(-1),/Menunggu giliran/);assert.deepEqual(order,[a.id]);
 const late=wa.createWhatsAppAccount(f.db,{phone:'60999'});wa.updateWhatsAppAccount(f.db,late.id,{status:'ONLINE',lastConnectedAt:new Date().toISOString()});
 wait.release();await f.flow.idle();await later();assert.deepEqual(order,[a.id,b.id]);assert.equal(f.flow.batch.entries.length,3);assert.equal(groupSummary(f.db).accessCount,2);
 const final=f.edits.at(-1);assert.match(final,/PROSES SYNC SELESAI/);assert.match(final,/Berjaya : 1 akaun/);assert.match(final,/Gagal : 1 akaun/);assert.match(final,/Dilangkau : 1 akaun/);
});
test('sync all waits for existing single sync and never fetches it twice',async t=>{
 const f=fixture(t),[a,b]=f.accounts,wait=gate(),calls=[];f.socket(a,async()=>{calls.push(a.id);await wait.promise;return {};});f.socket(b,async()=>{calls.push(b.id);return {};});
 await f.route('.group');await f.route('.group-sync 1');await f.route('.group-sync all');assert.deepEqual(calls,[a.id]);wait.release();await f.flow.idle();assert.deepEqual(calls,[a.id,b.id]);
});
test('manual sync status visibly replies even when completed results are unchanged, without fetching again',async t=>{
 const f=fixture(t,1),a=f.accounts[0];let calls=0;f.socket(a,async()=>{calls++;return {'1@g.us':{id:'1@g.us',subject:'Group Satu'}};});
 await f.route('.group');await f.route('.group-sync all');await f.flow.idle();await later();
 f.flow.edit=async()=>{throw new Error('message is not modified');};
 let before=f.sent.length;await f.route('.group-sync-status all');assert.equal(f.sent.length,before+1);assert.match(f.sent.at(-1),/PROSES SYNC SELESAI/);assert.doesNotMatch(f.sent.at(-1),/↳ Memproses akaun|Termasuk data lama|Progress Sync Semua/);
 before=f.sent.length;await f.route('.group-sync-status all');assert.equal(f.sent.length,before+1);
 before=f.sent.length;await f.route('.group-sync-status 1');assert.equal(f.sent.length,before+1);assert.match(f.sent.at(-1),/SYNC GROUP SELESAI/);assert.equal(calls,1);
});
test('manual status moves the live dashboard below the command and later progress edits only that new message',async t=>{
 const f=fixture(t,1),a=f.accounts[0],wait=gate();let calls=0;f.socket(a,async()=>{calls++;await wait.promise;return {'1@g.us':{id:'1@g.us',subject:'Baru'}};});
 await f.route('.group');await f.route('.group-sync 1');const old=f.flow.syncs.get(a.id).live,before=f.sent.length;
 await f.route('.group-sync-status 1');const current=f.flow.syncs.get(a.id).live;assert.equal(old.closed,true);assert.notEqual(current,old);assert.equal(f.sent.length,before+1);
 const sent=f.sent.length;wait.release();await f.flow.idle();await later();assert.equal(f.sent.length,sent);assert.match(current.text,/SYNC GROUP SELESAI/);assert.equal(calls,1);
});
test('controller shutdown never commits an interrupted sync or starts the next queued account',async t=>{
 const f=fixture(t),[a,b]=f.accounts,wait=gate(),calls=[];wa.syncWhatsAppGroups(f.db,a.id,[g('stable')]);
 f.socket(a,async()=>{calls.push(a.id);await wait.promise;return {'new@g.us':{id:'new@g.us',subject:'Partial'}};});f.socket(b,async()=>{calls.push(b.id);return {};});
 await f.route('.group');await f.route('.group-sync all');f.flow.close();await f.manager.stop();wait.release();await f.flow.idle();
 assert.deepEqual(calls,[a.id]);assert.equal(groupSnapshot(f.db,a.id).items[0].jid,'stable@g.us');assert.equal(f.sql('SELECT * FROM whatsapp_group_sync_stage').length,0);
});
test('sync preserves campaign target IDs and historical names; unavailable access is scoped to its account',async t=>{
 const f=fixture(t),[a,b]=f.accounts;wa.syncWhatsAppGroups(f.db,a.id,[g('shared','Nama Asal')]);wa.syncWhatsAppGroups(f.db,b.id,[g('shared','Nama Asal')]);
 const posting=createPosting(f.db,{ownerType:'SENDIRI',displayName:'Kempen'});createPostingAd(f.db,posting.id,{kind:'TEXT',body:'Iklan'});markPostingReady(f.db,posting.id);savePostingPlanAccounts(f.db,posting.id,[{...a,groupCount:1}]);setPostingSuccessTarget(f.db,posting.id,2);createPostingJob(f.db,posting.id,{delayMinSec:10,delayMaxSec:10,restMinSec:0,restMaxSec:0});
 const before=f.sql('SELECT * FROM posting_job_targets');wa.syncWhatsAppGroups(f.db,a.id,[]);wa.syncWhatsAppGroups(f.db,b.id,[g('shared','Nama Baru')]);assert.deepEqual(f.sql('SELECT * FROM posting_job_targets'),before);
 assert.throws(()=>wa.assertSavedGroupAccess(f.db,a.id,'shared@g.us'),/tidak lagi tersedia/);assert.doesNotThrow(()=>wa.assertSavedGroupAccess(f.db,b.id,'shared@g.us'));
 await assert.rejects(f.manager.sendPostingAd(a.id,'shared@g.us'),/tidak lagi tersedia/);await assert.rejects(f.manager.sendGroupStatus(a.id,'shared@g.us'),/tidak lagi tersedia/);assert.equal(classifyGsError({code:'GROUP_ACCESS_UNAVAILABLE'}),'SKIPPED');
});
test('schema 18 upgrade preserves saved IDs and marks unknown legacy metadata honestly',t=>{
 const f=fixture(t,1),a=f.accounts[0];wa.syncWhatsAppGroups(f.db,a.id,[g('known'),{jid:'unknown@g.us',subject:'Unknown'}]);const before=f.sql('SELECT id,account_id,jid,subject,participant_count,is_available FROM whatsapp_groups');
 for(const table of ['whatsapp_groups','whatsapp_group_sync_stage'])for(const column of ['participant_count_known','account_role','announcement'])f.sql(`ALTER TABLE ${table} DROP COLUMN ${column}`);
 f.sql('DELETE FROM schema_migrations WHERE version=19');assert.equal(initializeDatabase(f.db).schemaVersion,23);assert.deepEqual(f.sql('SELECT id,account_id,jid,subject,participant_count,is_available FROM whatsapp_groups'),before);
 const rows=groupSnapshot(f.db).items;assert.equal(rows.find(x=>x.jid==='known@g.us').participantCountKnown,1);assert.equal(rows.find(x=>x.jid==='unknown@g.us').participantCountKnown,0);assert.equal(rows[0].accountRole,null);
});
test('dashboard coalesces a final sync result behind a blocked edit and retries independently',async()=>{
 const wait=gate(),edits=[],timers=new Set();let now=100000,value='start',attempts=0;
 const live=new LiveMessage({chatId:1,render:()=>value,now:()=>now,send:async()=>({message_id:1}),edit:async(chat,id,text)=>{if(++attempts===1)await wait.promise;edits.push(text);},setTimer:(fn,ms)=>{const timer={fn,ms};timers.add(timer);return timer;},clearTimer:t=>timers.delete(t)});
 await live.update(true);value='progress';const editing=live.update(true);value='completed';await live.update(true);wait.release();await editing;assert.deepEqual(edits,['progress','completed']);
 live.edit=async()=>{throw new Error('timeout');};value='next';await live.update(true);assert.equal(timers.size,1);live.edit=async(chat,id,text)=>edits.push(text);const timer=[...timers][0];timers.delete(timer);now+=timer.ms;await timer.fn();assert.equal(edits.at(-1),'next');live.close();assert.equal(timers.size,0);
});
test('all-account list and detail pagination keep long names readable without overflowing Telegram',t=>{
 const f=fixture(t,12);
 for(const a of f.accounts)wa.syncWhatsAppGroups(f.db,a.id,Array.from({length:11},(_,i)=>g(i,'🌺 Kedah & <Bisnes> '+ 'Panjang '.repeat(20))));
 const snapshot=groupSnapshot(f.db),list=ui.listing(groupPage(snapshot));assert.ok(list.length<4096);assert.match(list,/\+10 lagi/);
 const detail=ui.details(snapshot.items[0],{page:2});assert.match(detail,/Akaun 11/);assert.doesNotMatch(detail,/Akaun 1 ·/);assert.ok(detail.length<4096);
 const html=formatTelegramMessage(list);assert.match(html,/&amp;/);assert.doesNotMatch(html,/<Bisnes>/);assert.match(html,/<code>\.group-info all 1<\/code>/);
 const home=mainMenuText('',{groups:132,uniqueGroups:11});assert.match(home,/Group Unik : 11/);assert.match(home,/Jumlah Akses Group : 132/);
});
