export const number=n=>Number(n||0).toLocaleString('en-US');
export const accountNo=a=>a.displayNumber??a.id;
export const accountName=a=>`WhatsApp …${String(a.phone||'').slice(-4)||'????'}`;
export const identity=a=>`Akaun ${accountNo(a)} · ${accountName(a)}`;
export const accountState=a=>a.status==='ONLINE'?'🟢 Online':a.status==='LOGGED_OUT'?'🔴 Log Keluar':a.status==='CONNECTING'?'🟡 Menyambung':'🔴 Offline';
export const role=g=>g.accountRole==='ADMIN'?'Admin':g.accountRole==='MEMBER'?'Ahli biasa':'Belum diketahui';
export const chat=g=>g.announcement===1?'Admin sahaja':g.announcement===0?'Semua ahli':'Belum diketahui';
export const members=g=>g.participantCountKnown?`${number(g.participantCount)} ahli`:'Ahli: Belum diketahui';
export const time=v=>v?new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true}).format(new Date(v)).replace(',',''):'Belum disync';
const short=value=>{const chars=Array.from(String(value||'Belum diketahui').replace(/\s+/g,' '));return chars.length>62?chars.slice(0,61).join('')+'…':chars.join('');};
const section=title=>`\n-------------------------\n| ${title} |\n-------------------------`;
const nav='\n-------------------------\n↩️ ↳ .group → Urus Group\n🏠 ↳ .menu → Menu Utama';
const command=(cmd,label,icon='🔎')=>`${icon} ↳ ${cmd} → ${label}`;
const accessLine=g=>g.access.slice(0,2).map(x=>`Akaun ${accountNo(x.account)} · …${String(x.account.phone||'').slice(-4)}`).join(' / ')+(g.access.length>2?` / +${g.access.length-2} lagi`:'');
export function home(s,page=1) {
 if(!s.accounts.length)return `👥 URUS GROUP\n↳ Sambungkan WhatsApp sebelum mendapatkan senarai group.\n\n📱 Tiada akaun WhatsApp disambungkan.\n\n${command('.login','Tambah Akaun','➕')}${nav}`;
 const pages=Math.max(1,Math.ceil(s.accounts.length/10));page=Math.max(1,Math.min(pages,Number(page)||1));
 const accounts=s.accounts.slice((page-1)*10,page*10);
 return ['👥 URUS GROUP','↳ Sync & semak group setiap akaun.',section('RINGKASAN'),`📱 Akaun Tersimpan : ${s.total}`,`🟢 Akaun Online : ${s.online}`,`👥 Group Unik : ${number(s.uniqueCount)}`,`🔗 Jumlah Akses Group : ${number(s.accessCount)}`,'','• Berdasarkan sync terakhir; termasuk akaun offline.',section('PILIH AKAUN'),accounts.map(a=>`${accountNo(a)}. ${accountName(a)}\n   ↳ ${accountState(a)} • ${a.lastGroupSyncAt?number(a.groupCount)+' group':'Belum disync'}`).join('\n\n'),'',...accounts.map(a=>command(`.group ${accountNo(a)}`,`Group Akaun ${accountNo(a)}`,'👥')),command('.group all','Semua Group Unik','📂'),...(pages>1?[`\nAkaun · Halaman ${page}/${pages}`,page>1?command(`.group-menu ${page-1}`,'Akaun Sebelum','⬅️'):'',page<pages?command(`.group-menu ${page+1}`,'Akaun Seterusnya','➡️'):'']:[]),section('EXTRACT AHLI'),command('.extract','Eksport Nombor Ahli','📇'),section('SYNC GROUP'),command('.group-sync all','Sync Semua Akaun Online','🔄'),command('.group-sync-status all','Progress Sync Semua','📊'),nav].filter(x=>x!=='').join('\n');
}
export function listing(data,account=null) {
 const scope=account?String(accountNo(account)):'all',lines=[account?`👥 GROUP AKAUN ${scope}`:'📂 SEMUA GROUP',account?'↳ '+accountName(account):'↳ Group unik daripada semua akaun.',section('RINGKASAN')];
 if(account)lines.push(`👥 Group Tersimpan : ${number(data.total)}`,`🕒 Sync Terakhir : ${time(account.lastGroupSyncAt)}`);
 else lines.push(`👥 Group Unik : ${number(data.uniqueCount)}`,`🔗 Jumlah Akses Group : ${number(data.accessCount)}`);
 lines.push(`📄 Halaman : ${data.page}/${data.totalPages}`,'🌏 Masa : Malaysia',section('SENARAI GROUP'));
 if(!data.items.length)lines.push(account&&!account.lastGroupSyncAt?'• Senarai group belum disync.':account?'• Tiada group ditemui pada sync terakhir.':'• Tiada group dalam data tersimpan.');
 else {
  lines.push(data.items.map((g,i)=>`${data.offset+i+1}. ${short(g.subject)}\n   ↳ ${members(g)}${account?' • '+role(g):'\n   ↳ '+accessLine(g)}`).join('\n\n'),section('PILIH GROUP'));
  lines.push(...data.items.map((g,i)=>command(`.group-info ${scope} ${data.offset+i+1}`,`Butiran Group ${data.offset+i+1}`)));
 }
 lines.push(section('CARI & SYNC'),command(`.group-search ${scope} kedah`,'Cari Group','🔍'),command(`.group-sync ${scope}`,account?'Segarkan Senarai':'Sync Akaun Online','🔄'));
 if(data.totalPages>1)lines.push(section('HALAMAN LAIN'),data.page>1?command(`.group ${scope} ${data.page-1}`,'Halaman Sebelum','⬅️'):'',data.page<data.totalPages?command(`.group ${scope} ${data.page+1}`,'Halaman Seterusnya','➡️'):'');
 lines.push(nav);return lines.filter(x=>x!=='').join('\n');
}
export function search(data,account=null) {
 const lines=['🔍 CARI GROUP',`↳ Kata Kunci: ${data.keyword}`,`↳ Skop: ${account?identity(account):'Semua Akaun'}`,'',`• Ditemui : ${data.total} group`,`• Halaman : ${data.page}/${data.totalPages}`,section('HASIL CARIAN')];
 if(!data.items.length)lines.push('• Tiada hasil. Cuba kata kunci lain atau sync group.',command(`.group-sync ${account?accountNo(account):'all'}`,'Segarkan Data','🔄'));
 else lines.push(data.items.map((g,i)=>`${data.offset+i+1}. ${short(g.subject)}\n   ↳ ${accessLine(g)}`).join('\n\n'),'',...data.items.map((g,i)=>command(`.group-result ${data.offset+i+1}`,`Butiran Hasil ${data.offset+i+1}`)));
 if(data.page>1)lines.push(command(`.group-search-page ${data.page-1}`,'Halaman Sebelum','⬅️'));
 if(data.page<data.totalPages)lines.push(command(`.group-search-page ${data.page+1}`,'Halaman Seterusnya','➡️'));
 lines.push(nav);return lines.join('\n');
}
export function details(group,{account=null,position=1,search=false,page=1}={}) {
 const scope=account?accountNo(account):'all',pages=Math.max(1,Math.ceil(group.access.length/10));page=Math.max(1,Math.min(pages,Number(page)||1));
 const lines=['👥 BUTIRAN GROUP',`↳ ${search?'Hasil Carian':'Group'} ${position} · ${account?'Akaun '+scope:'Semua Akaun'}`,section('INFO GROUP'),`📌 Nama : ${group.subject}`,`👥 ${members(group)}`];
 if(account)lines.push(`📱 Akaun : ${accountName(account)}`,`👤 Peranan Akaun : ${role(group)}`,`💬 Tetapan Chat : ${chat(group)}`,`🕒 Sync Terakhir : ${time(group.syncedAt)}`);
 else {
  lines.push(`💬 Tetapan Chat : ${chat(group)}`,`🕒 Snapshot Terbaru : ${time(group.syncedAt)}`,section('AKSES AKAUN'));
  lines.push(group.access.slice((page-1)*10,page*10).map(x=>`📱 ${identity(x.account)}\n   ↳ ${accountState(x.account)} • ${role(x)}\n   ↳ Chat: ${chat(x)}\n   ↳ Sync: ${time(x.syncedAt)}`).join('\n\n'));
  if(pages>1) {
   const cmd=search?`.group-result ${position}`:`.group-info all ${position}`;
   lines.push(`Akses · Halaman ${page}/${pages}`,page>1?command(`${cmd} ${page-1}`,'Akaun Sebelum','⬅️'):'',page<pages?command(`${cmd} ${page+1}`,'Akaun Seterusnya','➡️'):'');
  }
 }
 lines.push('🌏 Masa : Malaysia','','• Maklumat berdasarkan sync terakhir; keadaan sebenar boleh berubah.','• Tetapan chat tidak mengesahkan kebenaran Auto Status Group.',section('TINDAKAN GROUP'),command(`.group-sync ${scope}`,account?'Segarkan Data Akaun':'Sync Akaun Online','🔄'),command('.mula','Cipta Kempen','🚀'),search?command('.group-search-page 1','Hasil Carian','↩️'):command(`.group ${scope} ${Math.ceil(position/10)}`,'Senarai Group','↩️'),nav);
 return lines.filter(x=>x!=='').join('\n');
}
export function syncScreen(state,account) {
 const done=state.status==='DONE',failed=state.status==='FAILED'||state.status==='SKIPPED',event=state.progress||{},r=state.result;
 const lines=[done?'✅ SYNC GROUP SELESAI':failed?'⚠️ SYNC BELUM BERJAYA':'🔄 SYNC GROUP','↳ '+identity(account),''];
 if(done)lines.push(section('HASIL SYNC'),`👥 Group Tersimpan : ${number(r.detected)}`,`➕ Group Baharu : ${number(r.newCount)}`,`↩️ Kembali Tersenarai : ${number(r.restoredCount)}`,`↘️ Tidak Lagi Tersenarai : ${number(r.removedCount)}`,`🕒 Masa Sync : ${time(r.syncedAt)}`,'🌏 Masa : Malaysia','','• Senarai group telah dikemas kini.',command(`.group ${accountNo(account)}`,'Lihat Group','👥'),command('.mula','Cipta Kempen','🚀'));
 else if(failed)lines.push('• '+state.reason,'• Senarai daripada sync lengkap sebelumnya dikekalkan.',command(`.group-sync ${accountNo(account)}`,'Cuba Semula','🔄'),command(`.account ${accountNo(account)}`,'Semak Akaun','📱'));
 else {
  if(state.status==='QUEUED')lines.push('⏳ Menunggu giliran sync akaun.');
  else if(Number.isInteger(event.total))lines.push(`📥 Group Diterima : ${number(event.total)}`,`📦 Disimpan Sementara : ${number(event.accepted||0)}/${number(event.total)}`,'⏳ Status : Memproses…');
  else lines.push(event.type==='group_sync_retry'?'⏳ Sambungan terganggu. Mencuba semula sekali…':'⏳ Sedang mendapatkan senarai group…');
  lines.push('','• Senarai lama dikekalkan sehingga sync selesai.','• Anda boleh kembali ke menu semasa proses berjalan.',command(`.group-sync-status ${accountNo(account)}`,'Lihat Progress','📊'));
 }
 lines.push(nav);return lines.join('\n');
}
export function batchScreen(batch,summary,page=1) {
 const counts={DONE:0,FAILED:0,SKIPPED:0};for(const s of batch.entries)if(s.status in counts)counts[s.status]++;
 const pages=Math.max(1,Math.ceil(batch.entries.length/10));page=Math.max(1,Math.min(pages,Number(page)||1));
 const lines=[batch.running?'🔄 SYNC SEMUA AKAUN':'✅ PROSES SYNC SELESAI',batch.running?'↳ Memproses akaun ONLINE satu demi satu.':'↳ Proses sync untuk batch ini telah tamat.',section('STATUS AKAUN')];
 lines.push(batch.entries.slice((page-1)*10,page*10).map(s=>`${accountNo(s.account)}. ${accountName(s.account)}\n   ↳ ${s.status==='DONE'?`✅ Selesai • ${number(s.result.detected)} group`:s.status==='FAILED'?'⚠️ Gagal • '+s.reason:s.status==='SKIPPED'?'🔴 Dilangkau • '+s.reason:s.status==='QUEUED'?'⏳ Menunggu giliran':'⏳ Sedang Sync'}`).join('\n\n'));
 if(batch.running)lines.push('',`📊 Akaun Selesai Proses : ${batch.entries.filter(x=>x.selected&&['DONE','FAILED','SKIPPED'].includes(x.status)).length}/${batch.selectedCount}`);
 else lines.push(section('RINGKASAN AKHIR'),`📱 Berjaya : ${counts.DONE} akaun`,`⚠️ Gagal : ${counts.FAILED} akaun`,`🔴 Dilangkau : ${counts.SKIPPED} akaun`,`👥 Group Unik Tersimpan : ${number(summary.uniqueCount)}`,`🔗 Jumlah Akses Group : ${number(summary.accessCount)}`,'',counts.FAILED||counts.SKIPPED?'• Termasuk data lama akaun yang gagal / dilangkau.':'• Senarai group telah dikemas kini.');
 if(pages>1)lines.push(`\nAkaun · Halaman ${page}/${pages}`,page>1?command(`.group-sync-status all ${page-1}`,'Akaun Sebelum','⬅️'):'',page<pages?command(`.group-sync-status all ${page+1}`,'Akaun Seterusnya','➡️'):'');
 lines.push(command('.group-sync-status all',batch.running?'Progress Sync Semua':'Lihat Ringkasan Sync','📊'));
 if(!batch.running)lines.push(command('.group all','Lihat Semua Group','👥'));
 lines.push(nav);return lines.filter(x=>x!=='').join('\n');
}
