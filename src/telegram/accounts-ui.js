export const accountNumber = a => Number(a?.displayNumber ?? a?.id ?? 0);
export const accountName = a => `WhatsApp …${String(a?.phone || '').slice(-4) || '----'}`;
export const accountIdentity = a => `Akaun ${accountNumber(a)} · ${accountName(a)}`;
const count = n => Number(n || 0).toLocaleString('en-US');
const phone = a => a?.phone ? '+' + String(a.phone).replace(/^\+/, '') : 'Belum tersedia';
const section = title => ['-'.repeat(title.length + 4), `| ${title} |`, '-'.repeat(title.length + 4)];
const nav = ['-------------------------', '↩️ ↳ .accounts → Senarai Akaun', '🏠 ↳ .menu → Menu Utama'];
export function accountStatus(a) {
  if (a?.reconnecting) return '🟡 Reconnecting';
  return ({ONLINE:'🟢 Online',OFFLINE:'🔴 Offline',CONNECTING:'🟡 Connecting',LOGGED_OUT:'🔴 Logged Out'})[a?.status] || '🔴 Offline';
}
export function malaysiaTime(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Belum sync';
  return new Intl.DateTimeFormat('en-GB', { timeZone:'Asia/Kuala_Lumpur',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true }).format(new Date(value)).replace(',', '').toUpperCase();
}
export function whatsappMessage(accounts = [], page = 1) {
  if (!accounts.length) return ['📱 AKAUN WHATSAPP','↳ Sambungkan akaun pertama anda.','',
    '• Tiada akaun WhatsApp disambungkan.','','➕ ↳ .login → Tambah Akaun','',nav[0],nav[2]].join('\n');
  const pages = Math.ceil(accounts.length / 10);
  const current = Math.min(pages, Math.max(1, Math.floor(Number(page) || 1)));
  const visible = accounts.slice((current - 1) * 10, current * 10);
  const online = accounts.filter(a => a.status === 'ONLINE').length;
  const rows = ['📱 AKAUN WHATSAPP','↳ Sambung & urus semua akaun anda.','','📊 RINGKASAN',
    '-------------------------',`• Jumlah Akaun : ${accounts.length}`,`• Online : ${online}`,`• Offline : ${accounts.length-online}`,
    '-------------------------','',...section('SENARAI AKAUN')];
  for (const a of visible) rows.push(`${accountNumber(a)}. ${accountName(a)}`,`   ↳ ${accountStatus(a)} • ${count(a.groupCount)} group`,'');
  rows.push(...section('URUS AKAUN'));
  for (const a of visible) rows.push(`🔎 ↳ .account ${accountNumber(a)} → Urus Akaun ${accountNumber(a)}`);
  if (pages > 1) {
    rows.push('',`Halaman ${current}/${pages}`);
    if (current > 1) rows.push(`⬅️ ↳ .accounts ${current-1} → Halaman Sebelum`);
    if (current < pages) rows.push(`➡️ ↳ .accounts ${current+1} → Halaman Seterusnya`);
  }
  rows.push('',...section('TAMBAH AKAUN'),'➕ ↳ .login → Sambung WhatsApp Baharu','',nav[0],nav[2]);
  return rows.join('\n');
}
export function whatsappLoginMessage(_accounts = [], account = null) {
  if (account) return ['📲 LOGIN SEMULA',`↳ ${accountIdentity(account)}`,'',
    '• Sambungkan semula nombor WhatsApp yang sama.','• Profil dan kaitan kempen dikekalkan.','',
    '📲 ↳ Balas 1 → Pairing Code','🔳 ↳ Balas 2 → Scan QR','',nav[0],
    `↩️ ↳ .account ${accountNumber(account)} → Urus Akaun`,'✖️ ↳ .batal → Batal'].join('\n');
  return ['➕ TAMBAH AKAUN','↳ Pilih cara sambungan WhatsApp.','',...section('PAIRING CODE'),
    '📲 ↳ Balas 1','• Sambung menggunakan nombor telefon & kod.','',...section('SCAN QR'),
    '🔳 ↳ Balas 2','• Imbas QR menggunakan WhatsApp pada telefon anda.',
    '• Paparkan QR pada skrin peranti lain untuk diimbas.','',nav[0],nav[1],'✖️ ↳ .batal → Batal'].join('\n');
}
export function whatsappPairPromptMessage(account = null) {
  return ['📲 PAIRING CODE · LANGKAH 1/3','↳ Masukkan nombor WhatsApp bersama kod negara.','',
    ...(account ? [`📱 ${accountIdentity(account)}`,`• Nombor asal: ${phone(account)}`] : ['• Contoh Malaysia: 60123456789']),
    '• Gunakan nombor akaun yang ingin disambungkan.','','✍️ Hantar nombor telefon anda.','',nav[0],
    '↩️ ↳ .kembali → Pilih Kaedah','✖️ ↳ .batal → Batal'].join('\n');
}
export function whatsappPairReviewMessage(value) {
  return ['📲 PAIRING CODE · LANGKAH 2/3','↳ Semak nombor sebelum mendapatkan kod.','',`📞 Nombor: +${value}`,'',
    '✅ ↳ Balas YA → Dapatkan Kod','✏️ ↳ .kembali → Betulkan Nombor','✖️ ↳ .batal → Batal'].join('\n');
}
export function whatsappPairCodeMessage(account, code) {
  const grouped = String(code).replace(/-/g,'').replace(/^(.{4})(.{4})$/,'$1-$2');
  return ['📲 PAIRING CODE · LANGKAH 3/3','↳ Masukkan kod ini dalam WhatsApp anda.','',
    `📞 Nombor: ${phone(account)}`,`🔑 Kod: ${grouped}`,'',
    '1. Buka WhatsApp.','2. Masuk ke Peranti Dipautkan (Linked devices).','3. Pilih Pautkan Peranti (Link a device).',
    '4. Pilih pautan menggunakan nombor telefon.','5. Masukkan kod di atas.','','⏳ Menunggu sambungan…','',nav[0],'✖️ ↳ .batal → Batal'].join('\n');
}
export function whatsappQrMessage() {
  return ['🔳 SCAN QR','↳ Imbas QR untuk menyambungkan WhatsApp.','',
    '1. Buka WhatsApp pada telefon anda.','2. Masuk ke Peranti Dipautkan (Linked devices).',
    '3. Pilih Pautkan Peranti (Link a device).','4. Imbas QR pada skrin peranti lain.','',
    '⏳ Menunggu sambungan…','',nav[0],'✖️ ↳ .batal → Batal'].join('\n');
}
export function whatsappConnectedMessage(a) {
  const n = accountNumber(a);
  return ['✅ AKAUN BERJAYA DISAMBUNG','',`📱 Akaun : ${n} · ${accountName(a)}`,`📞 Nombor : ${phone(a)}`,'🟢 Status : Online','',
    '↳ Sync group untuk menyediakan akaun ini','bagi Auto Post & Auto Status Group.','',
    `🔄 ↳ .account-sync ${n} → Sync Group`,`📱 ↳ .account ${n} → Urus Akaun`,'',...nav].join('\n');
}
export function whatsappLoginFailedMessage(reason = 'Proses login telah tamat masa.', account = null) {
  return ['⚠️ SAMBUNGAN BELUM BERJAYA',`↳ ${reason}`,'','• Semak internet dan cuba sambungkan semula.',
    account ? '• Profil, sejarah dan sesi asal akaun dikekalkan.' : '• Akaun baharu belum ditambah.','',
    account ? `🔄 ↳ .account-login ${accountNumber(account)} → Cuba Semula` : '🔄 ↳ .login → Cuba Semula','',...nav].join('\n');
}
export function whatsappAccountMessage(a) {
  if (!a) return ['⚠️ AKAUN TIDAK DITEMUI','',...nav].join('\n');
  const n = accountNumber(a);
  const rows = ['📱 URUS AKAUN',`↳ ${accountIdentity(a)}`,'',...section('INFO AKAUN'),
    `📞 Nombor : ${phone(a)}`,accountStatus(a).replace(/^(\S+) (.+)$/, '$1 Status : $2'), `👥 Group Tersimpan : ${count(a.groupCount)}`,
    `🚀 Kempen Aktif : ${count(a.activeCampaigns)}`,`🕒 Sync Terakhir : ${malaysiaTime(a.lastGroupSyncAt)}`,'🌏 Masa : Malaysia','',...section('TINDAKAN AKAUN'),
    `👥 ↳ .account-group ${n} → Lihat Group`,`🔄 ↳ .account-sync ${n} → Sync Group`];
  if (a.status === 'LOGGED_OUT') rows.push(`📲 ↳ .account-login ${n} → Login Semula Nombor Asal`);
  else if (a.status === 'CONNECTING' || a.reconnecting) rows.push('⏳ Sambungan sedang diproses. Sila tunggu.');
  else rows.push(`🔌 ↳ .account-reconnect ${n} → Sambung Semula`);
  rows.push('',...section('AKSES AKAUN'),`🚪 ↳ .account-logout ${n} → Log Keluar`,`🗑️ ↳ .account-delete ${n} → Padam Akaun`,'',...nav);
  return rows.join('\n');
}
export function whatsappConfirmMessage(action, a) {
  return [action === 'delete' ? '🗑️ PADAM AKAUN' : '🚪 LOG KELUAR AKAUN','↳ Semak akaun sebelum meneruskan.','',
    `📱 Akaun : ${accountNumber(a)} · ${accountName(a)}`,`📞 Nombor : ${phone(a)}`,'',
    ...(action === 'delete' ? ['• Akaun dikeluarkan daripada senarai.','• Sesi dan akses group milik akaun ini dibersihkan.','• Laporan kempen terdahulu dikekalkan.'] :
      ['• Sesi WhatsApp akan diputuskan.','• Profil akaun kekal dalam senarai.','• Login semula diperlukan untuk menggunakan akaun ini.']),
    '',`✅ ↳ Balas SAH → ${action === 'delete' ? 'Padam Akaun' : 'Log Keluar'}`,'✖️ ↳ .batal → Batal'].join('\n');
}
export function whatsappReplacePromptMessage(a) { return whatsappLoginMessage([], a); }
export function accountSyncMessage(a, done = false) {
  return [done ? '✅ SYNC GROUP SELESAI' : '🔄 SYNC GROUP',`↳ ${accountIdentity(a)}`,'',
    ...(done ? [`👥 Group Tersimpan : ${count(a.groupCount)}`,'↳ Akaun sedia untuk digunakan.',`👥 ↳ .account-group ${accountNumber(a)} → Lihat Group`,'🚀 ↳ .mula → Cipta Kempen'] :
      ['⏳ Sedang mendapatkan senarai group…','• Sila tunggu sehingga proses selesai.']),
    '',`↩️ ↳ .account ${accountNumber(a)} → Urus Akaun`].join('\n');
}
