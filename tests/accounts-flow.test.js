import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initializeDatabase } from '../src/database/connection.js';
import { WhatsAppManager, normalizePhone } from '../src/whatsapp/manager.js';
import { createWhatsAppAccount, updateWhatsAppAccount, deleteWhatsAppAccount, getWhatsAppAccount, listWhatsAppAccounts, listAllWhatsAppAccounts, syncWhatsAppGroups, listWhatsAppGroups, accountDependencies } from '../src/whatsapp/store.js';
import { AccountsFlow } from '../src/telegram/accounts-flow.js';
import { whatsappMessage } from '../src/telegram/accounts-ui.js';
import { formatTelegramMessage, routeTelegramUpdate } from '../src/telegram/controller.js';
import { createPosting, savePostingPlanAccounts, getPostingPlan, createPostingJob } from '../src/posting/store.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
async function settle() { for (let i=0;i<8;i++) await tick(); }
function fixture(t) {
  const dir=mkdtempSync(join(tmpdir(),'wap-accounts-'));
  const db=join(dir,'app.sqlite'), sessions=join(dir,'sessions');
  initializeDatabase(db);
  const manager=new WhatsAppManager({databasePath:db,sessionsPath:sessions});
  manager.on('error',()=>{});
  t.after(async()=>{await manager.stop();rmSync(dir,{recursive:true,force:true});});
  const sockets=[], sent=[], photos=[], removed=[];
  manager.library={
    default:()=>{const socket={ev:new EventEmitter(),user:null,end(){},requestPairingCode:async()=> 'ABCD1234'};sockets.push(socket);return socket;},
    useMultiFileAuthState:async path=>{
      mkdirSync(path,{recursive:true});writeFileSync(join(path,'creds.json'),'NEW TEST AUTH');
      return {state:{creds:{registered:false}},saveCreds:async()=>{}};
    },
    fetchLatestBaileysVersion:async()=>({version:[2,3000,1]}),DisconnectReason:{loggedOut:401,badSession:500}
  };
  const clock={value:1000};
  const flow=new AccountsFlow({manager,databasePath:db,now:()=>clock.value,
    send:async(chat,text)=>{sent.push(text);return {message_id:sent.length};},
    photo:async(chat,qr,caption,id)=>{photos.push({qr,id,caption});return {message_id:id||100};},
    removeMessage:async(chat,id)=>{removed.push(id);}
  });
  const command=async text=>{const route=routeTelegramUpdate({message:{from:{id:7},chat:{id:7,type:'private'},text}},'7');return flow.handle(route);};
  const account=(phone,status='OFFLINE')=>{
    const a=createWhatsAppAccount(db,{phone});
    return updateWhatsAppAccount(db,a.id,{status,lastConnectedAt:new Date().toISOString()});
  };
  return {dir,db,sessions,manager,sockets,sent,photos,removed,flow,clock,command,account};
}
function job(db,accountId,status='PAUSED') {
  const sql=new DatabaseSync(db), now=new Date().toISOString();
  const posting=sql.prepare("INSERT INTO postings(owner_type,display_name,status,created_at,updated_at) VALUES ('SENDIRI','Test','READY',?,?)").run(now,now).lastInsertRowid;
  const id=sql.prepare('INSERT INTO posting_jobs(posting_id,status,target_success,created_at,updated_at) VALUES (?,?,1,?,?)').run(posting,status,now,now).lastInsertRowid;
  sql.prepare("INSERT INTO posting_job_accounts(job_id,account_id,account_label,position) VALUES (?,?,'Historical Account',1)").run(id,accountId);
  sql.close();return Number(id);
}

test('Account pages use continuous display numbers, mask phones, and keep numbered commands selectable',t=>{
  const f=fixture(t);for(let i=0;i<12;i++)f.account('60120000'+String(i).padStart(3,'0'));
  deleteWhatsAppAccount(f.db,2);
  const list=listWhatsAppAccounts(f.db);
  assert.deepEqual(list.map(a=>a.displayNumber),Array.from({length:11},(_,i)=>i+1));
  assert.equal(list[1].id,3);
  const page=whatsappMessage(list,2);
  assert.match(page,/11\. WhatsApp/);assert.doesNotMatch(page,/60120000/);
  assert.match(page,/\.accounts 1/);
  assert.match(formatTelegramMessage(page),/<code>\.account 11<\/code>/);
});

test('Pairing requires method, valid phone and YA; cancellation removes only the pending attempt',async t=>{
  const f=fixture(t), old=f.account('60111111111');
  await f.command('.login');await f.command('1');await f.command('invalid');
  assert.equal(f.flow.state.step,'PHONE');
  await f.command('+60 12-345 6789');assert.equal(f.flow.state.step,'REVIEW');
  assert.equal(listAllWhatsAppAccounts(f.db).length,1);
  await f.command('no');assert.equal(listAllWhatsAppAccounts(f.db).length,1);
  await f.command('YA');await settle();
  const pending=f.manager.loginAttempt.id, socket=f.sockets.at(-1);
  await f.command('.login');assert.equal(listAllWhatsAppAccounts(f.db).length,2);
  await f.command('.batal');await settle();
  assert.equal(getWhatsAppAccount(f.db,pending),null);
  assert.ok(getWhatsAppAccount(f.db,old.id));
  socket.user={id:'60123456789@s.whatsapp.net'};socket.ev.emit('connection.update',{connection:'open'});await settle();
  assert.equal(listWhatsAppAccounts(f.db).length,1);
});

test('Duplicate input and unsupported phone characters do not create a second account',async t=>{
  const f=fixture(t);f.account('60123456789');
  await f.command('.login');await f.command('1');await f.command('60123456789');
  assert.equal(f.flow.state.step,'PHONE');assert.equal(listAllWhatsAppAccounts(f.db).length,1);
  assert.match(f.sent.at(-1),/sudah didaftarkan/);
  assert.throws(()=>normalizePhone('text60123456789'));
  assert.throws(()=>normalizePhone('0123456789'));
});

test('QR refresh edits the same message; failed Telegram notification cannot undo ONLINE',async t=>{
  const f=fixture(t);
  await f.command('.login');await f.command('2');await settle();
  const socket=f.sockets.at(-1);
  socket.ev.emit('connection.update',{qr:'FIRST'});await settle();
  socket.ev.emit('connection.update',{qr:'SECOND'});await settle();
  assert.deepEqual(f.photos.map(x=>x.id),[undefined,100]);
  f.flow.send=async()=>{throw new Error('Telegram disconnected');};
  socket.user={id:'60123456789@s.whatsapp.net'};socket.ev.emit('connection.update',{connection:'open'});await settle();
  assert.equal(f.manager.list().length,1);assert.equal(f.manager.list()[0].status,'ONLINE');
  assert.equal(f.manager.loginAttempt,null);assert.equal(f.flow.state,null);
  assert.ok(f.removed.includes(100));
});

test('QR duplicate is rejected without disconnecting the established account',async t=>{
  const f=fixture(t), original=f.account('60123456789','ONLINE');
  await f.manager.createQr();const pending=f.manager.loginAttempt.id;
  const socket=f.sockets.at(-1);socket.user={id:'60123456789@s.whatsapp.net'};
  socket.ev.emit('connection.update',{connection:'open'});await settle();
  assert.equal(getWhatsAppAccount(f.db,pending),null);
  assert.equal(getWhatsAppAccount(f.db,original.id).status,'ONLINE');
});

test('Re-login rejects another phone and preserves original auth, groups and internal identity',async t=>{
  const f=fixture(t), original=f.account('60123456789','LOGGED_OUT');
  const oldPath=join(f.sessions,original.authDir);mkdirSync(oldPath,{recursive:true});writeFileSync(join(oldPath,'creds.json'),'ORIGINAL TEST AUTH');
  syncWhatsAppGroups(f.db,original.id,[{jid:'one@g.us',subject:'Keep group'}]);
  await assert.rejects(f.manager.replacePairing(original.id,'60999999999'),/nombor asal/);
  await f.manager.replaceQr(original.id);
  const socket=f.sockets.at(-1);socket.user={id:'60999999999@s.whatsapp.net'};
  socket.ev.emit('connection.update',{connection:'open'});await settle();
  const a=f.manager.get(original.id);
  assert.equal(a.phone,original.phone);assert.equal(a.authDir,original.authDir);assert.equal(a.status,'LOGGED_OUT');
  assert.equal(a.groupCount,1);assert.equal(readFileSync(join(oldPath,'creds.json'),'utf8'),'ORIGINAL TEST AUTH');
});

test('Successful same-number re-login promotes new auth while preserving group ownership and ID',async t=>{
  const f=fixture(t), original=f.account('60123456789','LOGGED_OUT');
  mkdirSync(join(f.sessions,original.authDir),{recursive:true});writeFileSync(join(f.sessions,original.authDir,'creds.json'),'OLD AUTH');
  syncWhatsAppGroups(f.db,original.id,[{jid:'one@g.us',subject:'Owned group'}]);
  await f.manager.replaceQr(original.id);
  const socket=f.sockets.at(-1);socket.user={id:'60123456789@s.whatsapp.net'};
  socket.ev.emit('connection.update',{connection:'open'});await settle();
  const a=f.manager.get(original.id);
  assert.equal(a.id,original.id);assert.equal(a.status,'ONLINE');assert.equal(a.groupCount,1);
  assert.notEqual(a.authDir,original.authDir);assert.ok(existsSync(join(f.sessions,a.authDir,'creds.json')));
  assert.equal(existsSync(join(f.sessions,original.authDir)),false);
});

test('Stale account selection, expired confirmation and repeated SAH never delete another identity',async t=>{
  const f=fixture(t), one=f.account('60111111111'),two=f.account('60222222222');
  await f.command('.accounts');await f.command('.account-delete 2');
  deleteWhatsAppAccount(f.db,one.id);
  await f.command('SAH');assert.ok(f.manager.get(two.id));assert.equal(f.flow.state,null);
  await f.command('.account-delete 1');f.clock.value+=180001;
  await f.command('SAH');assert.ok(f.manager.get(two.id));
  await f.command('.account-delete 1');await f.command('SAH');assert.equal(f.manager.get(two.id),null);
  const third=f.account('60333333333');await f.command('SAH');assert.ok(f.manager.get(third.id));
});

test('Paused campaigns prevent logout and delete; completed report snapshots survive deletion',async t=>{
  const f=fixture(t), a=f.account('60111111111'),b=f.account('60222222222');
  const id=job(f.db,a.id);
  assert.equal(accountDependencies(f.db,a.id).length,1);
  await assert.rejects(f.manager.logout(a.id),/masih digunakan/);
  await assert.rejects(f.manager.delete(a.id),/masih digunakan/);
  const sql=new DatabaseSync(f.db);sql.prepare("UPDATE posting_jobs SET status='COMPLETED' WHERE id=?").run(id);sql.close();
  syncWhatsAppGroups(f.db,a.id,[{jid:'shared@g.us',subject:'Group A'}]);
  syncWhatsAppGroups(f.db,b.id,[{jid:'shared@g.us',subject:'Group B'}]);
  await f.manager.delete(a.id);
  assert.equal(listWhatsAppGroups(f.db,b.id).total,1);assert.equal(f.manager.get(b.id).displayNumber,1);
  const check=new DatabaseSync(f.db);
  assert.equal(check.prepare('SELECT account_id FROM posting_job_accounts WHERE job_id=?').get(id).account_id,a.id);
  assert.ok(check.prepare('SELECT deleted_at FROM whatsapp_accounts WHERE id=?').get(a.id).deleted_at);check.close();
});

test('Disconnect during group staging keeps the last complete group snapshot',async t=>{
  const f=fixture(t), a=f.account('60111111111','ONLINE');
  syncWhatsAppGroups(f.db,a.id,[{jid:'previous@g.us',subject:'Previous'}]);
  f.manager.sockets.set(a.id,{socket:{groupFetchAllParticipating:async()=>{
    updateWhatsAppAccount(f.db,a.id,{status:'OFFLINE'});return {'new@g.us':{id:'new@g.us',subject:'New'}};
  }}});
  await assert.rejects(f.manager.syncGroups(a.id),/senarai group sebelumnya/);
  assert.equal(listWhatsAppGroups(f.db,a.id).items[0].jid,'previous@g.us');
});

test('Display numbers map to immutable IDs consistently across group, join, posting and status selectors',async t=>{
  const f=fixture(t);const first=f.account('60111111111'),second=f.account('60222222222'),third=f.account('60333333333');
  deleteWhatsAppAccount(f.db,first.id);await f.command('.accounts');
  for (const action of ['join_select','group_account','group_info','group_sync','gs_groups','gs_retry_account']) {
    assert.equal(f.flow.mapRoute({action,args:['1','5']}).args[0],String(second.id));
  }
  assert.equal(f.flow.mapRoute({action:'posting_account_choose',args:['1,2']}).args[0],`${second.id},${third.id}`);
  assert.equal(f.flow.mapRoute({action:'gs_target',args:['1:72,2:9']}).args[0],`${second.id}:72,${third.id}:9`);
  assert.equal(f.flow.mapRoute({action:'posting_status',args:['1']}).args[0],'1');
  deleteWhatsAppAccount(f.db,second.id);
  assert.throws(()=>f.flow.mapRoute({action:'group_account',args:['1']}),/Senarai akaun/);
});

test('Deleting a draft account requires explicit account reselection before it can run',t=>{
  const f=fixture(t),a=f.account('60111111111','ONLINE'),b=f.account('60222222222','ONLINE');
  const posting=createPosting(f.db,{ownerType:'SENDIRI',displayName:'Draft'});
  savePostingPlanAccounts(f.db,posting.id,[a,b]);
  deleteWhatsAppAccount(f.db,a.id);
  assert.equal(getPostingPlan(f.db,posting.id).accountsNeedReview,true);
  assert.deepEqual(getPostingPlan(f.db,posting.id).accounts.map(x=>x.accountId),[b.id]);
  const sql=new DatabaseSync(f.db);
  sql.prepare("UPDATE postings SET status='READY' WHERE id=?").run(posting.id);
  sql.prepare("UPDATE posting_campaign_plans SET status='READY' WHERE posting_id=?").run(posting.id);sql.close();
  assert.throws(()=>createPostingJob(f.db,posting.id),/Pilihan akaun telah berubah/);
  savePostingPlanAccounts(f.db,posting.id,[b]);
  assert.equal(getPostingPlan(f.db,posting.id).accountsNeedReview,false);
});

test('Repairing a logged-out session is allowed for a paused campaign and keeps its identity',async t=>{
  const f=fixture(t),a=f.account('60111111111','LOGGED_OUT');job(f.db,a.id);
  await f.command('.accounts');await f.command('.account-login 1');await f.command('2');await settle();
  assert.equal(f.manager.loginAttempt.id,a.id);
  const socket=f.sockets.at(-1);socket.user={id:'60111111111@s.whatsapp.net'};socket.ev.emit('connection.update',{connection:'open'});await settle();
  assert.equal(f.manager.get(a.id).status,'ONLINE');assert.equal(accountDependencies(f.db,a.id).length,1);
});

test('Late error from cancelled pairing cannot cancel a newer login for the same existing account',async t=>{
  const f=fixture(t),a=f.account('60111111111','LOGGED_OUT');
  let rejectCode;
  const promise=f.manager.replacePairing(a.id,a.phone).catch(()=>{});await settle();
  const old=f.sockets.at(-1);old.requestPairingCode=()=>new Promise((_,reject)=>{rejectCode=reject;});
  old.ev.emit('connection.update',{qr:'old'});await settle();
  await f.manager.cancelLogin(a.id);await promise;
  await f.manager.replaceQr(a.id);const fresh=f.manager.loginAttempt;
  rejectCode(new Error('old transport failed'));await settle();
  assert.equal(f.manager.loginAttempt,fresh);
});
