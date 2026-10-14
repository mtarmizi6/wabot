import {archived,archivePolicy} from '../system/policy.js';
import {reportArchive} from '../system/lifecycle.js';
import {campaignView,postingReportSnapshot,readPostingFlowState,savePostingFlowState} from '../posting/store.js';
import {listAllGsJobs,gsSnapshot,gsListPosts,gsAccountProgress} from '../groupstatus/store.js';
const active=j=>['RUNNING','WAITING','PAUSED'].includes(j.status);
const key=j=>`${j.type}:${j.id}`;
const short=(v,n=64)=>{const chars=Array.from(String(v||'').replace(/[*_~`]/g,'').replace(/\s+/g,' ').trim());return chars.length>n?chars.slice(0,n-1).join('')+'…':chars.join('');};
const date=v=>v&&!Number.isNaN(Date.parse(v))?new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',dateStyle:'short',timeStyle:'short',hour12:true}).format(new Date(v)):'—';
const retentionNote=(path,j)=>{const a=archived(path,j.type,j.id);if(!a)return '';const p=archivePolicy(path,j.type,j.id);return `\n📊 Butiran Luput : ${date(new Date(Date.parse(a.ended)+p.details*86400000).toISOString())}\n📁 Ringkasan Luput : ${date(new Date(Date.parse(a.ended)+p.summary*86400000).toISOString())}`;};
const reference=j=>`${j.type==='gs'?'AS':'CAM'}-${String(j.id).padStart(3,'0')}`;
const section=t=>`\n\n-------------------------\n| ${t} |\n-------------------------`;
export class CampaignHub {
 constructor({databasePath,post,send,gsShow,gsAction,account}){Object.assign(this,{databasePath,post,send,gsShow,gsAction,account});this.views=new Map();this.pendingDeletes=new Map();this.opened=new Map(readPostingFlowState(databasePath,'hub-opened')||[]);}
 items(scope='active'){
  const posts=campaignView(this.databasePath,scope==='reports'?'all':scope).map(j=>({...j,type:'post',name:j.displayName,created:j.createdAt,owner:j.clientName||'Sendiri'}));
  const gs=listAllGsJobs(this.databasePath).filter(j=>scope==='reports'?active(j)||['STOPPED','COMPLETED'].includes(j.status):scope==='active'?active(j):['STOPPED','COMPLETED'].includes(j.status)).map(j=>({...gsSnapshot(this.databasePath,j.id),type:'gs',name:'Status Group',excerpt:short(j.body,42),created:j.created_at,owner:'Sendiri'}));
  return [...posts,...gs].sort((a,b)=>String(a.created||'').localeCompare(String(b.created||''))||a.type.localeCompare(b.type)||a.id-b.id).map((j,i)=>({...j,number:i+1}));
 }
 capture(chat,scope){const v={scope,keys:this.items(scope).map(key),expires:Date.now()+600000};this.views.set(String(chat),v);savePostingFlowState(this.databasePath,'hub-view:'+chat,v);return v;}
 async list(chat,page=1,scope='active'){
  this.capture(chat,scope);const all=this.items(scope),pages=Math.max(1,Math.ceil(all.length/10)),p=Math.max(1,Math.min(pages,Number(page)||1));
  let text=`${scope==='reports'?'📊 LAPORAN KEMPEN':scope==='active'?'📊 KEMPEN AKTIF':'📁 REKOD KEMPEN'}\n↳ ${scope==='reports'?'Semak laporan semasa dan laporan akhir.':scope==='active'?'Pantau & kawal Auto Post dan Auto Status Group.':'Semak kempen selesai atau dihentikan.'}\n📃 Halaman ${p}/${pages}`;
  if(scope==='active'){const paused=all.filter(j=>j.status==='PAUSED').length,waiting=all.filter(j=>j.status==='WAITING'||j.status==='RUNNING'&&this.waiting(j)).length;text+=section('RINGKASAN')+`\n🚀 Berjalan : ${all.length-paused-waiting}\n💤 Menunggu / Rehat : ${waiting}\n⏸ Dijeda : ${paused}\n📋 Jumlah Belum Tamat : ${all.length}`;}
  text+=section('SENARAI KEMPEN');
  for(const j of all.slice((p-1)*10,p*10)){
   const progress=j.type==='gs'?`Proses : ${j.accepted+j.skipped+j.failed+j.unknown}/${j.total}`:`Success : ${j.successCount}${j.targetMode==='SUCCESS'?'/'+j.targetSuccess:''}`;
   const mode=j.type==='gs'?'Sekali Jalan':j.targetMode==='SUCCESS'?'SUCCESS':j.targetMode==='DAYS'?'HARI':'BERTERUSAN';
   text+=`\n${j.number}. ${short(j.name,36)}\n↳ ${j.type==='gs'?'📢 Auto Status Group':'🚀 Auto Post'} • ${short(j.owner,24)}${j.excerpt?'\n↳ '+j.excerpt:''}\n↳ ${this.state(j)}\n↳ Mode : ${mode}\n↳ ${progress}\n📊 ↳ ${scope==='reports'?'.report':scope==='active'?'.status':'.kempen-open'} ${j.number} → ${scope==='reports'?'Buka Laporan':scope==='active'?'Buka Kempen':'Butiran Rekod'}\n`;
  }
  if(!all.length)text+='\nTiada kempen '+(scope==='active'?'berjalan atau dijeda.':'terdahulu.')+'\n\n🚀 ↳ .mula → Cipta Auto Post\n📢 ↳ .group-status → Auto Status Group';
  const cmd=scope==='reports'?'.report-page':scope==='active'?'.campaigns':'.rekod';if(p>1)text+=`\n\n⬅️ ↳ ${cmd} ${p-1} → Halaman Sebelum`;if(p<pages)text+=`\n➡️ ↳ ${cmd} ${p+1} → Halaman Seterusnya`;
  text=text.trimEnd()+section('NAVIGASI')+`\n🔄 ↳ ${scope==='reports'?'.report':scope==='active'?'.status':'.rekod'} → Segarkan Senarai\n${scope==='active'?'📁 ↳ .rekod → Rekod Kempen':'📊 ↳ .status → Kempen Aktif'}\n🏠 ↳ .menu → Menu Utama`;return this.send(chat,text);
 }
 waiting(j){if(j.type==='post'){const e=this.post.enrich(j);return !j.processingCount&&(!e.accounts.some(a=>a.status==='ONLINE'&&!a.waitSeconds));}const a=gsAccountProgress(this.databasePath,j.id).filter(a=>a.pending>0);return !j.inFlight&&a.length>0&&a.every(a=>a.blockedAt||this.account(a.accountId)?.status!=='ONLINE'||Date.parse(a.nextAt)>Date.now());}
 state(j){if(j.status==='WAITING')return '🔄 Menunggu Giliran';if(j.status==='PAUSED')return '⏸ Dijeda';if(j.status==='COMPLETED')return '✅ Selesai';if(j.status==='STOPPED')return (j.processingCount||j.inFlight)?'⏹ Sedang Dihentikan':'🛑 Dihentikan';return this.waiting(j)?'💤 Menunggu / Rehat':'🟢 Berjalan';}
 async resolve(chat,n,scope){const v=this.views.get(String(chat))||readPostingFlowState(this.databasePath,'hub-view:'+chat);if(v&&v.expires>Date.now()&&(!scope||v.scope===scope)){const items=this.items(v.scope);if(JSON.stringify(items.map(key))===JSON.stringify(v.keys)){const j=items[Number(n)-1];if(j)return j;}}await this.send(chat,'📋 PILIH KEMPEN SEMULA\n↳ Senarai atau konteks berubah. Gunakan nombor daripada senarai terkini.');await this.list(chat,1,scope||v?.scope||'active');return null;}
 remember(chat,j){this.opened.set(key(j),{chat,scope:(this.views.get(String(chat))||readPostingFlowState(this.databasePath,'hub-view:'+chat))?.scope||(active(j)?'active':'records')});savePostingFlowState(this.databasePath,'hub-opened',[...this.opened]);}
 async show(chat,j){this.remember(chat,j);if(!active(j))return this.detail(chat,j);return this.live(chat,j);}
 async live(chat,j){this.remember(chat,j);if(j.type==='post')return this.post.show(chat,j.id,{feedback:true});return this.gsShow(j.id,chat);}
 async detail(chat,j){
  const busy=Number(j.processingCount||j.inFlight||0),gs=j.type==='gs',ref=reference(j);
  let text=`📁 REKOD KEMPEN ${j.number}\n↳ ${short(j.name,36)}${j.excerpt?'\n↳ '+j.excerpt:''}`+section('INFO KEMPEN')+`\n🔖 Rujukan : ${ref}\n👤 Pemilik : ${short(j.owner,36)}\n${gs?'📢 Jenis : Auto Status Group':'🚀 Jenis : Auto Post'}\n↳ Status : ${this.state(j)}\n🎯 Mode : ${gs?'Sekali Jalan':j.targetMode==='SUCCESS'?'SUCCESS':j.targetMode==='DAYS'?'HARI':'BERTERUSAN'}`;
  text+=section('HASIL KEMPEN')+(gs?`\n🔗 Sasaran : ${j.total}\n✅ ACK OK : ${j.accepted}\n⏭ Dilangkau : ${j.skipped}\n❌ Gagal : ${j.failed}\n❔ Belum Pasti : ${j.unknown}\n📥 Baki : ${j.pending}\n• ACK OK bukan bukti Status dipaparkan.`:`\n✅ Success : ${j.successCount}${j.targetMode==='SUCCESS'?'/'+j.targetSuccess:''}\n❌ Failed : ${j.failedCount}\n❔ Belum Pasti : ${j.unknownCount||0}`);
  if(busy)text+=`\n📤 Sedang Diselesaikan : ${busy}\n↳ Angka masih boleh berubah sehingga operasi selesai.`;
  text+=section('MASA PROSES')+`\n🕒 Mula : ${date(gs?j.started_at:j.startedAt)}\n🏁 ${j.status==='STOPPED'?'Dihentikan':'Tamat'} : ${date(gs?j.completed_at:j.completedAt)}\n🌏 Malaysia · MYT / UTC+8`;
  text+=retentionNote(this.databasePath,j);
  text+=section('TINDAKAN REKOD')+`\n📄 ↳ .kempen-report ${j.number} → Laporan\n📁 ↳ .kempen-posts ${j.number} → Rekod Penghantaran\n📱 ↳ .kempen-accounts ${j.number} → Butiran Akaun\n📊 ↳ .kempen-live ${j.number} → Dashboard`;
  if(gs&&j.status==='STOPPED'&&j.pending>0&&!busy)text+=`\n▶️ ↳ .kempen-resume ${j.number} → Sambung Baki\n↳ Sambung kempen yang sama; hanya sasaran belum diproses.`;
  const removable=!busy&&(gs||j.reportStatus==='SENT'&&j.cleanupAt);
  if(removable)text+=`\n🗑 ↳ .kempen-delete ${j.number} → Padam Rekod`;
  else text+='\n⏳ Padam tersedia selepas operasi, laporan dan penyimpanan rekod selesai.';
  if(!gs&&j.cleanupAt&&!reportArchive(this.databasePath,j.id))text+='\n↳ Bahan telah dibersihkan. Sehingga 10 hasil terakhir masih disimpan; rujuk laporan asal di Telegram untuk butiran penuh.';
  return this.send(chat,text+section('NAVIGASI')+`\n🔄 ↳ .kempen-open ${j.number} → Segarkan Rekod\n↩️ ↳ .rekod → Senarai Rekod\n🏠 ↳ .menu → Menu Utama`);
 }
 async posts(chat,j,page=1){
  let all,total,pages,p,limited=false,expired=false;
  if(j.type==='gs'){const data=gsListPosts(this.databasePath,j.id,page,10);all=data.items;expired=data.expired;total=data.total;pages=data.pages;p=data.page;}
  else{const snap=postingReportSnapshot(this.databasePath,j.id);const retained=reportArchive(this.databasePath,j.id);limited=Boolean(j.cleanupAt)&&!retained;const rows=retained?retained.items:limited?(snap?.recent||[]):[...(snap?.attempts||[])].reverse();total=rows.length;pages=Math.max(1,Math.ceil(total/10));p=Math.max(1,Math.min(pages,Number(page)||1));all=rows.slice((p-1)*10,p*10);}
  let text=`📁 REKOD PENGHANTARAN ${j.number}\n↳ ${short(j.name,36)} • ${reference(j)}\n📃 Halaman ${p}/${pages}\n📋 ${limited?'Hasil Tersimpan':'Jumlah Rekod'} : ${total}`+section('HASIL PENGHANTARAN');
  if(limited)text+='\n↳ Sehingga 10 hasil terakhir disimpan selepas cleanup. Butiran penuh ada dalam laporan asal di Telegram.';
  const labels={ACCEPTED:'✅ ACK OK',SUCCESS:'✅ Success',FAILED:'❌ Gagal',UNKNOWN:'❔ Belum Pasti',SKIPPED:'⏭ Dilangkau',PENDING:'📥 Belum Diproses',IN_FLIGHT:'📤 Sedang Diproses',PROCESSING:'📤 Sedang Hantar'};
  for(const [i,a] of all.entries()){const acc=this.account(a.accountId);text+=`\n\n${(p-1)*10+i+1}. ${short(a.groupName,42)}\n↳ ${labels[a.status]||a.status} • …${String(acc?.phone||'').slice(-4)||'Tersimpan'}${a.adNo?' • Iklan '+a.adNo:''}\n↳ ${date(a.completedAt||a.attemptedAt)}`;if(a.error||a.errorText)text+='\n↳ '+short(a.error||a.errorText,90);}
  if(!all.length)text+=expired?'\nButiran terperinci telah tamat tempoh. Ringkasan laporan masih tersedia.':'\nTiada rekod penghantaran tersimpan.';
  if(j.type==='gs')text+='\n\n• ACK OK bukan bukti Status dipaparkan.';
  text+=section('NAVIGASI');if(p>1)text+=`\n⬅️ ↳ .kempen-posts ${j.number} ${p-1} → Sebelum`;if(p<pages)text+=`\n➡️ ↳ .kempen-posts ${j.number} ${p+1} → Seterusnya`;
  return this.send(chat,text+`\n↩️ ↳ .kempen-open ${j.number} → ${active(j)?'Dashboard':'Butiran Rekod'}\n🏠 ↳ .menu → Menu Utama`);
 }
 async report(chat,j,page=1){
  const gs=j.type==='gs',busy=Number(j.inFlight||j.processingCount||0),snap=gs?null:postingReportSnapshot(this.databasePath,j.id);
  const accounts=gs?gsAccountProgress(this.databasePath,j.id):(snap?.accountStats||j.accounts||[]),pages=Math.max(1,Math.ceil(accounts.length/5)),p=Math.max(1,Math.min(pages,Number(page)||1));
  const phase=busy?'Laporan Sementara · Operasi Belum Selesai':active(j)?'Laporan Semasa':j.status==='STOPPED'?'Laporan Ketika Dihentikan':'Laporan Akhir';
  let text=`📊 LAPORAN KEMPEN ${j.number}\n↳ ${short(j.name,36)}\n↳ ${phase}`+section('INFO KEMPEN')+`\n🔖 Rujukan : ${reference(j)}\n👤 Pemilik : ${short(j.owner,36)}\n${gs?'📢 Jenis : Auto Status Group':'🚀 Jenis : Auto Post'}\n↳ Status : ${this.state(j)}\n🎯 Mode : ${gs?'Sekali Jalan':j.targetMode==='SUCCESS'?'SUCCESS':j.targetMode==='DAYS'?'HARI':'BERTERUSAN'}`;
  text+=section('RINGKASAN HASIL');
  if(gs)text+=`\n🔗 Sasaran : ${j.total}\n📨 Selesai Proses : ${j.accepted+j.skipped+j.failed+j.unknown}/${j.total}\n✅ ACK OK : ${j.accepted}\n⏭ Dilangkau : ${j.skipped}\n❌ Gagal : ${j.failed}\n❔ Belum Pasti : ${j.unknown}\n📥 Belum Diproses : ${j.pending}`;
  else{text+=`\n✅ Success : ${j.successCount}${j.targetMode==='SUCCESS'?'/'+j.targetSuccess:''}\n❌ Failed : ${j.failedCount}\n❔ Belum Pasti : ${j.unknownCount||0}`;if(j.targetMode==='SUCCESS')text+=`\n🎯 Baki Target : ${Math.max(0,j.targetSuccess-j.successCount)}`;if(j.targetMode==='DAYS')text+=`\n📆 Tempoh : ${j.targetDays} hari\n🕒 Had Masa : ${date(j.endsAt)}`;if(j.targetMode==='CONTINUOUS')text+='\n↳ Berjalan sehingga dihentikan.';}
  text+=`\n📤 Sedang Diproses : ${busy}`;if(gs)text+='\n• ACK OK bukan bukti Status dipaparkan.';
  text+=section('HASIL PER AKAUN')+`\n📱 Akaun : ${accounts.length} • Halaman ${p}/${pages}`;
  for(const a of accounts.slice((p-1)*5,p*5)){const acc=this.account(a.accountId);text+=`\n\n📱 ${short(acc?.label||a.accountLabel||'Akaun Tersimpan',24)}${acc?.phone?' · …'+String(acc.phone).slice(-4):''}`;text+=gs?`\n↳ ACK ${a.accepted} • Skip ${a.skipped}\n↳ Gagal ${a.failed} • Belum Pasti ${a.unknown}\n↳ Proses ${Number(a.accepted)+Number(a.skipped)+Number(a.failed)+Number(a.unknown)}/${a.total}`:`\n↳ Success ${a.successCount||0} • Failed ${a.failedCount||0}\n↳ Belum Pasti ${a.unknownCount||0}`;}
  if(!accounts.length)text+='\nTiada butiran akaun tersimpan.';
  if(p>1)text+=`\n⬅️ ↳ .kempen-report ${j.number} ${p-1} → Akaun Sebelum`;if(p<pages)text+=`\n➡️ ↳ .kempen-report ${j.number} ${p+1} → Akaun Seterusnya`;
  text+=section('MASA PROSES')+`\n🕒 Mula : ${date(gs?j.started_at:j.startedAt)}\n🏁 ${active(j)?'Tamat':j.status==='STOPPED'?'Dihentikan':'Tamat'} : ${active(j)?'Belum tamat':date(gs?j.completed_at:j.completedAt)}\n🌏 Malaysia · MYT / UTC+8`;
  text+=retentionNote(this.databasePath,j);
  text+=section('TINDAKAN LAPORAN')+`\n📁 ↳ .kempen-posts ${j.number} → Rekod Penghantaran\n📋 ↳ .kempen-open ${j.number} → Butiran Kempen`;
  if(!active(j)&&!busy&&(gs||j.reportStatus==='SENT'&&j.cleanupAt))text+=`\n🗑 ↳ .kempen-delete ${j.number} → Padam Laporan & Rekod\n↳ Memadam rekod lokal kempen; laporan Telegram dan penghantaran WhatsApp kekal.`;
  else if(active(j))text+='\n↳ Padam tersedia selepas kempen dihentikan dan rekod diselesaikan.';
  else text+='\n↳ Padam tersedia selepas operasi, laporan dan cleanup selesai.';
  text+=section('NAVIGASI')+`\n🔄 ↳ .kempen-report ${j.number} ${p} → Segarkan Laporan\n↩️ ↳ .report → Senarai Laporan\n🏠 ↳ .menu → Menu Utama`;
  return this.send(chat,text);
 }
 async cancelDelete(chat){const pending=this.pendingDeletes.get(String(chat));if(!pending)return false;this.pendingDeletes.delete(String(chat));await this.send(chat,'↩️ PADAM DIBATALKAN\n↳ Rekod kempen dikekalkan.');const scope=pending.scope||'records';this.capture(chat,scope);const j=this.items(scope).find(j=>j.type===pending.type&&j.id===pending.id);if(j){if(scope==='reports')await this.report(chat,j);else await this.detail(chat,j);}else await this.list(chat,1,scope);return true;}
 async afterDelete(chat,type,id){const pending=this.pendingDeletes.get(String(chat));if(!pending||pending.type!==type||pending.id!==Number(id))return false;this.pendingDeletes.delete(String(chat));this.opened.delete(`${type}:${id}`);savePostingFlowState(this.databasePath,'hub-opened',[...this.opened]);await this.send(chat,'✅ REKOD KEMPEN DIPADAM\n↳ '+reference(pending)+' • Senarai di bawah menggunakan nombor terkini.');await this.list(chat,1,pending.scope||'records');return true;}
 feedback(type,id){const opened=this.opened.get(`${type}:${id}`);const j=this.items(opened?.scope||'active').find(j=>j.type===type&&j.id===id)||this.items('records').find(j=>j.type===type&&j.id===id);return `📊 DASHBOARD DISEGARKAN\n↳ ${short(j?.name||'Kempen',36)}${j?' • '+this.state(j):''}\n\n🔎 Tekan mesej rujukan di atas untuk dashboard live.\n↩️ ↳ .status → Senarai Kempen`;}
 decorate(type,id,text){const opened=this.opened.get(`${type}:${id}`);if(!opened)return text;const j=this.items(opened.scope).find(j=>j.id===id&&j.type===type);
  if(!j)return text.split('\n').filter(line=>! /\.(?:posting-|gs-|report |campaign-delete)/.test(line)).join('\n')+'\n\n📁 ↳ .rekod → Rekod Kempen\n📊 ↳ .status → Kempen Aktif';
  const replacements=type==='post'?{'posting-view':'open','status':'open','posting-pause':'pause','posting-resume':'resume','posting-stop':'stop','posting-accounts':'accounts','report':'report','campaign-delete':'delete','report-delete':'delete'}:{'gs-pause':'pause','gs-resume':'resume','gs-stop':'stop','gs-report':'report','gs-posts':'posts','gs-delete':'delete'};
  for(const [from,to] of Object.entries(replacements))text=text.replace(new RegExp('\\.'+from+'(?: \\d+){1,2}(?= →|\\n|$)','g'),`.kempen-${to} ${j.number}`);
  if(active(j))text=text.split('\n').filter(line=>!line.includes('.kempen-delete')).join('\n');
  text=text.replace(/(📊 (?:INFO )?KEMPEN|📢 AUTO STATUS|📊 AUTO STATUS) \d+/,`$1 ${j.number}`);
  text=text.split('\n').filter(line=>! /↳ \.(?:menu|status|group-status|kempen-accounts)(?: |$)/.test(line)).join('\n').trim();
  return text+section('NAVIGASI')+`\n📱 ↳ .kempen-accounts ${j.number} → Butiran Akaun\n↩️ ↳ ${opened.scope==='reports'?'.report':opened.scope==='active'?'.status':'.rekod'} → Senarai Kempen\n🏠 ↳ .menu → Menu Utama`;
 }
 async accounts(chat,j,page=1){let rows=j.type==='gs'?gsAccountProgress(this.databasePath,j.id):this.post.enrich(j.cleanupAt?{...j,accounts:postingReportSnapshot(this.databasePath,j.id)?.job.accounts||[]}:j).accounts;const pages=Math.max(1,Math.ceil(rows.length/10)),p=Math.max(1,Math.min(pages,Number(page)||1));let text=`📱 AKAUN KEMPEN ${j.number}\n↳ ${short(j.name,36)}\n📃 Halaman ${p}/${pages}`+section('STATUS AKAUN');for(const a of rows.slice((p-1)*10,p*10)){const acc=this.account(a.accountId),at=j.type==='gs'?a.nextAt:null;const wait=j.type==='gs'?Math.max(0,Math.ceil((Date.parse(at)-Date.now())/1000))||0:a.waitSeconds;const count=j.type==='gs'?`Proses ${Number(a.accepted)+Number(a.skipped)+Number(a.failed)+Number(a.unknown)}/${a.total}`:`Success ${a.successCount||0} • Failed ${a.failedCount||0}`;text+=`\n\n📱 ${short(acc?.label||'Akaun',32)} · …${String(acc?.phone||'').slice(-4)}\n↳ ${count}\n↳ ${j.status==='PAUSED'?'⏸ Dijeda bersama kempen':j.status==='STOPPED'?'🛑 Kempen dihentikan':j.status==='COMPLETED'?'✅ Kempen selesai':a.blockedAt?'⏸ Perlu Semakan':acc?.status!=='ONLINE'?'🔌 Offline':wait?'⏳ Delay / Rehat · Anggaran '+wait+'s':'Menunggu giliran'}`;}if(p>1)text+=`\n\n⬅️ ↳ .kempen-accounts ${j.number} ${p-1} → Sebelum`;if(p<pages)text+=`\n➡️ ↳ .kempen-accounts ${j.number} ${p+1} → Seterusnya`;return this.send(chat,text+section('NAVIGASI')+`\n📊 ↳ .kempen-open ${j.number} → ${active(j)?'Dashboard Live':'Butiran Rekod'}\n↩️ ↳ ${active(j)?'.status':'.rekod'} → Senarai Kempen\n🏠 ↳ .menu → Menu Utama`);}
 async handle(route){const {action,chatId:chat}=route;
  if(action==='hub_reports_page'||action==='report_refresh'||action==='report'&&!route.args?.length){await this.list(chat,action==='hub_reports_page'?route.args?.[0]:1,'reports');return true;}
  if(['posting_active','posting_refresh'].includes(action)){await this.list(chat,route.args?.[0]);return true;}
  if(['records','records_refresh'].includes(action)){await this.list(chat,route.args?.[0],'records');return true;}
  if(action!=='report'&&action!=='posting_status'&&!action.startsWith('hub_'))return false;
  const j=await this.resolve(chat,route.args?.[0],action==='report'?'reports':action==='posting_status'?'active':undefined);if(!j)return true;
  const op=action==='report'?'report':action==='posting_status'?'open':action.slice(4);if(op==='report'){this.remember(chat,j);await this.report(chat,j,route.args?.[1]);return true;}if(op==='open'){await this.show(chat,j);return true;}if(op==='live'){await this.live(chat,j);return true;}if(op==='posts'){await this.posts(chat,j,route.args?.[1]);return true;}if(op==='accounts'){await this.accounts(chat,j,route.args?.[1]);return true;}
  if(op==='delete'&&active(j)){await this.send(chat,'⏹ Hentikan kempen dahulu. Padam tersedia melalui .rekod selepas penghantaran selesai.');return true;}
  this.remember(chat,j);if(op==='delete')this.pendingDeletes.set(String(chat),{type:j.type,id:j.id,scope:(this.views.get(String(chat))||readPostingFlowState(this.databasePath,'hub-view:'+chat))?.scope||'records'});
  if(j.type==='post'){
   if(op==='posts'){await this.post.report(chat,j);return true;}
   const scope=active(j)?'active':'records',items=this.post.capture(chat,scope),n=items.findIndex(x=>x.id===j.id)+1;
   await this.post.handle({...route,action:op==='report'?'report':op==='delete'?'posting_delete':'posting_'+op,args:[String(n)]});
  }else{await this.gsAction(j.id,{...route,action:'gs_'+op,args:[]});if(op==='resume'&&gsSnapshot(this.databasePath,j.id)?.status==='RUNNING'){await this.send(chat,'▶️ KEMPEN DISAMBUNG\n↳ Baki diteruskan dalam kempen yang sama.');await this.list(chat,1,'active');}}
  return true;
 }
}
