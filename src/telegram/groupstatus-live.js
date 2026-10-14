import { LiveMessage } from './live-message.js';
// Same serialized dashboard transport as Auto Post; WhatsApp work never waits for edits.
export class GroupStatusLive {
 constructor({render,readJob,load,save,send,edit,feedback,liveOptions={}}){Object.assign(this,{render,readJob,load,save,send,edit,feedback,liveOptions});this.messages=new Map();this.closed=false;}
 attach(chat,id){
  id=Number(id);let live=this.messages.get(id);
  if(live&&String(live.chatId)!==String(chat)){live.close();this.messages.delete(id);live=null;}
  if(!live){
   live=new LiveMessage({interval:5000,...this.liveOptions,chatId:chat,send:this.send,edit:this.edit,render:()=>this.render(id),onMessageId:messageId=>this.save(id,{chatId:chat,messageId})});
   const saved=this.load(id);if(saved&&String(saved.chatId)===String(chat))live.messageId=Number(saved.messageId)||null;
   this.messages.set(id,live);
  }
  return live;
 }
 refresh(id,chat,{force=false}={}){if(this.closed||!this.readJob(id))return;const live=this.attach(chat,id);live.update(force).catch(()=>{});return live;}
 async show(id,chat){
  if(this.closed)return;
  const job=this.readJob(id);if(!job)return this.send(chat,'📋 Kempen tidak ditemui. Buka .gs-list.');
  const live=this.attach(chat,id),previous=live.messageId;
  if(previous){
   live.update(true).catch(()=>{});
   return this.send(chat,this.feedback(id),{replyToMessageId:previous});
  }
  await live.update(true);
  if(!live.messageId||live.failures)return this.send(chat,this.feedback(id)+'\n↳ Dashboard sedang dicuba semula.');
 }
 pulse(){if(this.closed)return;for(const [id,live] of this.messages){const j=this.readJob(id);if(!j){live.close();this.messages.delete(id);}else if(j.status==='RUNNING'||j.inFlight>0)live.update().catch(()=>{});else if(['STOPPED','COMPLETED'].includes(j.status)&&!live.busy&&!live.dirty&&!live.failures){live.close();this.messages.delete(id);}}}
 forget(id){this.messages.get(Number(id))?.close();this.messages.delete(Number(id));}
 close(){this.closed=true;for(const live of this.messages.values())live.close();this.messages.clear();}
}
