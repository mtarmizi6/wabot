import { accountName, accountNumber, accountStatus, malaysiaTime } from './accounts-ui.js';

const clientFlow=p=>p?.ownerType==='CLIENT'&&p.clientFlowVersion>=186;
const rm=c=>`RM${(Number(c||0)/100).toFixed(2)}`;
const billing=j=>j.chargeCents?screen(`💰 Caj : ${rm(j.chargeCents)}`,`💳 Bayaran : ${j.paidFullAt?'✅ Bayaran Penuh':'Belum disahkan'}`):null;
const section = title => `\n-------------------------\n| ${title} |\n-------------------------`;
const cmd = (value, label, icon='➡️') => `${icon} ↳ ${value} → ${label}`;
const screen = (...rows) => rows.flat().filter(x=>x!==null&&x!==undefined).join('\n');
const nav = () => screen('',cmd('.mula','Simpan Draf & Kembali','📝'),cmd('.menu','Menu Utama','🏠'));
const back = (value,label) => screen('',cmd(value,label,'↩️'),cmd('.batal','Keluar & Simpan Draf','✖️'));
const name = p => String(p?.displayName||'Kempen');
const identity = p => `${p?.ownerType==='CLIENT'?'💼':'📢'} ${name(p)}`;
const no = n => String(n||1).padStart(2,'0');
const short = (s,n=60) => {const a=Array.from(String(s||'').replace(/[\r\n\t]+/g,' '));return a.length>n?a.slice(0,n-1).join('')+'…':a.join('');};
const kind = k => ({TEXT:'📝 Teks',PHOTO:'🖼 Gambar + Caption',VIDEO:'🎥 Video + Caption'})[k]||'Belum diketahui';
const pageOf = (items,page=1) => {const pages=Math.max(1,Math.ceil(items.length/10));page=Math.max(1,Math.min(pages,Math.floor(Number(page)||1)));return {items:items.slice((page-1)*10,page*10),page,pages};};
const paging = (p,command) => screen(p.pages>1?`\n📄 Halaman : ${p.page}/${p.pages}`:null,p.page>1?cmd(`${command} ${p.page-1}`,'Halaman Sebelum','⬅️'):null,p.page<p.pages?cmd(`${command} ${p.page+1}`,'Halaman Seterusnya'):null);
export const postingStatusIcon = status => ({RUNNING:'🟢',PAUSED:'⏸',WAITING:'⏳',COMPLETED:'✅',STOPPED:'⏹'})[status]||'⚪';
export const postingStatusLabel = status => ({RUNNING:'Sedang Berjalan',PAUSED:'Dijeda',WAITING:'Menunggu',COMPLETED:'Selesai',STOPPED:'Dihentikan'})[status]||status;
export const postingJobModeLabel = job => job.targetMode==='SUCCESS'?`SUCCESS · ${job.successCount}/${job.targetSuccess}${job.targetUnit==='UNIQUE_GROUPS'?' Group WhatsApp':''} · ${job.reuseMode==='UNIQUE'?'Sekali Sahaja':'Ulang'}`:job.targetMode==='DAYS'?`HARI · ${job.targetDays} hari`:'BERTERUSAN';
export function postingFeedbackMessage(job,activity='',dashboardPending=false) {
 const n=job.displayNumber||1;
 return screen(`📊 INFO KEMPEN ${n}`,`↳ ${short(job.displayName,64)}`,'',
  `${postingStatusIcon(job.status)} Status : ${postingStatusLabel(job.status)}`,
  `✅ Success : ${job.successCount}${job.targetMode==='SUCCESS'?'/'+job.targetSuccess:''}`,
  `❌ Failed : ${job.failedCount} • ❔ Belum Pasti : ${job.unknownCount||0}`,
  `📨 Sedang Hantar : ${job.processingCount||0}`,
  activity?`⏱ ${short(activity,160)}`:null,'',
  '📌 Tekan petikan mesej di atas untuk buka dashboard live.',
  '• Jika petikan tiada, cari mesej dashboard kempen di atas chat.',
  dashboardPending?'• Dashboard belum selesai dikemas kini. Maklumat di sini ialah status semasa.':null,'',
  job.status==='RUNNING'?cmd(`.posting-pause ${n}`,'Jeda','⏸'):null,
  ['PAUSED','WAITING'].includes(job.status)?cmd(`.posting-resume ${n}`,'Sambung','▶️'):null,
  cmd('.status','Semua Kempen Aktif','📊'));
}
export function postingNewMessage(existing=null,summary=null) {
 if(existing)return screen('🚀 MULA POSTING','↳ Sambung persediaan kempen anda.',section('DRAF TERSIMPAN'),identity(existing),summary?`🖼 Iklan : ${summary.ads?.length||0}`:null,summary?`📍 Langkah : ${!summary.ads?.length?'Tambah Iklan':!summary.plan?.accounts?.length?'Pilih Akaun':summary.plan.status!=='READY'?'Pilih Mode':'Semakan Akhir'}`:null,`📝 Status : ${existing.status==='READY'?'Iklan Sedia':'Sedang Disediakan'}`,section('TINDAKAN DRAF'),cmd('.posting-sambung','Teruskan Draf','📝'),cmd('.iklan-urus','Semak Iklan','✏️'),cmd('.posting-batal','Buang Draf','🗑️'),'',cmd('.status','Posting Aktif','⚡'),cmd('.menu','Menu Utama','🏠'));
 return screen('🚀 MULA POSTING','↳ Cipta kempen sendiri atau untuk client.',section('JENIS KEMPEN'),'01. 📢 SENDIRI','   ↳ Promosikan produk atau servis anda.',cmd('.mula sendiri','Cipta Kempen Sendiri'),'', '02. 💼 CLIENT','   ↳ Jalankan kempen untuk pelanggan.',cmd('.mula client','Cipta Kempen Client'),cmd('.client','Urus Pelanggan','👤'),section('PANTAU KEMPEN'),cmd('.status','Posting Aktif','⚡'),cmd('.menu','Menu Utama','🏠'));
}
export function postingNamePromptMessage(ownerType) {
 const client=ownerType==='CLIENT';return screen('🚀 AUTO POST · LANGKAH 1/6',client?'↳ Masukkan nama client untuk posting ini.':'↳ Berikan nama untuk posting ini.','',`• Jenis : ${client?'Client':'Sendiri'}`,`• Contoh : ${client?'Ahmad Printing':'Promosi September'}`,'','✍️ Hantar nama sekarang.',back('.mula','Pilih Jenis'));
}
export function postingAdInputMessage(posting,adNo=1,{next=false}={}) {
 return screen(`📝 IKLAN ${no(adNo)} · ${name(posting).toUpperCase()}`,clientFlow(posting)?'↳ Kempen Client · Bahan Iklan':'↳ Auto Post · Langkah 2/6',section('BAHAN IKLAN'),'📝 Teks sahaja','🖼 Gambar + Caption','🎥 Video + Caption','','• Media maksimum 20 MB.','• Selepas disimpan, boleh tambah maksimum 2 Button / CTA.','',next?'✍️ Hantar iklan seterusnya.':'✍️ Hantar bahan iklan pertama.',back('.iklan-urus','Urus Iklan'),nav());
}
export function postingAdAcceptedMessage(posting,ad) {
 return screen(`✅ IKLAN ${no(ad?.adNo)} DITERIMA`,identity(posting),`Jenis : ${kind(ad?.kind)}`,section('BUTTON / CTA'),'• Pilihan tambahan, maksimum 2 untuk iklan ini.',cmd(`.button-add ${ad?.adNo||1}`,'Tambah CTA','➕'),cmd(`.button-done ${ad?.adNo||1}`,'Selesai / Tanpa CTA'),cmd(`.iklan-preview ${ad?.adNo||1}`,'PREVIEW Iklan','👁'));
}
export function postingButtonNamePromptMessage(ad,buttonNo) {
 return screen(`🔘 BUTTON ${no(buttonNo)} · IKLAN ${no(ad?.adNo)}`,'↳ Masukkan nama button.','','• Contoh: WhatsApp Saya / Beli Sekarang','• Maksimum 64 aksara.','','✍️ Hantar nama button.',back('.button-cancel','Urus Button'));
}
export function postingButtonUrlPromptMessage(ad,buttonNo,label) {
 return screen('🔗 LINK BUTTON',`↳ Iklan ${no(ad?.adNo)} · Button ${buttonNo}`,`🔘 Nama : ${label}`,'','• Contoh: https://wa.me/60123456789','','✍️ Hantar pautan sekarang.',back('.button-cancel','Urus Button'));
}
export function postingButtonSavedMessage(posting,ad,buttons=[]) {
 return screen('✅ BUTTON DISIMPAN',identity(posting),`↳ Iklan ${no(ad?.adNo)} · ${buttons.length}/2 Button`,buttons.map(b=>`${b.buttonNo}. ${b.label}`),section('TINDAKAN IKLAN'),buttons.length<2?cmd('.button-add','Tambah Button Kedua','➕'):null,cmd(`.button-done ${ad?.adNo||1}`,'Siap & Teruskan'),cmd(`.iklan-preview ${ad?.adNo||1}`,'PREVIEW Iklan','👁'),cmd(`.button-manage ${ad?.adNo||1}`,'Urus Button','🔘'));
}
export function postingAdCompleteMessage(posting,ad,buttons=[]) {
 return screen(`✅ IKLAN ${no(ad?.adNo)} SIAP`,identity(posting),`Jenis : ${kind(ad?.kind)}`,`Button : ${buttons.length}`,section('LANGKAH SETERUSNYA'),cmd('.iklan-tambah','Tambah Iklan','➕'),cmd('.iklan-siap','Selesai Iklan & Pilih Akaun'),cmd('.iklan-urus','Semak Semua Iklan','✏️'),nav());
}
export function postingAdsManageMessage(summary,page=1) {
 if(!summary?.posting)return screen('📝 URUS IKLAN','• Tiada draf kempen.',cmd('.mula','Mula Posting','🚀'));
 const {posting,ads=[]}=summary,p=pageOf(ads,page);
 return screen(`📝 IKLAN · ${name(posting).toUpperCase()}`,clientFlow(posting)?'↳ Kempen Client · Bahan Iklan':'↳ Auto Post · Langkah 2/6',`📋 Jumlah Iklan : ${ads.length}`,section('SENARAI IKLAN'),ads.length?p.items.map(a=>screen(`${a.adNo}. ${kind(a.kind)}`,`   ↳ ${a.buttonCount||0} Button`,cmd(`.iklan ${a.adNo}`,'Urus Iklan','🔎'),'')):'• Belum ada iklan.',paging(p,'.iklan-urus'),section('TINDAKAN IKLAN'),cmd('.iklan-tambah','Tambah Iklan','➕'),ads.length?cmd('.iklan-siap','Teruskan ke Akaun'):null,nav());
}
export function postingAdDetailMessage(posting,ad) {
 if(!posting||!ad)return screen('⚠️ IKLAN','• Iklan tidak ditemui.',cmd('.iklan-urus','Senarai Iklan','↩️'));
 return screen(`📝 IKLAN ${no(ad.adNo)} · ${name(posting).toUpperCase()}`,`Jenis : ${kind(ad.kind)}`,`Button : ${ad.buttons?.length||0}`,section('TINDAKAN IKLAN'),cmd(`.iklan-preview ${ad.adNo}`,'PREVIEW Iklan','👁'),cmd(`.iklan-edit ${ad.adNo}`,'Edit Teks / Media','✏️'),cmd(`.button-manage ${ad.adNo}`,'Urus Button / CTA','🔘'),cmd(`.iklan-delete ${ad.adNo}`,'Padam Iklan','🗑️'),'',cmd('.iklan-urus','Senarai Iklan','↩️'),cmd('.iklan-siap','Teruskan ke Akaun'));
}
export function postingPreviewHeaderMessage(posting,ad) {return screen(`👁 PREVIEW · IKLAN ${no(ad?.adNo)}`,identity(posting),'↳ Bahan iklan dipaparkan di bawah.','• Preview Telegram tidak menjamin rupa yang sama di WhatsApp.');}
export function postingPreviewFooterMessage(ad) {return screen(cmd(`.iklan-edit ${ad?.adNo||1}`,'Edit Iklan','✏️'),cmd(`.button-manage ${ad?.adNo||1}`,'Urus Button','🔘'),cmd(`.iklan ${ad?.adNo||1}`,'Butiran Iklan','↩️'));}
export function postingButtonManageMessage(posting,ad) {
 if(!ad)return screen('🔘 BUTTON','• Pilih iklan dahulu.',cmd('.iklan-urus','Urus Iklan','↩️'));
 const buttons=ad.buttons||[];
 return screen(`🔘 BUTTON · IKLAN ${no(ad.adNo)}`,identity(posting),section('SENARAI BUTTON'),buttons.length?buttons.map(b=>screen(`${b.buttonNo}. ${b.label}`,`   ↳ ${short(b.url,100)}`,'')):'• Belum ada button.',buttons.length<2?cmd(`.button-add ${ad?.adNo||1}`,'Tambah CTA','➕'):null,buttons.length?cmd('.button-edit','Edit Button','✏️'):null,buttons.length?cmd('.button-delete','Padam Button','🗑️'):null,cmd(`.button-done ${ad?.adNo||1}`,'Siap'),cmd(`.iklan ${ad.adNo}`,'Butiran Iklan','↩️'));
}
export function postingButtonSelectMessage(action,ad,buttons=[]) {
 const verb=action==='edit'?'Edit':'Padam';return screen(`🔘 ${verb.toUpperCase()} BUTTON · IKLAN ${no(ad?.adNo)}`,buttons.map(b=>screen(`${b.buttonNo}. ${b.label}`,cmd(`.button-${action==='edit'?'edit':'delete'} ${b.buttonNo}`,`${verb} Button ${b.buttonNo}`),'')),cmd(`.button-manage ${ad?.adNo||1}`,'Urus Button','↩️'));
}
export function postingAdsReadyMessage(summary) {
 if(!summary?.posting)return postingNewMessage();
 const {posting,ads=[],buttonCount=0}=summary;
 return screen('✅ IKLAN SIAP',identity(posting),`Iklan : ${ads.length}`,`Button : ${buttonCount}`,'','• Iklan diproses bergilir dalam kempen ini.',section('LANGKAH SETERUSNYA'),cmd('.pilih-akaun','Pilih Akaun WhatsApp','📱'),cmd('.iklan-urus','Semak Semua Iklan','✏️'),nav());
}
export function postingAccountSelectMessage(posting,accounts=[],plan=null,page=1) {
 const p=pageOf(accounts,page),selected=new Set((plan?.accounts||[]).map(a=>a.accountId));
 const available=accounts.filter(a=>a.status==='ONLINE'&&a.groupCount>0);
 return screen(clientFlow(posting)?'📱 PILIH AKAUN KEMPEN CLIENT':'📱 AUTO POST · LANGKAH 3/6',`↳ ${name(posting).toUpperCase()}`,section('PILIH AKAUN'),p.items.map(a=>screen(`${accountNumber(a)}. ${accountName(a)}${selected.has(a.id)?' ✓':''}`,`   ↳ ${accountStatus(a)} • ${a.groupCount||0} group`,!a.groupCount?`   ↳ .account-sync ${accountNumber(a)} → Sync Group`:null,'')),paging(p,'.pilih-akaun-page'),available.length?screen('• Satu akaun: .pilih-akaun 1','• Beberapa akaun: .pilih-akaun 1,2',cmd('.pilih-akaun all','Semua Akaun Online dengan Group','📱'),'','✍️ Atau balas nombor / 1,2 / all.'):screen('• Tiada akaun ONLINE dengan group tersimpan.',cmd('.accounts','Urus Akaun','📱'),cmd('.group','Sync Group','🔄')),back('.iklan-urus','Semak Iklan'),nav());
}
export function postingTargetModeMessage(posting,plan) {
 if(!plan?.accounts?.length)return screen('🎯 MODE POSTING','• Pilih akaun dahulu.',cmd('.pilih-akaun','Pilih Akaun','📱'));
 return screen(clientFlow(posting)?'🎯 MODE KEMPEN CLIENT':'🎯 AUTO POST · LANGKAH 4/6',identity(posting),section('MODE KEMPEN'),'1. ✅ SUCCESS','   ↳ Berhenti apabila jumlah berjaya global cukup.',cmd('.target success','Tetapkan Jumlah Berjaya'),'', '2. 📅 HARI','   ↳ Berjalan sehingga tempoh hari tamat.',cmd('.target hari','Tetapkan Tempoh'),'', '3. ♾️ BERTERUSAN','   ↳ Berjalan sehingga dihentikan.','✍️ Balas 1, 2 atau 3.',cmd('.target terus','Guna Mode Berterusan'),back('.pilih-akaun','Ubah Akaun'),nav());
}
export function postingTargetSuccessMessage(posting,plan) {return screen('✅ MODE · SUCCESS',identity(posting),`📱 Akaun : ${plan?.accountCount||0}`,`👥 Akses Group : ${plan?.groupCapacity||0}`,'',clientFlow(posting)?'• Target ialah group unik yang berjaya menerima post.':'• Jumlah berjaya digabungkan daripada semua akaun.',clientFlow(posting)?'• Group sama melalui dua akaun dikira sekali.':null,clientFlow(posting)?'✍️ Hantar jumlah group, contoh: 300 (300 Group WhatsApp).':'✍️ Hantar nombor bulat, contoh: 100.',back('.target','Pilih Mode'),nav());}
export function postingTargetDaysMessage(posting) {return screen('📅 MODE · HARI',identity(posting),'','• Tamat pada 11:59:59 PM Malaysia pada hari terakhir.','• Hari mula dikira Hari 1; jeda tidak memanjangkan tempoh.','• Berjaya / gagal tetap direkodkan.','✍️ Hantar bilangan hari, contoh: 3.',back('.target','Pilih Mode'),nav());}
export function postingReuseMessage(posting,plan) {
 return screen('🔁 PENGGUNAAN GROUP',identity(posting),`🎯 Target : ${plan?.targetValue||0} SUCCESS`,section('PILIH CARA'),'1. ULANG SAMPAI TARGET','   ↳ Akaun mengulang group miliknya selepas habis giliran.',cmd('.reuse ulang','Ulang Sampai Target'),'', '2. SEKALI SAHAJA','   ↳ Setiap sasaran akaun–group diproses sekali.','✍️ Balas 1 atau 2.',cmd('.reuse unique','Sekali Sahaja'),back('.target success','Ubah Target'),nav());
}
export function postingScheduleMessage(posting,plan) {
 if(!plan?.accounts?.length)return postingTargetModeMessage(posting,plan);
 return screen(clientFlow(posting)?'⚙️ JADUAL KEMPEN CLIENT':'⚙️ AUTO POST · LANGKAH 5/6',identity(posting),section('TETAPAN SEMASA'),`⏱ Delay : ${plan.delayMinSec}–${plan.delayMaxSec} saat / akaun`,`📦 Batch : ${plan.batchSize} proses / akaun`,`💤 Rehat : ${plan.restMinSec/60}–${plan.restMaxSec/60} minit`,`👁 Auto Mark Read : ${plan.autoRead===false?'OFF':'ON'}`,'','• Delay dan rehat dipilih secara rawak dalam julat.','• Jadual tidak menjamin akaun bebas sekatan.',section('TINDAKAN'),cmd('.posting-next','Guna Tetapan & Semak','✅'),cmd('.posting-setting','Ubah Tetapan','✏️'),cmd('.setting-default','Guna Default System','🔄'),back('.target','Ubah Mode'),nav());
}
export function postingSchedulePromptMessage(step,draft={}) {
 if(step==='confirm')return screen('⚙️ SEMAK TETAPAN · 6/6',`⏱ Delay : ${draft.delayMinSec}–${draft.delayMaxSec}s`,`📦 Rehat Selepas : ${draft.batchSize} proses`,`💤 Rehat : ${draft.restMinSec/60}–${draft.restMaxSec/60} minit`,'','✅ Balas YA → Simpan Tetapan',back('.kembali','Ubah Rehat'));
 const data={delay:['1/6 · DELAY MINIMUM','Masukkan delay minimum dalam saat.','60'],delay_max:['2/6 · DELAY MAKSIMUM','Masukkan delay maksimum dalam saat.','120'],batch:['3/6 · BATCH','Masukkan jumlah proses sebelum rehat.','5'],rest:['4/6 · REHAT MINIMUM','Masukkan rehat minimum dalam minit.','5'],rest_max:['5/6 · REHAT MAKSIMUM','Masukkan rehat maksimum dalam minit.','10']}[step];
 return screen(`⚙️ UBAH TETAPAN · ${data[0]}`,`↳ ${data[1]}`,'',`✍️ Contoh: ${data[2]}`,back('.kembali','Langkah Sebelumnya'),cmd('.setting-posting','Batal Perubahan','✖️'));
}
export function postingReviewMessage(summary) {
 if(!summary?.posting)return postingNewMessage();const {posting,ads=[],buttonCount=0,plan}=summary;
 if(!plan?.accounts?.length)return postingTargetModeMessage(posting,plan);
 if(plan.accountsNeedReview)return screen('⚠️ SEMAK PILIHAN AKAUN','• Senarai akaun berubah. Pilih semula sebelum mula.',cmd('.pilih-akaun','Pilih Akaun','📱'));
 if(plan.status!=='READY')return postingTargetModeMessage(posting,plan);
 if(clientFlow(posting))return clientReviewMessage(summary);
 const mode=plan.targetMode==='SUCCESS'?`SUCCESS · ${plan.targetValue} · ${plan.reuseMode==='UNIQUE'?'Sekali Sahaja':'Ulang'}`:plan.targetMode==='DAYS'?`HARI · ${plan.targetValue} hari`:'BERTERUSAN';
 return screen('🚀 AUTO POST · LANGKAH 6/6','↳ Semak ringkasan sebelum mula.',section('RINGKASAN KEMPEN'),identity(posting),`📝 Iklan : ${ads.length}`,`🔘 Button : ${buttonCount}`,`📱 Akaun : ${plan.accountCount}`,`🔗 Sasaran Akaun–Group : ${plan.review?.targetCount??plan.groupCapacity}`,`🎯 Mode : ${mode}`,section('AKAUN DIPILIH'),plan.accounts.slice(0,10).map(a=>`${a.displayNumber?`Akaun ${a.displayNumber} · `:''}${a.phone?accountName(a):short(a.accountLabel,50)}\n   ↳ ${a.groupCount} group${a.status?' • '+accountStatus(a):''}`),plan.accounts.length>10?`• +${plan.accounts.length-10} akaun; semak melalui .pilih-akaun.`:null,section('JADUAL'),`⏱ Delay : ${plan.delayMinSec}–${plan.delayMaxSec}s`,`📦 Batch : ${plan.batchSize} proses / akaun`,`💤 Rehat : ${plan.restMinSec/60}–${plan.restMaxSec/60} minit`,'','• Group sama melalui akaun berbeza ialah sasaran berasingan.','• Akaun menggunakan group yang dikaitkan dengannya.','• Penghantaran hanya bermula selepas arahan anda.',plan.review?.endsAt?`🕒 Tamat : ${malaysiaTime(plan.review.endsAt)} · MYT`:null,posting.clientName?`👤 Client : ${posting.clientName}`:null,section('SEMAK IKLAN'),ads.slice(0,3).map(a=>cmd(`.iklan-preview ${a.adNo}`,`Preview Iklan ${a.adNo}`,'👁')),ads.length>3?cmd('.iklan-urus','Semua Iklan','🗂️'):null,section('MULA KEMPEN'),cmd('.posting-mula','Mula Sekarang','🚀'),cmd('.setting-posting','Ubah Tetapan','⚙️'),cmd('.target','Ubah Mode','🎯'),cmd('.pilih-akaun','Ubah Akaun','📱'),cmd('.iklan-urus','Urus Iklan','✏️'),nav());
}
export const postingRunBoundaryMessage = postingReviewMessage;
const acctLabel = a => a?.displayNumber?`Akaun ${a.displayNumber} · ${accountName(a)}`:short(a?.accountLabel||'Akaun Tersimpan',48);
const seconds = n => n>=60?`${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`:`${n}s`;
const timeOnly = v => v?new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(v)):'—';
const accountProgress = (a,adCount,status) => screen(`📱 ${acctLabel(a)}`,`   ↳ ✅ ${a.successCount} • ❌ ${a.failedCount} • ❔ ${a.unknownCount||0}`,`   ↳ Round ${a.currentRound||1} • Group ${a.groupDone||0}/${a.groupTotal||0}`,`   ↳ Iklan ${a.nextAdNo||1}/${adCount||1} • ${status==='PAUSED'?'Dijeda bersama kempen':status==='STOPPED'?'Kempen dihentikan':status==='COMPLETED'?'Kempen selesai':a.status==='OFFLINE'?'Offline':a.waitSeconds?`${a.waitKind==='REST'?'Rehat':'Delay'} ${seconds(a.waitSeconds)}`:'Menunggu giliran'}`,'');
export function postingJobStatusMessage(job,recent=[],activity='') {
 if(!job)return screen('📊 POSTING AKTIF','• Tiada kempen dipilih.',cmd('.status','Senarai Kempen','📁'));
 const n=job.displayNumber||1,accounts=job.accounts||[],ads=job.ads||[];
 return screen(`📊 KEMPEN ${n} · ${postingStatusLabel(job.status).toUpperCase()}`,`↳ ${short(job.displayName,64)}`,job.clientName?`👤 Client : ${short(job.clientName,48)}`:null,billing(job),`🎯 Mode : ${postingJobModeLabel(job)}`,`🖼 Iklan : ${ads.length} • 📱 Akaun : ${accounts.length}`,section('KEMAJUAN KEMPEN'),`✅ Success : ${job.successCount}${job.targetMode==='SUCCESS'?'/'+job.targetSuccess:''}`,`❌ Failed : ${job.failedCount}`,`❔ Belum Pasti : ${job.unknownCount||0}`,`📨 Sedang Hantar : ${job.processingCount||0}`,job.targetMode==='SUCCESS'?`🎯 Baki Target : ${job.remainingSuccess}`:null,job.unknownCount?'• Belum Pasti tidak diulang; slot target dikekalkan.':null,job.endsAt?`🕒 Tamat : ${malaysiaTime(job.endsAt)} · MYT`:null,section('AKTIVITI SEMASA'),`⏱ ${short(activity||postingStatusLabel(job.status),120)}`,job.status==='PAUSED'&&job.processingCount?'• Permintaan yang telah dihantar masih boleh selesai.':null,section('STATUS AKAUN'),accounts.slice(0,2).map(a=>accountProgress(a,ads.length,job.status)),accounts.length>2?cmd(`.posting-accounts ${n}`,'Lihat Semua Akaun','📱'):null,section('10 HASIL TERKINI'),recent.length?recent.slice(0,10).map((item,i)=>screen(`${i+1}. ${short(item.groupName||'Group WhatsApp',38)}`,`   ↳ ${{SUCCESS:'✅ Berjaya Hantar',FAILED:'❌ Gagal',UNKNOWN:'❔ Belum Pasti',SKIPPED:'⏭ Dilangkau'}[item.status]||'❔ Belum Pasti'} • ${timeOnly(item.completedAt)}`,`   ↳ Akaun ${accounts.find(a=>a.accountId===item.accountId)?.displayNumber||'tersimpan'} · Iklan ${item.adNo||'-'}${item.status!=='SUCCESS'&&item.errorText?' · '+short(item.errorText,34):''}`,'')):'• Belum ada hasil penghantaran.',section('KAWALAN KEMPEN'),job.status==='RUNNING'?cmd(`.posting-pause ${n}`,'Jeda','⏸'):null,['PAUSED','WAITING'].includes(job.status)?cmd(`.posting-resume ${n}`,'Sambung','▶️'):null,['RUNNING','PAUSED','WAITING'].includes(job.status)?cmd(`.posting-stop ${n}`,'Hentikan','⏹'):null,['RUNNING','PAUSED','WAITING'].includes(job.status)?cmd(`.posting-view ${n}`,'Segarkan Dashboard','🔄'):null,['RUNNING','PAUSED','WAITING'].includes(job.status)?cmd(`.report ${n}`,'Laporan Kempen','📄'):cmd('.rekod','Laporan & Rekod','📄'),'',`🕒 Dikemas Kini : ${malaysiaTime(job.updatedDisplayAt||job.updatedAt)}`,'• Countdown anggaran ketika kemas kini.',cmd('.status','Semua Kempen Aktif','📊'),cmd('.menu','Menu Utama','🏠'));
}
export function postingStartedMessage(job) {return postingJobStatusMessage(job);}
export function postingActiveMessage(jobs=[],page=1,total=jobs.length,scope='active') {
 const active=scope==='active';return screen(active?'⚡ POSTING AKTIF':'📁 REKOD & LAPORAN KEMPEN','↳ Pilih kempen daripada senarai ini.',`📋 Jumlah : ${total}`,section('SENARAI KEMPEN'),jobs.length?jobs.slice(0,10).map(j=>screen(`${j.displayNumber||1}. ${short(j.displayName,64)}`,`   ↳ ${postingStatusIcon(j.status)} ${postingStatusLabel(j.status)} • ✅ ${j.successCount} • ❌ ${j.failedCount} • ❔ ${j.unknownCount||0}`,cmd(`${active?'.status':'.report'} ${j.displayNumber||1}`,active?'Lihat Kempen':'Laporan','📊'),!active&&j.cleanupAt?cmd(`.report-delete ${j.displayNumber}`,'Padam Rekod','🗑️'):null,'')):'• Tiada kempen.',paging({page,pages:Math.max(1,Math.ceil(total/10))},active?'.campaigns':'.rekod'),cmd('.mula','Cipta Kempen','🚀'),cmd(active?'.rekod':'.status',active?'Rekod Kempen':'Kempen Aktif','🗂️'),cmd('.menu','Menu Utama','🏠'));
}
export function postingAccountsMessage(job,page=1) {
 const p=pageOf(job.accounts||[],page),n=job.displayNumber||1;return screen(`📱 AKAUN KEMPEN ${n}`,`↳ ${name(job)}`,p.items.map(a=>accountProgress(a,job.ads?.length,job.status)),paging(p,`.posting-accounts ${n}`),cmd(`.posting-view ${n}`,'Status Kempen','↩️'));
}
export function postingReportMessage(job) {
 return screen(`📄 LAPORAN KEMPEN ${job.displayNumber||1}`,`↳ ${job.displayName}`,job.clientName?`👤 Client : ${job.clientName}`:null,billing(job),job.paidFullAt?`🕒 Bayaran disahkan owner : ${malaysiaTime(job.paidFullAt)}`:null,`🎯 Mode : ${postingJobModeLabel(job)}`,`📍 Status : ${postingStatusLabel(job.status)}`,job.finishReason?`↳ ${job.finishReason}`:null,section('RINGKASAN'),`✅ Success : ${job.successCount}${job.targetUnit==='UNIQUE_GROUPS'?' Group WhatsApp':''}`,`❌ Failed : ${job.failedCount}`,`❔ Belum Pasti : ${job.unknownCount||0}`,`📨 Sedang Hantar : ${job.processingCount||0}`,section('HASIL PER AKAUN'),(job.accounts||[]).slice(0,10).map(a=>screen(acctLabel(a),`   ↳ ✅ ${a.successCount} • ❌ ${a.failedCount} • ❔ ${a.unknownCount||0}`,'')),(job.accounts||[]).length>10?'• Butiran semua akaun dalam laporan TXT akhir.':null,`🕒 Mula : ${job.startedAt?malaysiaTime(job.startedAt):'Belum mula'}`,`🕒 Tamat : ${job.completedAt?malaysiaTime(job.completedAt):'Belum tamat'}`,'🌏 Malaysia · MYT / UTC+8',`🖼 Iklan : ${job.ads?.length||0}`,job.reportFilename?`📄 Fail : ${job.reportFilename}`:'• Laporan TXT penuh disediakan selepas kempen tamat.',job.cleanupAt?'• Bahan telah dibersihkan selepas laporan dihantar.':null,'',cmd('.status','Kempen Aktif','📊'),cmd('.rekod','Rekod Kempen','🗂️'));
}
export function postingClientSelectMessage(result) {return screen('💼 KEMPEN CLIENT','↳ Pilih pelanggan atau tambah pelanggan baharu.',result.items.map((c,i)=>`${i+1}. ${c.name}`),'','✍️ Balas nombor dalam senarai atau baru.',paging({page:result.page,pages:result.pages},'.mula-client-page'),back('.mula','Pilih Jenis'));}
export function postingClientNameMessage(client){return screen('💼 NAMA KEMPEN',`↳ Client: ${client.name}`,'','• Contoh: Promosi Banner September','✍️ Hantar nama kempen.',back('.mula client','Pilih Client'));}

function clientReviewMessage({posting,ads=[],plan,payment}) {
 const unique=plan.targetMode==='SUCCESS',paid=payment?.paid===true;
 const target=unique?`${plan.targetValue} Group WhatsApp`:plan.targetMode==='DAYS'?`${plan.targetValue} hari`:'Berterusan';
 return screen('🚀 SEMAK KEMPEN CLIENT','↳ Semak tempahan sebelum mula.',section('INFO KEMPEN'),`📌 Nama : ${posting.displayName}`,`👤 Client : ${posting.clientName}`,`🎯 Pakej : ${target}`,`💰 Caj : ${posting.chargeCents?rm(posting.chargeCents):'Belum ditetapkan'}`,`💳 Bayaran : ${paid?'✅ Bayaran Penuh':'Belum disahkan'}`,`🖼 Iklan : ${ads.length}`,`📱 Akaun : ${plan.accountCount}`,`👥 ${unique?'Group Unik Tersedia':'Sasaran Akaun–Group'} : ${plan.review?.targetCount??plan.groupCapacity}`,unique?'• Group sama dikira sekali, walaupun ada pada beberapa akaun.':null,section('JADUAL'),`⏱ Delay : ${plan.delayMinSec}–${plan.delayMaxSec} saat`,`📦 Rehat Selepas : ${plan.batchSize} proses / akaun`,`💤 Rehat : ${plan.restMinSec/60}–${plan.restMaxSec/60} minit`,plan.review?.endsAt?`🕒 Tamat : ${malaysiaTime(plan.review.endsAt)} · MYT`:null,section('SEMAK IKLAN'),ads.slice(0,3).map(a=>cmd(`.iklan-preview ${a.adNo}`,`Preview Iklan ${a.adNo}`,'👁')),ads.length>3?cmd('.iklan-urus','Semua Iklan','🗂️'):null,section(paid?'MULA KEMPEN':'SAHKAN BAYARAN PENUH'),paid?cmd('.posting-mula','Mula Sekarang','🚀'):`• Sahkan hanya selepas ${rm(posting.chargeCents)} diterima penuh.`,paid?null:'• Ini pengesahan owner, bukan semakan bank automatik.',paid?null:'✅ ↳ Balas SAH → Sahkan Bayaran Penuh',paid?null:'• Pengesahan sah 2 minit dan tidak memulakan kempen.',section('UBAH TEMPAHAN'),cmd('.posting-charge','Ubah Caj','💰'),cmd('.target','Ubah Mode / Target','🎯'),cmd('.pilih-akaun','Ubah Akaun','📱'),cmd('.posting-setting','Ubah Jadual','⚙️'),cmd('.posting-next','Semak Semula','🔄'),nav());
}
