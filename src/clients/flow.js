import * as c from './store.js';
import * as p from '../posting/store.js';
import * as ui from './ui.js';
import * as postUi from '../telegram/posting-ui.js';

// All numeric selections are snapshots of stable IDs, scoped to this owner chat.
export class ClientFlow {
 constructor({databasePath,clientsDbPath,send,postingLive,beginClient,now=Date.now}) {
  Object.assign(this,{databasePath,clientsDbPath,send,postingLive,beginClient,now});
  const draft=p.getUnstartedPosting(databasePath);
  if(draft?.ownerType==='CLIENT'&&!draft.clientId){const link=c.clientForPosting(clientsDbPath,draft.id),client=link&&c.getClient(clientsDbPath,link.clientId);if(client)p.setPostingClient(databasePath,draft.id,client);}
  this.views=new Map();this.campaignViews=new Map();this.inputs=new Map();this.payments=new Map();this.receiptDeliveries=new Map();this.closed=false;
 }
 directory(){return c.clientDirectory(this.clientsDbPath);}
 stamp(rows){return JSON.stringify(rows.map(r=>[r.id,r.name]));}
 capture(chat){const rows=this.directory();this.views.set(String(chat),{stamp:this.stamp(rows),ids:rows.map(c=>c.id),expires:this.now()+600000});return rows;}
 campaigns(clientId,liveJobs=null){
  const linked=new Set(c.clientPostingLinks(this.clientsDbPath,clientId).map(l=>l.postingId));
  const live=(liveJobs||p.campaignView(this.databasePath,'all')).filter(j=>j.clientId===clientId||!j.clientId&&linked.has(j.postingId)),ids=new Set(live.map(j=>j.id));
  const saved=c.clientSavedReports(this.clientsDbPath,clientId).filter(r=>!ids.has(r.jobId)).map(r=>({...r.snapshot?.job,id:r.jobId,postingId:r.postingId,status:r.status,successCount:r.successCount,failedCount:r.failedCount,unknownCount:r.unknownCount,archived:true,displayName:r.snapshot?.job?.displayName||'Rekod terdahulu',accounts:r.snapshot?.accountStats||r.snapshot?.job?.accounts||[],ads:r.snapshot?.ads||[]}));
  const jobs=[...live,...saved].sort((a,b)=>a.id-b.id).map(j=>({...j,key:'job:'+j.id}));
  const draft=p.getUnstartedPosting(this.databasePath);
  if(draft?.clientId===clientId){const plan=p.getPostingPlan(this.databasePath,draft.id);jobs.push({...draft,id:draft.id,key:'draft:'+draft.id,isDraft:true,status:'DRAFT',targetMode:plan.targetMode,targetSuccess:plan.targetValue,targetDays:plan.targetValue,paymentValid:p.postingPaymentState(this.databasePath,draft.id).paid});}
  return jobs;
 }
 async list(chat,page=1,choose=false){const rows=this.capture(chat),live=p.campaignView(this.databasePath,'all'),items=rows.map(c=>({...c,counts:ui.clientCounts(this.campaigns(c.id,live))}));if(choose)this.inputs.set(String(chat),{kind:'choose',expires:this.now()+600000});return this.send(chat,ui.clientDirectoryMessage(items,page,{choose}));}
 async resolve(chat,n){const rows=this.directory(),view=this.views.get(String(chat));if(!view||view.expires<=this.now()||view.stamp!==this.stamp(rows)){await this.send(chat,'⚠️ SENARAI CLIENT BERUBAH / TAMAT TEMPOH\n↳ Pilih semula daripada senarai terkini.');await this.list(chat);return null;}const client=rows[Number(n)-1];if(!client){await this.send(chat,'⚠️ Nombor client tidak sah. Buka .client untuk senarai.');return null;}return client;}
 async detail(chat,client){const fresh=this.capture(chat).find(r=>r.id===client.id);return this.send(chat,ui.clientProfileMessage(fresh,ui.clientCounts(this.campaigns(client.id))));}
 async begin(chat,client){const draft=p.getUnstartedPosting(this.databasePath);if(draft)return this.send(chat,postUi.postingNewMessage(draft));this.inputs.delete(String(chat));await this.beginClient(chat,client);}
 async campaignList(chat,client,page=1,reports=false){const items=this.campaigns(client.id).filter(j=>!reports||!j.isDraft);this.campaignViews.set(String(chat)+':'+client.id+':'+reports,{keys:items.map(j=>j.key),expires:this.now()+600000});return this.send(chat,ui.clientJobsMessage(client,items,page,reports));}
 async openCampaign(chat,client,n,reports=false){const items=this.campaigns(client.id).filter(j=>!reports||!j.isDraft),view=this.campaignViews.get(String(chat)+':'+client.id+':'+reports);if(!view||view.expires<=this.now()||JSON.stringify(view.keys)!==JSON.stringify(items.map(j=>j.key))){await this.send(chat,'⚠️ Senarai kempen berubah. Pilih semula.');return this.campaignList(chat,client,1,reports);}const job=items[Number(n)-1];if(!job)return this.send(chat,'⚠️ Pilih nombor kempen dalam senarai.');if(job.isDraft)return this.send(chat,postUi.postingNewMessage(p.getPosting(this.databasePath,job.id)));if(job.archived)return this.send(chat,postUi.postingReportMessage({...job,displayNumber:Number(n)})+`\n↩️ ↳ .client ${client.displayNumber} → Profil Client`);if(reports)return this.postingLive.report(chat,job);return this.postingLive.show(chat,job.id,{feedback:true});}
 async review(chat,id,summary=null){
  const state=p.postingPaymentState(this.databasePath,id);
  if(state.required&&!state.chargeCents)return this.send(chat,ui.clientChargeMessage(p.getPosting(this.databasePath,id)));
  const review=p.capturePostingReview(this.databasePath,id,this.now());
  const plan=p.getPostingPlan(this.databasePath,id);
  if(state.required&&plan.targetMode==='SUCCESS'&&plan.targetValue>review.targetCount){this.payments.delete(String(chat));return this.send(chat,`⚠️ GROUP UNIK TIDAK CUKUP\n🎯 Target : ${plan.targetValue} Group WhatsApp\n👥 Tersedia : ${review.targetCount} group unik\n↩️ ↳ .target → Ubah Target\n📱 ↳ .pilih-akaun → Ubah Akaun`);}
  if(state.required&&plan.status==='READY'&&!state.paid)this.payments.set(String(chat),{id,fingerprint:state.fingerprint,review:review.fingerprint,expires:this.now()+120000});
  else this.payments.delete(String(chat));
  return this.send(chat,postUi.postingReviewMessage({...p.postingPlanSummary(this.databasePath,id),...(summary||{}),plan:{...(summary?.plan||p.getPostingPlan(this.databasePath,id)),review},payment:state}));
 }
 // Receipt delivery cannot roll back payment or block the command dispatcher.
 // Only this informational message may be retried; the payment mutation never is.
 deliverReceipt(chat,{retry=false}={}){
  if(this.closed)return false;
  const key=String(chat),receipt=p.readPostingFlowState(this.databasePath,'payment-receipt:'+key);
  if(!receipt||receipt.expires<=this.now())return false;
  const posting=p.getPosting(this.databasePath,receipt.id),state=p.postingPaymentState(this.databasePath,receipt.id);
  if(!posting||!state.paid||state.fingerprint!==receipt.fingerprint||p.getPostingJobForPosting(this.databasePath,receipt.id)){this.clearReceipt(chat);return false;}
  let delivery=this.receiptDeliveries.get(key);
  if(delivery?.busy)return true;
  if(delivery?.timer)clearTimeout(delivery.timer);
  if(!delivery){delivery={attempts:0};this.receiptDeliveries.set(key,delivery);}
  if(!retry)delivery.attempts=0;
  delivery.busy=true;delivery.attempts++;
  const plan=p.getPostingPlan(this.databasePath,receipt.id);
  const message=ui.clientPaymentReceiptMessage(posting,plan);
  delivery.task=(async()=>{
   try{await this.send(chat,message);}
   catch{
    if(!this.closed&&this.receiptDeliveries.get(key)===delivery&&delivery.attempts<2){
     delivery.timer=setTimeout(()=>{delivery.timer=null;try{this.deliverReceipt(chat,{retry:true});}catch{}},3000);delivery.timer.unref?.();
    }
   }finally{delivery.busy=false;}
  })();
  return true;
 }
 clearReceipt(chat){
  const key=String(chat),delivery=this.receiptDeliveries.get(key);
  if(delivery?.timer)clearTimeout(delivery.timer);
  this.receiptDeliveries.delete(key);
  if(p.readPostingFlowState(this.databasePath,'payment-receipt:'+key))p.savePostingFlowState(this.databasePath,'payment-receipt:'+key,null);
 }
 close(){this.closed=true;for(const d of this.receiptDeliveries.values())if(d.timer)clearTimeout(d.timer);this.receiptDeliveries.clear();}
 async handle(route){
  const {action,chatId:chat}=route,key=String(chat),text=String(route.text||'').trim(),args=route.args||[],payment=this.payments.get(key);
  if(payment&&action==='text'){
   if(payment.expires<=this.now()){this.payments.delete(key);await this.send(chat,'⚠️ Pengesahan bayaran tamat tempoh. Buka .posting-next dan semak semula.');return true;}
   if(text.toUpperCase()!=='SAH'){await this.send(chat,'✅ Balas SAH selepas bayaran penuh diterima.\n✖️ ↳ .batal → Simpan Draf & Keluar');return true;}
   this.payments.delete(key);
   try{
    if(p.postingReviewState(this.databasePath,payment.id,this.now()).fingerprint!==payment.review)throw new Error('Butiran berubah. Buka .posting-next dan sahkan semula.');
    p.confirmPostingPayment(this.databasePath,payment.id,payment.fingerprint);
    // Commit a receipt context before attempting notification. Retrying SAH is
    // read-only and remains bound to this exact invoice, including after restart.
    p.savePostingFlowState(this.databasePath,'payment-receipt:'+key,{id:payment.id,fingerprint:payment.fingerprint,expires:this.now()+600000});
   }catch(e){await this.send(chat,'⚠️ '+e.message);return true;}
   this.deliverReceipt(chat);return true;
  }
  if(action==='text'&&text.toUpperCase()==='SAH'&&!this.inputs.has(key)&&this.deliverReceipt(chat))return true;
  if(action!=='text'){
   this.payments.delete(key);this.clearReceipt(chat);
  }
  const input=this.inputs.get(key);
  if(action==='text'&&input){
   try{
    if(input.expires<=this.now()){this.inputs.delete(key);await this.send(chat,'⚠️ Input tamat tempoh. Buka .client semula.');return true;}
    if(input.kind==='choose'){
     if(text.toLowerCase()==='baru'){this.inputs.set(key,{kind:'new',posting:true,expires:this.now()+600000});await this.send(chat,ui.clientNewPrompt());return true;}
     const client=await this.resolve(chat,text);if(client)await this.begin(chat,client);return true;
    }
    if(input.kind==='new'){
     const matches=c.findClientsByName(this.clientsDbPath,text);
     if(matches.length){await this.send(chat,'🔎 NAMA CLIENT SUDAH WUJUD\n↳ Gunakan profil sedia ada.');await this.list(chat,1,input.posting);return true;}
     const client=c.createClient(this.clientsDbPath,text);this.inputs.delete(key);this.capture(chat);
     if(input.posting)await this.begin(chat,client);else{await this.send(chat,'✅ CLIENT DISIMPAN');await this.detail(chat,client);}return true;
    }
    if(input.kind==='edit-select'){
     const field={'1':'name','2':'contact','3':'notes'}[text];if(!field)throw new Error('Balas 1, 2 atau 3.');this.inputs.set(key,{...input,kind:'edit',field});await this.send(chat,ui.clientFieldPrompt(input.client,field));return true;
    }
    if(input.kind==='edit'){
     let value=text;
     if(input.field==='contact'&&text!=='-'){value=text.replace(/[\s()+.-]/g,'');if(!/^[1-9]\d{6,14}$/.test(value))throw new Error('Masukkan nombor bersama kod negara, contoh 60123456789, atau - untuk kosongkan.');value='+'+value;}
     const client=c.setClientField(this.clientsDbPath,input.client.id,input.field,value);this.inputs.delete(key);await this.send(chat,'✅ MAKLUMAT CLIENT DIKEMAS KINI');await this.detail(chat,client);return true;
    }
   }catch(e){await this.send(chat,'⚠️ '+e.message+'\n✖️ ↳ .batal → Batal Input');return true;}
  }
  if(action!=='text')this.inputs.delete(key);
  if(input&&['wa_cancel','wa_back','client_cancel'].includes(action)){await this.list(chat);return true;}
  if(!action.startsWith('client_')&&!['posting_client','posting_client_manual'].includes(action))return false;
  try{
   if(action==='client_cancel'){await this.list(chat);return true;}
   if(['posting_client','posting_client_manual','client_post'].includes(action)&&p.getUnstartedPosting(this.databasePath)){await this.send(chat,postUi.postingNewMessage(p.getUnstartedPosting(this.databasePath)));return true;}
   if(action==='client_list'||action==='posting_client'){await this.list(chat,args[0]||1,action==='posting_client');return true;}
   if(action==='client_new'||action==='posting_client_manual'){this.inputs.set(key,{kind:'new',posting:action==='posting_client_manual',expires:this.now()+600000});await this.send(chat,ui.clientNewPrompt());return true;}
   // Old commands do not mutate account-level prices or partial payments.
   if(action==='client_edit'){await this.send(chat,'👤 PENGURUSAN CLIENT\n↳ Buka .client, kemudian .client-edit N untuk profil.\n• Caj dan bayaran penuh ditetapkan dalam setiap kempen melalui .client-post N.');return true;}
   const client=await this.resolve(chat,args[0]);if(!client)return true;
   if(action==='client_detail')await this.detail(chat,client);
   else if(action==='client_post')await this.begin(chat,client);
   else if(action==='client_edit_menu'){this.inputs.set(key,{kind:'edit-select',client,expires:this.now()+600000});await this.send(chat,ui.clientEditMessage(client));}
   else if(action==='client_campaigns')await this.campaignList(chat,client,args[1]||1);
   else if(action==='client_campaign'&&!args[1])await this.campaignList(chat,client);
   else if(action==='client_campaign')await this.openCampaign(chat,client,args[1]);
   else if(action==='client_report_page')await this.campaignList(chat,client,args[1]||1,true);
   else if(action==='client_report'&&!args[1])await this.campaignList(chat,client,1,true);
   else if(action==='client_report')await this.openCampaign(chat,client,args[1],true);
   return true;
  }catch(e){await this.send(chat,'⚠️ CLIENT\n'+e.message+'\n↩️ ↳ .client → Senarai Client');return true;}
 }
}
