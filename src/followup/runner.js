import * as store from './store.js';
import {diskReady} from '../system/disk.js';
export class FollowupRunner {
 constructor({databasePath,owner,manager,onUpdate=async()=>{},now=Date.now,random=Math.random,timeoutMs=60000}){Object.assign(this,{databasePath,owner:String(owner),manager,onUpdate,now,random,timeoutMs});this.busy=false;this.closed=false;this.cursor=0;}
 async notify(id){try{await this.onUpdate(id);}catch{}}
 start(){if(this.closed||this.timer)return;this.timer=setInterval(()=>this.tick().catch(()=>{}),1000);this.timer.unref?.();}
 async tick(){if(this.closed||this.busy)return false;this.busy=true;
 try{if(!diskReady(this.databasePath))return false;
 const jobs=store.listJobs(this.databasePath,this.owner).filter(j=>j.status==='RUNNING');
 for(let i=0;i<jobs.length;i++){
  const j=jobs[(this.cursor+i)%jobs.length],online=this.manager.list().filter(a=>a.status==='ONLINE').map(a=>a.id);
  const work=store.claim(this.databasePath,j.id,this.owner,online,this.now());
  if(!work){await this.notify(j.id);continue;}
  this.cursor=(this.cursor+i+1)%jobs.length;await this.notify(j.id);
  let expired=false,started=false,timer;
  const complete=result=>store.finish(this.databasePath,work,result,this.now(),this.random);
  try{
   const sending=this.manager.sendFollowupAd(work.account_id,work.phone,work.ad,{
    onSendStarted:()=>{if(expired||this.closed||store.getJob(this.databasePath,j.id,this.owner)?.status!=='RUNNING')throw Error('Dihentikan sebelum send.');started=true;},
    onSendResult:sent=>{if(sent?.key?.id){complete({status:'SUCCESS',messageId:sent.key.id});this.notify(j.id);}}
   });
   const sent=await Promise.race([sending,new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(Error('Timeout penghantaran.'));},this.timeoutMs);})]);
   complete({status:sent?.messageId?'SUCCESS':'UNKNOWN',messageId:sent?.messageId,error:sent?.messageId?null:'Tiada pengesahan message ID.'});
  }catch(error){expired=true;complete({status:started&&!error.definiteRejection?'UNKNOWN':'FAILED',error:started?'Penghantaran tidak disahkan / ditolak. Tiada retry.':'Tidak dihantar; semak akaun atau bahan. Tiada retry.'});}
  finally{clearTimeout(timer);}
  // Terminal status is calculated without claiming another recipient.
  const s=store.snapshot(this.databasePath,j.id,this.owner);
  if(s.job.status==='RUNNING'&&!s.counts.PENDING&&!s.counts.PROCESSING)store.editJob(this.databasePath,j.id,this.owner,j=>{j.status='COMPLETED';j.endedAt=new Date(this.now()).toISOString();});
  else if(s.job.status==='RUNNING'&&store.withDb(this.databasePath,db=>store.quotaExhausted(s.job,db)))store.changeStatus(this.databasePath,j.id,this.owner,'QUOTA');
  await this.notify(j.id);return true;
 }
 return false;
 }finally{this.busy=false;}}
 close(){this.closed=true;clearInterval(this.timer);this.timer=null;}
}
