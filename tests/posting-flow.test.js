import {SystemFlow} from '../src/system/flow.js';
import { CampaignHub } from '../src/telegram/campaign-hub.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {initializeDatabase} from '../src/database/connection.js';
import * as store from '../src/posting/store.js';
import * as wa from '../src/whatsapp/store.js';
import * as clients from '../src/clients/store.js';
import * as clientsUi from '../src/clients/ui.js';
import * as ui from '../src/telegram/controller.js';
import * as postingUi from '../src/telegram/posting-ui.js';
import * as navigation from '../src/telegram/posting-draft.js';
import {AccountsFlow} from '../src/telegram/accounts-flow.js';
import {GroupFlow} from '../src/telegram/group-flow.js';
import {ClientFlow} from '../src/clients/flow.js';
import {PostingLive} from '../src/telegram/posting-live.js';
import {WhatsAppManager} from '../src/whatsapp/manager.js';
import {accountNumber} from '../src/telegram/accounts-ui.js';
const later=()=>new Promise(r=>setImmediate(r));
const route=text=>ui.routeTelegramUpdate({message:{from:{id:1},chat:{id:1,type:'private'},text}},'1');
const gate=()=>{let release;const promise=new Promise(r=>release=r);return {promise,release};};
const runtime=fs.readFileSync(new URL('../scripts/telegram-controller.js',import.meta.url),'utf8');
// Expose only filesystem functions actually imported by the production controller.
// Supplying the whole fs module can hide missing imports in its media send path.
const runtimeFs=Object.fromEntries(runtime.match(/import\s*\{([^}]+)\}\s*from 'node:fs'/)[1].split(',').map(name=>{const key=name.trim();return [key,fs[key]];}));
function fixture(t,count=2) {
 const dir=fs.mkdtempSync(join(tmpdir(),'wa-post-flow-')),db=join(dir,'data.sqlite');initializeDatabase(db);
 const accounts=Array.from({length:count},(_,i)=>{let a=wa.createWhatsAppAccount(db,{phone:'6018888000'+i});wa.updateWhatsAppAccount(db,a.id,{status:'ONLINE',lastConnectedAt:new Date().toISOString()});wa.syncWhatsAppGroups(db,a.id,[{jid:`${i}a@g.us`,subject:'Group A '+i},{jid:`${i}b@g.us`,subject:'Group B '+i}]);return wa.getWhatsAppAccount(db,a.id);});
 const clientFlows=[];
 const manager=new WhatsAppManager({databasePath:db,sessionsPath:join(dir,'sessions')}),sent=[],edits=[],sendOptions=[];let starts=0,now=Date.now(),current=null;
 const send=async(chat,text,options={})=>{sent.push(text);sendOptions.push(options);return {message_id:sent.length};};
 const live=new PostingLive({databasePath:db,manager,send,edit:async(chat,id,text)=>{edits.push({id,text});return {};},startScheduler:()=>{starts++;},resolvePosting:()=>current,now:()=>now,liveOptions:{interval:0}});
 const accountsFlow=new AccountsFlow({databasePath:db,manager,send});
 const groupFlow=new GroupFlow({databasePath:db,manager,accountsFlow,send,edit:async()=>{}});
 t.after(async()=>{for(const flow of clientFlows)flow.close();live.close();groupFlow.close();await manager.stop();fs.rmSync(dir,{recursive:true,force:true});});
 const prepare=(mode='SUCCESS')=>{
  const p=store.createPosting(db,{ownerType:'SENDIRI',displayName:'Promosi '+randomUUID().slice(0,6)});
  store.createPostingAd(db,p.id,{kind:'TEXT',body:'Iklan pertama'});store.markPostingReady(db,p.id);store.savePostingPlanAccounts(db,p.id,wa.listWhatsAppAccounts(db));
  if(mode==='DAYS')store.setPostingDaysTarget(db,p.id,3);else if(mode==='CONTINUOUS')store.setPostingContinuous(db,p.id);else store.setPostingSuccessTarget(db,p.id,20);
  current=store.getPosting(db,p.id);return current;
 };
 const makeJob=(mode='SUCCESS')=>{const p=prepare(mode);const j=store.createPostingJob(db,p.id);store.setPostingJobStatus(db,j.id,'RUNNING');return store.getPostingJob(db,j.id);};
 return {dir,db,accounts,clientFlows,manager,sent,edits,send,sendOptions,live,accountsFlow,groupFlow,prepare,makeJob,starts:()=>starts,advance:ms=>{now+=ms;}};
}

// Execute the actual controller dispatch and content helpers with simulated I/O.
// This exercises wiring and navigation, without starting polling or sending messages.
function controllerHarness(f) {
 const helpers=runtime.slice(runtime.indexOf('function normalizePostingAccountSelection'),runtime.indexOf('function currentStorageMessage'));
 const dispatch=runtime.slice(runtime.indexOf('async function dispatch(route)'),runtime.indexOf('\nfunction enableStopKey()',runtime.indexOf('async function dispatch(route)')));
 assert.ok(dispatch.includes("case 'posting_review'"));
 const hub=new CampaignHub({databasePath:f.db,post:f.live,send:f.send,account:id=>f.manager.get(id),gsShow:()=>{throw new Error('Unexpected GS route');},gsAction:()=>{throw new Error('Unexpected GS action');}});
 const sys=new SystemFlow({root:f.dir,databasePath:f.db,send:f.send,accounts:()=>wa.listWhatsAppAccounts(f.db),build:196});
 const deps={followupFlow:{leave(){},handle:async()=>false},ensureSystemFlow:()=>sys,ensureCampaignHub:()=>hub,...runtimeFs,...store,...wa,...clients,...clientsUi,...ui,...postingUi,...navigation,ClientFlow,join,extname,randomUUID,accountNumber,
  databasePath:f.db,projectRoot:f.dir,clientsDbPath:join(f.dir,'clients.sqlite'),ownerId:'1',token:'test',abort:{signal:undefined},whatsapp:f.manager,accountFlow:f.accountsFlow,groupFlow:f.groupFlow,
  joinFlow:{handle:async()=>false,leave:()=>{}},postingLive:f.live,sendScreen:f.send,sendMenu:()=>f.send('1','MENU'),
  getFileInfo:async(t,id)=>({filePath:id==='video'?'file.mp4':'file.jpg',fileSize:12}),downloadTelegramFile:async(t,path)=>path.endsWith('mp4')?Buffer.from('0000ftyp0000'):Buffer.from([255,216,255,224,0,0,0,0,0,0,0,0]),
  sendMessage:async(token,chat,text)=>f.send(chat,text),sendPhotoBuffer:async(token,chat,buf,opts)=>{assert.equal(buf[0],255);return f.send(chat,'PHOTO '+opts.caption);},
  sendVideoBuffer:async(token,chat,buf,opts)=>{assert.equal(buf.toString('ascii',4,8),'ftyp');return f.send(chat,'VIDEO '+opts.caption);}
 };
 delete deps.default;
 const factory=new Function(...Object.keys(deps),`const gsContext={};function saveGsContext(){}const restored=readPostingFlowState(databasePath,'input:'+ownerId);let pendingInput=restored?.pendingInput||null,postingUi=restored?.postingUi||null,postingScreen=restored?.postingScreen||null;\nconst clientFlow=new ClientFlow({databasePath,clientsDbPath,send:sendScreen,postingLive,beginClient:async(chatId,client)=>{pendingInput={type:'posting_name',chatId,ownerType:'CLIENT',clientId:client.id};postingUi=null;return sendScreen(chatId,postingClientNameMessage(client));}});\npostingLive.review=(chat,id)=>showPostingReview(chat,id);\n${helpers}\n${dispatch}\nreturn {dispatch,clientFlow,state:()=>({pendingInput,postingUi,postingScreen})};`);
 const h=factory(...Object.values(deps));
 f.clientFlows.push(h.clientFlow);
 f.live.resolvePosting=()=>h.state().postingUi?.postingId?store.getPosting(f.db,h.state().postingUi.postingId):store.getUnstartedPosting(f.db);
 return {...h,command:text=>h.dispatch(route(text))};
}

test('Auto Post routes include draft, pages and account details with owner guard',()=>{
 for(const [text,action,args] of [['.mula-draft','posting_draft',[]],['.iklan-urus 2','ad_manage',['2']],['.pilih-akaun-page 2','posting_account_select',['2']],['.campaigns 2','posting_active',['2']],['.posting-accounts 7 2','posting_accounts',['7','2']]]){
  assert.equal(route(text).action,action);assert.deepEqual(route(text).args,args);
  assert.equal(ui.routeTelegramUpdate({message:{from:{id:2},chat:{id:2,type:'private'},text}},'1').action,'ignore');
 }
});
test('controller text draft resumes through all six steps and repeated start cannot resume a paused campaign',async t=>{
 const f=fixture(t),h=controllerHarness(f);
 await h.command('.mula sendiri');assert.match(f.sent.at(-1),/LANGKAH 1\/6/);
 await h.command('Promosi Kedah');assert.match(f.sent.at(-1),/Langkah 2\/6/);
 await h.command('Iklan A');await h.command('.button-add');await h.command('Beli');await h.command('https://example.com/beli');await h.command('.button-done');await h.command('.iklan-siap');
 const p=store.getUnstartedPosting(f.db);assert.equal(p.status,'READY');assert.equal(store.getPostingAd(f.db,p.id,1).buttons.length,1);
 await h.command('.menu');await h.command('.mula');assert.match(f.sent.at(-1),/SAMBUNG|Teruskan Draf/);
 await h.command('.mula-draft');assert.match(f.sent.at(-1),/LANGKAH 3\/6/);
 await h.command('1,2');assert.match(f.sent.at(-1),/LANGKAH 4\/6/);
 await h.command('.target success');await h.command('20');await h.command('.reuse ulang');assert.match(f.sent.at(-1),/LANGKAH 5\/6/);
 await h.command('.posting-semak');assert.match(f.sent.at(-1),/LANGKAH 6\/6/);
 await h.command('.posting-mula');const job=store.getPostingJobForPosting(f.db,p.id);assert.equal(job.status,'RUNNING');assert.equal(f.starts(),1);
 await h.command('.posting-pause');assert.equal(store.getPostingJob(f.db,job.id).status,'PAUSED');
 await h.command('.posting-mula');assert.equal(store.getPostingJob(f.db,job.id).status,'PAUSED');assert.equal(f.starts(),1);assert.equal(store.listPostingJobs(f.db).total,1);
 await h.command('.mula');assert.doesNotMatch(f.sent.at(-1),/DRAF TERSIMPAN/);
});
test('photo and video drafts preserve per-ad CTA and real preview media through edit',async t=>{
 const f=fixture(t),h=controllerHarness(f);
 await h.command('.mula sendiri');await h.command('Media');
 await h.dispatch({action:'photo',chatId:'1',text:'Caption gambar',media:{fileId:'photo',mimeType:'image/jpeg',fileSize:3}});
 await h.command('.button-add');await h.command('WhatsApp');await h.command('https://wa.me/60122223333');await h.command('.button-done');
 const p=store.getUnstartedPosting(f.db),first=store.getPostingAd(f.db,p.id,1);assert.ok(fs.existsSync(join(f.dir,first.mediaPath)));
 await h.command('.iklan-preview 1');assert.ok(f.sent.some(x=>x==='PHOTO Caption gambar'));
 await h.command('.iklan-tambah');await h.dispatch({action:'video',chatId:'1',text:'Caption video',media:{fileId:'video',mimeType:'video/mp4',fileSize:3}});await h.command('.button-skip');
 await h.command('.iklan-preview 2');assert.ok(f.sent.some(x=>x==='VIDEO Caption video'));
 await h.command('.iklan-edit 1');await h.command('Teks baharu');const edited=store.getPostingAd(f.db,p.id,1);assert.equal(edited.kind,'TEXT');assert.equal(edited.buttons.length,1);assert.ok(!fs.existsSync(join(f.dir,first.mediaPath)));assert.equal(store.getPostingAd(f.db,p.id,2).buttons.length,0);
});
test('cancel preserves draft, back restores schedule input, deleting a draft or ad requires matching confirmation',async t=>{
 const f=fixture(t),h=controllerHarness(f);
 await h.command('.mula sendiri');await h.command('Simpan');await h.command('Iklan 1');await h.command('.button-skip');await h.command('.iklan-siap');await h.command('.pilih-akaun');await h.command('all');await h.command('.target terus');
 const p=store.getUnstartedPosting(f.db);
 await h.command('.setting-custom');await h.command('45 90');await h.command('3');await h.command('.kembali');assert.equal(h.state().pendingInput.type,'posting_setting_batch');await h.command('4');await h.command('2 5');await h.command('YA');
 assert.equal(store.getPostingPlan(f.db,p.id).batchSize,4);
 await h.command('.iklan-tambah');await h.command('.batal');assert.equal(store.listPostingAds(f.db,p.id).length,1);
 await h.command('.mula-cancel');assert.ok(store.getPosting(f.db,p.id));await h.command('.batal');assert.ok(store.getPosting(f.db,p.id));
 await h.command('.iklan-delete 1');await h.command('tak');assert.equal(store.listPostingAds(f.db,p.id).length,1);await h.command('SAH');assert.equal(store.listPostingAds(f.db,p.id).length,0);
 await h.command('.mula-cancel');await h.command('SAH');assert.equal(store.getPosting(f.db,p.id),null);
});
test('account reply maps display numbers to stable IDs after deletion and rejects stale lists',async t=>{
 const f=fixture(t),h=controllerHarness(f);wa.deleteWhatsAppAccount(f.db,f.accounts[0].id);
 await h.command('.mula sendiri');await h.command('Akaun');await h.command('Iklan');await h.command('.iklan-siap');await h.command('.pilih-akaun');await h.command('1');
 const p=store.getUnstartedPosting(f.db);assert.equal(store.getPostingPlan(f.db,p.id).accounts[0].accountId,f.accounts[1].id);
 await h.command('.pilih-akaun');const a=wa.createWhatsAppAccount(f.db,{phone:'60199990000'});wa.updateWhatsAppAccount(f.db,a.id,{status:'ONLINE',lastConnectedAt:new Date().toISOString()});
 await h.command('.pilih-akaun 1');assert.match(f.sent.at(-1),/Senarai akaun|pilih semula/i);
 assert.equal(store.getPostingPlan(f.db,p.id).accounts[0].accountId,f.accounts[1].id);
});
test('new drafts coexist with active client campaigns without changing running snapshots',async t=>{
 const f=fixture(t),h=controllerHarness(f),first=f.makeJob('CONTINUOUS');
 const snapshot=store.getPostingJobAd(f.db,first.id,1);
 await h.command('.mula client');await h.command('baru');await h.command('Client Baharu');await h.command('Promosi client');
 assert.equal(store.getUnstartedPosting(f.db).ownerType,'CLIENT');assert.deepEqual(store.getPostingJobAd(f.db,first.id,1),snapshot);
});
test('resume preserves worker rest for SUCCESS, HARI and BERTERUSAN and uses global scheduler only',async t=>{
 const f=fixture(t);
 for(const mode of ['SUCCESS','DAYS','CONTINUOUS']){
  const job=f.makeJob(mode);store.setPostingWorkerWait(f.db,f.accounts[0].id,600);const before=store.getPostingWorker(f.db,f.accounts[0].id).availableAt;
  await f.live.show('1',job.id);await f.live.handle(route(`.posting-pause ${f.live.number(job.id)}`));await f.live.handle(route('.posting-resume'));
  assert.equal(store.getPostingJob(f.db,job.id).status,'RUNNING');assert.equal(store.getPostingWorker(f.db,f.accounts[0].id).availableAt,before);
  assert.equal(store.claimNextCampaignWork(f.db,f.accounts[0].id,f.accounts.map(a=>a.id)),null);
 }
 assert.equal(f.starts(),3);assert.doesNotMatch(runtime,/runPostingJob\s*\(/);
});
test('ambiguous job control never silently chooses newest; stop confirmation binds ID and expires',async t=>{
 const f=fixture(t),a=f.makeJob(),b=f.makeJob();await f.live.handle(route('.posting-pause'));
 assert.equal(store.getPostingJob(f.db,a.id).status,'RUNNING');assert.equal(store.getPostingJob(f.db,b.id).status,'RUNNING');assert.match(f.sent.join('\n'),/PILIH KEMPEN/);
 await f.live.handle(route(`.status ${a.id}`));await f.live.handle(route('.posting-stop'));assert.equal(store.getPostingJob(f.db,a.id).status,'RUNNING');
 f.advance(120001);await f.live.handle(route('SAH'));assert.equal(store.getPostingJob(f.db,a.id).status,'RUNNING');
 await f.live.handle(route(`.posting-stop ${a.id}`));await f.live.handle(route('SAH'));assert.equal(store.getPostingJob(f.db,a.id).status,'STOPPED');assert.equal(store.getPostingJob(f.db,b.id).status,'RUNNING');assert.equal(await f.live.handle(route('SAH')),false);
});
test('pause and in-flight result reach latest dashboard even while previous edit is blocked',async t=>{
 const f=fixture(t),job=f.makeJob(),wait=gate();await f.live.show('1',job.id);const old=f.live.messages.get(job.id);
 old.edit=async()=>{await wait.promise;};const work=store.claimNextCampaignWork(f.db,f.accounts[0].id,f.accounts.map(a=>a.id));
 const blocked=f.live.refresh(job.id);await later();await f.live.handle(route(`.posting-pause ${job.id}`));const current=f.live.messages.get(job.id);assert.equal(current,old);assert.equal(old.closed,false);
 store.completeCampaignWork(f.db,work,{success:true,messageId:'mock'});await f.live.refresh(job.id);assert.equal(store.getPostingJob(f.db,job.id).status,'PAUSED');
 wait.release();await blocked;assert.match(current.text,/Success : 1/);assert.match(current.text,/DIJEDA/);assert.match(current.text,/1\. Group A 0\n   ↳ ✅ Berjaya Hantar/);
});
test('manual status replies to the saved dashboard while automatic pulse only edits that dashboard',async t=>{
 const f=fixture(t),job=f.makeJob();await f.live.show('1',job.id);const count=f.sent.length,id=f.live.messages.get(job.id).messageId;
 await f.live.handle(route(`.status ${job.id}`));assert.equal(f.sent.length,count+1);assert.match(f.sent.at(-1),/INFO KEMPEN 1/);assert.match(f.sent.at(-1),/Status : Sedang Berjalan/);assert.equal(f.sendOptions.at(-1).replyToMessageId,id);assert.equal(f.live.messages.get(job.id).messageId,id);assert.equal(store.savedPostingDashboards(f.db)[0].messageId,id);
 const work=store.claimNextCampaignWork(f.db,f.accounts[0].id,f.accounts.map(a=>a.id));store.completeCampaignWork(f.db,work,{success:false,error:'Test'});f.live.pulse();await later();assert.equal(f.sent.length,count+1);assert.match(f.edits.at(-1).text,/1\. Group A 0\n   ↳ ❌ Gagal/);assert.match(f.edits.at(-1).text,/Akaun 1 · WhatsApp/);assert.equal(f.edits.at(-1).id,id);
});

test('pause, resume and confirmed stop acknowledge the current campaign without duplicating its runner',async t=>{
 const f=fixture(t),job=f.makeJob();await f.live.show('1',job.id);const id=f.live.messages.get(job.id).messageId;
 await f.live.handle(route('.posting-pause 1'));assert.match(f.sent.at(-1),/Status : Dijeda/);assert.match(f.sent.at(-1),/posting-resume 1/);assert.equal(f.sendOptions.at(-1).replyToMessageId,id);
 await f.live.handle(route('.posting-resume 1'));assert.match(f.sent.at(-1),/Status : Sedang Berjalan/);assert.equal(f.starts(),1);
 await f.live.handle(route('.posting-resume 1'));assert.equal(f.starts(),1);assert.match(f.sent.at(-1),/Status : Sedang Berjalan/);
 await f.live.handle(route('.posting-stop 1'));await f.live.handle(route('SAH'));assert.match(f.sent.at(-1),/Status : Dihentikan/);assert.equal(store.getPostingJob(f.db,job.id).status,'STOPPED');assert.equal(f.sendOptions.at(-1).replyToMessageId,id);
});

test('failed dashboard edits still return current status; removed dashboards produce one visible replacement',async t=>{
 const f=fixture(t),job=f.makeJob();await f.live.show('1',job.id);const live=f.live.messages.get(job.id),id=live.messageId;
 live.edit=async()=>{throw new Error('Simulated network failure');};await f.live.handle(route('.posting-pause 1'));
 assert.match(f.sent.at(-1),/Status : Dijeda/);assert.match(f.sent.at(-1),/belum selesai dikemas kini/);assert.equal(f.sendOptions.at(-1).replyToMessageId,id);assert.equal(store.getPostingJob(f.db,job.id).status,'PAUSED');
 live.retryAt=0;live.lastSendAt=-Infinity;live.edit=async()=>{throw new Error('message to edit not found');};const count=f.sent.length;
 await f.live.handle(route('.status 1'));assert.equal(f.sent.length,count+1);assert.match(f.sent.at(-1),/KEMPEN 1 · DIJEDA/);assert.ok(!f.sendOptions.at(-1).replyToMessageId);assert.notEqual(live.messageId,id);assert.equal(store.savedPostingDashboards(f.db)[0].messageId,live.messageId);
});
test('long dashboards and page lists keep ten results, safe text escaping and valid commands',t=>{
 const f=fixture(t),job=f.makeJob();const large={...job,displayName:'Nama <tag> & '+('a'.repeat(120)),accounts:Array.from({length:35},(_,i)=>({accountId:i+1,displayNumber:i+1,phone:'60123456789',successCount:20,failedCount:1}))};
 const recent=Array.from({length:15},(_,i)=>({groupName:'Group <tag> & '+('🌸'.repeat(100)),accountId:i+1,status:'SUCCESS',adNo:2}));
 const text=postingUi.postingJobStatusMessage(large,recent,'Menunggu giliran seterusnya : 20s');assert.equal((text.match(/↳ ✅ Berjaya Hantar/g)||[]).length,10);assert.ok(text.length<4096,text.length);
 const html=ui.formatTelegramMessage(text);assert.ok(html.includes('&lt;tag&gt;'));assert.ok(html.includes('<code>.posting-pause'));
 const accountList=postingUi.postingAccountSelectMessage({displayName:'Test'},Array.from({length:25},(_,i)=>({id:100+i,displayNumber:i+1,phone:'60123456',groupCount:10,status:'ONLINE'})),null,2);assert.match(accountList,/11\. WhatsApp/);assert.match(accountList,/20\. WhatsApp/);assert.doesNotMatch(accountList,/21\. WhatsApp/);
 for(const raw of [...text.matchAll(/↳ (\.[^\n]+?) →/g)])assert.notEqual(route(raw[1]).action,'text',raw[1]);
});

test('global worker records its result and rest without awaiting a stalled Telegram dashboard',async t=>{
 const f=fixture(t),job=f.makeJob(),wait=gate();
 const code=runtime.slice(runtime.indexOf('async function runAccountPostingWork'),runtime.indexOf('function ensurePostingScheduler'));
 const deps={followupFlow:{leave(){},handle:async()=>false},...store,databasePath:f.db,ownerId:'1',whatsapp:{list:()=>wa.listWhatsAppAccounts(f.db),get:id=>f.manager.get(id),sendPostingAd:async()=>({messageId:'simulation'})},postingLive:{refresh:()=>wait.promise},friendlyUserError:(_,fallback)=>fallback};
 const worker=new Function(...Object.keys(deps),`${code}; return runAccountPostingWork;`)(...Object.values(deps));
 const result=await worker(f.accounts[0].id,'1');assert.equal(result,true);assert.equal(store.getPostingJob(f.db,job.id).successCount,1);assert.ok(store.getPostingWorker(f.db,f.accounts[0].id).availableAt);wait.release();
});
test('existing campaign report formatter still emits Malaysia times and snapshot details',()=>{
 const start=runtime.indexOf('function formatMalaysiaDateTime'),end=runtime.indexOf('async function cleanupSentCampaign',start);
 assert.ok(start>0&&end>start);
 const build=new Function(`${runtime.slice(start,end)};return buildCampaignReportText;`)();
 const text=build({job:{id:7,displayName:'Client Uji',targetMode:'SUCCESS',targetSuccess:100,successCount:100,failedCount:2,processedCount:102,status:'COMPLETED',startedAt:'2026-09-29T01:00:00Z',completedAt:'2026-09-29T02:00:00Z'},accountStats:[],attempts:[],ads:[]});
 assert.match(text,/09\/29|29\/09\/2026/);assert.match(text,/09:00:00 am/i);assert.match(text,/MYT \/ UTC\+8/);assert.match(text,/TOTAL SUCCESS : 100/);
});

test('new command aliases and six-step settings accept only scoped choices, persist partial input and require confirmation',async t=>{
 const f=fixture(t),h=controllerHarness(f);await h.command('.mula sendiri');await h.command('Kempen Uji');await h.command('Iklan');await h.command('.button-done 1');await h.command('.iklan-siap');await h.command('.pilih-akaun');await h.command('all');await h.command('1');await h.command('20');await h.command('1');
 assert.match(f.sent.at(-1),/LANGKAH 5/);
 await h.command('.posting-setting');await h.command('60');await h.command('40');assert.match(f.sent.at(-1),/TIDAK SAH/);await h.command('120');await h.command('5');
 await h.command('.menu');await h.command('.posting-sambung');assert.equal(h.state().pendingInput.type,'posting_setting_rest');
 await h.command('5');await h.command('10');const p=store.getUnstartedPosting(f.db);assert.equal(h.state().pendingInput.type,'posting_setting_confirm');
 await h.command('YA');assert.equal(store.getPostingPlan(f.db,p.id).restMaxSec,600);assert.ok(store.getPostingPlan(f.db,p.id).review);await h.command('.posting-mula');assert.equal(store.getPostingJobForPosting(f.db,p.id).status,'RUNNING');
});
test('client selection creates one profile, asks separate campaign name and detects an existing matching name',async t=>{
 const f=fixture(t),h=controllerHarness(f);
 await h.command('.mula client');await h.command('baru');await h.command('Ahmad Printing');await h.command('Promosi September');
 let p=store.getUnstartedPosting(f.db);assert.equal(p.displayName,'Promosi September');assert.equal(p.clientName,'Ahmad Printing');assert.ok(clients.clientForPosting(join(f.dir,'clients.sqlite'),p.id));
 await h.command('.posting-batal');await h.command('SAH');
 await h.command('.mula client');await h.command('baru');await h.command('ahmad printing');assert.ok(f.sent.some(x=>/sudah wujud/i.test(x)));assert.equal(clients.listClients(join(f.dir,'clients.sqlite')).total,1);
 await h.command('1');await h.command('Kempen Kedua');p=store.getUnstartedPosting(f.db);assert.equal(p.clientName,'Ahmad Printing');assert.equal(p.displayName,'Kempen Kedua');
});
test('start requires a new review when group targets change even when the count stays equal',async t=>{
 const f=fixture(t),p=f.prepare();store.capturePostingReview(f.db,p.id);
 wa.syncWhatsAppGroups(f.db,f.accounts[0].id,[{jid:'changed-a@g.us',subject:'New A'},{jid:'changed-b@g.us',subject:'New B'}]);
 await f.live.start('1');assert.equal(store.getPostingJobForPosting(f.db,p.id),null);assert.match(f.sent.at(-1),/Sasaran Akaun–Group/);
 await f.live.start('1');assert.ok(store.getPostingJobForPosting(f.db,p.id));
});
test('display numbers start at one for current campaigns, stale controls are rejected and stop binds the real ID',async t=>{
 const f=fixture(t),old=f.makeJob();store.setPostingJobStatus(f.db,old.id,'STOPPED');const first=f.makeJob(),second=f.makeJob();
 await f.live.list('1');assert.deepEqual(f.live.view().map(j=>[j.displayNumber,j.id]),[[1,first.id],[2,second.id]]);
 await f.live.handle(route('.posting-stop 2'));store.setPostingJobStatus(f.db,first.id,'STOPPED');await f.live.handle(route('SAH'));assert.equal(store.getPostingJob(f.db,second.id).status,'STOPPED');
 const third=f.makeJob(),fourth=f.makeJob();await f.live.list('1');store.setPostingJobStatus(f.db,third.id,'STOPPED');await f.live.handle(route('.posting-pause 1'));
 assert.equal(store.getPostingJob(f.db,fourth.id).status,'RUNNING');assert.ok(f.sent.some(x=>x.includes('PILIHAN KEMPEN PERLU DISEGARKAN')));
 await f.live.handle(route('.posting-pause 1'));assert.equal(store.getPostingJob(f.db,fourth.id).status,'PAUSED');
});
test('saved dashboard survives controller restart and uses one replacement when its message was removed',async t=>{
 const f=fixture(t),job=f.makeJob();await f.live.show('1',job.id);const id=store.savedPostingDashboards(f.db)[0].messageId;f.live.close();store.recoverPostingJobs(f.db);
 const edits=[];let sent=0,missing=false;
 const live=new PostingLive({databasePath:f.db,manager:f.manager,send:async()=>({message_id:++sent+100}),edit:async(c,mid,text)=>{edits.push({mid,text});if(missing){missing=false;throw new Error('message to edit not found');}},startScheduler:()=>{},resolvePosting:()=>null,liveOptions:{interval:0}});t.after(()=>live.close());
 await live.show('1',job.id);assert.equal(sent,0);assert.equal(edits[0].mid,id);assert.match(edits[0].text,/DIJEDA/);
 missing=true;await live.show('1',job.id);assert.equal(sent,1);assert.equal(store.savedPostingDashboards(f.db)[0].messageId,101);await live.show('1',job.id);assert.equal(sent,1);
});
test('missing media pauses only its campaign; an offline failure after send is never requeued',async t=>{
 const f=fixture(t),job=f.makeJob();const sql=new DatabaseSync(f.db);sql.prepare("UPDATE posting_job_ads SET kind='PHOTO',media_path='media/missing.jpg' WHERE job_id=?").run(job.id);sql.close();
 const code=runtime.slice(runtime.indexOf('async function runAccountPostingWork'),runtime.indexOf('function ensurePostingScheduler'));
 let calls=0;const deps={followupFlow:{leave(){},handle:async()=>false},...store,...runtimeFs,join,projectRoot:f.dir,databasePath:f.db,ownerId:'1',whatsapp:{list:()=>wa.listWhatsAppAccounts(f.db),get:id=>f.manager.get(id),sendPostingAd:async()=>{calls++;}},postingLive:{refresh:()=>Promise.resolve()},friendlyUserError:(_,fallback)=>fallback};
 const run=new Function(...Object.keys(deps),`${code};return runAccountPostingWork;`)(...Object.values(deps));
 await run(f.accounts[0].id);assert.equal(calls,0);assert.equal(store.getPostingJob(f.db,job.id).status,'PAUSED');assert.equal(store.getPostingJob(f.db,job.id).failedCount,0);
 const next=f.makeJob();deps.whatsapp.sendPostingAd=async(id,jid,ad,hooks)=>{hooks.onSendStarted();wa.updateWhatsAppAccount(f.db,id,{status:'OFFLINE'});const e=new Error('Connection closed');e.sendStarted=true;throw e;};
 await run(f.accounts[0].id);const updated=store.getPostingJob(f.db,next.id);assert.equal(updated.unknownCount,1);assert.equal(updated.failedCount,0);assert.equal(updated.pendingCount,next.totalTargets-1);
});
test('media validation rejects albums and forged file bytes without consuming an ad number',async t=>{
 const f=fixture(t),h=controllerHarness(f);await h.command('.mula sendiri');await h.command('Media validation');
 await h.dispatch({action:'photo',chatId:'1',text:'Album',mediaGroupId:'album',media:{fileId:'photo',fileSize:12}});assert.match(f.sent.at(-1),/Album/);
 await h.dispatch({action:'video',chatId:'1',text:'Wrong type',media:{fileId:'photo',fileSize:12,mimeType:'video/mp4'}});assert.match(f.sent.at(-1),/tidak sepadan/);
 const p=store.getUnstartedPosting(f.db);assert.equal(store.listPostingAds(f.db,p.id).length,0);
});

test('production worker imports support first PHOTO and VIDEO sends without leaving a claimed target stuck',async t=>{
 for(const kind of ['PHOTO','VIDEO'])await t.test(kind,async t=>{
  const f=fixture(t,1),job=f.makeJob(),mediaPath=kind==='PHOTO'?'ad.jpg':'ad.mp4';fs.writeFileSync(join(f.dir,mediaPath),'simulated local media');
  const sql=new DatabaseSync(f.db);sql.prepare('UPDATE posting_job_ads SET kind=?,media_path=? WHERE job_id=?').run(kind,mediaPath,job.id);sql.close();
  const code=runtime.slice(runtime.indexOf('async function runAccountPostingWork'),runtime.indexOf('function ensurePostingScheduler'));
  let calls=0;const deps={followupFlow:{leave(){},handle:async()=>false},...store,...runtimeFs,join,projectRoot:f.dir,databasePath:f.db,ownerId:'1',postingLive:{refresh:()=>Promise.resolve()},friendlyUserError:(_,fallback)=>fallback,
   whatsapp:{list:()=>wa.listWhatsAppAccounts(f.db),get:id=>f.manager.get(id),sendPostingAd:async(id,jid,ad,hooks)=>{calls++;assert.equal(ad.kind,kind);assert.equal(ad.mediaPath,mediaPath);hooks.onSendStarted();hooks.onSendResult({key:{id:'simulated-'+kind}});return {messageId:'simulated-'+kind};}}};
  const run=new Function(...Object.keys(deps),`${code};return runAccountPostingWork;`)(...Object.values(deps));
  assert.equal(await run(f.accounts[0].id),true);assert.equal(calls,1);
  const updated=store.getPostingJob(f.db,job.id);assert.equal(updated.successCount,1);assert.equal(updated.failedCount,0);assert.equal(updated.unknownCount,0);assert.equal(updated.processingCount,0);assert.equal(updated.pendingCount,job.totalTargets-1);
 });
});

test('unexpected preflight error preserves the pending target and releases its account for another campaign',async t=>{
 const f=fixture(t,1),broken=f.makeJob(),healthy=f.makeJob();
 const code=runtime.slice(runtime.indexOf('async function runAccountPostingWork'),runtime.indexOf('function ensurePostingScheduler'));
 let calls=0;const deps={followupFlow:{leave(){},handle:async()=>false},...store,...runtimeFs,join,projectRoot:f.dir,databasePath:f.db,ownerId:'1',postingLive:{refresh:()=>Promise.resolve()},friendlyUserError:(_,fallback)=>fallback,
  getPostingJobAd:(path,id,no)=>{if(id===broken.id)throw new Error('Simulated preflight failure');return store.getPostingJobAd(path,id,no);},
  whatsapp:{list:()=>wa.listWhatsAppAccounts(f.db),get:id=>f.manager.get(id),sendPostingAd:async(id,jid,ad,hooks)=>{calls++;hooks.onSendStarted();return {messageId:'simulated-healthy'};}}};
 const run=new Function(...Object.keys(deps),`${code};return runAccountPostingWork;`)(...Object.values(deps));
 assert.equal(await run(f.accounts[0].id),true);assert.equal(calls,0);
 const paused=store.getPostingJob(f.db,broken.id);assert.equal(paused.status,'PAUSED');assert.match(paused.pauseReason,/sebelum penghantaran/);assert.equal(paused.processingCount,0);assert.equal(paused.pendingCount,broken.totalTargets);assert.equal(paused.failedCount,0);assert.equal(paused.unknownCount,0);assert.equal(paused.accounts[0].nextAdNo,1);
 await run(f.accounts[0].id);assert.equal(calls,1);assert.equal(store.getPostingJob(f.db,healthy.id).successCount,1);
});

async function clientDraft(f,h,{name='Ahmad Printing',campaign='Pakej Group',mode='1',target='3'}={}){
 await h.command('.mula client');await h.command('baru');await h.command(name);await h.command(campaign);
 await h.command('Iklan client');await h.command('.button-done 1');await h.command('.iklan-siap');await h.command('.pilih-akaun');await h.command('all');await h.command(mode);
 if(mode!=='3')await h.command(target);
 return store.getUnstartedPosting(f.db);
}
test('Client full wizard validates unique capacity, requires explicit full payment and snapshots independent invoices',async t=>{
 const f=fixture(t),h=controllerHarness(f);
 for(const a of f.accounts)wa.syncWhatsAppGroups(f.db,a.id,[{jid:'shared@g.us',subject:'Sama'},{jid:a.id+'@g.us',subject:'Sendiri '+a.id}]);
 const p=await clientDraft(f,h,{target:'4'});assert.match(f.sent.at(-1),/melebihi 3 group unik/);assert.equal(store.getPostingJobForPosting(f.db,p.id),null);
 await h.command('3');assert.match(f.sent.at(-1),/CAJ KEMPEN/);assert.equal(store.getPostingPlan(f.db,p.id).reuseMode,'UNIQUE');
 await h.command('RM20.90');assert.equal(store.getPosting(f.db,p.id).chargeCents,2090);assert.equal(store.postingPaymentState(f.db,p.id).paid,false);
 await h.command('.posting-next');assert.match(f.sent.at(-1),/3 Group WhatsApp/);assert.doesNotMatch(f.sent.at(-1),/\.posting-mula/);
 await h.command('.posting-mula');assert.equal(store.getPostingJobForPosting(f.db,p.id),null);assert.equal(f.starts(),0);
 await h.command('SAH');assert.equal(store.postingPaymentState(f.db,p.id).paid,true);assert.equal(store.getPostingJobForPosting(f.db,p.id),null);assert.match(f.sent.at(-1),/Bayaran Penuh/);
 await h.command('.posting-mula');const job=store.getPostingJobForPosting(f.db,p.id);assert.equal(job.status,'RUNNING');assert.equal(job.targetUnit,'UNIQUE_GROUPS');assert.equal(job.totalTargets,3);assert.equal(job.chargeCents,2090);assert.ok(job.paidFullAt);assert.equal(f.starts(),1);
 await h.command('.posting-mula');assert.equal(store.listPostingJobs(f.db).total,1);assert.equal(f.starts(),1);
 assert.throws(()=>store.setPostingCharge(f.db,p.id,3000),/dikunci/);
 const db=new DatabaseSync(f.db);const rows=db.prepare('SELECT account_id,group_jid FROM posting_job_targets WHERE job_id=?').all(job.id);db.close();assert.equal(new Set(rows.map(r=>r.group_jid)).size,3);
 const cp=join(f.dir,'clients.sqlite');await h.command('.client');await h.command('.client-post 1');await h.command('Kempen Hari');await h.command('Iklan 2');await h.command('.iklan-siap');await h.command('.pilih-akaun');await h.command('all');await h.command('2');await h.command('7');await h.command('45.50');await h.command('.posting-next');
 const second=store.getUnstartedPosting(f.db);assert.equal(second.chargeCents,4550);assert.equal(store.postingPaymentState(f.db,second.id).paid,false);assert.equal(store.getPostingJob(f.db,job.id).chargeCents,2090);assert.equal(clients.listClients(cp).total,1);
 await h.command('.client 1');assert.match(f.sent.at(-1),/Aktif : 1/);assert.match(f.sent.at(-1),/Draf : 1/);assert.doesNotMatch(f.sent.at(-1),/Baki|PARTIAL|Deposit/);
});
test('Client price and mode changes invalidate payment, confirmation expires, restart preserves charge draft and cannot auto start',async t=>{
 const f=fixture(t);let h=controllerHarness(f);const p=await clientDraft(f,h,{mode:'2',target:'3'});await h.command('35');await h.command('.posting-next');
 h.clientFlow.payments.get('1').expires=0;await h.command('SAH');assert.equal(store.postingPaymentState(f.db,p.id).paid,false);assert.match(f.sent.at(-1),/tamat tempoh/);
 await h.command('.posting-next');await h.command('SAH');assert.equal(store.postingPaymentState(f.db,p.id).paid,true);
 await h.command('.posting-charge');await h.command('40');assert.equal(store.postingPaymentState(f.db,p.id).paid,false);
 await h.command('.posting-next');store.setPostingDaysTarget(f.db,p.id,4);await h.command('SAH');assert.match(f.sent.at(-1),/berubah/);assert.equal(store.postingPaymentState(f.db,p.id).paid,false);
 await h.command('.posting-next');h=controllerHarness(f);await h.command('SAH');assert.equal(store.postingPaymentState(f.db,p.id).paid,false);assert.equal(f.starts(),0);
 await h.command('.posting-sambung');assert.match(f.sent.at(-1),/4 hari/);assert.match(f.sent.at(-1),/RM40.00/);await h.command('SAH');assert.ok(store.postingPaymentState(f.db,p.id).paid);assert.equal(f.starts(),0);
 await h.command('.posting-mula');const job=store.getPostingJobForPosting(f.db,p.id);assert.equal(job.targetMode,'DAYS');assert.equal(job.targetDays,4);assert.equal(job.reuseMode,'REPEAT');
 store.recoverPostingJobs(f.db);assert.equal(store.getPostingJob(f.db,job.id).status,'PAUSED');assert.ok(store.getPostingJob(f.db,job.id).paidFullAt);
});
test('Client unique SUCCESS never repeats a group, stores matching counts and preserves paid report after cleanup and deletion',async t=>{
 const f=fixture(t),h=controllerHarness(f),p=await clientDraft(f,h,{target:'4'});await h.command('20');await h.command('.posting-next');await h.command('SAH');await h.command('.posting-mula');const job=store.getPostingJobForPosting(f.db,p.id),ids=f.accounts.map(a=>a.id),seen=new Set();
 for(let i=0;i<4;i++){const w=store.claimNextCampaignWork(f.db,ids[i%2],ids,Date.now()+1000000);assert.ok(w);assert.ok(!seen.has(w.groupJid));seen.add(w.groupJid);store.markCampaignSendStarted(f.db,w);store.completeCampaignWork(f.db,w,i===0?{success:false,error:'tiada kebenaran'}:{success:true,messageId:'id-'+i});}
 const result=store.getPostingJob(f.db,job.id);assert.equal(result.status,'COMPLETED');assert.equal(result.successCount,3);assert.equal(result.failedCount,1);assert.match(result.finishReason,/SASARAN HABIS/);assert.equal(store.claimNextCampaignWork(f.db,ids[0],ids,Date.now()+1000000),null);
 const cp=join(f.dir,'clients.sqlite'),snap=store.postingReportSnapshot(f.db,job.id);assert.equal(snap.accountStats.reduce((n,a)=>n+a.successCount,0),3);clients.saveClientCampaignSnapshot(cp,snap,'report.txt');
 assert.throws(()=>store.cleanupPostingJobData(f.db,job.id),/belum/);store.markPostingReportSent(f.db,job.id,'report.txt');store.cleanupPostingJobData(f.db,job.id);store.deletePostingReportRecord(f.db,job.id);
 clients.setClientField(cp,p.clientId,'name','Nama Baru');await h.command('.client');await h.command('.client-report 1');await h.command('.client-report 1 1');assert.match(f.sent.at(-1),/Ahmad Printing/);assert.match(f.sent.at(-1),/RM20.00/);assert.match(f.sent.at(-1),/Bayaran Penuh/);assert.match(f.sent.at(-1),/SASARAN HABIS/);assert.match(f.sent.at(-1),/3 Group WhatsApp/);assert.equal(clients.clientSavedReports(cp,p.clientId).length,1);
});
test('Client profile selections paginate, reject stale numbering, edit by ID and isolate campaign list contexts',async t=>{
 const f=fixture(t),h=controllerHarness(f),cp=join(f.dir,'clients.sqlite');for(let i=1;i<=12;i++)clients.createClient(cp,'Client '+i);
 await h.command('.client-list 2');assert.match(f.sent.at(-1),/11\. Client 11/);assert.doesNotMatch(f.sent.at(-1),/^1\. /m);
 await h.command('.client-edit 11');await h.command('2');await h.command('abc');assert.match(f.sent.at(-1),/kod negara/);await h.command('60123456789');assert.equal(clients.getClient(cp,11).contact,'+60123456789');
 await h.command('.client-edit 11');await h.command('1');await h.command('Client 1');assert.match(f.sent.at(-1),/digunakan/);assert.equal(clients.getClient(cp,11).name,'Client 11');await h.command('.batal');
 clients.createClient(cp,'Tambah');await h.command('.client-post 11');assert.match(f.sent.at(-2),/BERUBAH/);assert.equal(store.getUnstartedPosting(f.db),null);
 await h.command('.client 11');await h.command('.client-post 11');await h.command('Tempahan 11');await h.command('Iklan');await h.command('.iklan-siap');await h.command('.pilih-akaun');await h.command('all');await h.command('3');await h.command('29');await h.command('.posting-next');await h.command('SAH');await h.command('.posting-mula');
 const job=store.listPostingJobs(f.db).items[0];await h.command('.client');await h.command('.client-campaigns 11');await h.command('.client-campaign 11 1');assert.equal(f.live.contexts.get('1').id,job.id);
 await h.command('.client-campaign 12 1');assert.match(f.sent.at(-1),/Tiada kempen/);assert.equal(f.live.contexts.get('1').id,job.id);
 await h.command('.posting-stop 1');await h.command('.client-new');await h.command('.batal');await h.command('SAH');assert.equal(store.getPostingJob(f.db,job.id).status,'RUNNING');
});

test('Client retained linkage finds old campaigns even when their pre-183 main profile fields are empty',async t=>{
 const f=fixture(t),h=controllerHarness(f),cp=join(f.dir,'clients.sqlite'),c=clients.createClient(cp,'Legacy Client'),job=f.makeJob();
 clients.linkClientPosting(cp,c.id,job.postingId,'Kempen Lama');const db=new DatabaseSync(f.db);db.prepare("UPDATE postings SET owner_type='CLIENT',client_id=NULL,client_name=NULL,client_flow_version=0 WHERE id=?").run(job.postingId);db.close();
 await h.command('.client');assert.match(f.sent.at(-1),/Aktif 1/);await h.command('.client-campaigns 1');await h.command('.client-campaign 1 1');assert.equal(f.live.contexts.get('1').id,job.id);assert.equal(store.getPostingJob(f.db,job.id).targetUnit,'SENDS');assert.equal(store.getPostingJob(f.db,job.id).reuseMode,'REPEAT');
});
test('Client ten-entry pages and live dashboard stay within Telegram limits with long client/campaign names',()=>{
 const rows=Array.from({length:10},(_,i)=>({id:i+1,displayNumber:i+1,name:'Pelanggan panjang '.repeat(7),counts:{active:999,ended:999,drafts:1}}));
 assert.ok(ui.formatTelegramMessage(clientsUi.clientDirectoryMessage(rows)).replace(/<[^>]*>/g,'').length<4096);
 const jobs=rows.map((r,i)=>({id:i+1,status:'COMPLETED',displayName:'Nama kempen panjang '.repeat(6),targetMode:'SUCCESS',targetSuccess:300,targetUnit:'UNIQUE_GROUPS',successCount:300,failedCount:15,unknownCount:3,chargeCents:2000,paidFullAt:'2026-09-29T10:00:00Z'}));
 assert.ok(ui.formatTelegramMessage(clientsUi.clientJobsMessage(rows[0],jobs)).replace(/<[^>]*>/g,'').length<4096);
 const job={...jobs[0],displayNumber:1,clientName:rows[0].name,remainingSuccess:0,updatedAt:'2026-09-29T10:00:00Z',ads:[{adNo:1}],accounts:[1,2].map(n=>({accountId:n,displayNumber:n,phone:'60123456789',successCount:150,failedCount:7,unknownCount:1,currentRound:1,groupDone:158,groupTotal:200,nextAdNo:1,waitSeconds:120}))};
 const recent=Array.from({length:10},(_,i)=>({groupName:'Nama group panjang '.repeat(7),status:'FAILED',accountId:i%2+1,adNo:1,completedAt:'2026-09-29T10:00:00Z',errorText:'Tiada kebenaran hantar pada group ini'}));
 assert.ok(ui.formatTelegramMessage(postingUi.postingJobStatusMessage(job,recent)).replace(/<[^>]*>/g,'').length<4096);

});

test('Client review refuses full-payment confirmation if a later sync reduces unique capacity',async t=>{
 const f=fixture(t),h=controllerHarness(f),p=await clientDraft(f,h,{target:'4'});await h.command('20');
 wa.syncWhatsAppGroups(f.db,f.accounts[1].id,[]);await h.command('.posting-next');assert.match(f.sent.at(-1),/GROUP UNIK TIDAK CUKUP/);assert.equal(h.clientFlow.payments.has('1'),false);
 assert.throws(()=>store.confirmPostingPayment(f.db,p.id,store.postingPaymentState(f.db,p.id).fingerprint),/tidak cukup/);assert.equal(store.postingPaymentState(f.db,p.id).paid,false);
});

test('failed full-payment receipt preserves the invoice and repeated SAH only resends its receipt',async t=>{
 const f=fixture(t);let failReceipt=true,attempts=0;
 const send=f.send;f.send=async(chat,text,options)=>{if(text.startsWith('✅ BAYARAN PENUH DISAHKAN')){attempts++;if(failReceipt)throw new Error('Telegram unavailable');}return send(chat,text,options);};
 const h=controllerHarness(f),p=await clientDraft(f,h);await h.command('29.90');await h.command('.posting-next');await h.command('SAH');await later();
 const paid=store.getPosting(f.db,p.id);assert.ok(paid.paidFullAt);assert.equal(store.postingPaymentState(f.db,p.id).paid,true);assert.equal(f.starts(),0);assert.equal(attempts,1);
 assert.equal(store.readPostingFlowState(f.db,'payment-receipt:1').id,p.id);assert.ok(h.clientFlow.receiptDeliveries.get('1').timer);
 failReceipt=false;await h.command('SAH');await later();assert.equal(attempts,2);assert.equal(store.getPosting(f.db,p.id).paidFullAt,paid.paidFullAt);assert.match(f.sent.at(-1),/BAYARAN PENUH DISAHKAN/);assert.match(f.sent.at(-1),/RM29.90/);assert.equal(store.getPostingJobForPosting(f.db,p.id),null);
 await h.command('.posting-mula');assert.equal(f.starts(),1);assert.equal(store.listPostingJobs(f.db).total,1);assert.equal(store.readPostingFlowState(f.db,'payment-receipt:1'),null);
});

test('a held payment receipt cannot block dispatch or create duplicate confirmations',async t=>{
 const f=fixture(t),hold=gate();let attempts=0;const send=f.send;
 f.send=async(chat,text,options)=>{if(text.startsWith('✅ BAYARAN PENUH DISAHKAN')){attempts++;await hold.promise;}return send(chat,text,options);};
 const h=controllerHarness(f),p=await clientDraft(f,h);await h.command('20');await h.command('.posting-next');
 let settled=false;const confirmation=h.command('SAH').then(()=>{settled=true;});
 try{
  await later();assert.equal(settled,true);assert.equal(attempts,1);assert.equal(store.postingPaymentState(f.db,p.id).paid,true);
  await h.command('SAH');assert.equal(attempts,1);await h.command('.pilih-akaun');assert.equal(h.state().pendingInput.type,'posting_account_input');assert.equal(h.clientFlow.receiptDeliveries.size,0);assert.equal(f.starts(),0);
 }finally{hold.release();await confirmation;await later();}
});

test('payment receipt recovers after restart but cannot confirm a changed or unpaid invoice',async t=>{
 const f=fixture(t);let fail=true;const send=f.send;f.send=async(chat,text,options)=>{if(fail&&text.startsWith('✅ BAYARAN PENUH DISAHKAN'))throw new Error('reply timeout');return send(chat,text,options);};
 let h=controllerHarness(f);const p=await clientDraft(f,h);await h.command('20');await h.command('.posting-next');await h.command('SAH');await later();const paidAt=store.getPosting(f.db,p.id).paidFullAt;
 h.clientFlow.close();fail=false;h=controllerHarness(f);await h.command('SAH');await later();assert.match(f.sent.at(-1),/BAYARAN PENUH DISAHKAN/);assert.equal(store.getPosting(f.db,p.id).paidFullAt,paidAt);assert.equal(f.starts(),0);
 // An external charge change invalidates even a receipt context saved before restart.
 store.setPostingCharge(f.db,p.id,3000);assert.equal(await h.clientFlow.handle(route('SAH')),false);assert.equal(store.postingPaymentState(f.db,p.id).paid,false);assert.equal(store.readPostingFlowState(f.db,'payment-receipt:1'),null);
 await h.command('.posting-sambung');assert.match(f.sent.at(-1),/RM30.00/);await h.command('SAH');assert.equal(store.postingPaymentState(f.db,p.id).paid,true);assert.equal(f.starts(),0);
});

test('receipt delivery retries once, without changing payment or starting the campaign',async t=>{
 const f=fixture(t);let attempts=0;const send=f.send;
 f.send=async(chat,text,options)=>{if(text.startsWith('✅ BAYARAN PENUH DISAHKAN')){attempts++;throw new Error('reply unavailable');}return send(chat,text,options);};
 const h=controllerHarness(f),p=await clientDraft(f,h);await h.command('20');await h.command('.posting-next');await h.command('SAH');await later();const paidAt=store.getPosting(f.db,p.id).paidFullAt;
 await new Promise(r=>setTimeout(r,3200));assert.equal(attempts,2);assert.equal(h.clientFlow.receiptDeliveries.get('1').timer,null);assert.equal(store.getPosting(f.db,p.id).paidFullAt,paidAt);assert.equal(f.starts(),0);
});

test('saved photo survives failed acceptance replies and resumes without requesting another upload',async t=>{
 for(const failAll of [false,true])await t.test(failAll?'all replies fail':'fallback arrives',async t=>{
  const f=fixture(t);let failing=false;const send=f.send;
  f.send=async(chat,text,options)=>{if(failing&&(failAll||!text.includes('TELAH DISIMPAN')))throw new Error('reply timeout');return send(chat,text,options);};
  const h=controllerHarness(f);await h.command('.mula sendiri');await h.command('Media recovery');failing=true;
  await h.dispatch({action:'photo',chatId:'1',text:'Caption kekal',media:{fileId:'photo',mimeType:'image/jpeg',fileSize:3}});
  const p=store.getUnstartedPosting(f.db),ads=store.listPostingAds(f.db,p.id);assert.equal(ads.length,1);assert.equal(ads[0].body,'Caption kekal');assert.ok(fs.existsSync(join(f.dir,ads[0].mediaPath)));assert.equal(h.state().pendingInput,null);
  if(!failAll){assert.match(f.sent.at(-1),/TELAH DISIMPAN/);assert.doesNotMatch(f.sent.at(-1),/Hantar semula bahan/);}
  failing=false;await h.command('.posting-sambung');await h.command('.button-add 1');await h.command('Tempah');await h.command('https://example.com/tempah');assert.equal(store.getPostingAd(f.db,p.id,1).buttons[0].label,'Tempah');assert.equal(store.listPostingAds(f.db,p.id).length,1);
 });
});

test('failed command reply does not discard later updates in the same Telegram poll batch',async()=>{
 const start=runtime.indexOf('      for (const update of updates) {'),end=runtime.indexOf('      if (updates.length) render();',start);
 assert.ok(start>0&&end>start);const seen=[],states=[];
 const execute=new Function('updates','routeTelegramUpdate','dispatch','render','friendlyUserError',`return (async()=>{let offset,ignored=0,processed=0,lastAction='',lastError='-',running=true;const abort={signal:{aborted:false}},ownerId='1';${runtime.slice(start,end)}return {offset,ignored,processed,lastAction,lastError};})();`);
 const result=await execute([{update_id:101,action:'first'},{update_id:102,action:'second'}],x=>x,async r=>{seen.push(r.action);if(r.action==='first')throw new Error('reply failure');},()=>states.push('render'),()=> 'Balasan belum dapat dihantar.');
 assert.deepEqual(seen,['first','second']);assert.equal(result.offset,103);assert.equal(result.processed,2);assert.equal(result.lastAction,'SECOND');assert.equal(result.lastError,'-');assert.equal(states.length,2);
});
