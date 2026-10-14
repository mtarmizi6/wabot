import * as store from './store.js';
import {dashboard,report,nav,section,stepNav,paceText} from './ui.js';
import {LiveMessage} from '../telegram/live-message.js';
import {accountNumber,accountName} from '../telegram/accounts-ui.js';
const inputKinds=['text','photo','video','document'];
const steps=[['min','Delay minimum (saat)',1,86400],['max','Delay maksimum (saat)',1,86400],['batch','Rehat selepas berapa penerima',1,10000],['restMin','Rehat minimum (minit)',0,1440],['restMax','Rehat maksimum (minit)',0,1440],['quota','Kuota cubaan setiap akaun / pusingan',1,20000]];
export class FollowupFlow {
 constructor({databasePath,owner,manager,runner,send,edit,readDocument,saveMedia,preview,document}){Object.assign(this,{databasePath,owner:String(owner),manager,runner,send,edit,readDocument,saveMedia,preview,document});this.current=null;this.active=false;this.live=new Map();this.reporting=new Set();
 const saved=store.readInputContext(this.databasePath,this.owner),draft=saved?.id?store.getJob(this.databasePath,saved.id,this.owner):null;
 if(saved?.active&&draft?.status==='DRAFT'){this.current=draft.id;this.active=true;this.restored=true;}
 }
 get(id=this.current){return id?store.getJob(this.databasePath,Number(id),this.owner):null;}
 mutate(fn){return store.editJob(this.databasePath,this.current,this.owner,fn);}
 draft(){const j=this.get();if(j?.status!=='DRAFT')throw Error('Buka draf melalui .fu-new.');return j;}
 persistInput(){const j=this.get();const context={id:j?.id||null,active:!!(this.active&&j?.status==='DRAFT')};const json=JSON.stringify(context);if(json!==this.persistedInput){store.saveInputContext(this.databasePath,this.owner,context);this.persistedInput=json;}}
 leave(){this.active=false;this.confirm=null;this.persistInput();}
 async resumeNotice(chat){
  const draft=this.get()||store.listJobs(this.databasePath,this.owner).find(j=>j.status==='DRAFT');if(!draft||draft.status!=='DRAFT')return;
  if(this.restored&&this.active){await this.send(chat,'📝 DRAF FOLLOW-UP DIPULIHKAN\n↳ Controller disambung semula. Hantar pilihan semula pada langkah di bawah.');await this.screen(chat);}
  else await this.send(chat,'📝 DRAF FOLLOW-UP MASIH TERSIMPAN\n↳ Jika balasan sebelum restart belum diproses, buka draf dan hantar semula.\n\n📝 ↳ .fu-draft → Sambung Draf');
 }
 async home(chat){
 this.active=false;this.confirm=null;const jobs=store.listJobs(this.databasePath,this.owner),draft=jobs.find(j=>j.status==='DRAFT');
 return this.send(chat,['💬 AUTO FOLLOW-UP','↳ Urus penghantaran ke senarai nombor.',section('RINGKASAN'),
 `🚀 Berjalan : ${jobs.filter(j=>j.status==='RUNNING').length}`,`⏸ Dijeda / Baki : ${jobs.filter(j=>['PAUSED','QUOTA','STOPPED'].includes(j.status)).length}`,`📝 Draf : ${draft?1:0}`,section('MULA DI SINI'),
 '1. Cipta Kempen','➕ ↳ .fu-new → Pilih Akaun & Cipta Kempen',
 ...(draft?['','2. Sambung Draf','📝 ↳ .fu-draft → Teruskan Langkah Tersimpan']:[]),
 '',`${draft?3:2}. Senarai Kempen`,'📋 ↳ .fu-list → Pilih & Pantau Kempen',section('ALIRAN KEMPEN'),
 '1. Pilih Akaun','2. Masukkan Nombor','3. Susun Iklan & CTA','4. Tetapkan Delay, Rehat & Kuota','5. Semak & Mula',
 '', '📇 ↳ .extract → Eksport Ahli Group','🏠 ↳ .menu → Menu Utama'].join('\n'));
 }
 async screen(chat){let j=this.get();if(j?.status==='DRAFT'&&j.stage==='chatpick'){this.mutate(d=>{d.stage='numbers';delete d.chatChoices;delete d.preferChats;});j=this.get();}if(!j)return this.home(chat);this.active=true;if(j.status!=='DRAFT')return this.showLive(chat,j.id);
 if(j.stage==='accounts')return this.accounts(chat);
 if(j.stage==='numbers')return this.send(chat,['📥 FOLLOW-UP · LANGKAH 2/5','↳ Masukkan senarai nombor penerima.',section('SENARAI NOMBOR'),
 '• Tampal satu nombor setiap baris; atau','• Hantar fail TXT daripada Extract / senarai sendiri.','','Contoh: +60123456789','↳ Maksimum 1 MB / 20,000 baris.',
 ...(j.import?['',`📋 Senarai tersimpan : ${j.import.valid} nombor unik`,'✅ ↳ .fu-next → Kekalkan Senarai & Teruskan','↳ Hantar senarai baharu untuk menggantikannya.']:[]),stepNav].join('\n'));
 if(j.stage==='content')return this.send(chat,['📝 FOLLOW-UP · LANGKAH 3/5',`↳ ${j.editAd?'Ganti bahan Iklan '+j.editAd:'Tambah Iklan '+(j.ads.length+1)}.`,section('HANTAR BAHAN'),
 '📝 Teks sahaja','🖼 Gambar + caption','🎥 Video + caption','','↳ Satu media setiap mesej · Maksimum 20 MB.','↳ Selepas bahan disimpan, urus CTA bagi iklan tersebut.',stepNav].join('\n'));
 if(j.stage==='ads')return this.ads(chat);
 if(j.stage==='ctaLabel')return this.send(chat,`🔘 FOLLOW-UP · LANGKAH 3/5\n↳ Iklan ${j.selectedAd} · Nama CTA\n\n✍️ Hantar nama CTA (1–30 aksara).${stepNav}`);
 if(j.stage==='ctaUrl')return this.send(chat,`🔗 FOLLOW-UP · LANGKAH 3/5\n↳ Iklan ${j.selectedAd} · Link untuk “${j.ctaLabel}”\n\n✍️ Hantar URL penuh bermula https:// atau http://.${stepNav}`);
 if(j.stage==='pace')return this.send(chat,['⚙️ FOLLOW-UP · LANGKAH 4/5','↳ Tetapkan sela penghantaran dan kuota akaun.',section('TETAPAN SEMASA'),paceText(j),
 section('PILIH TINDAKAN'),'✅ ↳ .fu-review → Guna Tetapan Ini & Semak','✏️ ↳ .fu-setting → Ubah Tetapan','🎯 ↳ .fu-limit 100 → Had Keseluruhan 100 Cubaan','🎯 ↳ .fu-limit 0 → Ikut Kuota Akaun Sahaja',stepNav].join('\n'));
 if(j.stage==='settings'){const x=steps[j.settingStep||0];return this.send(chat,`⚙️ FOLLOW-UP · LANGKAH 4/5\n↳ Tetapan ${(j.settingStep||0)+1}/6 · ${x[1]}\n\n✍️ Hantar satu nombor (${x[2]}–${x[3]}).${stepNav}`);}
 return this.review(chat);
 }
 async ads(chat,page=1){const j=this.get();if(!j)return this.home(chat);if(j.status==='DRAFT')this.mutate(j=>{j.stage='ads';delete j.editAd;});
 page=Math.min(Math.max(1,Number(page)||1),Math.max(1,Math.ceil(j.ads.length/5)));const selected=j.ads[(j.selectedAd||1)-1];
 return this.send(chat,['📝 FOLLOW-UP · LANGKAH 3/5','↳ Susun iklan bergilir dan CTA setiap iklan.',section('SENARAI IKLAN'),
 ...j.ads.slice((page-1)*5,page*5).map((a,i)=>`${(page-1)*5+i+1}. Iklan ${(page-1)*5+i+1} · ${{TEXT:'Teks',PHOTO:'Gambar + Caption',VIDEO:'Video + Caption'}[a.kind]}\n   ↳ CTA ${a.buttons.length}/2\n📝 ↳ .fu-ad ${(page-1)*5+i+1} → Pilih Iklan`),
 ...(!j.ads.length?['Belum ada iklan.']:[]),...(page>1?[`⬅️ ↳ .fu-ads ${page-1} → Sebelum`]:[]),...(j.ads.length>page*5?[`➡️ ↳ .fu-ads ${page+1} → Seterusnya`]:[]),
 ...(selected?[section('IKLAN DIPILIH'),`Iklan ${j.selectedAd||1} · CTA ${selected.buttons.length}/2`,
 '👁 ↳ .fu-preview → Preview Bahan & CTA','🔘 ↳ .fu-cta → Tambah CTA','🧹 ↳ .fu-cta-clear → Kosongkan CTA',`✏️ ↳ .fu-edit ${j.selectedAd||1} → Edit Bahan`,`🗑 ↳ .fu-remove ${j.selectedAd||1} → Buang Iklan Draf`]:[]),
 section('LANGKAH SETERUSNYA'),'➕ ↳ .fu-add → Tambah Iklan',...(j.ads.length?['✅ ↳ .fu-next → Selesai Iklan & Tetapkan Jadual']:[]),
 '↳ CTA pilihan sahaja, maksimum 2 bagi setiap iklan.',stepNav].join('\n'));
 }
 async accounts(chat,page=1){const j=this.get();if(!j)return this.home(chat);this.active=true;const all=this.manager.list();
 if(j.status==='DRAFT')this.mutate(j=>{j.stage='accounts';j.accountChoices=all.map(a=>({id:a.id,number:accountNumber(a),phone:a.phone||''}));});
 const entries=j.status==='DRAFT'?all:j.accounts.map(a=>{const live=all.find(x=>x.id===a.id);return live?{...live,used:a.used}:{id:a.id,displayNumber:a.number,phone:a.phone,status:'TIDAK TERSEDIA',used:a.used};});
 const pages=Math.max(1,Math.ceil(entries.length/10));page=Math.min(pages,Math.max(1,Number(page)||1));
 return this.send(chat,[j.status==='DRAFT'?'📱 FOLLOW-UP · LANGKAH 1/5':'📱 AKAUN KEMPEN FOLLOW-UP',
 '↳ Pilih akaun WhatsApp untuk penghantaran.',section('SENARAI AKAUN'),
 ...entries.slice((page-1)*10,page*10).flatMap(a=>[`${accountNumber(a)}. ${accountName(a)}`,`   ↳ ${a.status==='ONLINE'?'🟢 Online':'🔴 '+a.status}${a.used!==undefined?' · '+a.used+'/'+j.pace.quota+' cubaan':''}`,...(j.status==='DRAFT'&&a.status==='ONLINE'?[`📱 ↳ .fu-select ${accountNumber(a)} → Pilih Akaun ${accountNumber(a)}`]:[]),'']),
 ...(!entries.length?['Tiada akaun. Sambungkan dahulu melalui .login.']:[]),`Halaman ${page}/${pages}`,
 ...(page>1?[`⬅️ ↳ .fu-accounts ${page-1} → Halaman Sebelum`]:[]),...(page<pages?[`➡️ ↳ .fu-accounts ${page+1} → Halaman Seterusnya`]:[]),
 ...(j.status==='DRAFT'?[section('PILIH AKAUN'),'• Satu akaun : 1','• Beberapa akaun : 1,2','• Semua akaun ONLINE : all','','✍️ Balas pilihan di atas atau salin command akaun.','📱 ↳ .fu-select all → Pilih Semua Akaun ONLINE','↳ Had penghantaran setiap akaun ditetapkan pada Langkah 4.',stepNav]:[nav])].join('\n'));
 }
 async review(chat){const j=this.get(),s=store.snapshot(this.databasePath,j.id,this.owner);return this.send(chat,[
 '👁 FOLLOW-UP · LANGKAH 5/5','↳ Semak kempen sebelum mula.',section('RINGKASAN KEMPEN'),`💬 Kempen : Follow-Up ${j.id}`,`📱 Akaun Dipilih : ${j.accounts.length}`,
 `📥 Nombor Unik : ${s.total}`,...(j.import?[`↳ Duplicate ${j.import.duplicate} · Tidak Sah ${j.import.invalid}`]:[]),`📝 Jumlah Iklan : ${j.ads.length}`,
 ...j.ads.slice(0,5).map((a,i)=>`   ${i+1}. ${{TEXT:'Teks',PHOTO:'Gambar + Caption',VIDEO:'Video + Caption'}[a.kind]} · CTA ${a.buttons.length}`),...(j.ads.length>5?['   ↳ +'+(j.ads.length-5)+' iklan lagi']:[]),
 ...(j.source==='chats'?[section('AKAUN ASAL PENERIMA'),...store.withDb(this.databasePath,db=>db.prepare('SELECT source_account_id id,count(*) n FROM fu_targets WHERE job_id=? GROUP BY source_account_id').all(j.id)).map(r=>`📱 Akaun ${j.accounts.find(a=>a.id===r.id)?.number||'?'} : ${r.n} penerima`)]:[]),section('DELAY DAN KUOTA'),paceText(j),section('MULA KEMPEN'),
 '🚀 ↳ .fu-run → Mula Penghantaran',section('UBAH PILIHAN'),'📱 ↳ .fu-accounts → Ubah Akaun','📥 ↳ .fu-numbers → Ubah Senarai Nombor','📝 ↳ .fu-ads → Ubah Iklan & CTA','⚙️ ↳ .fu-pace → Ubah Jadual',
 '','↳ Satu cubaan setiap nombor. Hanya nombor belum dicuba kekal dalam baki.',stepNav].join('\n'));}
 async showLive(chat,id){const j=this.get(id);if(!j)throw Error('Kempen tidak ditemui.');this.current=j.id;let live=this.live.get(j.id);if(!live){live=new LiveMessage({chatId:chat,send:this.send,edit:this.edit,render:()=>dashboard(store.snapshot(this.databasePath,j.id,this.owner),this.manager)});this.live.set(j.id,live);}await live.update(true);}
 async update(id){await this.live.get(id)?.update();const j=this.get(id);if(j&&['COMPLETED','STOPPED','QUOTA'].includes(j.status)&&!store.snapshot(this.databasePath,id,this.owner).counts.PROCESSING&&j.reportKey!==`${j.status}:${j.round}`)await this.sendReport(this.owner,id,true);}
 async sendReport(chat,id,automatic=false){if(this.reporting.has(id))return;this.reporting.add(id);try{const s=store.snapshot(this.databasePath,id,this.owner);if(!s)throw Error('Kempen tidak ditemui.');const text=report(s);if(text.length<3800)await this.send(chat,text);else await this.document(chat,{buffer:Buffer.from(text),filename:`FU-${id}-Report.txt`,mimeType:'text/plain'});if(automatic)store.editJob(this.databasePath,id,this.owner,j=>{j.reportKey=`${s.job.status}:${s.job.round}`;});}finally{this.reporting.delete(id);}}
 async input(route){const j=this.get();if(!j||j.status!=='DRAFT')return false;const chat=route.chatId,text=String(route.text||'').trim();
 if(j.stage==='numbers'){
  if(!['text','document'].includes(route.action))throw Error('Hantar teks atau fail TXT.');let content=text;
  if(route.action==='document'){if(!/\.txt$/i.test(route.document.fileName)||route.document.fileSize>1024*1024)throw Error('Gunakan TXT maksimum 1 MB.');const buffer=await this.readDocument(route.document);if(buffer.length>1024*1024)throw Error('Fail melebihi 1 MB.');content=buffer.toString('utf8');}
  store.importNumbers(this.databasePath,j.id,this.owner,content);if(j.ads.length)this.mutate(j=>{j.stage='ads';});await this.screen(chat);return true;
 }
 if(j.stage==='content'){
  if(route.mediaGroupId)throw Error('Hantar satu gambar atau video; album tidak disokong.');
  if(!['text','photo','video'].includes(route.action))throw Error('Hantar teks, gambar + caption atau video + caption.');
  const kind={text:'TEXT',photo:'PHOTO',video:'VIDEO'}[route.action];if(!text||text.length>(kind==='TEXT'?4000:1000))throw Error(kind==='TEXT'?'Teks diperlukan, maksimum 4,000 aksara.':'Caption diperlukan, maksimum 1,000 aksara.');
  if(j.ads.length>=30&&!j.editAd)throw Error('Maksimum 30 iklan.');const media=kind==='TEXT'?{}:await this.saveMedia(route,j,kind);
  this.mutate(j=>{if(j.editAd){const old=j.ads[j.editAd-1];j.ads[j.editAd-1]={kind,body:text,buttons:old.buttons,...media};j.selectedAd=j.editAd;delete j.editAd;}else{j.ads.push({kind,body:text,buttons:[],...media});j.selectedAd=j.ads.length;}j.stage='ads';});await this.screen(chat);return true;
 }
 if(j.stage==='ctaLabel'){if(route.action!=='text'||!text||text.length>30)throw Error('Nama CTA 1–30 aksara.');this.mutate(j=>{j.ctaLabel=text;j.stage='ctaUrl';});await this.screen(chat);return true;}
 if(j.stage==='ctaUrl'){let url;try{url=new URL(text);}catch{throw Error('URL tidak sah.');}if(route.action!=='text'||!['http:','https:'].includes(url.protocol)||url.username||url.password||text.length>2000)throw Error('Gunakan URL http/https yang sah.');this.mutate(j=>{const ad=j.ads[j.selectedAd-1];if(!ad||ad.buttons.length>=2)throw Error('Maksimum 2 CTA.');ad.buttons.push({label:j.ctaLabel,url:text});delete j.ctaLabel;j.stage='ads';});await this.screen(chat);return true;}
 if(j.stage==='settings'){const [key,,min,max]=steps[j.settingStep||0];if(route.action!=='text'||!/^\d+$/.test(text)||Number(text)<min||Number(text)>max)throw Error(`Masukkan nombor ${min}–${max}.`);const n=Number(text);this.mutate(j=>{const values=j.settingValues||{};if(key==='max'&&n<values.min)throw Error('Maksimum mesti ≥ minimum.');if(key==='restMax'&&n<values.restMin)throw Error('Rehat maksimum mesti ≥ minimum.');values[key]=n;j.settingValues=values;j.settingStep=(j.settingStep||0)+1;if(j.settingStep===steps.length){j.pace={roundLimit:j.pace.roundLimit||0,...values,restMin:values.restMin*60,restMax:values.restMax*60};j.stage='pace';delete j.settingStep;delete j.settingValues;}});await this.screen(chat);return true;}
 if(j.stage==='accounts'&&route.action==='text'){await this.select(chat,text);return true;}
 return false;
 }
 async select(chat,value){const current=this.draft();const all=this.manager.list(),online=all.filter(a=>a.status==='ONLINE');let selected;
 const choices=all.map(a=>({id:a.id,number:accountNumber(a),phone:a.phone||''}));
 if(!current.accountChoices||JSON.stringify(choices)!==JSON.stringify(current.accountChoices)){await this.accounts(chat);throw Error('Senarai akaun berubah. Pilih semula daripada senarai terkini.');}
 if(value.toLowerCase()==='all')selected=online;
 else{const parts=value.split(/[\s,]+/).filter(Boolean);if(!parts.length||parts.some(x=>!/^\d+$/.test(x)))throw Error('Pilih nombor akaun seperti 1,2 atau all.');const nums=[...new Set(parts.map(Number))];selected=nums.map(n=>all.find(a=>accountNumber(a)===n));if(selected.some(a=>!a||a.status!=='ONLINE'))throw Error('Semua akaun pilihan mesti ONLINE.');}
 if(!selected.length||selected.length>50)throw Error('Pilih 1 hingga 50 akaun ONLINE.');
 this.mutate(j=>{j.accounts=selected.map(a=>({id:a.id,number:accountNumber(a),phone:a.phone||'',label:`Akaun ${accountNumber(a)} · ${accountName(a).slice(0,40)}`,used:0,attempts:0,nextAt:0}));j.cursor=0;j.stage='numbers';});return this.screen(chat);}
 async handle(route){const isCommand=route.action?.startsWith('fu_');if(!isCommand&&(!this.active||!inputKinds.includes(route.action)))return false;
 const chat=route.chatId,args=route.args||[],action=route.action;
 try{
 if(!isCommand){if(this.confirm){if(Date.now()>this.confirm.expires){this.confirm=null;throw Error('Pengesahan tamat tempoh.');}if(route.action!=='text'||route.text.toUpperCase()!=='SAH')throw Error('Balas SAH atau .fu-cancel untuk batal.');const c=this.confirm;this.confirm=null;store.changeStatus(this.databasePath,c.id,this.owner,'STOPPED');await this.showLive(chat,c.id);await this.update(c.id);return true;}return await this.input(route);}
 this.active=true;if(action!=='fu_cancel')this.confirm=null;
 if(action==='fu_home'){this.confirm=null;await this.home(chat);return true;}
 if(action==='fu_cancel'){this.confirm=null;await this.home(chat);return true;}
 if(action==='fu_back'){this.confirm=null;const j=this.get();if(!j||j.status!=='DRAFT'){await this.home(chat);return true;}if(j.stage==='accounts'){await this.home(chat);return true;}
 this.mutate(j=>{if(j.stage==='settings'){if(j.settingStep>0){j.settingStep--;const keys=steps.slice(j.settingStep).map(x=>x[0]);for(const k of keys)delete j.settingValues[k];}else j.stage='pace';}
 else{j.stage=({chatpick:'numbers',numbers:'accounts',content:j.ads.length?'ads':'numbers',ads:'numbers',ctaLabel:'ads',ctaUrl:'ctaLabel',pace:'ads',review:'pace'})[j.stage]||'ads';if(j.stage!=='content')delete j.editAd;}});await this.screen(chat);return true;}
 if(action==='fu_draft'){const j=store.listJobs(this.databasePath,this.owner).find(j=>j.status==='DRAFT');if(!j){await this.home(chat);return true;}this.current=j.id;await this.screen(chat);return true;}
 if(action==='fu_new'){const j=store.newJob(this.databasePath,this.owner);this.current=j.id;await this.screen(chat);return true;}
 if(action==='fu_list'){this.active=false;const jobs=store.listJobs(this.databasePath,this.owner).reverse(),page=Math.max(1,Number(args[0])||1),items=jobs.slice((page-1)*10,page*10);await this.send(chat,['📋 KEMPEN FOLLOW-UP',section('SENARAI KEMPEN'),...(!jobs.length?['Belum ada kempen. Cipta kempen pertama di bawah.','']:[]),...items.map((j,i)=>`${(page-1)*10+i+1}. Follow-Up ${j.id} · ${j.status}\n💬 ↳ .fu-open ${j.id} → Buka Kempen`),...(page>1?[`⬅️ ↳ .fu-list ${page-1} → Sebelum`]:[]),...(jobs.length>page*10?[`➡️ ↳ .fu-list ${page+1} → Seterusnya`]:[]),'▶️ ↳ .fu-new → Cipta Kempen',nav].join('\n'));return true;}
 if(['fu_open','fu_status','fu_pause','fu_resume','fu_continue','fu_stop','fu_run','fu_report','fu_remaining'].includes(action)&&args[0]){if(!this.get(args[0]))throw Error('Kempen tidak ditemui.');this.current=Number(args[0]);}
 if(!this.current&&['fu_select','fu_accounts'].includes(action)){const draft=store.listJobs(this.databasePath,this.owner).find(j=>j.status==='DRAFT');if(draft)this.current=draft.id;}
 const j=this.get();if(!j){await this.home(chat);return true;}
 if(action==='fu_open'){await this.screen(chat);}
 else if(action==='fu_accounts'){await this.accounts(chat,args[0]);}
 else if(action==='fu_select'){await this.select(chat,args.join(' '));}
 else if(action==='fu_numbers'||action==='fu_add'||action==='fu_setting'){this.draft();this.mutate(j=>{delete j.editAd;j.stage=action==='fu_numbers'?'numbers':action==='fu_add'?'content':'settings';j.settingStep=0;j.settingValues={};});await this.screen(chat);}
 else if(action==='fu_limit'){this.draft();const value=Number(args[0]);if(!/^\d+$/.test(args[0]||'')||!Number.isInteger(value)||value<0||value>20000)throw Error('Had ialah 0 hingga 20,000 cubaan.');this.mutate(j=>{j.pace.roundLimit=value;j.stage='pace';});await this.screen(chat);}
 else if(action==='fu_ads'){await this.ads(chat,args[0]);}
 else if(action==='fu_ad'){this.draft();const n=Number(args[0]);if(!j.ads[n-1])throw Error('Nombor iklan tidak sah.');this.mutate(j=>{j.selectedAd=n;j.stage='ads';});await this.screen(chat);}
 else if(action==='fu_edit'||action==='fu_remove'){this.draft();const n=Number(args[0]);if(!j.ads[n-1])throw Error('Nombor iklan tidak sah.');this.mutate(j=>{if(action==='fu_edit'){j.editAd=n;j.stage='content';}else{j.ads.splice(n-1,1);j.selectedAd=1;delete j.editAd;j.stage=j.ads.length?'ads':'content';}});await this.screen(chat);}
 else if(action==='fu_cta'||action==='fu_cta_clear'){this.draft();const ad=j.ads[(j.selectedAd||1)-1];if(!ad)throw Error('Masukkan bahan dahulu.');if(action==='fu_cta'&&ad.buttons.length>=2)throw Error('Maksimum 2 CTA setiap iklan.');this.mutate(j=>{if(action==='fu_cta')j.stage='ctaLabel';else{j.ads[(j.selectedAd||1)-1].buttons=[];j.stage='ads';}});await this.screen(chat);}
 else if(action==='fu_preview'){const ad=j.ads[(j.selectedAd||1)-1];if(!ad)throw Error('Tiada bahan.');await this.preview(chat,ad);}
 else if(['fu_next','fu_pace','fu_review'].includes(action)){this.draft();
 this.mutate(j=>{if(action==='fu_next'&&j.stage==='numbers'){if(!j.import)throw Error('Masukkan nombor dahulu.');j.stage=j.ads.length?'ads':'content';return;}
 if(!j.accounts.length||!j.import||!j.ads.length)throw Error('Lengkapkan akaun, nombor dan iklan dahulu.');j.stage=action==='fu_review'?'review':'pace';});await this.screen(chat);}
 else if(action==='fu_run'||action==='fu_resume'||action==='fu_continue'){
 if(j.status==='DRAFT'&&(action!=='fu_run'||j.stage!=='review')){await this.screen(chat);return true;}
 if(action==='fu_run'&&j.status!=='DRAFT'&&j.status!=='RUNNING')throw Error('Gunakan Sambung untuk kempen sedia ada.');
 if(action==='fu_continue'&&j.status!=='QUOTA'&&!store.quotaExhausted(j))throw Error('Kuota belum habis.');
 if(!j.accounts.some(a=>this.manager.get(a.id)?.status==='ONLINE'))throw Error('Sambungkan sekurang-kurangnya satu akaun pilihan.');
 store.startJob(this.databasePath,j.id,this.owner,{continueQuota:action==='fu_continue'});this.runner.start();await this.showLive(chat,j.id);
 }
 else if(action==='fu_pause'){store.changeStatus(this.databasePath,j.id,this.owner,'PAUSED');await this.showLive(chat,j.id);}
 else if(action==='fu_stop'){if(!['RUNNING','PAUSED','QUOTA'].includes(j.status))throw Error('Kempen ini tidak sedang berjalan.');this.confirm={id:j.id,expires:Date.now()+120000};await this.send(chat,`⏹ HENTIKAN FU-${j.id}?\n↳ Baki belum dicuba disimpan untuk sambung. Cubaan sedang berjalan mungkin masih selesai.\n\n✅ ↳ Balas SAH → Hentikan\n✖️ ↳ .fu-cancel → Batal`);}
 else if(action==='fu_report'){await this.sendReport(chat,j.id);}
 else if(action==='fu_remaining'){const phones=store.withDb(this.databasePath,db=>db.prepare("SELECT phone FROM fu_targets WHERE job_id=? AND status='PENDING' ORDER BY id").all(j.id));if(!phones.length)throw Error('Tiada baki belum dicuba.');await this.document(chat,{buffer:Buffer.from(phones.map(r=>'+'+r.phone).join('\n')+'\n'),filename:`FU-${j.id}-Baki.txt`,mimeType:'text/plain'});}
 else if(action==='fu_status'){await this.showLive(chat,j.id);}
 else{await this.screen(chat);}
 }catch(error){await this.send(chat,`⚠️ FOLLOW-UP\n↳ ${error.message}`+nav);}
 finally{this.persistInput();}
 return true;
 }
 close(){for(const live of this.live.values())live.close();this.live.clear();this.runner.close();}
}
