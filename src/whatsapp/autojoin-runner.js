import {diskReady} from '../system/disk.js';
import * as store from './autojoin-store.js';
import {classifyAutoJoinError,autoJoinRetryDelayMs} from './join.js';

// One pump for all jobs. No parallel groupAcceptInvite calls within Auto Join.
export class AutoJoinRunner {
  constructor({databasePath,manager,onUpdate=async()=>{},sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now}) {
    Object.assign(this,{databasePath,manager,onUpdate,sleep,now});
    this.task=null;this.closed=false;this.busy=false;this.activities=new Map();this.jobCursor=0;
  }
  jobs() {
    const jobs=[];let page=1,data;
    do {data=store.listAutoJoinJobs(this.databasePath,{page:page++,perPage:50});jobs.push(...data.items);} while(page<=data.totalPages);
    return jobs.filter(j=>j.status==='RUNNING');
  }
  async notify(id) {try{await this.onUpdate(id);}catch{} }
  async tick() {
    if(this.closed||this.busy)return false;
    this.busy=true;
    try {
      if(!diskReady(this.databasePath)){for(const j of this.jobs())this.activities.set(j.id,{text:'Ruang peranti rendah · Penghantaran ditangguh'});return false;}
      const jobs=this.jobs(); if(!jobs.length)return false;
      for(let offset=0;offset<jobs.length;offset++) {
        const index=(this.jobCursor+offset)%jobs.length;const job=jobs[index];
        const progress=store.refreshAutoJoinJobStats(this.databasePath,job.id);
        if(!progress.pending&&!progress.processing) {store.setAutoJoinJobStatus(this.databasePath,job.id,'COMPLETED');await this.notify(job.id);continue;}
        const all=store.getAutoJoinJobAccounts(this.databasePath,job.id).filter(a=>a.pending>0&&!a.deletedAt);
        const online=all.filter(a=>this.manager.get(a.id)?.status==='ONLINE');
        const ready=online.filter(a=>!a.availableAt||Date.parse(a.availableAt)<=this.now());
        if(!ready.length) {
          const next=online.length?Math.max(0,Math.ceil((Math.min(...online.map(a=>Date.parse(a.availableAt)||this.now()))-this.now())/1000)):null;
          this.activities.set(job.id,{text:online.length?`Menunggu giliran seterusnya · ${next}s`:'Menunggu Sambungan',waitSec:next});
          await this.notify(job.id);continue;
        }
        const selected=ready.find(a=>a.position>job.cursor)||ready[0];
        const target=store.claimNextAutoJoinTarget(this.databasePath,job.id,selected.id);
        if(!target)continue;
        this.jobCursor=(index+1)%jobs.length;
        this.activities.set(job.id,{account:selected,groupName:null,linkPosition:target.linkPosition,text:'Sedang memproses'});
        await this.notify(job.id);
        try {
          const result=await this.manager.joinGroupInvite(selected.id,target.inviteCode,{beforeSend:()=>{
            if(this.closed||store.getAutoJoinJob(this.databasePath,job.id)?.status!=='RUNNING')return false;
            return store.markAutoJoinDispatched(this.databasePath,target.id);
          }});
          store.completeAutoJoinTarget(this.databasePath,target.id,{...result,status:result.status||'UNKNOWN',schedule:true});
          this.activities.set(job.id,{account:selected,groupName:result.groupName,linkPosition:target.linkPosition,text:'Menunggu giliran seterusnya'});
        } catch(error) {
          const c=classifyAutoJoinError(error);
          const active=store.getAutoJoinJob(this.databasePath,job.id)?.status==='RUNNING'&&!this.closed;
          if(error.joinDispatched===false&&!active) store.requeueAutoJoinTarget(this.databasePath,target.id,'Dijeda sebelum permintaan dihantar.');
          else if(c.kind==='account') {
            store.setAutoJoinAccountWait(this.databasePath,job.id,selected.id,Math.max(10,c.retryAfterSec||0));
            store.requeueAutoJoinTarget(this.databasePath,target.id,c.userMessage);
          } else if(c.retryable&&target.retryCount<3) {
            const retry=store.incrementAutoJoinRetry(this.databasePath,target.id);
            store.setAutoJoinAccountWait(this.databasePath,job.id,selected.id,Math.max(autoJoinRetryDelayMs(retry)/1000,c.retryAfterSec||0));
            store.requeueAutoJoinTarget(this.databasePath,target.id,c.userMessage);
          } else {
            if(c.retryAfterSec) store.setAutoJoinAccountWait(this.databasePath,job.id,selected.id,c.retryAfterSec);
            store.completeAutoJoinTarget(this.databasePath,target.id,{status:c.kind==='already'?'ALREADY':c.kind==='approval'?'APPROVAL':c.kind==='uncertain'?'UNKNOWN':'FAILED',error:c.userMessage,schedule:true});
            if(c.kind==='restricted') store.setAutoJoinJobStatus(this.databasePath,job.id,'PAUSED');
          }
          this.activities.set(job.id,{account:selected,linkPosition:target.linkPosition,text:c.userMessage});
        }
        await this.notify(job.id);return true;
      }
      return false;
    } finally {this.busy=false;}
  }
  ensure() {
    if(this.task||this.closed)return this.task;
    this.task=(async()=>{
      while(!this.closed&&this.jobs().length) {
        try{await this.tick();}
        catch {
          const affected=this.jobs();
          for(const j of affected)store.setAutoJoinJobStatus(this.databasePath,j.id,'PAUSED');
          store.recoverAutoJoinJobs(this.databasePath);
          for(const j of affected)await this.notify(j.id);
          break;
        }
        if(!this.closed)await this.sleep(1000);
      }
    })().finally(()=>{this.task=null;});
    return this.task;
  }
  close() { this.closed=true; }
}
