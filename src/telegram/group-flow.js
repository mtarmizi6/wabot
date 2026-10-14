import {groupSnapshot,groupSummary,groupPage} from '../whatsapp/group-store.js';
import {LiveMessage} from './live-message.js';
import * as ui from './group-ui.js';

const TTL=10*60*1000;
const terminal=s=>['DONE','FAILED','SKIPPED'].includes(s.status);
export function syncReason(error,account) {
 const code=Number(error?.output?.statusCode||error?.statusCode||error?.status),message=String(error?.message||'');
 if(account?.status==='LOGGED_OUT'||[401,403].includes(code))return 'Sesi tidak sah. Login semula melalui halaman akaun.';
 if(/tidak lengkap/i.test(message))return 'Hasil sync tidak lengkap. Cuba semula.';
 if(/timeout|timed out/i.test(message))return 'Proses tamat masa. Semak internet dan cuba semula.';
 if(/berjalan/i.test(message))return 'Sync akaun ini sedang berjalan. Semak progress.';
 return 'Sambungan terganggu. Semak akaun dan cuba semula.';
}
export class GroupFlow {
 constructor({databasePath,manager,accountsFlow,send,edit,now=Date.now,liveOptions={}}) {
  Object.assign(this,{databasePath,manager,accountsFlow,send,edit,now,liveOptions});
  this.users=new Map();this.syncs=new Map();this.tasks=new Set();this.batch=null;this.closed=false;
  this.onEvent=event=>this.syncEvent(event);this.manager.on?.('group-sync',this.onEvent);
 }
 user(chat){const key=String(chat);if(!this.users.has(key))this.users.set(key,{lists:new Map(),search:null});return this.users.get(key);}
 snapshot(scope='all',keyword=''){return groupSnapshot(this.databasePath,scope,keyword);}
 track(promise){const task=Promise.resolve(promise).catch(()=>{}).finally(()=>this.tasks.delete(task));this.tasks.add(task);return task;}
 async idle(){while(this.tasks.size)await Promise.all([...this.tasks]);}
 async home(chat,page=1,note='') {
  this.accountsFlow.capture();return this.send(chat,(note?'⚠️ '+note+'\n\n':'')+ui.home(groupSummary(this.databasePath),page));
 }
 resolve(scope){return scope==='all'?null:this.accountsFlow.resolve(scope);}
 async listAccount(chat,account,page=1,note='') {
  this.accountsFlow.capture();return this.list(chat,account,page,note);
 }
 async list(chat,account=null,page=1,note='') {
  const scope=account?.id??'all',snapshot=this.snapshot(scope),u=this.user(chat),old=u.lists.get(scope);
  if(account&&!snapshot.accounts.some(a=>a.id===account.id))return this.home(chat,1,'Akaun tidak lagi tersedia. Pilih semula.');
  if(Number(page)>1&&old&&(old.fingerprint!==snapshot.fingerprint||this.now()>old.expires)){page=1;note='Senarai berubah / tamat tempoh. Pilih semula daripada senarai terkini.';}
  const data=groupPage(snapshot,page),same=old?.fingerprint===snapshot.fingerprint&&this.now()<=old.expires;
  const context={scope,fingerprint:snapshot.fingerprint,keys:snapshot.items.map(g=>g.key),seen:same?old.seen:new Set(),expires:this.now()+TTL};
  data.items.forEach((g,i)=>context.seen.add(data.offset+i+1));u.lists.set(scope,context);this.accountsFlow.capture();
  return this.send(chat,(note?'⚠️ '+note+'\n\n':'')+ui.listing(data,account?snapshot.accounts.find(a=>a.id===account.id):null));
 }
 async info(chat,account,position,page=1) {
  const scope=account?.id??'all',context=this.user(chat).lists.get(scope),snapshot=this.snapshot(scope),n=Number(position);
  if(!context||this.now()>context.expires||context.fingerprint!==snapshot.fingerprint||!context.seen.has(n))return this.list(chat,account,1,'Pilihan lama / belum dipaparkan. Pilih group daripada senarai terkini.');
  const group=snapshot.items.find(g=>g.key===context.keys[n-1]);
  if(!group)return this.list(chat,account,1,'Group tidak lagi tersedia. Pilih semula.');
  return this.send(chat,ui.details(group,{account,position:n,page}));
 }
 async search(chat,account,keyword) {
  keyword=String(keyword||'').trim();if(!keyword||keyword.length>100)throw new Error('Masukkan kata kunci 1–100 aksara. Contoh: .group-search all kedah');
  const scope=account?.id??'all',snapshot=this.snapshot(scope,keyword);
  this.user(chat).search={scope,keyword,fingerprint:snapshot.fingerprint,keys:snapshot.items.map(g=>g.key),seen:new Set(),expires:this.now()+TTL};
  this.accountsFlow.capture();return this.searchPage(chat,1);
 }
 async searchContext(chat) {
  const c=this.user(chat).search;
  if(!c){await this.send(chat,'🔍 CARI GROUP\n↳ Jalankan carian dahulu.\n\n🔍 ↳ .group-search all kedah → Cari Group');return null;}
  const snapshot=this.snapshot(c.scope,c.keyword);
  if(this.now()>c.expires||c.fingerprint!==snapshot.fingerprint) {
   this.user(chat).search=null;const a=snapshot.accounts.find(x=>x.id===c.scope);
   await this.send(chat,`⚠️ HASIL CARIAN BERUBAH / TAMAT TEMPOH\n↳ Jalankan carian semula sebelum memilih.\n\n🔍 ↳ .group-search ${a?ui.accountNo(a):'all'} ${c.keyword} → Cari Semula`);return null;
  }
  return {c,snapshot,account:c.scope==='all'?null:snapshot.accounts.find(a=>a.id===c.scope)};
 }
 async searchPage(chat,page=1) {
  const result=await this.searchContext(chat);if(!result)return;const {c,snapshot,account}=result,data=groupPage(snapshot,page);
  data.items.forEach((g,i)=>c.seen.add(data.offset+i+1));return this.send(chat,ui.search(data,account));
 }
 async searchResult(chat,position,page=1) {
  const result=await this.searchContext(chat);if(!result)return;const {c,snapshot,account}=result,n=Number(position);
  if(!c.seen.has(n))return this.searchPage(chat,1);
  const group=snapshot.items.find(g=>g.key===c.keys[n-1]);if(!group)return this.searchPage(chat,1);
  return this.send(chat,ui.details(group,{account,position:n,search:true,page}));
 }
 newSync(account,status='QUEUED') {
  this.syncs.get(account.id)?.live?.close();
  const state={account,status,progress:null,live:null};state.done=new Promise(resolve=>state.resolve=resolve);this.syncs.set(account.id,state);return state;
 }
 syncEvent(event) {
  const state=this.syncs.get(event?.account?.id);if(!state||this.closed||terminal(state))return;
  state.progress=event;
  if(event.type==='group_sync_done')this.finish(state,'DONE',event);
  else if(event.type==='group_sync_error')this.finish(state,'FAILED',null,syncReason(event.error,this.manager.get(state.account.id)));
  else {state.status='RUNNING';this.refreshSync(state);}
 }
 finish(state,status,result=null,reason='') {
  if(terminal(state))return;
  state.status=status;state.result=result;state.reason=reason;state.resolve(state);this.refreshSync(state,true);
 }
 refreshSync(state,force=false) {
  if(this.closed)return;
  state.live?.update(force).catch(()=>{});
  if(this.batch?.running&&this.batch.entries.includes(state))this.batch.live.update().catch(()=>{});
 }
 runSync(state) {
  if(this.closed||terminal(state))return state;
  const account=this.manager.get(state.account.id),existing=this.manager.groupSyncs?.get(state.account.id);
  if(existing){state.status='RUNNING';state.progress=existing.progress||null;if(existing.progress)this.syncEvent(existing.progress);return state;}
  if(account?.status!=='ONLINE'){this.finish(state,'SKIPPED',null,account?'Offline':'Akaun tidak lagi tersedia');return state;}
  state.status='RUNNING';
  this.track(this.manager.syncGroups(account.id).then(result=>this.finish(state,'DONE',result)).catch(error=>this.finish(state,'FAILED',null,syncReason(error,this.manager.get(account.id)))));
  return state;
 }
 showSync(chat,state,fresh=false) {
  // Explicit status requests get a visible reply; subsequent live updates edit it.
  if(fresh){state.live?.close();state.live=null;}
  if(!state.live)state.live=new LiveMessage({...this.liveOptions,send:this.send,edit:this.edit,chatId:chat,now:this.now,render:()=>ui.syncScreen(state,this.manager.get(state.account.id)||state.account)});
  this.accountsFlow.capture();return state.live.update(true);
 }
 async startSyncAccount(chat,account) {
  if(this.closed)return;
  let state=this.syncs.get(account.id);
  if(state&&!terminal(state))return this.showSync(chat,state,true);
  if(account.status!=='ONLINE')return this.send(chat,`⚠️ SYNC GROUP\n↳ ${ui.identity(account)}\n\n• Akaun perlu ONLINE. Data tersimpan masih boleh dilihat.\n\n📱 ↳ .account ${ui.accountNo(account)} → Semak Akaun\n👥 ↳ .group ${ui.accountNo(account)} → Lihat Group`);
  state=this.newSync(account);this.runSync(state);return this.showSync(chat,state);
 }
 async syncStatus(chat,account) {
  let state=this.syncs.get(account.id);
  if(!state&&this.manager.groupSyncs?.has(account.id)){state=this.newSync(account);this.runSync(state);}
  if(state)return this.showSync(chat,state,true);
  return this.send(chat,`📊 STATUS SYNC GROUP\n↳ ${ui.identity(account)}\n\n• Tiada sync sedang berjalan.\n🕒 Sync Lengkap Terakhir : ${ui.time(account.lastGroupSyncAt)}\n🌏 Masa : Malaysia\n\n🔄 ↳ .group-sync ${ui.accountNo(account)} → Sync Sekarang\n👥 ↳ .group ${ui.accountNo(account)} → Lihat Group`);
 }
 async startAll(chat) {
  if(this.closed)return;
  if(this.batch?.running)return this.showBatch(chat,1,true);
  const accounts=groupSummary(this.databasePath).accounts;
  if(!accounts.length)return this.home(chat);
  this.batch?.live.close();
  const entries=accounts.map(account=>{
   if(account.status!=='ONLINE')return {account,status:'SKIPPED',reason:'Offline',selected:false};
   let state=this.syncs.get(account.id);
   if(!state||terminal(state))state=this.newSync(account);
   state.selected=true;return state;
  });
  const batch={entries,running:true,selectedCount:entries.filter(x=>x.selected).length,page:1};this.batch=batch;
  this.batchMessage(chat,batch);
  // Join existing syncs before starting queued accounts; never spawn a second sync.
  const order=entries.filter(x=>x.selected).sort((a,b)=>Number(this.manager.groupSyncs?.has(b.account.id))-Number(this.manager.groupSyncs?.has(a.account.id)));
  this.track((async()=>{
   for(const state of order){if(this.closed)break;this.runSync(state);await state.done;}
   batch.running=false;if(!this.closed)await batch.live.update(true);
  })());
  return this.showBatch(chat);
 }
 batchMessage(chat,batch) {
  batch.live=new LiveMessage({...this.liveOptions,send:this.send,edit:this.edit,chatId:chat,now:this.now,render:()=>ui.batchScreen(batch,groupSummary(this.databasePath),batch.page)});
 }
 async showBatch(chat,page=1,fresh=false) {
  if(!this.batch)return this.send(chat,'📊 STATUS SYNC SEMUA\n↳ Tiada proses sync semua dalam sesi ini.\n\n🔄 ↳ .group-sync all → Sync Akaun Online');
  if(fresh){this.batch.live.close();this.batchMessage(chat,this.batch);}
  this.batch.page=Number(page)||1;this.accountsFlow.capture();return this.batch.live.update(true);
 }
 async handle(route) {
  if(!['group','group_menu','group_account','group_all','group_info','group_search','group_result','group_search_page','group_sync','group_sync_status'].includes(route.action))return false;
  const {action,chatId:chat}=route,args=route.args||[];
  try {
   if(action==='group'||action==='group_menu')await this.home(chat,args[0]);
   else if(action==='group_all')await this.list(chat,null,args[0]||1);
   else if(action==='group_account')await this.list(chat,this.resolve(args[0]),args[1]||1);
   else if(action==='group_info')await this.info(chat,this.resolve(args[0]),args[1],args[2]);
   else if(action==='group_search')await this.search(chat,this.resolve(args[0]),args[1]);
   else if(action==='group_result')await this.searchResult(chat,args[0],args[1]);
   else if(action==='group_search_page')await this.searchPage(chat,args[0]);
   else if(action==='group_sync')args[0]&&args[0]!=='all'?await this.startSyncAccount(chat,this.resolve(args[0])):await this.startAll(chat);
   else if(action==='group_sync_status')args[0]&&args[0]!=='all'?await this.syncStatus(chat,this.resolve(args[0])):await this.showBatch(chat,args[1],true);
  } catch(error) {
   if(/Senarai akaun|Akaun tidak ditemui|Nombor akaun/.test(error.message||''))await this.home(chat,1,'Senarai akaun berubah / belum dipaparkan. Pilih semula.');
   else await this.send(chat,'⚠️ URUS GROUP\n'+(/kata kunci/.test(error.message||'')?error.message:'Paparan belum tersedia. Cuba semula melalui .group.')+'\n\n👥 ↳ .group → Urus Group');
  }
  return true;
 }
 close() {
  this.closed=true;this.manager.off?.('group-sync',this.onEvent);this.batch?.live.close();
  for(const s of this.syncs.values()){s.live?.close();s.resolve(s);}
 }
}
