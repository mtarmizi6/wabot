import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {initializeDatabase} from '../src/database/connection.js';
import * as wa from '../src/whatsapp/store.js';
import {WhatsAppManager} from '../src/whatsapp/manager.js';
import {exportPhone,collectGroupNumbers,memberExportFile} from '../src/whatsapp/member-export.js';
import {MemberExportFlow} from '../src/telegram/member-export-flow.js';
import {routeTelegramUpdate} from '../src/telegram/controller.js';
const tick=()=>new Promise(r=>setImmediate(r));
const gate=()=>{let resolve;return {promise:new Promise(r=>resolve=r),release:x=>resolve(x)};};
const group=(i)=>({jid:`${i}@g.us`,subject:`Kelas ${String(i).padStart(2,'0')}`,participantCount:2,accountRole:'MEMBER',announcement:false});
function fixture(t,{participants=[{id:'60123456789@s.whatsapp.net'}],lookup,collect,document}={}){
 const dir=mkdtempSync(join(tmpdir(),'wa-extract-')),db=join(dir,'app.sqlite');initializeDatabase(db);
 const a=wa.createWhatsAppAccount(db,{phone:'60111111111'});wa.updateWhatsAppAccount(db,a.id,{status:'ONLINE',lastConnectedAt:new Date().toISOString()});
 wa.syncWhatsAppGroups(db,a.id,[group(1)]);
 const manager=new WhatsAppManager({databasePath:db,sessionsPath:join(dir,'sessions')});let calls=0;
 const socket={groupMetadata:async jid=>{calls++;return {id:jid,subject:'Kelas Team',participants};},signalRepository:{lidMapping:{getPNForLID:lookup}}};manager.sockets.set(a.id,{socket});
 const sent=[],edits=[],files=[];let now=Date.now();
 const flow=new MemberExportFlow({databasePath:db,manager,collect,now:()=>now,send:async(c,text)=>{sent.push(text);return {message_id:sent.length};},edit:async(c,id,text)=>edits.push(text),document:document||(async(c,file)=>files.push(file))});
 t.after(async()=>{flow.close();await flow.idle();await manager.stop();rmSync(dir,{recursive:true,force:true});});
 const route=text=>flow.handle(routeTelegramUpdate({message:{from:{id:1},chat:{id:1,type:'private'},text}},'1'));
 return {a,db,manager,socket,flow,sent,edits,files,route,calls:()=>calls,advance:ms=>now+=ms,collect:opts=>collectGroupNumbers({databasePath:db,manager,accountId:a.id,groupJid:'1@g.us',...opts}),review:async()=>{await route('.extract');await route('.extract-account 1');await route('.extract-group 1');}};
}
test('phone sources accept explicit PN only and never numeric LID/usernames',()=>{
 assert.equal(exportPhone('60123456789:9@s.whatsapp.net'),'+60123456789');
 assert.equal(exportPhone('+60123456789',true),'+60123456789');
 for(const x of ['60123456789@lid','60123456789@username','@azam','0123456789','123','9999999999999999',60123456789])assert.equal(exportPhone(x,true),null);
 assert.equal(exportPhone('60123456789'),null);
});
test('collector deduplicates PN/explicit/cached mapping; reports missing, invalid and conflicts',async t=>{
 let lookups=0;const f=fixture(t,{lookup:async lid=>{lookups++;return lid==='999999999999@lid'?'60123456780@s.whatsapp.net':null;},participants:[
 {id:'60123456789@s.whatsapp.net',admin:'superadmin'},
 {id:'111111111111@lid',phoneNumber:'60123456789@s.whatsapp.net'},
 {id:'999999999999@lid',admin:'admin'},{id:'999999999999:4@lid'},
 {id:'888888888888@lid'},{id:'name@username'},
 {id:'0123456789@s.whatsapp.net'},{id:'60123456781@s.whatsapp.net',phoneNumber:'+60123456782'},
 {id:'777777777777@lid',phoneNumber:'+60123456783'}]});
 const before=readFileSync(f.db);const r=await f.collect();
 assert.equal(r.total,9);assert.equal(r.processed,9);assert.equal(r.rows.length,3);assert.equal(r.duplicates,2);assert.equal(r.unavailable,2);assert.equal(r.invalid,2);assert.equal(lookups,2);
 assert.deepEqual(r.rows.map(x=>x.phone),['+60123456780','+60123456783','+60123456789']);
 assert.equal(r.rows[0].source,'CACHED_MAPPING');assert.equal(r.rows[0].role,'ADMIN');assert.deepEqual(readFileSync(f.db),before);
});
test('unknown mapping does not become a phone; mapping failures are counted without probing',async t=>{
 const f=fixture(t,{participants:[{id:'999999999999@lid'},{id:'888888888888@lid'}],lookup:async lid=>{if(lid[0]==='9')throw Error('cache');return '888888888888@lid';}});
 const r=await f.collect();assert.equal(r.rows.length,0);assert.equal(r.unavailable,2);assert.equal(r.lookupErrors,1);
 delete f.socket.signalRepository;assert.equal((await f.collect()).unavailable,2);
});
test('collector refuses unavailable group, offline account, wrong metadata and changed socket',async t=>{
 const f=fixture(t);await assert.rejects(f.collect({groupJid:'2@g.us'}));assert.equal(f.calls(),0);
 wa.updateWhatsAppAccount(f.db,f.a.id,{status:'OFFLINE'});await assert.rejects(f.collect(),/Akaun terputus/);assert.equal(f.calls(),0);
 wa.updateWhatsAppAccount(f.db,f.a.id,{status:'ONLINE'});f.socket.groupMetadata=async()=>({id:'2@g.us',participants:[]});await assert.rejects(f.collect(),/tidak lengkap/);
 f.socket.groupMetadata=async()=>{f.manager.sockets.set(f.a.id,{socket:f.socket});return {id:'1@g.us',participants:[]};};await assert.rejects(f.collect(),/Akaun terputus/);
});
test('abort and timeout stop pending metadata and no result is emitted',async t=>{
 const f=fixture(t),g=gate();f.socket.groupMetadata=()=>g.promise;const abort=new AbortController();
 const p=f.collect({signal:abort.signal});abort.abort();await assert.rejects(p,{name:'AbortError'});
 const keepAlive=setTimeout(()=>{},1000);try{await assert.rejects(f.collect({timeoutMs:10}),{name:'TimeoutError'});}finally{clearTimeout(keepAlive);g.release({id:'1@g.us',participants:[]});}
});
test('TXT exact numbers and CSV escapes formulas, commas, quotes and uses MYT',()=>{
 const r={at:'2026-09-30T20:12:13.000Z',groupJid:'123@g.us',groupName:'=x,"team"',rows:[{phone:'+60123456789',role:'MEMBER',source:'PN'}]};
 const txt=memberExportFile(r);assert.equal(txt.buffer.toString(),'+60123456789\n');assert.match(txt.filename,/20261001041213/);
 const csv=memberExportFile(r,'csv').buffer.toString();assert.ok(csv.startsWith('\uFEFF'));assert.match(csv,/Masa MYT/);assert.ok(csv.includes('"\'+60123456789"'));assert.ok(csv.includes('"\'=x,""team"""'));assert.match(csv,/2026-10-01 04:12:13/);assert.throws(()=>memberExportFile(r,'xls'));
});
test('all commands owner-only/private and optional search/page routes preserved',()=>{
 for(const [cmd,action] of [['extract','home'],['extract 2','home'],['extract-account 1','account'],['extract-page 2','page'],['extract-group 1','group'],['extract-search kelas','search'],['extract-search','search'],['extract-run','run'],['extract-status','status'],['extract-txt','txt'],['extract-csv','csv'],['extract-cancel','cancel']]){
 const update={message:{from:{id:1},chat:{id:1,type:'private'},text:'.'+cmd}};assert.equal(routeTelegramUpdate(update,'1').action,'extract_'+action);assert.equal(routeTelegramUpdate(update,'2').action,'ignore');update.message.chat.type='group';assert.equal(routeTelegramUpdate(update,'1').action,'ignore');
 }
});
test('selected group flow runs once, exports both files, clears result and starts fresh',async t=>{
 const f=fixture(t);await f.review();assert.match(f.sent.at(-1),/SEMAK EXTRACT/);
 await Promise.all([f.route('.extract-run'),f.route('.extract-run')]);await f.flow.idle();assert.equal(f.calls(),1);assert.match(f.edits.at(-1),/EXTRACT AHLI SELESAI/);
 await f.route('.extract-run');assert.equal(f.calls(),1);await f.route('.extract-txt');await f.route('.extract-csv');assert.equal(f.files.length,2);
 await f.route('.extract');assert.equal(f.flow.get(1).result,null);await f.route('.extract-run');assert.equal(f.calls(),1);
 await f.route('.extract-cancel');assert.equal(f.flow.sessions.size,0);
});
test('pagination, search and changed snapshots cannot extract unseen or redirected group',async t=>{
 const f=fixture(t);wa.syncWhatsAppGroups(f.db,f.a.id,Array.from({length:12},(_,i)=>group(i+1)));
 await f.route('.extract');await f.route('.extract-account 1');await f.route('.extract-group 12');assert.equal(f.flow.get(1).stage,'GROUPS');
 await f.route('.extract-page 2');await f.route('.extract-group 12');assert.equal(f.flow.get(1).selected.jid,'12@g.us');
 await f.route('.extract-search 03');await f.route('.extract-group 1');assert.equal(f.flow.get(1).selected.jid,'3@g.us');
 await f.route('.extract-search');wa.syncWhatsAppGroups(f.db,f.a.id,[group(99)]);await f.route('.extract-group 1');assert.equal(f.flow.get(1).stage,'GROUPS');assert.equal(f.flow.get(1).selected,null);
});
test('cancelled operation cannot deliver late results or documents',async t=>{
 const g=gate(),f=fixture(t,{collect:()=>g.promise});await f.review();await f.route('.extract-run');await tick();await f.route('.extract-cancel');
 g.release({rows:[{phone:'+60123456789'}]});await f.flow.idle();assert.equal(f.flow.sessions.size,0);assert.ok(!f.edits.some(x=>x.includes('SELESAI')));await f.route('.extract-txt');assert.equal(f.files.length,0);
});
test('expired results clear, delivery retries preserve result and duplicate downloads coalesce',async t=>{
 let attempts=0;const g=gate();const f=fixture(t,{document:async()=>{attempts++;if(attempts===1)throw Error('offline');await g.promise;}});
 await f.review();await f.route('.extract-run');await f.flow.idle();await f.route('.extract-txt');assert.match(f.sent.at(-1),/Hasil masih tersedia/);
 const p=f.route('.extract-txt');await tick();await f.route('.extract-txt');assert.equal(attempts,2);g.release();await p;assert.ok(f.flow.get(1).result);
 f.advance(1800001);await f.route('.extract-txt');assert.equal(attempts,2);assert.equal(f.flow.get(1).result,null);
});
test('removed/renumbered accounts cannot redirect a stale account selection',async t=>{
 const f=fixture(t);const b=wa.createWhatsAppAccount(f.db,{phone:'60111111112'});wa.updateWhatsAppAccount(f.db,b.id,{status:'ONLINE'});
 await f.route('.extract');wa.deleteWhatsAppAccount(f.db,f.a.id);await f.route('.extract-account 1');assert.equal(f.flow.get(1).stage,'ACCOUNTS');assert.equal(f.flow.get(1).accountId,null);
});
