// Serialized, coalesced dashboard delivery. Rendering always reads current state.
export class LiveMessage {
 constructor({send,edit,chatId,render,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout,interval=3000,onMessageId=()=>{}}) {
  Object.assign(this,{send,edit,chatId,render,now,setTimer,clearTimer,interval,onMessageId});this.closed=false;
 }
 update(force=false) {
  if(this.closed||this.failures>3&&!force)return Promise.resolve();
  this.dirty=true;this.force=this.force||force;if(force)this.failures=0;
  return this.flush();
 }
 schedule(delay) {
  if(this.closed)return;
  if(this.timer)this.clearTimer(this.timer);
  this.timer=this.setTimer(()=>{this.timer=null;return this.flush().catch(()=>{});},Math.max(1,delay));this.timer?.unref?.();
 }
 async flush() {
  if(this.busy||this.closed)return;this.busy=true;
  if(this.timer){this.clearTimer(this.timer);this.timer=null;}
  try {
   while(this.dirty&&!this.closed) {
    const text=this.render();
    if(text===this.text&&!this.force){this.dirty=false;return;}
    const wait=Math.max((this.retryAt||0)-this.now(),this.force?0:this.interval-(this.now()-(this.lastAt??-Infinity)));
    if(wait>0){this.schedule(wait);return;}
    this.dirty=false;this.force=false;this.lastAt=this.now();
    try {
     if(this.messageId) {
      try {await this.edit(this.chatId,this.messageId,text);}
      catch(error) {
       if(/message to edit not found|message can't be edited|message identifier is not specified/i.test(error.message||''))this.messageId=null;
       else if(!/message is not modified/i.test(error.message||''))throw error;
      }
     }
     if(!this.messageId) {
      if(this.closed)return;
      const waitSend=15000-(this.now()-(this.lastSendAt??-Infinity));
      if(waitSend>0){this.dirty=true;this.schedule(waitSend);return;}
      this.lastSendAt=this.now();const sent=await this.send(this.chatId,text);
      if(!sent?.message_id)throw new Error('Dashboard belum dihantar.');this.messageId=sent.message_id;this.onMessageId(this.messageId);
     }
     this.text=text;this.failures=0;this.retryAt=0;
    } catch(error) {
     this.dirty=true;this.failures=(this.failures||0)+1;
     if(this.failures<=3){const delay=Math.max([3000,10000,30000][this.failures-1],Number(error.retryAfterSec||0)*1000);this.retryAt=this.now()+delay;this.schedule(delay);}
     return;
    }
   }
  } finally {this.busy=false;}
 }
 close(){this.closed=true;if(this.timer)this.clearTimer(this.timer);this.timer=null;}
}
