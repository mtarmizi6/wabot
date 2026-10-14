import * as s from '../whatsapp/autojoin-store.js';
import {listWhatsAppAccounts} from '../whatsapp/store.js';
import * as ui from './autojoin-ui.js';

export class AutoJoinFlow {
 constructor({databasePath,manager,runner,send,edit,readDocument,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}) {
  Object.assign(this,{databasePath,manager,runner,send,edit,readDocument,now,setTimer,clearTimer});
  this.users=new Map();this.live=new Map();this.closed=false;
 }
 user(chat) {const key=String(chat);if(!this.users.has(key))this.users.set(key,{active:false,jobId:null,jobIds:null,accountIds:null,confirmation:null});return this.users.get(key);}
 leave(chat) {const u=this.user(chat);u.active=false;u.confirmation=null;}
 ids() {const ids=[];let data,page=1;do{data=s.listAutoJoinJobs(this.databasePath,{page:page++,perPage:50});ids.push(...data.items.map(j=>j.id));}while(page<=data.totalPages);return ids;}
 fingerprint() {return this.ids().join(',');}
 capture(chat) {this.user(chat).jobIds=this.ids();}
 async list(chat,page=1,message='') {
  const data=s.listAutoJoinJobs(this.databasePath,{page});data.items=data.items.map(j=>s.refreshAutoJoinJobStats(this.databasePath,j.id));this.capture(chat);
  return this.send(chat,(message?`⚠️ ${message}\n\n`:'')+ui.listScreen(data));
 }
 async resolve(chat,value,action) {
  const u=this.user(chat),ids=this.ids();
  if(value) {
    if(!u.jobIds||u.jobIds.join(',')!==ids.join(',')) {await this.list(chat,1,'Senarai job perlu disahkan semula. Pilih nombor daripada senarai ini.');return null;}
    const id=u.jobIds[Number(value)-1];if(!id) {await this.list(chat,1,'Nombor job tidak ditemui.');return null;}
    u.jobId=id;
  }
  if(u.jobId&&!ids.includes(u.jobId))u.jobId=null;
  if(!u.jobId) {
    let relevant=ids.map(id=>s.getAutoJoinJob(this.databasePath,id));
    if(['join_pause','join_stop'].includes(action))relevant=relevant.filter(j=>['RUNNING','PAUSED'].includes(j.status));
    if(action==='join_resume')relevant=relevant.filter(j=>['PAUSED','STOPPED'].includes(j.status));
    if(action==='join_run')relevant=relevant.filter(j=>j.status==='DRAFT');
    if(relevant.length!==1){await this.list(chat,1,relevant.length?'Pilih job sasaran dahulu.':'Tiada job yang sesuai.');return null;}
    u.jobId=relevant[0].id;
  }
  return s.refreshAutoJoinJobStats(this.databasePath,u.jobId);
 }
 async accounts(chat,job,page=1) {
  const items=listWhatsAppAccounts(this.databasePath);const busy=new Set(s.autoJoinAccountConflicts(this.databasePath,items.map(a=>a.id),job.id).map(x=>x.accountId));
  this.user(chat).accountIds=items.map(a=>a.id);
  const available=items.filter(a=>a.status==='ONLINE'&&!busy.has(a.id));
  return this.send(chat,(!available.length?'⚠️ Tiada akaun ONLINE yang tersedia. Akaun offline perlu disambung; akaun digunakan perlu dilepaskan oleh job lain.\n\n':'')+ui.accountChoice(items,busy,page));
 }
 async renderDraft(chat) {
  let j=s.getDraftAutoJoinJob(this.databasePath);if(!j)return this.send(chat,'Tiada draf.\n➕ ↳ .join-new → Cipta Job');
  const u=this.user(chat);u.active=true;u.jobId=j.id;u.confirmation=null;this.capture(chat);
  if(j.selectionDirty)j=s.setAutoJoinDraftStage(this.databasePath,j.id,'ACCOUNTS');
  const a=s.getAutoJoinJobAccounts(this.databasePath,j.id);
  if(j.stage==='ACCOUNTS')return this.accounts(chat,j);
  if(j.stage==='DISTRIBUTION')return this.send(chat,ui.distributionChoice());
  if(j.stage==='INPUT')return this.send(chat,ui.inputScreen());
  if(j.stage==='REVIEW')return this.send(chat,ui.reviewScreen(s.refreshAutoJoinJobStats(this.databasePath,j.id),a));
  if(j.stage==='SETTINGS')return this.send(chat,ui.settingsScreen(j));
  if(j.stage==='FINAL')return this.send(chat,ui.finalScreen(s.refreshAutoJoinJobStats(this.databasePath,j.id),a));
  return this.send(chat,ui.settingPrompt(j));
 }
 async chooseAccounts(chat,text) {
  const j=s.getDraftAutoJoinJob(this.databasePath),u=this.user(chat),items=listWhatsAppAccounts(this.databasePath);
  if(!j)return this.send(chat,'Cipta draf dahulu.\n➕ ↳ .join-new → Cipta Job');
  if(!u.accountIds||u.accountIds.join(',')!==items.map(a=>a.id).join(',')) {s.setAutoJoinDraftStage(this.databasePath,j.id,'ACCOUNTS');await this.send(chat,'⚠️ Senarai akaun berubah. Pilih semula.');return this.accounts(chat,j);}
  const busy=new Set(s.autoJoinAccountConflicts(this.databasePath,items.map(a=>a.id),j.id).map(x=>x.accountId));
  let selected;
  if(text.toLowerCase()==='all')selected=items.filter(a=>a.status==='ONLINE'&&!busy.has(a.id));
  else {
    if(!/^\d+(?:\s*,\s*\d+)*$/.test(text))throw new Error('Hantar 1, 1,2 atau all.');
    selected=[...new Set(text.split(',').map(Number))].map(n=>items[n-1]);
  }
  if(!selected.length||selected.some(a=>!a||a.status!=='ONLINE'||busy.has(a.id)||this.manager.get(a.id)?.status!=='ONLINE'))throw new Error('Pilihan mengandungi akaun offline / digunakan job lain. Pilih akaun yang tersedia.');
  s.setAutoJoinDraftAccounts(this.databasePath,j.id,selected.map(a=>a.id));return this.renderDraft(chat);
 }
 async input(chat,text) {
  const u=this.user(chat);text=String(text||'').trim();
  if(!text)throw new Error('Input kosong. Hantar nilai mengikut contoh pada langkah semasa.');
  if(u.confirmation)return this.confirm(chat,text);
  const j=s.getDraftAutoJoinJob(this.databasePath);if(!j)return this.send(chat,'Tiada draf.\n➕ ↳ .join-new → Cipta Job');
  if(j.stage==='ACCOUNTS')return this.chooseAccounts(chat,text);
  if(j.stage==='DISTRIBUTION') {if(!['1','2'].includes(text))throw new Error('Balas 1 atau 2 untuk memilih agihan link.');s.setAutoJoinDistribution(this.databasePath,j.id,text==='1'?'ROUND_ROBIN':'ALL_EACH');return this.renderDraft(chat);}
  if(j.stage==='INPUT') {
    const next=s.addAutoJoinLinks(this.databasePath,j.id,text);
    if(!next.validCount)await this.send(chat,`⚠️ Tiada link format sah. Dikesan ${next.totalInput}; tidak sah ${next.invalidCount}. Hantar link WhatsApp atau fail TXT.\n🔎 ↳ .join-invalid → Lihat Input Tidak Sah`);
    return this.renderDraft(chat);
  }
  if(j.stage.startsWith('SETTING_')) {
    const d={...(j.settingDraft||j)};
    const values=text.split(/[\s,]+/).map(Number);
    const range=(count,min,max)=>{if(values.length!==count||values.some(n=>!Number.isInteger(n)||n<min||n>max)||count===2&&values[0]>values[1])throw new Error(`Hantar ${count===2?'minimum dan maksimum':'satu nilai'} dalam julat ${min}–${max}. Contoh: ${count===2?min+' '+max:min}.`);};
    let next;
    if(j.stage==='SETTING_DELAY'){range(2,10,3600);[d.delayMinSec,d.delayMaxSec]=values;next='SETTING_BATCH';}
    if(j.stage==='SETTING_BATCH'){range(1,1,100);d.batchSize=values[0];next='SETTING_REST';}
    if(j.stage==='SETTING_REST'){range(2,0,360);[d.restMinSec,d.restMaxSec]=values.map(n=>n*60);next='SETTING_EVERY';}
    if(j.stage==='SETTING_EVERY'){range(1,1,1000);d.cooldownEvery=values[0];next='SETTING_COOLDOWN';}
    if(j.stage==='SETTING_COOLDOWN'){range(1,0,720);d.cooldownSec=values[0]*60;s.validateAutoJoinSettings(d);next='SETTING_REVIEW';}
    if(j.stage==='SETTING_REVIEW') {
      if(text.toUpperCase()!=='SAH')throw new Error('Balas SAH untuk simpan tetapan, atau .kembali.');
      s.saveAutoJoinDraftSettings(this.databasePath,j.id,d);return this.renderDraft(chat);
    }
    s.setAutoJoinDraftStage(this.databasePath,j.id,next,d);return this.renderDraft(chat);
  }
  return this.renderDraft(chat);
 }
 async confirm(chat,text) {
  const u=this.user(chat),c=u.confirmation;
  if(this.now()>c.expires||this.fingerprint()!==c.fingerprint) {u.confirmation=null;return this.list(chat,1,'Pengesahan tamat tempoh / senarai berubah. Pilih job semula.');}
  if(text.toUpperCase()!=='SAH')return this.send(chat,'Balas SAH untuk tindakan pada job yang dipaparkan, atau .batal.');
  u.confirmation=null;u.active=false;const j=s.getAutoJoinJob(this.databasePath,c.id);
  if(!j)throw new Error('Job tidak lagi tersedia.');
  if(c.action==='partial')return this.start(chat,j,c.resume,true);
  if(c.action==='delete') {
    s.deleteAutoJoinJob(this.databasePath,j.id);this.forgetLive(j.id);u.jobId=null;u.jobIds=null;
    return this.list(chat,1,'Rekod job dan baki dipadam. Keahlian group WhatsApp serta akaun dikekalkan.');
  }
  if(['RUNNING','PAUSED'].includes(j.status))s.setAutoJoinJobStatus(this.databasePath,j.id,'STOPPED');
  await this.send(chat,`⏹ AUTO JOIN DIHENTIKAN\n↳ Job ${ui.joinNumber(j)}\n\nPengambilan sasaran baharu dihentikan. Operasi yang sudah dihantar akan direkodkan. Rekod dan baki disimpan.`);
  return this.show(chat,j.id);
 }
 async start(chat,job,resume=false,partialConfirmed=false) {
  if(!resume&&job.status==='DRAFT'&&job.stage!=='FINAL') {this.user(chat).active=true;return this.renderDraft(chat);}
  if(job.status==='RUNNING')return this.show(chat,job.id);
  if(resume&&!['PAUSED','STOPPED'].includes(job.status))throw new Error('Job ini tidak berada dalam keadaan dijeda / dihentikan.');
  const progress=s.refreshAutoJoinJobStats(this.databasePath,job.id);
  if(!progress.pending) {await this.send(chat,'Tiada sasaran PENDING untuk disambung. Hasil selesai / belum pasti tidak dihantar semula.');return this.show(chat,job.id);}
  const a=s.getAutoJoinJobAccounts(this.databasePath,job.id).filter(a=>a.pending>0);
  if(!a.some(x=>this.manager.get(x.id)?.status==='ONLINE'))throw new Error('Semua akaun dengan baki belum ONLINE. Job belum dimulakan. Semak .accounts.');
  const offline=a.filter(x=>this.manager.get(x.id)?.status!=='ONLINE');
  if(offline.length&&!partialConfirmed) {
    this.user(chat).confirmation={action:'partial',id:job.id,resume,expires:this.now()+180000,fingerprint:this.fingerprint()};
    return this.send(chat,`⚠️ SEBAHAGIAN AKAUN OFFLINE\n↳ Job ${ui.joinNumber(job)}\n\n${offline.map(ui.joinAccount).join('\n')}\n\nSasaran akaun ini kekal menunggu. Akaun ONLINE boleh meneruskan.\n\n✅ ↳ Balas SAH → Mula Akaun Tersedia\n✖️ ↳ .batal → Batal`);
  }
  s.setAutoJoinJobStatus(this.databasePath,job.id,'RUNNING');this.user(chat).active=false;
  // Start independently of whether the Telegram dashboard can be delivered.
  this.runner.ensure();return this.show(chat,job.id);
 }
 async show(chat,id) {
  if(this.closed)return;
  this.user(chat).jobId=id;this.capture(chat);
  // Keep the object held by an in-flight edit; replacing it loses its result.
  let state=this.live.get(id);
  if(!state){state={chatId:chat};this.live.set(id,state);}
  return this.updateLive(id,true);
 }
 async updateLive(id,force=false) {
  const state=this.live.get(id);if(!state||this.closed)return;
  if(state.failures>3&&!force)return;
  state.dirty=true;state.force=state.force||force;
  if(force)state.failures=0;
  return this.flushLive(id,state);
 }
 scheduleLive(id,state,delay) {
  if(this.closed||this.live.get(id)!==state)return;
  if(state.timer)this.clearTimer(state.timer);
  state.timer=this.setTimer(()=>{
    state.timer=null;
    return this.flushLive(id,state).catch(()=>{});
  },Math.max(1,delay));
  state.timer?.unref?.();
 }
 forgetLive(id) {
  const state=this.live.get(id);if(state?.timer)this.clearTimer(state.timer);
  this.live.delete(id);
 }
 close() {this.closed=true;for(const id of this.live.keys())this.forgetLive(id);}
 async flushLive(id,state) {
  if(state.busy||this.closed||this.live.get(id)!==state)return;
  state.busy=true;
  if(state.timer){this.clearTimer(state.timer);state.timer=null;}
  try {
    while(state.dirty&&!this.closed&&this.live.get(id)===state) {
      const j=s.refreshAutoJoinJobStats(this.databasePath,id);if(!j){this.forgetLive(id);return;}
      const activity={...(this.runner.activities.get(id)||{})};
      if(activity.account)activity.account=this.manager.get(activity.account.id)||activity.account;
      const text=ui.dashboard(j,s.listRecentAutoJoinTargets(this.databasePath,id,10),activity);
      const urgent=state.force||j.status!==state.lastStatus||(j.status!=='RUNNING'&&j.processing!==state.lastProcessing);
      if(!urgent&&state.text===text){state.dirty=false;return;}
      const wait=Math.max((state.retryAt||0)-this.now(),urgent?0:5000-(this.now()-(state.lastAt||0)));
      if(wait>0){this.scheduleLive(id,state,wait);return;}
      state.dirty=false;state.force=false;state.lastAt=this.now();
      try {
        if(state.messageId) {
          try {await this.edit(state.chatId,state.messageId,text);}
          catch(error) {
            if(/message to edit not found|message can't be edited|message identifier is not specified/i.test(error.message||''))state.messageId=null;
            else if(!/message is not modified/i.test(error.message||''))throw error;
          }
        }
        if(!state.messageId) {
          if(this.closed||this.live.get(id)!==state)return;
          const sendWait=15000-(this.now()-(state.lastSendAt??-Infinity));
          if(sendWait>0){state.dirty=true;this.scheduleLive(id,state,sendWait);return;}
          state.lastSendAt=this.now();
          const sent=await this.send(state.chatId,text);
          if(!sent?.message_id)throw new Error('Dashboard belum dihantar.');
          state.messageId=sent.message_id;
        }
        state.text=text;state.lastStatus=j.status;state.lastProcessing=j.processing;
        state.failures=0;state.retryAt=0;
      } catch(error) {
        // Retry delivery even after the runner has paused. Never retry a join here.
        state.dirty=true;state.failures=(state.failures||0)+1;
        if(state.failures<=3) {
          const delay=Math.max([3000,10000,30000][state.failures-1],Number(error.retryAfterSec||0)*1000);
          state.retryAt=this.now()+delay;this.scheduleLive(id,state,delay);
        }
        return;
      }
    }
  } finally {state.busy=false;}
 }
 async handle(route) {
  const {action,chatId:chat}=route,u=this.user(chat),args=route.args||[];
  const own=action==='join'||action.startsWith('join_');
  const input=['text','document','wa_cancel','wa_back'].includes(action)&&(u.active||u.confirmation);
  if(!own&&!input) {if(!['text','document'].includes(action))this.leave(chat);return false;}
  try {
    if(action==='text'){await this.input(chat,route.text);return true;}
    if(action==='wa_cancel') {this.leave(chat);await this.send(chat,'✖️ INPUT DIBATALKAN\n↳ Draf dan job yang sudah dimulakan dikekalkan.\n\n📝 ↳ .join-draft → Sambung Draf\n🔗 ↳ .join → Menu Auto Join');return true;}
    if(action==='wa_back') {
      if(u.confirmation){u.confirmation=null;await this.send(chat,ui.joinHome(s.autoJoinSummary(this.databasePath)));return true;}
      const j=s.getDraftAutoJoinJob(this.databasePath);if(!j)throw new Error('Tiada draf.');
      const back={DISTRIBUTION:'ACCOUNTS',INPUT:s.getAutoJoinJobAccounts(this.databasePath,j.id).length>1?'DISTRIBUTION':'ACCOUNTS',REVIEW:'INPUT',SETTINGS:'REVIEW',FINAL:'SETTINGS',SETTING_DELAY:'SETTINGS',SETTING_BATCH:'SETTING_DELAY',SETTING_REST:'SETTING_BATCH',SETTING_EVERY:'SETTING_REST',SETTING_COOLDOWN:'SETTING_EVERY',SETTING_REVIEW:'SETTING_COOLDOWN'};
      s.setAutoJoinDraftStage(this.databasePath,j.id,back[j.stage]||'ACCOUNTS');await this.renderDraft(chat);return true;
    }
    if(action==='document') {
      const j=s.getDraftAutoJoinJob(this.databasePath),d=route.document||{};
      if(j?.stage!=='INPUT')throw new Error('Buka .join-add untuk menambah fail TXT.');
      if(!/\.txt$/i.test(d.fileName||''))throw new Error('Hantar fail .txt sahaja.');
      if(Number(d.fileSize||0)>1024*1024)throw new Error('Had fail TXT ialah 1 MB.');
      const buffer=await this.readDocument(d);
      if(buffer.length>1024*1024)throw new Error('Had fail TXT ialah 1 MB.');
      if(!buffer.length)throw new Error('Fail TXT kosong.');
      if(buffer.includes(0))throw new Error('Gunakan fail teks biasa UTF-8.');
      await this.input(chat,new TextDecoder('utf-8',{fatal:true}).decode(buffer));return true;
    }
    u.confirmation=null;
    if(action==='join') {u.active=false;await this.send(chat,ui.joinHome(s.autoJoinSummary(this.databasePath)));return true;}
    if(['join_new','join_start'].includes(action)) {
      if(s.getDraftAutoJoinJob(this.databasePath))await this.send(chat,'📝 DRAF AUTO JOIN SUDAH ADA\n\n📝 ↳ .join-draft → Sambung Draf\n🗑️ ↳ .join-draft-delete → Buang Draf');
      else {s.createAutoJoinJob(this.databasePath);await this.renderDraft(chat);}return true;
    }
    if(action==='join_draft'){await this.renderDraft(chat);return true;}
    if(action==='join_accounts') {const j=s.getDraftAutoJoinJob(this.databasePath);if(!j)throw new Error('Cipta draf melalui .join-new.');s.setAutoJoinDraftStage(this.databasePath,j.id,'ACCOUNTS');u.active=true;await this.accounts(chat,j,Number(args[0]||1));return true;}
    if(action==='join_select') {if(!s.getDraftAutoJoinJob(this.databasePath))s.createAutoJoinJob(this.databasePath);u.active=true;await this.chooseAccounts(chat,String(args[0]||''));return true;}
    if(['join_add','join_link','join_txt','join_next','join_setting','join_setting_custom','join_setting_standard','join_invalid'].includes(action)) {
      const j=s.getDraftAutoJoinJob(this.databasePath);if(!j)throw new Error('Cipta draf melalui .join-new dahulu.');u.active=true;u.jobId=j.id;
      if(action==='join_invalid') {
        const pages=Math.max(1,Math.ceil(j.invalid.length/10)),page=Math.min(pages,Math.max(1,Number(args[0])||1));
        await this.send(chat,`🔎 INPUT TIDAK SAH\n↳ Halaman ${page}/${pages}\n\n${j.invalid.slice((page-1)*10,page*10).map((x,i)=>`${(page-1)*10+i+1}. ${x}`).join('\n')||'Tiada input tidak sah.'}\n\n${page>1?`⬅️ ↳ .join-invalid ${page-1} → Sebelum\n`:''}${page<pages?`➡️ ↳ .join-invalid ${page+1} → Seterusnya\n`:''}📝 ↳ .join-draft → Sambung Draf`);return true;
      }
      if(['join_add','join_link','join_txt'].includes(action)) {if(!j.distribution||j.selectionDirty||!s.getAutoJoinJobAccounts(this.databasePath,j.id).length)throw new Error('Pilih akaun dan agihan dahulu melalui .join-draft.');s.setAutoJoinDraftStage(this.databasePath,j.id,'INPUT');}
      else if(action==='join_next') {
        if(!j.validCount)throw new Error('Masukkan sekurang-kurangnya satu link format sah.');
        if(!['REVIEW','SETTINGS'].includes(j.stage))throw new Error('Lengkapkan langkah semasa dahulu melalui .join-draft.');
        s.setAutoJoinDraftStage(this.databasePath,j.id,j.stage==='REVIEW'?'SETTINGS':'FINAL');
      } else if(action==='join_setting_standard')s.saveAutoJoinDraftSettings(this.databasePath,j.id,{delayMinSec:60,delayMaxSec:120,batchSize:5,restMinSec:300,restMaxSec:600,cooldownEvery:25,cooldownSec:900});
      else {if(!j.validCount)throw new Error('Masukkan link dahulu.');s.setAutoJoinDraftStage(this.databasePath,j.id,'SETTING_DELAY',{...j,settingDraft:undefined});}
      await this.renderDraft(chat);return true;
    }
    if(['join_list','join_report_page'].includes(action)) {u.active=false;await this.list(chat,Number(args[0]||1));return true;}
    let job;
    if(['join_draft_delete','join_reset'].includes(action))job=s.getDraftAutoJoinJob(this.databasePath);
    else job=await this.resolve(chat,args[0],action);
    if(!job)return true;u.jobId=job.id;u.active=false;
    if(['join_run','join_resume'].includes(action))await this.start(chat,job,action==='join_resume');
    else if(action==='join_status')await this.show(chat,job.id);
    else if(action==='join_report') {this.capture(chat);await this.send(chat,ui.reportScreen(s.refreshAutoJoinJobStats(this.databasePath,job.id),s.autoJoinAccountResults(this.databasePath,job.id),Number(args[1]||1)));}
    else if(action==='join_report_info'){this.capture(chat);await this.send(chat,ui.detailsScreen(job,s.listAutoJoinTargets(this.databasePath,job.id,{page:Number(args[1]||1)})));}
    else if(action==='join_pause') {
      if(!['RUNNING','PAUSED'].includes(job.status)){await this.show(chat,job.id);return true;}
      if(job.status==='RUNNING')s.setAutoJoinJobStatus(this.databasePath,job.id,'PAUSED');
      const p=s.refreshAutoJoinJobStats(this.databasePath,job.id);
      // A command acknowledgement must not wait behind an older dashboard edit.
      void this.show(chat,job.id).catch(()=>{});
      await this.send(chat,`⏸ AUTO JOIN DIJEDA\n↳ Job ${ui.joinNumber(job)}${job.status==='PAUSED'?' · Sudah dijeda':''}\n\n• Sasaran baharu tidak akan diambil.\n${p.processing?'• Operasi yang sudah bermula sedang diselesaikan / direkodkan.\n':''}• Baki dan masa rehat disimpan.\n\n📊 ↳ .join-status ${ui.joinNumber(job)} → Lihat Status\n▶️ ↳ .join-resume ${ui.joinNumber(job)} → Sambung`);
    }
    else if(['join_stop','join_delete','join_draft_delete','join_reset'].includes(action)) {
      const deleting=action!=='join_stop',p=s.refreshAutoJoinJobStats(this.databasePath,job.id);
      if(deleting&&(job.status==='RUNNING'||p.processing))throw new Error('Hentikan job dan tunggu operasi semasa direkodkan dahulu.');
      if(!deleting&&!['RUNNING','PAUSED'].includes(job.status)){await this.show(chat,job.id);return true;}
      u.confirmation={action:deleting?'delete':'stop',id:job.id,fingerprint:this.fingerprint(),expires:this.now()+180000};
      await this.send(chat,`${deleting?'🗑️ PADAM DRAF / JOB?':'⏹ HENTIKAN AUTO JOIN?'}\n\n📋 Job : ${ui.joinNumber(job)}\n📨 Selesai Proses : ${p.processed}/${p.targetTotal}\n📥 Baki : ${p.pending}\n⚡ Sedang Diproses : ${p.processing}\n\n${deleting?'• Rekod job dan baki akan dibuang.\n• Akaun dan keahlian group WhatsApp dikekalkan.':'• Sasaran baharu tidak akan diambil.\n• Permintaan yang sudah dihantar mungkin masih selesai.\n• Rekod dan baki akan disimpan.'}\n\n✅ ↳ Balas SAH → ${deleting?'Padam':'Hentikan'}\n✖️ ↳ .batal → Batal\n\nPengesahan sah selama 3 minit.`);
    }
  } catch(error) {await this.send(chat,`⚠️ AUTO JOIN\n${error instanceof TypeError?'Input tidak dapat dibaca. Semak format dan cuba semula.':String(error.message||'Proses terganggu.').slice(0,350)}\n\n📝 ↳ .join-draft → Sambung Draf\n🔗 ↳ .join → Menu Auto Join`);}
  return true;
 }
}
