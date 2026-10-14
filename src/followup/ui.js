import {quotaExhausted} from './store.js';
const formatter = new Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Kuala_Lumpur', day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true});
const clock = new Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Kuala_Lumpur',hour:'2-digit',minute:'2-digit',hour12:true});
const date = x => x && Number.isFinite(Date.parse(x)) ? formatter.format(new Date(x)).replace(',', '').toUpperCase() : '—';
const time = x => x && Number.isFinite(Date.parse(x)) ? clock.format(new Date(x)).toUpperCase() : '—';
const status = x => ({DRAFT:'📝 DRAF',RUNNING:'🟢 BERJALAN',PAUSED:'⏸ DIJEDA',STOPPED:'⏹ DIHENTIKAN',QUOTA:'🟡 KUOTA HABIS',COMPLETED:'✅ SELESAI'}[x] || '❔ BELUM PASTI');
const result = x => ({SUCCESS:'✅ BERJAYA',FAILED:'❌ GAGAL',UNKNOWN:'❔ BELUM PASTI',PROCESSING:'📤 SEDANG HANTAR',PENDING:'📥 BELUM DICUBA'}[x] || '❔ BELUM PASTI');
const account = a => a ? `Akaun ${a.number || String(a.label||'').match(/Akaun (\d+)/)?.[1] || 'tersimpan'}` : 'Akaun tersimpan';
const accountPhone = a => {
 const digits=String(a?.phone||'').replace(/\D/g,'').slice(-4) || String(a?.label||'').match(/…(\d{4})/)?.[1];
 return digits ? `WhatsApp …${digits}` : 'WhatsApp';
};
const screen = rows => rows.filter(x=>x!==null && x!==undefined).join('\n');
export const section=t=>`-------------------------\n| ${t} |\n-------------------------`;
export const stepNav='\n↩️ ↳ .kembali → Langkah Sebelumnya\n✖️ ↳ .batal → Simpan Draf & Keluar';
export const paceText=j=>`⏱ Delay Rawak : ${j.pace.min}–${j.pace.max} saat\n📦 Rehat Selepas : ${j.pace.batch} penerima / akaun\n💤 Rehat Rawak : ${j.pace.restMin/60}–${j.pace.restMax/60} minit\n📊 Kuota : ${j.pace.quota} cubaan / akaun / pusingan\n🎯 Had Keseluruhan : ${j.pace.roundLimit||'Tiada had tambahan'}${j.pace.roundLimit?' cubaan / pusingan':''}`;
export const nav='\n\n💬 ↳ .followup → Auto Follow-Up\n🏠 ↳ .menu → Menu Utama';

function counts(c,total){
 return [`📋 Jumlah Nombor : ${total}`,`📨 Selesai Proses : ${c.SUCCESS+c.FAILED+c.UNKNOWN}/${total}`,`✅ Berjaya : ${c.SUCCESS}`,`❌ Gagal : ${c.FAILED}`,`❔ Belum Pasti : ${c.UNKNOWN}`,`📤 Sedang Hantar : ${c.PROCESSING}`,`📥 Baki Belum Dicuba : ${c.PENDING}`];
}
function accountStats(s,a){const rows=s.perAccount?.filter(r=>r.account_id===a.id)||[];const n=k=>rows.find(r=>r.status===k)?.n||0;
 return [`📱 ${account(a)} · ${accountPhone(a)}`,`   ↳ ✅ ${n('SUCCESS')} Berjaya · ❌ ${n('FAILED')} Gagal`,`   ↳ ❔ Belum Pasti : ${n('UNKNOWN')}`,`   ↳ Kuota : ${a.used}/${s.job.pace.quota} · Pusingan ${s.job.round}`].join('\n');
}
export function dashboard(s,manager){
 const {job:j,counts:c}=s,now=Date.now();
 const ready=j.accounts.filter(a=>a.used<j.pace.quota && manager?.get(a.id)?.status==='ONLINE');
 const delay=ready.length?Math.min(...ready.map(a=>Math.max(0,Math.ceil(((a.nextAt||0)-now)/1000)))):null;
 const activity=j.status==='RUNNING'?(c.PROCESSING?'📤 Sedang menghantar kepada penerima':delay===null?'⏳ Menunggu akaun ONLINE / kuota':delay>0?`⏱ Delay / Rehat : ${delay} saat lagi`:'⏳ Menunggu giliran penghantaran'):j.status==='COMPLETED'?'✅ Semua nombor telah diproses.':j.status==='QUOTA'?'🟡 Kuota habis. Gunakan Sambung Baki.':j.status==='PAUSED'?'⏸ Kempen dijeda. Baki disimpan.':j.status==='STOPPED'?'⏹ Kempen dihentikan. Baki disimpan.':'📝 Draf belum dimulakan.';
 const exhausted=j.accounts.length && quotaExhausted(j);
 const recent=s.recent.slice(0,10).map((t,i)=>screen([
  `${String(i+1).padStart(2,'0')}. ${result(t.status)}`,
  `   ↳ Penerima : ${t.display_name?String(t.display_name).slice(0,40)+' · ':''}…${String(t.phone||'').slice(-4)}`,
  `   ↳ ${account(j.accounts.find(a=>a.id===t.account_id))} · ${time(t.finished_at||t.attempted_at)}`,
  ''
 ])).join('\n');
 return screen([
  `💬 FOLLOW-UP ${j.id} · ${status(j.status)}`,
  `↳ ${j.ads.length} iklan · ${j.accounts.length} akaun · Pusingan ${j.round}`,'',
  section('KEMAJUAN KEMPEN'),...counts(c,s.total),'',
  section('AKTIVITI SEMASA'),activity,`🎯 Cubaan Pusingan : ${j.roundUsed||0} / ${j.pace.roundLimit||'Ikut kuota akaun'}`,'',
  section('STATUS AKAUN'),...j.accounts.slice(0,3).flatMap(a=>[accountStats(s,a),'']),
  j.accounts.length>3?`📱 ↳ .fu-accounts → Lihat Semua ${j.accounts.length} Akaun`:null,
  section('10 HASIL TERKINI'),recent||'↳ Belum ada hasil penghantaran.',
  section('KAWALAN KEMPEN'),
  `🔄 ↳ .fu-status ${j.id} → Segarkan Dashboard`,
  j.status==='RUNNING'?`⏸ ↳ .fu-pause ${j.id} → Jeda`:null,
  ['PAUSED','STOPPED'].includes(j.status)&&!exhausted&&c.PENDING?`▶️ ↳ .fu-resume ${j.id} → Sambung Baki`:null,
  ['QUOTA','PAUSED','STOPPED'].includes(j.status)&&exhausted&&c.PENDING?`▶️ ↳ .fu-continue ${j.id} → Sambung Baki · Kuota Baharu`:null,
  ['RUNNING','PAUSED','QUOTA'].includes(j.status)?`⏹ ↳ .fu-stop ${j.id} → Hentikan`:null,
  `📄 ↳ .fu-report ${j.id} → Laporan Kempen`,
  c.PENDING?`📥 ↳ .fu-remaining ${j.id} → Muat Turun Baki TXT`:null,'',
  `🕒 Dikemas Kini : ${date(new Date(Math.floor(now/5000)*5000).toISOString())} MYT`,
  j.status==='RUNNING'?'↳ Countdown anggaran ketika kemas kini.':null,'↳ Berjaya = ID mesej diterima; bukan bukti dibaca.',nav
 ]);
}
export function report(s){const {job:j,counts:c}=s;
 return screen([
  '📄 LAPORAN FOLLOW-UP',`↳ Kempen ${j.id} · ${status(j.status)}`,'',
  section('RINGKASAN KEMPEN'),...counts(c,s.total),'',
  section('HASIL PER AKAUN'),...j.accounts.flatMap(a=>[accountStats(s,a),'']),
  section('BAHAN DAN KUOTA'),`📝 Jumlah Iklan : ${j.ads.length}`,`📱 Akaun Digunakan : ${j.accounts.length}`,`🔁 Pusingan Kuota : ${j.round}`,'',
  section('MASA KEMPEN'),`🕒 Mula : ${date(j.startedAt)}`,`🏁 Tamat : ${date(j.endedAt)}`,'🌏 Malaysia · MYT / UTC+8','',
  '↳ Berjaya = ID mesej diterima; bukan bukti dibaca.','↳ Satu cubaan setiap nombor; tiada retry automatik.','',
  'Generated by WA PROMO BOT'
 ]);
}
