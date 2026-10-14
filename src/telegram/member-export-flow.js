import {groupSnapshot,groupPage} from '../whatsapp/group-store.js';
import {collectGroupNumbers,memberExportFile} from '../whatsapp/member-export.js';
import {LiveMessage} from './live-message.js';
import {accountNo,accountName,time} from './group-ui.js';

const TTL=30*60*1000;
const short=x=>Array.from(String(x||'Group').replace(/\s+/g,' ')).slice(0,70).join('');
const nav='\n\n👥 ↳ .group → Urus Group\n🏠 ↳ .menu → Menu Utama';
export class MemberExportFlow {
 constructor({databasePath,manager,send,edit,document,now=Date.now,collect=collectGroupNumbers}){
  Object.assign(this,{databasePath,manager,send,edit,document,now,collect});
  this.sessions=new Map();this.tasks=new Set();this.closed=false;
 }
 clear(chat){const s=this.sessions.get(String(chat));if(s){clearTimeout(s.timer);s.abort?.abort();s.live?.close();s.result=null;}this.sessions.delete(String(chat));}
 get(chat){const s=this.sessions.get(String(chat));if(s&&this.now()>s.expires){this.clear(chat);return null;}return s;}
 touch(chat,s){clearTimeout(s.timer);s.expires=this.now()+TTL;s.timer=setTimeout(()=>{if(this.sessions.get(String(chat))===s)this.clear(chat);},TTL);s.timer.unref?.();}
 current(chat,s){return !this.closed&&this.sessions.get(String(chat))===s&&!s.abort?.signal.aborted;}
 async home(chat,page=1){
  let s=this.get(chat);if(s?.stage==='RUNNING'||s?.sending)return this.status(chat);
  const accounts=this.manager.list(),fingerprint=accounts.map(a=>a.id).join(',');
  if(!s){s={stage:'ACCOUNTS',seenAccounts:new Set()};this.sessions.set(String(chat),s);}
  if(s.accountFingerprint!==fingerprint)s.seenAccounts=new Set();
  s.live?.close();s.abort?.abort();s.abort=null;s.stage='ACCOUNTS';s.selected=null;s.result=null;s.list=null;s.accountId=null;
  s.accountFingerprint=fingerprint;this.touch(chat,s);
  const pages=Math.max(1,Math.ceil(accounts.length/10));page=Math.max(1,Math.min(pages,Number(page)||1));
  const items=accounts.slice((page-1)*10,page*10);items.forEach(a=>s.seenAccounts.add(a.id));
  return this.send(chat,['📇 EXTRACT NOMBOR AHLI','↳ Eksport nombor ahli untuk urusan team yang dipersetujui.','','| PILIH AKAUN |',
   ...items.map(a=>`${accountNo(a)}. ${accountName(a)} · ${a.status==='ONLINE'?'🟢 Online':'🔴 Offline'}\n📱 ↳ .extract-account ${accountNo(a)} → Pilih Akaun`),
   ...(!items.length?['Tiada akaun. Sambungkan WhatsApp melalui .login.']:[]),
   ...(page>1?[`⬅️ ↳ .extract ${page-1} → Halaman Sebelum`]:[]),...(page<pages?[`➡️ ↳ .extract ${page+1} → Halaman Seterusnya`]:[]),
   '', '• Pilih satu group bagi setiap proses.','• Fail mengandungi nombor tersedia sahaja; ID tanpa nombor dilangkau.',nav].join('\n'));
 }
 async chooseAccount(chat,value){
  const s=this.get(chat);if(s?.stage==='RUNNING'||s?.sending)return this.status(chat);
  const accounts=this.manager.list(),a=accounts.find(x=>accountNo(x)===Number(value));
  if(!s||s.accountFingerprint!==accounts.map(x=>x.id).join(',')||!a||!s.seenAccounts.has(a.id))return this.home(chat);
  if(a.status!=='ONLINE')return this.send(chat,`⚠️ AKAUN BELUM ONLINE\n↳ Sambungkan Akaun ${accountNo(a)} dahulu.\n\n📱 ↳ .account ${accountNo(a)} → Semak Akaun\n📇 ↳ .extract → Extract Nombor`);
  s.accountId=a.id;s.keyword='';s.list=null;s.selected=null;s.result=null;s.stage='GROUPS';this.touch(chat,s);
  return this.groups(chat,1);
 }
 async groups(chat,page=1,keyword){
  const s=this.get(chat);if(!s?.accountId)return this.home(chat);if(s.stage==='RUNNING'||s.sending)return this.status(chat);
  const a=this.manager.get(s.accountId);if(!a)return this.home(chat);
  if(keyword!==undefined){keyword=String(keyword).trim();if(keyword.length>100)throw Error('Had carian ialah 100 aksara.');s.keyword=keyword;}
  const snapshot=groupSnapshot(this.databasePath,s.accountId,s.keyword),old=s.list;
  if(old&&old.fingerprint!==snapshot.fingerprint)page=1;
  const data=groupPage(snapshot,page);
  s.list={fingerprint:snapshot.fingerprint,keys:snapshot.items.map(g=>g.key),seen:old?.fingerprint===snapshot.fingerprint?old.seen:new Set()};
  data.items.forEach((g,i)=>s.list.seen.add(data.offset+i+1));s.stage='GROUPS';s.selected=null;s.result=null;s.live?.close();this.touch(chat,s);
  return this.send(chat,['📇 PILIH GROUP UNTUK EXTRACT',`↳ Akaun ${accountNo(a)} · ${accountName(a)}`,`↳ ${data.total} group · Halaman ${data.page}/${data.totalPages}`,
   ...(s.keyword?[`Carian: ${short(s.keyword)}`]:[]),'',
   ...data.items.map((g,i)=>`${data.offset+i+1}. ${short(g.subject)}\n↳ ${g.participantCountKnown?g.participantCount+' ahli':'Jumlah ahli belum diketahui'}\n📇 ↳ .extract-group ${data.offset+i+1} → Pilih Group`),
   ...(!data.total?['Tiada group. Sync atau cuba carian lain.']:[]),'',
   ...(data.page>1?[`⬅️ ↳ .extract-page ${data.page-1} → Halaman Sebelum`]:[]),...(data.page<data.totalPages?[`➡️ ↳ .extract-page ${data.page+1} → Halaman Seterusnya`]:[]),
   '🔍 ↳ .extract-search kelas → Cari Nama Group','📂 ↳ .extract-search → Papar Semua',`🔄 ↳ .group-sync ${accountNo(a)} → Sync Group`,'📱 ↳ .extract → Tukar Akaun',nav].join('\n'));
 }
 async chooseGroup(chat,value){
  const s=this.get(chat);if(!s?.accountId)return this.home(chat);if(s.stage==='RUNNING'||s.sending)return this.status(chat);
  const snapshot=groupSnapshot(this.databasePath,s.accountId,s.keyword),n=Number(value);
  if(!s.list||s.list.fingerprint!==snapshot.fingerprint||!s.list.seen.has(n))return this.groups(chat,1);
  const group=snapshot.items.find(g=>g.key===s.list.keys[n-1]);if(!group)return this.groups(chat,1);
  s.selected={key:group.key,jid:group.jid,name:group.subject};s.result=null;s.stage='REVIEW';this.touch(chat,s);
  return this.send(chat,['📇 SEMAK EXTRACT AHLI',`📌 Group : ${short(group.subject)}`,`📱 Akaun : ${accountNo(this.manager.get(s.accountId))}`,'',
   '• Ambil nombor yang tersedia daripada ahli group terpilih.','• Nombor sama dibuang; ID tanpa padanan tidak masuk fail.','• Tiada mesej WhatsApp dihantar.','',
   '▶️ ↳ .extract-run → Mula Extract','↩️ ↳ .extract-page 1 → Pilih Group Lain','✖️ ↳ .extract-cancel → Batal',nav].join('\n'));
 }
 screen(s){
  if(s.stage==='RUNNING')return `📇 EXTRACT SEDANG BERJALAN\n📌 ${short(s.selected.name)}\n\n↳ ${s.progress?`Disemak ${s.progress.processed}/${s.progress.total} ahli · ${s.progress.unique} nombor unik`:'Mendapatkan senarai ahli semasa…'}\n\n📊 ↳ .extract-status → Semak Progress\n✖️ ↳ .extract-cancel → Batal`;
  if(s.stage==='FAILED')return `⚠️ EXTRACT BELUM SELESAI\n↳ ${s.error}\n\n▶️ ↳ .extract-run → Cuba Semula\n📇 ↳ .extract → Pilih Semula`;
  const r=s.result;if(!r)return '📇 Tiada hasil extract.\n↳ .extract → Mula';
  return ['✅ EXTRACT AHLI SELESAI',`📌 ${short(r.groupName)}`,`🕒 ${time(r.at)} MYT`,'',`👥 Rekod ahli disemak : ${r.total}`,`📱 Nombor unik tersedia : ${r.rows.length}`,`🔁 Duplicate : ${r.duplicates}`,`❔ Nombor belum tersedia : ${r.unavailable}`,`⚠️ Format / padanan tidak sah : ${r.invalid}`,
   ...(r.lookupErrors?[`↳ Semakan padanan terganggu : ${r.lookupErrors}`]:[]),'','• Semakan format sahaja; bukan jaminan nombor aktif.','• Hasil sementara 30 minit; muat turun fail sebelum tamat.',
   ...(r.rows.length?['','📄 ↳ .extract-txt → Muat Turun TXT','📊 ↳ .extract-csv → Muat Turun CSV']:[]),'','📇 ↳ .extract → Extract Group Lain','🧹 ↳ .extract-cancel → Kosongkan Hasil',nav].join('\n');
 }
 async run(chat){
  const s=this.get(chat);if(!s?.selected)return this.home(chat);if(s.stage==='RUNNING'||s.sending||s.stage==='DONE')return this.status(chat);
  const a=this.manager.get(s.accountId),snapshot=groupSnapshot(this.databasePath,s.accountId);
  if(a?.status!=='ONLINE')return this.send(chat,'⚠️ Akaun perlu ONLINE sebelum extract.\n📇 ↳ .extract → Pilih Akaun');
  if(!snapshot.items.some(g=>g.key===s.selected.key&&g.jid===s.selected.jid))return this.groups(chat,1);
  s.stage='RUNNING';s.result=null;s.error='';s.progress=null;s.abort=new AbortController();this.touch(chat,s);
  s.live?.close();s.live=new LiveMessage({send:this.send,edit:this.edit,chatId:chat,render:()=>this.screen(s)});
  // Reserve RUNNING before the first await so repeat commands never start twice.
  const task=(async()=>{
   await s.live.update(true).catch(()=>{});if(!this.current(chat,s))return;
   try{
    const result=await this.collect({manager:this.manager,databasePath:this.databasePath,accountId:s.accountId,groupJid:s.selected.jid,signal:s.abort.signal,onProgress:p=>{if(this.current(chat,s)){s.progress=p;s.live.update().catch(()=>{});}}});
    if(!this.current(chat,s))return;s.result=result;s.stage='DONE';this.touch(chat,s);
   }catch(error){
    if(!this.current(chat,s))return;s.stage='FAILED';
    s.error=error?.name==='TimeoutError'?'Semakan tamat masa. Semak sambungan dan cuba semula.':/Akaun terputus|tidak lengkap|tidak tersedia|tidak sepadan/.test(error?.message||'')?error.message:'Senarai ahli belum dapat dibaca. Semak akses group dan sambungan WhatsApp.';
   }
   if(this.current(chat,s))await s.live.update(true).catch(()=>{});
  })().finally(()=>this.tasks.delete(task));this.tasks.add(task);
 }
 async status(chat){const s=this.get(chat);if(!s)return this.home(chat);return this.send(chat,this.screen(s));}
 async download(chat,format){
  const s=this.get(chat);if(!s?.result||s.stage!=='DONE'||!s.result.rows.length)return this.status(chat);
  if(s.sending)return this.send(chat,'⏳ Fail sedang dihantar. Tunggu sebentar.');
  s.sending=true;this.touch(chat,s);
  try{const file=memberExportFile(s.result,format);await this.document(chat,file,{signal:s.abort.signal,caption:`📇 ${short(s.result.groupName)}\n${s.result.rows.length} nombor unik · ${format.toUpperCase()}`});}
  catch{if(this.current(chat,s))await this.send(chat,`⚠️ Fail belum berjaya dihantar. Hasil masih tersedia.\n📄 ↳ .extract-${format} → Cuba Muat Turun Semula`);}
  finally{s.sending=false;}
 }
 async handle(route){
  if(!route.action?.startsWith('extract_'))return false;
  const chat=route.chatId,args=route.args||[];
  try{
   if(route.action==='extract_home')await this.home(chat,args[0]);
   else if(route.action==='extract_account')await this.chooseAccount(chat,args[0]);
   else if(route.action==='extract_page')await this.groups(chat,args[0]);
   else if(route.action==='extract_search')await this.groups(chat,1,args[0]||'');
   else if(route.action==='extract_group')await this.chooseGroup(chat,args[0]);
   else if(route.action==='extract_run')await this.run(chat);
   else if(route.action==='extract_status')await this.status(chat);
   else if(route.action==='extract_txt'||route.action==='extract_csv')await this.download(chat,route.action.slice(8));
   else if(route.action==='extract_cancel'){this.clear(chat);await this.send(chat,'📇 EXTRACT DIKOSONGKAN\n↳ Proses dibatalkan dan hasil sementara dibuang.\n\n📇 ↳ .extract → Mula Semula'+nav);}
  }catch{await this.send(chat,'⚠️ Pilihan extract tidak lagi tersedia. Buka semula senarai.\n📇 ↳ .extract → Pilih Akaun');}
  return true;
 }
 async idle(){while(this.tasks.size)await Promise.all([...this.tasks]);}
 close(){this.closed=true;for(const chat of this.sessions.keys())this.clear(chat);}
}
