import {groupSnapshot} from './group-store.js';

// Only a PN JID or the explicit phoneNumber field is a phone-number source.
// In particular, digits before @lid must NEVER become an exported number.
export function exportPhone(value,plain=false){
 if(typeof value!=='string')return null;
 const text=value.trim();
 const jid=text.match(/^([1-9]\d{6,14})(?::\d+)?@s\.whatsapp\.net$/);
 if(jid)return '+'+jid[1];
 if(plain&&/^\+?[1-9]\d{6,14}$/.test(text))return '+'+text.replace(/^\+/,'');
 return null;
}
function bounded(task,signal){
 signal.throwIfAborted();
 return new Promise((resolve,reject)=>{
  const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});
  Promise.resolve().then(task).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
 });
}
export async function collectGroupNumbers({manager,databasePath,accountId,groupJid,signal,onProgress=()=>{},timeoutMs=60000}){
 const activeSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs);
 const record=manager.sockets.get(Number(accountId)),socket=record?.socket;
 const check=()=>{
  activeSignal.throwIfAborted();
  if(!groupSnapshot(databasePath,accountId).items.some(g=>g.jid===groupJid))throw Error('Group tidak tersedia untuk akaun ini. Sync senarai group dahulu.');
  if(manager.get(accountId)?.status!=='ONLINE'||!socket||manager.sockets.get(Number(accountId))!==record)
   throw Error('Akaun terputus. Sambungkan semula sebelum extract.');
 };
 check();
 if(typeof socket.groupMetadata!=='function')throw Error('Bacaan ahli group tidak tersedia pada sambungan ini.');
 const metadata=await bounded(()=>socket.groupMetadata(groupJid),activeSignal);check();
 if(metadata?.id!==groupJid||!Array.isArray(metadata.participants)||metadata.participants.length>10000)
  throw Error('Respons ahli group tidak lengkap atau tidak sepadan. Cuba sync dan extract semula.');
 const result={groupJid,groupName:String(metadata.subject||'Group'),at:new Date().toISOString(),total:metadata.participants.length,processed:0,duplicates:0,unavailable:0,invalid:0,lookupErrors:0,rows:[]};
 const seen=new Set(),mapping=new Map(),lookup=socket.signalRepository?.lidMapping;
 for(const participant of metadata.participants){
  activeSignal.throwIfAborted();
  if(result.processed%25===0)check();
  const p=participant&&typeof participant==='object'?participant:{};
  const candidates=new Set([exportPhone(p.id),exportPhone(p.phoneNumber,true)].filter(Boolean));
  let source=exportPhone(p.phoneNumber,true)?'PHONE_FIELD':'PN';
  const lid=typeof p.id==='string'?p.id.match(/^(\d+)(?::\d+)?@lid$/):null;
  if(!candidates.size&&lid&&typeof lookup?.getPNForLID==='function'){
   const key=lid[1]+'@lid';
   if(!mapping.has(key)){
    try {mapping.set(key,await bounded(()=>lookup.getPNForLID(key),activeSignal));}
    catch(error){activeSignal.throwIfAborted();result.lookupErrors++;mapping.set(key,null);}
   }
   const phone=exportPhone(mapping.get(key));if(phone){candidates.add(phone);source='CACHED_MAPPING';}
  }
  if(candidates.size>1)result.invalid++;
  else if(candidates.size===0){
   if(lid||!p.phoneNumber&&!String(p.id||'').endsWith('@s.whatsapp.net'))result.unavailable++;
   else result.invalid++;
  }else{
   const phone=[...candidates][0];
   if(seen.has(phone))result.duplicates++;
   else {seen.add(phone);result.rows.push({phone,source,role:p.admin==='superadmin'?'OWNER':p.admin==='admin'?'ADMIN':'MEMBER'});}
  }
  result.processed++;
  if(result.processed%25===0)await onProgress({processed:result.processed,total:result.total,unique:result.rows.length});
 }
 check();result.rows.sort((a,b)=>a.phone.localeCompare(b.phone));
 return result;
}
const csv=value=>'"'+String(value??'').replace(/^[=+\-@\t\r]/,"'$&").replace(/"/g,'""')+'"';
export function memberExportFile(result,format='txt'){
 if(!['txt','csv'].includes(format))throw Error('Format eksport tidak sah.');
 const myt=new Date(new Date(result.at).getTime()+8*60*60*1000).toISOString().slice(0,19).replace('T',' ');
 const stamp=myt.replace(/\D/g,'');
 const suffix=String(result.groupJid).replace(/[^0-9-]/g,'').slice(-22);
 const filename=`WAPromoBot-Ahli-${suffix}-${stamp}.${format}`;
 const text=format==='txt'?result.rows.map(r=>r.phone).join('\n')+'\n':
  '\uFEFF'+[['Nombor','Group','Peranan','Sumber','Masa MYT'],...result.rows.map(r=>[r.phone,result.groupName,r.role,r.source,myt])].map(row=>row.map(csv).join(',')).join('\r\n')+'\r\n';
 return {filename,mimeType:format==='txt'?'text/plain':'text/csv',buffer:Buffer.from(text,'utf8')};
}
