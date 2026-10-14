import {existsSync,readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {PanelData} from './data.js';
import {PanelServer} from './server.js';
import {panelActions} from './actions.js';
import {telegramRequest} from '../telegram/api.js';
export function panelUrl(value){let u;try{u=new URL(value);}catch{throw new Error('URL HTTPS tidak sah.');}if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/'||u.port)throw new Error('Gunakan alamat HTTPS utama tanpa path, port atau token.');return u.origin;}
// This probe never includes Telegram credentials. A failed probe must not kill a
// live quick tunnel: newly-created hostnames can outlast a short readiness window.
export function probeReason(error){
 const code=String(error?.cause?.code||error?.code||'');
 if(['ENOTFOUND','EAI_AGAIN'].includes(code))return 'DNS belum dapat diselesaikan ('+code+')';
 if(error?.name==='TimeoutError'||['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT'].includes(code))return 'Sambungan HTTPS tamat masa';
 if(['ECONNRESET','ECONNREFUSED','ENETUNREACH','EHOSTUNREACH'].includes(code))return 'Sambungan HTTPS gagal ('+code+')';
 if(/CERT|TLS|SSL/.test(code))return 'Sijil atau sambungan TLS gagal';
 return 'Permintaan HTTPS gagal';
}
export async function waitForPanel(url,nonce,{signal,fetcher=fetch,pause=delay,attempts=12}={}){
 let reason='Belum menerima respons',identityMismatch=false;
 for(let attempt=0;attempt<attempts;attempt++){
  signal?.throwIfAborted();
  try{
   const timeout=AbortSignal.timeout(6000);
   const response=await fetcher(url+'/.well-known/wapromobot-ready/'+nonce,{redirect:'error',cache:'no-store',signal:signal?AbortSignal.any([signal,timeout]):timeout});
   if(!response.ok){reason='Pelayan HTTPS memberi HTTP '+response.status;await response.body?.cancel?.();}
   else{
    let result;try{result=await response.json();}catch{reason='Respons HTTPS bukan JSON panel';}
    signal?.throwIfAborted();
    if(result?.ready===nonce)return true;
    if(result){reason='Identiti respons tidak sepadan dengan panel ini';identityMismatch=true;}
   }
  }catch(error){signal?.throwIfAborted();reason=probeReason(error);}
  if(attempt+1<attempts)await pause(2500,undefined,{signal});
 }
 const error=new Error('Alamat Mini App belum dapat disahkan: '+reason+'.');error.identityMismatch=identityMismatch;throw error;
}
// Each stream has its own cursor. Process fresh transport events in order, even
// when a log message spans chunks; never replay an older registration/failure.
function tunnelLogReader(onEvent){
 let buffer='',offset=0,handledThrough=0;
 return chunk=>{
  buffer+=chunk.toString();
  if(buffer.length>8192){offset+=buffer.length-8192;buffer=buffer.slice(-8192);}
  const events=/Registered tunnel connection|failed to dial|handshake[^\r\n]*?timeout|no recent network activity|lookup [^\r\n]*?no such host|DNS[^\r\n]*?failed/gi;
  for(const match of buffer.matchAll(events)){
   const end=offset+match.index+match[0].length;
   if(end<=handledThrough)continue;
   handledThrough=end;onEvent(match[0]);
  }
 };
}
export class MiniAppController {
 constructor(options){Object.assign(this,options);this.configPath=join(this.projectRoot,'config','miniapp.json');this.config={enabled:false,mode:'fixed',url:'',port:8787};this.url='';this.error='';this.starting=false;this.closed=false;this.server=null;this.data=null;this.tunnel=null;this.runtimeVersion=0;this.readyAbort=null;this.urlTimer=null;this.menuQueue=Promise.resolve();this.pendingUrl='';this.retryTimer=null;this.probePromise=null;this.probeRounds=0;this.tunnelConnected=false;this.tunnelNote='';this.identityMismatch=false;
  if(existsSync(this.configPath)){try{const c=JSON.parse(readFileSync(this.configPath,'utf8'));if(c.schema!==1||!['fixed','quick'].includes(c.mode)||typeof c.enabled!=='boolean')throw Error();this.config={...this.config,...c,url:c.url?panelUrl(c.url):''};if(!Number.isInteger(c.port)||c.port<1024||c.port>65535)throw Error();}catch{this.config.enabled=false;this.error='Konfigurasi Mini App tidak sah. Semak config/miniapp.json.';}}
 }
 save(){mkdirSync(join(this.projectRoot,'config'),{recursive:true});const temp=this.configPath+'.tmp';writeFileSync(temp,JSON.stringify({schema:1,...this.config},null,2),{mode:0o600});renameSync(temp,this.configPath);}
 async menuButton(url){return telegramRequest(this.token,'setChatMenuButton',{chat_id:this.ownerId,menu_button:url?{type:'web_app',text:'Live Panel',web_app:{url}}:{type:'commands'}});}
 async publishMenu(url,version){
  this.menuQueue=this.menuQueue.catch(()=>{}).then(()=>{if(version===this.runtimeVersion&&!this.closed)return this.menuButton(url);});
  return this.menuQueue;
 }
 async start(){
  if(this.closed||!this.config.enabled||this.starting)return;
  this.stopRuntime();const version=this.runtimeVersion;this.starting=true;this.error='';
  this.readyAbort=new AbortController();
  // Remove the previous menu URL while the new connection is being checked.
  this.publishMenu('',version).catch(()=>{});
  try{
   this.data=new PanelData({...this,system:this.system});
   this.server=new PanelServer({root:join(this.projectRoot,'miniapp'),token:this.token,ownerId:this.ownerId,data:this.data,act:panelActions(this),botName:this.botName,port:this.config.port});
   await this.server.start();if(version!==this.runtimeVersion)return;
   if(this.config.mode==='fixed'){
    if(!this.config.url)throw Error('Alamat HTTPS belum ditetapkan.');
    this.beginReadiness(this.config.url,version);
   }else this.quickTunnel(version);
  }catch(e){if(version===this.runtimeVersion&&!this.closed){this.stopRuntime();this.error=e.code==='EADDRINUSE'?'Port Mini App sedang digunakan. Hentikan proses panel lama dahulu.':e.message;}}
 }
 async connected(url,version=this.runtimeVersion){
  const server=this.server,signal=this.readyAbort?.signal;
  if(this.closed||!server||version!==this.runtimeVersion)return false;
  url=panelUrl(url);
  await (this.readinessCheck||waitForPanel)(url,server.readinessNonce,{signal});
  if(this.closed||signal?.aborted||version!==this.runtimeVersion||this.server!==server)return false;
  this.url=url;this.pendingUrl='';server.origin=url;this.starting=false;this.error='';this.tunnelNote='';
  clearTimeout(this.retryTimer);this.retryTimer=null;
  try{await this.publishMenu(url,version);}catch{if(version===this.runtimeVersion)this.error='Panel boleh dicapai; butang menu Telegram belum dikemas kini. Guna .panel.';}
  return version===this.runtimeVersion&&!this.closed&&this.url===url;
 }
 beginReadiness(url,version=this.runtimeVersion){
  if(this.closed||!this.server||version!==this.runtimeVersion||this.url)return;
  if(this.probePromise)return this.probePromise;
  clearTimeout(this.retryTimer);this.retryTimer=null;
  this.pendingUrl=panelUrl(url);this.server.origin=this.pendingUrl;this.starting=true;
  const task=this.connected(this.pendingUrl,version).then(()=>{
  }).catch(async e=>{
   if(this.closed||version!==this.runtimeVersion)return;
   this.starting=false;this.error=e.message;this.identityMismatch=Boolean(e.identityMismatch);this.probeRounds++;
   // Keep the same URL, local server and cloudflared alive while DNS/transport recovers.
   if(this.probeRounds<6){
    this.retryTimer=setTimeout(()=>this.beginReadiness(this.pendingUrl,version),this.retryDelayMs??15000);this.retryTimer.unref?.();
   }
  }).catch(()=>{}).finally(()=>{if(version===this.runtimeVersion&&this.probePromise===task)this.probePromise=null;});
  this.probePromise=task;return task;
 }
 async pendingReply(chat){
  const canOpen=Boolean(this.pendingUrl&&this.server&&!this.identityMismatch&&(this.config.mode==='fixed'||this.tunnelConnected));
  const transport=this.config.mode==='quick'?'\n↳ Tunnel: '+(this.tunnelConnected?'sambungan pernah didaftarkan':'menunggu sambungan Cloudflare')+(this.tunnelNote?' · '+this.tunnelNote:''):'';
  const message='⏳ MINI APP · SEMAK SAMBUNGAN\n↳ '+(this.error||'Alamat HTTPS sedang diuji.')+transport+'\n• Alamat semasa dikekalkan.'+(canOpen?'\n• Boleh cuba buka di Telegram. Capaian HTTPS belum disahkan oleh controller.':'\n• Tunggu sambungan tunnel tersedia dahulu.')+'\n\n📊 ↳ .panel → Semak Lagi\n🧪 ↳ .panel-quick → Uji Semula\n⏹ ↳ .panel-off → Matikan Panel';
  await this.send(chat,message,canOpen?{inline_keyboard:[[{text:'🧪 Uji Buka Panel',web_app:{url:this.pendingUrl}}]]}:undefined);
 }
 async readyReply(chat){
  const transport=this.tunnelNote?'\n• Cloudflare melaporkan: '+this.tunnelNote+'. Alamat panel dikekalkan.':'';
  await this.send(chat,'📱 WA PROMOBOT · LIVE PANEL\n↳ Pantau progress dan kawal job milik owner.\n'+(this.config.mode==='quick'?'• Alamat semasa dikekalkan; .panel-quick tidak memulakan semula sambungan.':'• Sambungan HTTPS mengikut pemasangan anda.')+transport+'\n• Tutup dan buka semula panel jika sesi tamat.\n\n⚙️ ↳ .panel-setup → Tetapan Panel',{inline_keyboard:[[{text:'📊 Buka Live Panel',web_app:{url:this.url}}]]});
 }
 quickTunnel(version=this.runtimeVersion){
  let buf='',candidate=false;
  const child=(this.spawnTunnel||spawn)('cloudflared',['tunnel','--url',`http://127.0.0.1:${this.config.port}`,'--no-autoupdate'],{stdio:['ignore','pipe','pipe']});this.tunnel=child;
  const fail=message=>{
   if(version!==this.runtimeVersion||this.closed)return;
   this.stopRuntime();this.error=message;this.publishMenu('',this.runtimeVersion).catch(()=>{});
  };
  this.urlTimer=setTimeout(()=>fail('Tunnel belum memberikan alamat. Semak internet dan hantar .panel-quick semula.'),60000);this.urlTimer.unref?.();
  const onTransport=event=>{
   if(/Registered tunnel connection/i.test(event)){this.tunnelConnected=true;this.tunnelNote='';}
   else if(/lookup |^DNS/i.test(event))this.tunnelNote='resolusi DNS tunnel gagal';
   else this.tunnelNote='sambungan tunnel sedang dicuba semula';
  };
  const stdoutLog=tunnelLogReader(onTransport),stderrLog=tunnelLogReader(onTransport);
  const scan=(chunk,readLog)=>{
   if(version!==this.runtimeVersion||this.tunnel!==child||this.closed)return;
   buf=(buf+chunk.toString()).slice(-8192);
   readLog(chunk);
   const m=[...buf.matchAll(/https:\/\/([a-z0-9-]+)\.trycloudflare\.com\b/g)].find(x=>x[1]!=='api');
   if(!m||candidate)return;candidate=true;clearTimeout(this.urlTimer);this.urlTimer=null;
   this.beginReadiness(m[0],version);
  };
  child.stdout.on('data',chunk=>scan(chunk,stdoutLog));child.stderr.on('data',chunk=>scan(chunk,stderrLog));
  child.on('error',()=>fail('cloudflared gagal dimulakan. Semak pemasangan: pkg install cloudflared'));
  child.on('exit',()=>fail('Tunnel terputus. Hantar .panel-quick untuk sambung semula.'));
 }
 stopRuntime(){
  this.runtimeVersion++;this.starting=false;this.url='';this.pendingUrl='';this.probePromise=null;this.probeRounds=0;this.tunnelConnected=false;this.tunnelNote='';this.identityMismatch=false;clearTimeout(this.retryTimer);this.retryTimer=null;clearTimeout(this.urlTimer);this.urlTimer=null;
  this.readyAbort?.abort();this.readyAbort=null;const t=this.tunnel;this.tunnel=null;t?.kill('SIGTERM');
  this.server?.close();this.server=null;this.data?.close();this.data=null;
 }
 close(){this.closed=true;this.stopRuntime();}
 async handle(route){const action=route.action;if(!action?.startsWith('panel'))return false;const chat=route.chatId;
  if(action==='panel'&&!this.url&&this.pendingUrl){await this.pendingReply(chat);return true;}
  // A repeat setup command must not tear down an already usable quick tunnel.
  // An explicit .panel-off followed by .panel-quick still starts a new one.
  if(action==='panel_quick'&&this.config.mode==='quick'&&this.url&&this.tunnel&&this.server){await this.readyReply(chat);return true;}
  if(action==='panel_quick'&&this.config.mode==='quick'&&this.pendingUrl&&this.tunnel&&this.server){if(!this.probePromise){this.probeRounds=0;this.beginReadiness(this.pendingUrl);}await this.pendingReply(chat);return true;}
  if(action==='panel_quick'){if(this.starting){await this.send(chat,'⏳ Panel sedang disediakan. Cuba .panel sebentar lagi.');return true;}this.config={...this.config,enabled:true,mode:'quick',url:''};this.save();await this.start();await this.send(chat,this.error||'⏳ MINI APP PERCUBAAN\n↳ Alamat HTTPS sedang diuji. Semakan berjalan senyap; hantar .panel untuk melihat status.\n• Controller mesti terus hidup.\n• Jika cloudflared belum ada: pkg install cloudflared\n\n📊 ↳ .panel → Semak Panel');return true;}
  if(action==='panel_url'){if(this.starting)throw Error('Panel sedang disediakan. Tunggu sebentar.');const url=panelUrl(route.args?.[0]||'');this.config={...this.config,enabled:true,mode:'fixed',url};this.save();await this.start();await this.send(chat,(this.error||'✅ ALAMAT MINI APP DISIMPAN\n↳ Sambungan HTTPS sedang diuji. Hantar .panel untuk melihat status.')+'\n\n📊 ↳ .panel → Buka Panel');return true;}
  if(action==='panel_off'){this.config.enabled=false;this.save();this.stopRuntime();await this.menuButton('').catch(()=>{});await this.send(chat,'📱 MINI APP DIMATIKAN\n↳ Penghantaran bot terus mengikut keadaan kempen.\n\n⚙️ ↳ .panel-setup → Sediakan Semula');return true;}
  if(action==='panel'&&this.url){await this.readyReply(chat);return true;}
  await this.send(chat,'📱 TETAPAN MINI APP\n↳ Guna bot dan Owner ID pemasangan ini.\n\n| STATUS |\n↳ '+(this.url?'Sedia':this.starting?'Menguji sambungan HTTPS':this.pendingUrl?'Menunggu pengesahan HTTPS':this.config.enabled?'Menunggu sambungan':'Belum diaktifkan')+(this.error?'\n↳ '+this.error:'')+'\n\n| SAMBUNGAN |\n🧪 ↳ .panel-quick → Cuba dengan Tunnel Automatik\n• Pasang sekali di Termux: pkg install cloudflared\n• Alamat percubaan boleh berubah; bukan hosting tetap.\n\n🔗 ↳ .panel-url https://panel.domain-anda.com → Guna HTTPS Tetap\n• Sediakan tunnel / reverse proxy ke 127.0.0.1:'+this.config.port+' terlebih dahulu.\n\n📊 ↳ .panel → Buka Live Panel\n⏹ ↳ .panel-off → Matikan Mini App\n🏠 ↳ .menu → Menu Utama');return true;
 }
}
