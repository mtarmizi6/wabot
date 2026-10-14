import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { LiveMessage } from './live-message.js';
import { accountNumber } from './accounts-ui.js';
import * as ui from './posting-ui.js';
import * as s from '../posting/store.js';

export class PostingLive {
 constructor({databasePath,manager,send,edit,startScheduler,resolvePosting,projectRoot=null,now=Date.now,liveOptions={}}) {
  Object.assign(this,{databasePath,manager,send,edit,startScheduler,resolvePosting,projectRoot,now,liveOptions});
  this.messages=new Map();this.contexts=new Map();this.views=new Map();this.confirmations=new Map();this.closed=false;
  for(const d of s.savedPostingDashboards(databasePath))this.attach(d.chatId,d.jobId,d.messageId,d.displayNumber);
 }
 view(scope='active'){return s.campaignView(this.databasePath,scope);}
 capture(chat,scope='active'){const items=this.view(scope);this.views.set(String(chat),{scope,ids:items.map(j=>j.id),expires:this.now()+600000});return items;}
 number(id){const active=this.view().find(j=>j.id===id);if(active)return active.displayNumber;return this.messages.get(id)?.displayNumber||this.view('records').find(j=>j.id===id)?.displayNumber||1;}
 enrich(job) {
  if(!job)return null;
  return {...job,displayNumber:job.displayNumber||this.number(job.id),updatedDisplayAt:job.completedAt||new Date(Math.floor(this.now()/5000)*5000).toISOString(),accounts:(job.accounts||[]).map(a=>{
   const current=this.manager.get(a.accountId),w=s.getPostingWorker(this.databasePath,a.accountId);
   const wait=Math.max(0,Math.ceil((Date.parse(w.availableAt||'')-this.now())/1000))||0;
   return {...a,...(current?{displayNumber:accountNumber(current),phone:current.phone,status:current.status}:{}),waitSeconds:wait,waitKind:w.waitKind};
  })};
 }
 activity(job) {
  if(job.status!=='RUNNING')return job.pauseReason||job.finishReason||ui.postingStatusLabel(job.status);
  if(job.processingCount)return `Sedang menghantar · ${job.processingCount} operasi`;
  const online=job.accounts.filter(a=>a.status==='ONLINE');if(!online.length)return 'Menunggu sambungan WhatsApp';
  const wait=Math.min(...online.map(a=>a.waitSeconds));return wait?`Menunggu giliran akaun : ${wait}s`:'Menunggu giliran akaun';
 }
 render(id) {
  let raw=s.getPostingJob(this.databasePath,id);if(!raw)return '📊 Rekod kempen telah dipadam.\n↩️ ↳ .status → Senarai Kempen';
  const saved=raw.cleanupAt?s.postingReportSnapshot(this.databasePath,id):null;
  if(saved)raw={...raw,accounts:saved.job.accounts,ads:saved.ads};
  const job=this.enrich(raw);const live=this.messages.get(id);if(live&&['RUNNING','PAUSED','WAITING'].includes(raw.status))live.displayNumber=job.displayNumber;const recent=saved?.recent||s.listRecentPostingTargets(this.databasePath,id,10);
  const text=ui.postingJobStatusMessage(job,recent,this.activity(job));return this.decorate?this.decorate(id,text):text;
 }
 attach(chat,id,messageId=null,displayNumber=null) {
  const live=new LiveMessage({...this.liveOptions,interval:this.liveOptions.interval??5000,chatId:chat,send:this.send,edit:this.edit,now:this.now,render:()=>this.render(id),onMessageId:mid=>s.savePostingDashboard(this.databasePath,id,chat,mid,this.number(id))});
  live.messageId=messageId;live.displayNumber=displayNumber||this.number(id);this.messages.set(id,live);return live;
 }
 async show(chat,id,{feedback=false}={}) {
  if(this.closed)return;
  const job=s.getPostingJob(this.databasePath,id);if(!job)return this.send(chat,'⚠️ Kempen tidak ditemui.\n↩️ ↳ .status → Senarai Kempen');
  this.capture(chat,['RUNNING','WAITING','PAUSED'].includes(job.status)?'active':'records');
  this.contexts.set(String(chat),{id,expires:this.now()+600000});
  let live=this.messages.get(id);
  if(live&&String(live.chatId)!==String(chat)){live.close();this.messages.delete(id);live=null;}
  if(!live){const saved=s.savedPostingDashboards(this.databasePath).find(d=>d.jobId===id&&String(d.chatId)===String(chat));live=this.attach(chat,id,saved?.messageId);}
  const previousId=live.messageId;
  await live.update(true);
  // A manual command needs a visible response even when its dashboard is far
  // above the current chat position. Automatic refreshes never send receipts.
  if(feedback&&previousId&&live.messageId===previousId){
   const latest=s.getPostingJob(this.databasePath,id);if(!latest)return;
   const job=this.enrich(latest);
   const text=ui.postingFeedbackMessage(job,this.activity(job),Boolean(live.busy||live.dirty||live.failures));return this.send(chat,this.feedback?this.feedback(id):text,{replyToMessageId:live.messageId});
  }
 }
 refresh(id,force=false){return this.messages.get(Number(id))?.update(force)||Promise.resolve();}
 pulse(){if(this.closed)return;for(const [id,live] of this.messages){const job=s.getPostingJob(this.databasePath,id);if(!job){live.close();this.messages.delete(id);}else if(['RUNNING','WAITING'].includes(job.status)||job.processingCount)live.update().catch(()=>{});else if(['STOPPED','COMPLETED'].includes(job.status)&&job.reportStatus==='SENT'&&!live.busy&&!live.dirty&&!live.failures){live.close();this.messages.delete(id);}}}
 async list(chat,page=1,scope='active') {
  const items=this.capture(chat,scope),pages=Math.max(1,Math.ceil(items.length/10)),p=Math.max(1,Math.min(pages,Number(page)||1));
  return this.send(chat,ui.postingActiveMessage(items.slice((p-1)*10,p*10),p,items.length,scope));
 }
 async resolve(chat,value,{active=false}={}) {
  const key=String(chat),view=this.views.get(key),valid=view&&view.expires>this.now()&&JSON.stringify(view.ids)===JSON.stringify(this.view(view.scope).map(j=>j.id));
  if(value){
   if(!valid||(active&&view.scope!=='active')){await this.send(chat,'⚠️ PILIHAN KEMPEN PERLU DISEGARKAN\n↳ Susunan atau konteks sudah berubah. Pilih semula daripada senarai ini.');await this.list(chat);return null;}
   const id=view.ids[Number(value)-1];if(id)return {...s.getPostingJob(this.databasePath,id),displayNumber:Number(value)};
  }else{
   const context=this.contexts.get(key);
   if(context&&context.expires>this.now()){const job=s.getPostingJob(this.databasePath,context.id);if(job)return job;}
   const items=this.view();if(items.length===1)return items[0];
  }
  await this.send(chat,'📋 PILIH KEMPEN\n↳ Buka .status N daripada senarai terkini.');await this.list(chat);return null;
 }
 async start(chat) {
  const posting=this.resolvePosting();if(!posting)return this.send(chat,ui.postingNewMessage());
  const existing=s.getPostingJobForPosting(this.databasePath,posting.id);if(existing)return this.show(chat,existing.id,{feedback:true});
  if(s.isClientPosting(posting)&&!s.postingPaymentState(this.databasePath,posting.id).paid){if(this.review)return this.review(chat,posting.id);return this.send(chat,'⚠️ Sahkan bayaran penuh melalui .posting-next sebelum mula.');}
  const plan=s.getPostingPlan(this.databasePath,posting.id),state=s.postingReviewState(this.databasePath,posting.id,this.now());
  if(!plan.review||plan.review.fingerprint!==state.fingerprint||plan.review.endsAt!==state.endsAt){
   if(this.review)return this.review(chat,posting.id);
   s.capturePostingReview(this.databasePath,posting.id,this.now());
   await this.send(chat,'🔎 SEMAKAN SEBELUM MULA\n↳ Semak sasaran dan masa terkini. Hantar .posting-mula selepas semakan.');
   return this.send(chat,ui.postingReviewMessage(s.postingPlanSummary(this.databasePath,posting.id)));
  }
  if(!plan.accounts?.length||plan.accounts.some(a=>this.manager.get(a.accountId)?.status!=='ONLINE'))throw new Error('Akaun pilihan perlu ONLINE. Semak .accounts atau pilih semula.');
  this.checkMedia(s.listPostingAds(this.databasePath,posting.id));
  const job=s.createPostingJob(this.databasePath,posting.id);s.setPostingJobStatus(this.databasePath,job.id,'RUNNING');
  this.startScheduler(chat);return this.show(chat,job.id);
 }
 checkMedia(ads){if(this.projectRoot)for(const ad of ads)if(ad.kind!=='TEXT'&&(!ad.mediaPath||!existsSync(join(this.projectRoot,ad.mediaPath))))throw new Error('Media iklan hilang. Pulihkan bahan sebelum mula / sambung.');}
 async report(chat,job) {
  const snap=s.postingReportSnapshot(this.databasePath,job.id);
  return this.send(chat,ui.postingReportMessage(this.enrich({...job,accounts:snap?.accountStats||job.accounts,ads:snap?.ads||job.ads})));
 }
 async handle(route) {
  const {action,chatId:chat}=route,key=String(chat),confirmation=this.confirmations.get(key);
  if(confirmation&&['wa_cancel','wa_back'].includes(action)){this.confirmations.delete(key);if(confirmation.kind==='delete'&&await this.cancelDelete?.(chat))return true;await this.send(chat,'↩️ Tindakan dibatalkan. Kempen dikekalkan.');return true;}
  if(confirmation&&action==='text'){
   if(this.now()>confirmation.expires){this.confirmations.delete(key);await this.send(chat,'⚠️ Pengesahan tamat tempoh. Buka kempen semula.');return true;}
   if(String(route.text).trim().toUpperCase()!=='SAH'){await this.send(chat,'✅ ↳ Balas SAH → Sahkan\n✖️ ↳ .batal → Batal');return true;}
   this.confirmations.delete(key);
   try{
    if(confirmation.kind==='delete-all'){s.deleteAllPostingReportRecords(this.databasePath);await this.list(chat,1,'records');return true;}
    const job=s.getPostingJob(this.databasePath,confirmation.id);if(!job)return true;
    if(confirmation.kind==='delete'){s.deletePostingReportRecord(this.databasePath,job.id);if(await this.afterDelete?.(chat,job.id))return true;await this.list(chat,1,'records');return true;}
    if(['RUNNING','PAUSED','WAITING'].includes(job.status))s.setPostingJobStatus(this.databasePath,job.id,'STOPPED');
    await this.show(chat,job.id,{feedback:true});return true;
   }catch(e){await this.send(chat,'⚠️ '+e.message);return true;}
  }
  if(action!=='text')this.confirmations.delete(key);
  const owned=['posting_run','posting_active','posting_refresh','posting_status','posting_pause','posting_resume','posting_stop','posting_accounts','posting_delete','records','records_refresh','report','report_refresh','report_delete'];
  if(!owned.includes(action))return false;
  try {
   if(action==='posting_run'){await this.start(chat);return true;}
   if(['posting_active','posting_refresh'].includes(action)){await this.list(chat,route.args?.[0]||1);return true;}
   if(['records','records_refresh','report_refresh'].includes(action)||action==='report'&&!route.args?.length){await this.list(chat,route.args?.[0]||1,'records');return true;}
   if(action==='report_delete'&&route.args?.[0]==='all'){
    this.confirmations.set(key,{kind:'delete-all',expires:this.now()+120000});await this.send(chat,'🗑️ PADAM SEMUA REKOD SELESAI?\n• Hanya rekod yang laporannya sudah dihantar dan cleanup selesai.\n• Laporan Telegram kekal.\n\n✅ ↳ Balas SAH → Padam Rekod\n✖️ ↳ .batal → Batal');return true;
   }
   const job=await this.resolve(chat,route.args?.[0],{active:['posting_pause','posting_resume','posting_stop'].includes(action)});if(!job)return true;
   this.contexts.set(key,{id:job.id,expires:this.now()+600000});
   if(action==='report'){await this.report(chat,job);return true;}
   if(action==='posting_accounts'){await this.send(chat,ui.postingAccountsMessage(this.enrich(job),route.args?.[1]));return true;}
   if(['posting_delete','report_delete'].includes(action)){
    if(!['STOPPED','COMPLETED'].includes(job.status)||job.processingCount||job.reportStatus!=='SENT'||!job.cleanupAt)throw new Error('Hentikan kempen dan tunggu laporan serta cleanup selesai sebelum memadam rekod.');
    this.confirmations.set(key,{kind:'delete',id:job.id,expires:this.now()+120000});await this.send(chat,`🗑️ PADAM REKOD KEMPEN ${this.number(job.id)}?\n↳ ${job.displayName}\n• Laporan Telegram kekal.\n\n✅ ↳ Balas SAH → Padam\n✖️ ↳ .batal → Batal`);return true;
   }
   if(action==='posting_pause'&&job.status==='RUNNING')s.setPostingJobStatus(this.databasePath,job.id,'PAUSED');
   if(action==='posting_resume'&&['PAUSED','WAITING'].includes(job.status)){
    s.finalizeExpiredPostingJobs(this.databasePath,this.now());
    if(s.getPostingJob(this.databasePath,job.id).status==='COMPLETED'){await this.show(chat,job.id,{feedback:true});return true;}
    this.checkMedia(job.ads);
    if(!job.accounts.some(a=>this.manager.get(a.accountId)?.status==='ONLINE'))throw new Error('Tiada akaun kempen ONLINE. Semak .accounts.');
    s.setPostingJobStatus(this.databasePath,job.id,'RUNNING');this.startScheduler(chat);
   }
   if(action==='posting_stop'&&['RUNNING','PAUSED','WAITING'].includes(job.status)){
    this.confirmations.set(key,{kind:'stop',id:job.id,expires:this.now()+120000});
    await this.send(chat,`⏹ HENTIKAN KEMPEN ${this.number(job.id)}?\n↳ ${job.displayName}\n\n✅ Success : ${job.successCount}\n❌ Failed : ${job.failedCount}\n❔ Belum Pasti : ${job.unknownCount||0}\n📨 Sedang Hantar : ${job.processingCount}\n\n• Penghantaran baharu akan dihentikan.\n• Permintaan yang sudah dihantar mungkin masih selesai.\n• Gunakan Jeda jika mahu sambung kemudian.\n\n✅ ↳ Balas SAH → Hentikan\n✖️ ↳ .batal → Batal`);return true;
   }
   await this.show(chat,job.id,{feedback:true});return true;
  }catch(error){await this.send(chat,`⚠️ AUTO POST\n${String(error.message||'Tindakan belum berjaya.').slice(0,240)}\n\n↩️ ↳ .mula → Mula Posting\n📊 ↳ .status → Senarai Kempen`);return true;}
 }
 close(){this.closed=true;for(const live of this.messages.values())live.close();this.messages.clear();this.confirmations.clear();}
}
