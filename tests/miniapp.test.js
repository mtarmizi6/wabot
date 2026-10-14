import test from 'node:test';import assert from 'node:assert/strict';import {createHmac} from 'node:crypto';import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {EventEmitter} from 'node:events';import {DatabaseSync} from 'node:sqlite';
import {initializeDatabase} from '../src/database/connection.js';import * as p from '../src/posting/store.js';import * as g from '../src/groupstatus/store.js';import * as w from '../src/whatsapp/store.js';import * as a from '../src/whatsapp/autojoin-store.js';import {PostingLive} from '../src/telegram/posting-live.js';import {PanelData} from '../src/miniapp/data.js';import {PanelServer} from '../src/miniapp/server.js';import {panelActions} from '../src/miniapp/actions.js';import {validateInitData} from '../src/miniapp/auth.js';import {panelUrl} from '../src/miniapp/controller.js';import {routeTelegramUpdate} from '../src/telegram/controller.js';
const token='123456:test-token-for-isolated-tests';
function signed(id='123',at=Math.floor(Date.now()/1000),t=token){const q=new URLSearchParams({auth_date:String(at),query_id:'test',user:JSON.stringify({id:Number(id),first_name:'Azam'}),signature:'test-signature'});const check=[...q].sort(([a],[b])=>a<b?-1:1).map(([k,v])=>k+'='+v).join('\n');const secret=createHmac('sha256','WebAppData').update(t).digest();q.set('hash',createHmac('sha256',secret).update(check).digest('hex'));return q.toString();}
function fixture(t){const root=mkdtempSync(join(tmpdir(),'panel-')),db=join(root,'db');initializeDatabase(db);const manager=new EventEmitter();manager.groupSyncs=new Map();manager.get=id=>w.getWhatsAppAccount(db,id);for(let i=1;i<=3;i++){const x=w.createWhatsAppAccount(db,{phone:'6012345678'+i});w.updateWhatsAppAccount(db,x.id,{status:'ONLINE',lastConnectedAt:new Date().toISOString()});w.syncWhatsAppGroups(db,x.id,[{jid:'same@g.us',subject:'Group '+i}]);}let starts=0;const live=new PostingLive({databasePath:db,manager,send:async()=>({message_id:1}),edit:async()=>{},startScheduler:()=>starts++,resolvePosting:()=>null,liveOptions:{interval:0}});const data=new PanelData({databasePath:db,clientsDbPath:join(root,'clients'),manager,postingLive:live,system:()=>({maintenance:{usage:async()=>({total:10,free:100,sizes:{media:5}})}})});const act=panelActions({databasePath:db,projectRoot:root,manager,postingLive:live,joinRunner:{ensure:()=>starts++},joinFlow:{updateLive:async()=>{}},gsRunners:new Map(),beginGsRunner:()=>starts++,gsRefresh:async()=>{},gsReport:async()=>{},ownerId:'123'});const post=()=>{const q=p.createPosting(db,{ownerType:'SENDIRI',displayName:'Promosi'});p.createPostingAd(db,q.id,{kind:'TEXT',body:'Hi'});p.markPostingReady(db,q.id);p.savePostingPlanAccounts(db,q.id,w.listWhatsAppAccounts(db));p.setPostingSuccessTarget(db,q.id,10);const j=p.createPostingJob(db,q.id);p.setPostingJobStatus(db,j.id,'RUNNING');return j;};const gs=()=>{const j=g.createGsJob(db);g.setGsAccounts(db,j.id,[1,2,3]);g.setGsContent(db,j.id,{kind:'TEXT',body:'Status contoh'});g.prepareGsTargets(db,j.id);g.setGsStatus(db,j.id,'RUNNING');return j;};t.after(()=>{data.close();live.close();rmSync(root,{recursive:true,force:true});});return {root,db,manager,data,act,post,gs,starts:()=>starts};}
test('Mini App validates signed Telegram identity, expiry, tampering and installation token',()=>{assert.equal(validateInitData(signed(),token,'123').id,'123');assert.throws(()=>validateInitData(signed('124'),token,'123'));assert.throws(()=>validateInitData(signed('123',1),token,'123'));assert.throws(()=>validateInitData(signed('123',Math.floor(Date.now()/1000)+200),token,'123'));assert.throws(()=>validateInitData(signed(),token+'x','123'));assert.throws(()=>validateInitData(signed()+'&auth_date=123',token,'123'));assert.throws(()=>validateInitData(signed().replace('Azam','Other'),token,'123'));});
test('Mini App HTTPS config and owner-only bot commands',()=>{assert.equal(panelUrl('https://example.com'),'https://example.com');for(const x of ['http://example.com','https://u:p@example.com','https://example.com/?token=abc','https://example.com/a'])assert.throws(()=>panelUrl(x));const u=text=>({message:{chat:{id:123,type:'private'},from:{id:123},text}});for(const [cmd,action]of [['.panel','panel'],['.panel-quick','panel_quick'],['.panel-url https://example.com','panel_url']])assert.equal(routeTelegramUpdate(u(cmd),'123').action,action);assert.notEqual(routeTelegramUpdate(u('.panel'),'124').action,'panel');});
test('read model returns real three-account jobs, unique/access groups, records and storage',async t=>{const f=fixture(t),post=f.post(),gs=f.gs();const o=f.data.overview();assert.equal(o.active,2);assert.equal(o.groups.uniqueCount,1);assert.equal(o.groups.accessCount,3);assert.equal(f.data.jobs().total,2);for(const key of ['post:'+post.id,'gs:'+gs.id]){const j=f.data.detail(key);assert.equal(j.accounts.length,3);assert.equal(j.status,'RUNNING');assert.equal(f.data.records(key).total,key.startsWith('gs')?3:0);}assert.equal(f.data.groups().items.length,3);assert.deepEqual((await f.data.health()).categories,{media:5});assert.equal(f.starts(),0);});
test('shared controls target one immutable typed ID and preserve other campaigns',t=>{const f=fixture(t),one=f.post(),two=f.post(),gs=f.gs();const key='post:'+one.id;f.act(f.data.detail(key),'pause');assert.equal(p.getPostingJob(f.db,one.id).status,'PAUSED');assert.equal(p.getPostingJob(f.db,two.id).status,'RUNNING');assert.equal(g.getGsJob(f.db,gs.id).status,'RUNNING');f.act(f.data.detail(key),'resume');assert.equal(p.getPostingJob(f.db,one.id).status,'RUNNING');f.act(f.data.detail('gs:'+gs.id),'pause');assert.equal(p.getPostingJob(f.db,one.id).status,'RUNNING');f.act(f.data.detail(key),'stop');assert.equal(f.data.jobs({scope:'records'}).total,1);assert.equal(f.data.detail(key).actions.length,0);});
test('HTTP rejects other owner/origin, binds stop confirmation, blocks stale/repeated mutation and keeps assets public',async t=>{const f=fixture(t),one=f.post(),two=f.post();writeFileSync(join(f.root,'index.html'),'public shell');const s=new PanelServer({root:f.root,data:f.data,act:f.act,ownerId:'123',token,origin:'https://example.com',port:0});const address=await s.start();t.after(()=>s.close());const base='http://127.0.0.1:'+address.port;const call=(path,body,auth=signed(),origin='https://example.com')=>fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{Authorization:'tma '+auth,Origin:origin,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert.equal((await fetch(base+'/')).status,200);assert.equal((await fetch(base+'/api/overview')).status,401);assert.equal((await call('overview',null,signed('124'))).status,401);assert.equal((await call('overview',null,signed(),'https://evil.test')).status,403);assert.equal((await call('overview')).status,200);const c=await (await call('confirm',{key:'post:'+one.id})).json();const body={key:'post:'+two.id,action:'stop',expectedStatus:'RUNNING',confirmation:c.nonce,requestId:'idempotent-request-001'};assert.equal((await call('action',body)).status,400);body.key='post:'+one.id;assert.equal((await call('action',body)).status,200);assert.equal((await call('action',body)).status,200);assert.equal(p.getPostingJob(f.db,two.id).status,'RUNNING');assert.equal((await call('action',{...body,requestId:'idempotent-request-002'})).status,400);});
test('Auto Join three-account read model, pause/resume and offline guard retain targets and wait times',t=>{const f=fixture(t);const j=a.createAutoJoinJob(f.db);a.setAutoJoinDraftAccounts(f.db,j.id,[1,2,3]);a.setAutoJoinDistribution(f.db,j.id,'ROUND_ROBIN');a.addAutoJoinLinks(f.db,j.id,Array.from({length:9},(_,i)=>'https://chat.whatsapp.com/InviteCode'+String(i).padStart(12,'0')).join('\n'));a.setAutoJoinDraftStage(f.db,j.id,'FINAL');a.setAutoJoinJobStatus(f.db,j.id,'RUNNING');const key='join:'+j.id;let d=f.data.detail(key);assert.equal(d.accounts.length,3);assert.equal(d.total,9);assert.equal(f.data.records(key).total,9);const db=new DatabaseSync(f.db),wait=new Date(Date.now()+300000).toISOString();db.prepare('UPDATE auto_join_job_accounts SET available_at=? WHERE job_id=? AND account_id=2').run(wait,j.id);db.close();f.act(d,'pause');assert.equal(f.data.detail(key).status,'PAUSED');f.act(f.data.detail(key),'resume');assert.equal(f.data.detail(key).accounts.find(x=>x.id===2).waitUntil,wait);f.act(f.data.detail(key),'stop');assert.ok(f.data.detail(key).actions.includes('resume'));for(const x of [1,2,3])w.updateWhatsAppAccount(f.db,x,{status:'OFFLINE'});assert.throws(()=>f.act(f.data.detail(key),'resume'),/ONLINE/);assert.equal(a.getAutoJoinJob(f.db,j.id).status,'STOPPED');assert.equal(f.data.detail(key).pending,9);});
test('client filters use true IDs despite equal display names and independently numbered module IDs',t=>{const f=fixture(t),one=f.post(),two=f.post();f.gs();const db=new DatabaseSync(f.db);db.prepare("UPDATE postings SET owner_type='CLIENT',client_id=7,client_name='Nama Sama' WHERE id=?").run(one.postingId);db.prepare("UPDATE postings SET owner_type='CLIENT',client_id=8,client_name='Nama Sama' WHERE id=?").run(two.postingId);db.close();const rows=f.data.jobs({client:'7',owner:'client'}).items;assert.equal(rows.length,1);assert.equal(rows[0].key,'post:'+one.id);assert.equal(f.data.jobs({owner:'self'}).items[0].kind,'gs');assert.throws(()=>f.data.detail('../config/settings.json'));});
test('public panel assets never include project settings and stop must have confirmation',async t=>{const f=fixture(t),j=f.post();writeFileSync(join(f.root,'secret.json'),'{"token":"hidden"}');const s=new PanelServer({root:f.root,data:f.data,act:f.act,ownerId:'123',token,port:0});const address=await s.start();t.after(()=>s.close());const base='http://127.0.0.1:'+address.port;assert.equal((await fetch(base+'/secret.json')).status,404);const r=await fetch(base+'/api/action',{method:'POST',headers:{Authorization:'tma '+signed(),'Content-Type':'application/json'},body:JSON.stringify({key:'post:'+j.id,action:'stop',expectedStatus:'RUNNING',requestId:'no-confirmation-001'})});assert.equal(r.status,400);assert.equal(p.getPostingJob(f.db,j.id).status,'RUNNING');});

test('record deletion protects active jobs, pending reports and in-flight results',t=>{
 const f=fixture(t),j=f.gs(),key='gs:'+j.id;
 assert.throws(()=>f.act(f.data.detail(key),'delete'),/Hentikan/);
 g.setGsStatus(f.db,j.id,'STOPPED');assert.equal(f.data.detail(key).deletion.allowed,false);
 assert.throws(()=>f.act(f.data.detail(key),'delete'),/Laporan/);
 const db=new DatabaseSync(f.db);db.prepare('INSERT INTO system_gs_report_outbox(id,sent) VALUES(?,1)').run(j.id);
 assert.equal(f.data.detail(key).deletion.allowed,true);
 db.prepare("UPDATE group_status_targets SET status='IN_FLIGHT' WHERE job_id=? AND account_id=1").run(j.id);
 assert.equal(f.data.detail(key).deletion.allowed,false);assert.throws(()=>f.act(f.data.detail(key),'delete'),/Operasi/);
 db.prepare("UPDATE group_status_targets SET status='PENDING' WHERE job_id=?").run(j.id);
 db.close();f.act(f.data.detail(key),'delete');assert.equal(g.getGsJob(f.db,j.id),null);assert.equal(w.listWhatsAppAccounts(f.db).length,3);
});
test('post deletion requires sent report and completed cleanup, preserves another posting',t=>{
 const f=fixture(t),one=f.post(),other=f.post(),key='post:'+one.id;
 p.setPostingJobStatus(f.db,one.id,'STOPPED');assert.match(f.data.detail(key).deletion.reason,/Laporan/);
 const db=new DatabaseSync(f.db);db.prepare("UPDATE posting_jobs SET report_status='SENT' WHERE id=?").run(one.id);
 assert.match(f.data.detail(key).deletion.reason,/Cleanup/);
 db.prepare('UPDATE posting_jobs SET cleanup_at=? WHERE id=?').run(new Date().toISOString(),one.id);db.close();
 f.act(f.data.detail(key),'delete');assert.equal(p.getPostingJob(f.db,one.id),null);assert.equal(p.getPostingJob(f.db,other.id).status,'RUNNING');
});
test('HTTP delete confirmation binds action, job and current preview, retry is idempotent',async t=>{
 const f=fixture(t),j=f.gs(),key='gs:'+j.id;
 const server=new PanelServer({root:f.root,data:f.data,act:f.act,ownerId:'123',token,port:0});const addr=await server.start();t.after(()=>server.close());
 const call=(path,body,id='123')=>fetch('http://127.0.0.1:'+addr.port+'/api/'+path,{method:'POST',headers:{Authorization:'tma '+signed(id),'Content-Type':'application/json'},body:JSON.stringify(body)});
 const stop=await (await call('confirm',{key})).json();g.setGsStatus(f.db,j.id,'STOPPED');
 const db=new DatabaseSync(f.db);db.prepare('INSERT INTO system_gs_report_outbox(id,sent) VALUES(?,1)').run(j.id);
 const body={key,action:'delete',expectedStatus:'STOPPED',requestId:'delete-request-001',confirmation:stop.nonce};
 assert.equal((await call('action',body)).status,400);
 const preview=await (await call('confirm',{key,action:'delete'})).json();assert.equal(preview.pending,3);body.confirmation=preview.nonce;
 assert.equal((await call('action',body,'124')).status,401);
 db.prepare("UPDATE group_status_targets SET status='SKIPPED' WHERE job_id=? AND account_id=1").run(j.id);
 assert.equal((await call('action',body)).status,400);assert.ok(g.getGsJob(f.db,j.id));
 body.confirmation=(await (await call('confirm',{key,action:'delete'})).json()).nonce;
 assert.equal((await call('action',body)).status,200);assert.equal((await call('action',body)).status,200);
 assert.equal(g.getGsJob(f.db,j.id),null);assert.equal(db.prepare('SELECT count(*) n FROM system_gs_report_outbox WHERE id=?').get(j.id).n,0);db.close();
});
test('Auto Join record deletion preserves WhatsApp membership and installed accounts',t=>{
 const f=fixture(t),j=a.createAutoJoinJob(f.db);a.setAutoJoinDraftAccounts(f.db,j.id,[1]);a.addAutoJoinLinks(f.db,j.id,'https://chat.whatsapp.com/InviteCode000000000001');
 a.setAutoJoinJobStatus(f.db,j.id,'STOPPED');const key='join:'+j.id,d=f.data.detail(key);assert.equal(d.deletion.allowed,true);assert.equal(d.deletion.pending,1);
 f.act(d,'delete');assert.equal(a.getAutoJoinJob(f.db,j.id),null);assert.equal(f.data.overview().groups.accessCount,3);assert.equal(w.listWhatsAppAccounts(f.db).length,3);
});

test('WAITING Auto Post exposes the same resume/stop controls as bot, not a misleading pause',t=>{
 const f=fixture(t),j=f.post();p.setPostingJobStatus(f.db,j.id,'WAITING');const key='post:'+j.id;
 assert.deepEqual(f.data.detail(key).actions,['resume','stop']);f.act(f.data.detail(key),'resume');assert.equal(p.getPostingJob(f.db,j.id).status,'RUNNING');
});
test('HTTP controls commit correct module IDs and late results remain attached to stopped job',async t=>{
 const f=fixture(t),post=f.post(),gs=f.gs(),aj=a.createAutoJoinJob(f.db);
 a.setAutoJoinDraftAccounts(f.db,aj.id,[1]);a.addAutoJoinLinks(f.db,aj.id,'https://chat.whatsapp.com/InviteCode000000000001\nhttps://chat.whatsapp.com/InviteCode000000000002');a.setAutoJoinJobStatus(f.db,aj.id,'RUNNING');
 const s=new PanelServer({root:f.root,data:f.data,act:f.act,ownerId:'123',token,port:0});const addr=await s.start();t.after(()=>s.close());let seq=0;
 const call=async(path,body)=>{const r=await fetch('http://127.0.0.1:'+addr.port+'/api/'+path,{method:'POST',headers:{Authorization:'tma '+signed(),'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,...await r.json()};};
 for(const key of ['post:'+post.id,'gs:'+gs.id,'join:'+aj.id]){
  const before=f.data.detail(key);const body={key,action:'pause',expectedStatus:'RUNNING',requestId:'test-controls-'+String(++seq).padStart(6,'0')};
  assert.equal((await call('action',body)).job.status,'PAUSED');assert.equal((await call('action',body)).job.status,'PAUSED');
  assert.equal((await call('action',{...body,requestId:'test-controls-'+String(++seq).padStart(6,'0')})).status,400);
  assert.equal((await call('action',{...body,action:'resume',expectedStatus:'PAUSED',requestId:'test-controls-'+String(++seq).padStart(6,'0')})).job.status,'RUNNING');
  assert.equal(f.data.detail(key).processed,before.processed);
 }
 const work=a.claimNextAutoJoinTarget(f.db,aj.id,1);assert.ok(work);a.markAutoJoinDispatched(f.db,work.id);
 const key='join:'+aj.id,preview=await call('confirm',{key});assert.equal(preview.inFlight,1);
 const stopped=await call('action',{key,action:'stop',expectedStatus:'RUNNING',requestId:'test-controls-stop-join',confirmation:preview.nonce});assert.equal(stopped.job.status,'STOPPED');
 assert.equal(a.claimNextAutoJoinTarget(f.db,aj.id,1),null);assert.equal(stopped.job.deletion.allowed,false);
 a.completeAutoJoinTarget(f.db,work.id,{status:'SUCCESS',groupName:'Late result',schedule:true});
 assert.equal(f.data.detail(key).success,1);assert.equal(f.data.detail(key).pending,1);assert.equal(f.data.detail(key).status,'STOPPED');
 assert.equal(f.data.detail('post:'+post.id).status,'RUNNING');assert.equal(f.data.detail('gs:'+gs.id).status,'RUNNING');
});
test('pause and resume preserve shared posting wait; paused/stopped jobs cannot claim new work',t=>{
 const f=fixture(t),j=f.post(),key='post:'+j.id;const wait=p.setPostingWorkerWait(f.db,1,300,{kind:'REST'});
 f.act(f.data.detail(key),'pause');assert.equal(p.claimNextCampaignWork(f.db,1,[1]),null);
 f.act(f.data.detail(key),'resume');assert.equal(p.getPostingWorker(f.db,1).availableAt,wait);assert.equal(p.claimNextCampaignWork(f.db,1,[1]),null);
 f.act(f.data.detail(key),'stop');assert.equal(p.claimNextCampaignWork(f.db,1,[1],Date.now()+600000),null);
});
test('expired confirmation and completed jobs reject actions without changing counts',async t=>{
 const f=fixture(t),j=f.gs(),key='gs:'+j.id;const s=new PanelServer({root:f.root,data:f.data,act:f.act,ownerId:'123',token,port:0});const addr=await s.start();t.after(()=>s.close());
 const call=(path,body)=>fetch('http://127.0.0.1:'+addr.port+'/api/'+path,{method:'POST',headers:{Authorization:'tma '+signed(),'Content-Type':'application/json'},body:JSON.stringify(body)});
 const c=await(await call('confirm',{key})).json();s.confirmations.get(c.nonce).expires=0;
 assert.equal((await call('action',{key,action:'stop',expectedStatus:'RUNNING',requestId:'expired-confirmation-001',confirmation:c.nonce})).status,400);assert.equal(g.getGsJob(f.db,j.id).status,'RUNNING');
 g.setGsStatus(f.db,j.id,'COMPLETED');assert.equal((await call('action',{key,action:'resume',expectedStatus:'COMPLETED',requestId:'completed-resume-001'})).status,400);assert.equal(f.data.detail(key).success,0);
});
test('real Auto Join runner obeys panel pause/resume/stop and retains delay after a result',async t=>{
 const {AutoJoinRunner}=await import('../src/whatsapp/autojoin-runner.js');const f=fixture(t),j=a.createAutoJoinJob(f.db);
 a.setAutoJoinDraftAccounts(f.db,j.id,[1]);a.addAutoJoinLinks(f.db,j.id,'https://chat.whatsapp.com/InviteCode000000000001\nhttps://chat.whatsapp.com/InviteCode000000000002');a.setAutoJoinJobStatus(f.db,j.id,'RUNNING');
 let sent=0;f.manager.joinGroupInvite=async(id,code,{beforeSend})=>{assert.equal(beforeSend(),true);sent++;return {status:'SUCCESS',groupName:'Group ujian'};};
 const runner=new AutoJoinRunner({databasePath:f.db,manager:f.manager});t.after(()=>runner.close());const key='join:'+j.id;
 f.act(f.data.detail(key),'pause');await runner.tick();assert.equal(sent,0);
 f.act(f.data.detail(key),'resume');await runner.tick();assert.equal(sent,1);assert.equal(f.data.detail(key).success,1);
 const wait=f.data.detail(key).accounts[0].waitUntil;assert.ok(Date.parse(wait)>Date.now());
 f.act(f.data.detail(key),'pause');f.act(f.data.detail(key),'resume');assert.equal(f.data.detail(key).accounts[0].waitUntil,wait);await runner.tick();assert.equal(sent,1);
 f.act(f.data.detail(key),'stop');await runner.tick();assert.equal(sent,1);assert.equal(f.data.detail(key).pending,1);
});
