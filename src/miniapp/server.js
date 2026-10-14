import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {randomBytes} from 'node:crypto';
import {validateInitData} from './auth.js';
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.ttf':'font/ttf','.woff2':'font/woff2','.woff':'font/woff','.svg':'image/svg+xml','.txt':'text/plain; charset=utf-8'};
export class PanelServer {
 constructor({root,token,ownerId,data,act,botName='',origin='',port=8787}){Object.assign(this,{root,token,ownerId,data,act,botName,origin,port});this.readinessNonce=randomBytes(24).toString('hex');this.confirmations=new Map();this.requests=new Map();this.limits=new Map();this.server=createServer((q,s)=>this.handle(q,s));this.server.requestTimeout=10000;this.server.headersTimeout=10000;this.server.maxHeadersCount=40;}
 json(res,status,body){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));}
 prune(){const now=Date.now();for(const map of [this.confirmations,this.requests,this.limits])for(const [k,v] of map)if(v.expires<now)map.delete(k);}
 async body(req){let size=0,parts=[];for await(const b of req){size+=b.length;if(size>4096)throw new Error('Permintaan terlalu besar.');parts.push(b);}try{return JSON.parse(Buffer.concat(parts).toString());}catch{throw new Error('Permintaan tidak sah.');}}
 async handle(req,res){
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self' https://web.telegram.org https://*.telegram.org");
  try{
   const url=new URL(req.url,'http://localhost');this.prune();
   if(req.method==='GET'&&url.pathname==='/.well-known/wapromobot-ready/'+this.readinessNonce)return this.json(res,200,{ready:this.readinessNonce});
   if(!url.pathname.startsWith('/api/')){
    if(req.method!=='GET'&&req.method!=='HEAD')return this.json(res,405,{error:'Kaedah tidak sah.'});
    const name=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));
    const file=resolve(this.root,name);if(!file.startsWith(resolve(this.root)+sep)||!types[extname(file)]||name.startsWith('.'))return this.json(res,404,{error:'Tidak ditemui.'});
    const bytes=await readFile(file);res.writeHead(200,{'Content-Type':types[extname(file)]});return res.end(req.method==='HEAD'?undefined:bytes);
   }
   // No CORS: a panel is tied to this installation and its current public origin.
   if(req.headers.origin&&req.headers.origin!==this.origin)return this.json(res,403,{error:'Asal panel tidak sah.'});
   const raw=String(req.headers.authorization||'');if(!raw.startsWith('tma '))return this.json(res,401,{error:'Buka panel melalui bot Telegram anda.'});
   let user;try{user=validateInitData(raw.slice(4),this.token,this.ownerId);}catch{return this.json(res,401,{error:'Akses tidak sah atau sesi tamat. Tutup dan buka semula melalui bot owner.'});}
   const limit=this.limits.get(user.id)||{count:0,expires:Date.now()+60000};if(++limit.count>120)return this.json(res,429,{error:'Terlalu banyak permintaan. Tunggu sebentar.'});this.limits.set(user.id,limit);
   const p=Object.fromEntries(url.searchParams);const route=url.pathname;
   if(req.method==='GET'){
    let result;
    if(route==='/api/overview')result={...this.data.overview(),user,botName:this.botName};
    else if(route==='/api/jobs')result=this.data.jobs(p);
    else if(route==='/api/job')result=this.data.detail(p.key);
    else if(route==='/api/results')result=this.data.records(p.key,{...p,recent:p.recent==='1'});
    else if(route==='/api/accounts')result={items:this.data.accounts()};
    else if(route==='/api/sync')result=this.data.syncs();
    else if(route==='/api/groups')result=this.data.groups(p);
    else if(route==='/api/clients')result=this.data.clients(Number(p.page)||1);
    else if(route==='/api/extract')result=this.data.extraction();
    else if(route==='/api/health')result=await this.data.health();
    else return this.json(res,404,{error:'Tidak ditemui.'});
    return this.json(res,200,result);
   }
   if(req.method!=='POST')return this.json(res,405,{error:'Kaedah tidak sah.'});
   if(!String(req.headers['content-type']||'').startsWith('application/json'))return this.json(res,415,{error:'Gunakan JSON.'});
   const body=await this.body(req);
   if(route==='/api/confirm'){
    const job=this.data.detail(body.key),action=body.action||'stop';if(action==='delete'){if(!job.deletion?.allowed)throw new Error(job.deletion?.reason||'Job ini tidak boleh dipadam.');}else if(action!=='stop'||!job.actions.includes('stop'))throw new Error('Job ini tidak boleh dihentikan. Segarkan panel.');
    const nonce=randomBytes(24).toString('hex');this.confirmations.set(nonce,{key:job.key,status:job.status,action,fingerprint:job.deletion?.fingerprint,expires:Date.now()+120000});
    return this.json(res,200,{nonce,key:job.key,name:job.name,status:job.status,kind:job.kind,client:job.client,pending:job.deletion?.pending??job.pending??0,inFlight:job.inFlight||0});
   }
   if(route==='/api/action'){
    if(!/^[a-zA-Z0-9_-]{16,80}$/.test(String(body.requestId)))throw new Error('Rujukan tindakan tidak sah.');
    const fingerprint=JSON.stringify([body.key,body.action,body.expectedStatus,body.confirmation]);
    const old=this.requests.get(body.requestId);if(old){if(old.fingerprint!==fingerprint)throw new Error('Rujukan tindakan telah digunakan.');return this.json(res,200,old.result);}
    const job=this.data.detail(body.key);
    if(job.status!==body.expectedStatus||(body.action==='delete'?!job.deletion?.allowed:!job.actions.includes(body.action)))throw new Error('Keadaan job sudah berubah. Segarkan dan pilih semula.');
    if(['stop','delete'].includes(body.action)){
     const c=this.confirmations.get(body.confirmation);if(!c||c.key!==job.key||c.status!==job.status||c.action!==body.action||(body.action==='delete'&&c.fingerprint!==job.deletion.fingerprint))throw new Error('Pengesahan tamat atau tidak sepadan. Semak semula job.');
     this.confirmations.delete(body.confirmation);
    }
    // act must commit synchronously before any dashboard/network work.
    this.act(job,body.action);
    const result=body.action==='delete'?{ok:true,deleted:true,key:job.key}:{ok:true,job:this.data.detail(body.key)};this.requests.set(body.requestId,{fingerprint,result,expires:Date.now()+600000});
    if(this.requests.size>500)this.requests.delete(this.requests.keys().next().value);
    return this.json(res,200,result);
   }
   return this.json(res,404,{error:'Tidak ditemui.'});
  }catch(e){if(res.headersSent)return res.end();const known=/tidak|Tiada|belum|sudah|hilang|ONLINE|semula|Bahan|Media|Operasi|Job|job|Kempen|kempen|Permintaan|Rujukan|Pengesahan|Keadaan|Akaun|Sambung|Enjin|Tunggu/i.test(e.message||'');return this.json(res,e.code==='ENOENT'?404:400,{error:known?String(e.message).slice(0,240):'Panel tidak dapat membaca keadaan semasa. Cuba semula.'});}
 }
 start(){return new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(this.port,'127.0.0.1',()=>{this.server.off('error',reject);resolve(this.server.address());});});}
 close(){this.server.close();this.server.closeAllConnections?.();this.confirmations.clear();this.requests.clear();this.limits.clear();}
}
