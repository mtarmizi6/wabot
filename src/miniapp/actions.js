import * as fu from '../followup/store.js';
import {deletionInfo} from './deletion.js';
import {policyDb} from '../system/policy.js';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import * as p from '../posting/store.js';
import * as g from '../groupstatus/store.js';
import * as a from '../whatsapp/autojoin-store.js';
import {diskReady} from '../system/disk.js';
export function panelActions({databasePath,projectRoot,manager,postingLive,joinRunner,joinFlow,gsRunners,beginGsRunner,gsRefresh,gsReport,forgetGs,ownerId,followupRunner,followupFlow}){
 const later=fn=>Promise.resolve().then(fn).catch(()=>{});
 return (job,action)=>{
  const id=job.id;
  if(job.kind==='fu'){
   if(!job.actions.includes(action))throw Error('Tindakan tidak tersedia.');
   if(['resume','continue'].includes(action)){if(!diskReady(databasePath))throw Error('Ruang peranti belum mencukupi.');if(!fu.getJob(databasePath,id,ownerId).accounts.some(a=>manager.get(a.id)?.status==='ONLINE'))throw Error('Tiada akaun ONLINE.');fu.startJob(databasePath,id,ownerId,{continueQuota:action==='continue'});followupRunner.start();}
   else fu.changeStatus(databasePath,id,ownerId,action==='pause'?'PAUSED':'STOPPED');
   later(()=>followupFlow.update(id));return;
  }
  if(action==='delete'){
   const check=deletionInfo(databasePath,job.kind,id);
   if(!check.allowed)throw Error(check.reason);
   if(check.fingerprint!==job.deletion?.fingerprint)throw Error('Rekod sudah berubah. Semak pengesahan semula.');
   if(job.kind==='post'){
    p.deletePostingReportRecord(databasePath,id);postingLive.messages?.get(id)?.close();postingLive.messages?.delete(id);
   }else if(job.kind==='gs'){
    if(gsRunners.has(id))throw Error('Operasi lama masih diselesaikan. Tunggu sebentar.');
    g.deleteGsJob(databasePath,id);
    policyDb(databasePath,db=>db.prepare('DELETE FROM system_gs_report_outbox WHERE id=?').run(id));
    forgetGs?.(id);
   }else if(job.kind==='join'){
    a.deleteAutoJoinJob(databasePath,id);joinFlow.forgetLive?.(id);
   }
   // Unreferenced media is handled by the existing reference-aware cleanup policy.
   return;
  }
  const target={pause:'PAUSED',resume:'RUNNING',stop:'STOPPED'}[action];
  if(!target||!job.actions.includes(action))throw new Error('Tindakan tidak tersedia.');
  if(action==='resume'&&!diskReady(databasePath))throw new Error('Ruang peranti belum mencukupi. Semak .storage.');
  if(job.kind==='post'){
   const raw=p.getPostingJob(databasePath,id);
   if(action==='resume'){
    p.finalizeExpiredPostingJobs(databasePath,Date.now());if(p.getPostingJob(databasePath,id).status==='COMPLETED'){postingLive.startScheduler(ownerId);later(()=>postingLive.refresh(id,true));return;}
    postingLive.checkMedia(raw.ads);if(!raw.accounts.some(x=>manager.get(x.accountId)?.status==='ONLINE'))throw new Error('Tiada akaun kempen ONLINE. Semak .accounts.');
   }
   p.setPostingJobStatus(databasePath,id,target);
   if(action==='resume'||action==='stop')postingLive.startScheduler(ownerId);
   later(()=>postingLive.refresh(id,true));
  }else if(job.kind==='gs'){
   const raw=g.getGsJob(databasePath,id);
   if(action==='resume'){
    if(gsRunners.has(id))throw new Error('Operasi lama masih diselesaikan. Cuba resume sebentar lagi.');
    if(raw.media_path&&!existsSync(join(projectRoot,raw.media_path)))throw new Error('Bahan Status hilang. Pulihkan fail sebelum resume.');
    if(!['TEXT','PHOTO'].includes(raw.kind))throw new Error('Enjin ini hanya menyokong teks / gambar.');
    if(!JSON.parse(raw.selected_accounts||'[]').some(x=>manager.get(x)?.status==='ONLINE'))throw new Error('Tiada akaun terpilih ONLINE.');
   }
   g.setGsStatus(databasePath,id,target);if(action==='resume')beginGsRunner(id,ownerId);
   later(()=>gsRefresh(id,ownerId));
   if(action==='stop')later(async()=>{await gsRunners.get(id);if(g.getGsJob(databasePath,id)?.status==='STOPPED')await gsReport(ownerId,id);});
  }else if(job.kind==='join'){
   if(action==='resume'&&!a.getAutoJoinJobAccounts(databasePath,id).some(x=>x.pending>0&&manager.get(x.id)?.status==='ONLINE'))throw new Error('Tiada akaun dengan baki ONLINE. Semak .accounts.');
   a.setAutoJoinJobStatus(databasePath,id,target);if(action==='resume')joinRunner.ensure();later(()=>joinFlow.updateLive(id,true));
  }else throw new Error('Sync dikawal melalui bot.');
 };
}
