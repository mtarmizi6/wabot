# Build 212

Panel membuat semakan secara senyap. Hantar .panel untuk status atau pautan; tiada pemberitahuan automatik sedia/gagal.

# Build 211

Nombor Chat Personal dibuang. Extract Ahli dan DM Follow-Up kekal dengan monitor progress serta kawalan kempen sedia ada. Semua setup melalui bot Telegram.

# Build 209 — Mini App untuk monitor

Setup kempen, input fail, pilihan nombor dan sync dibuat melalui Telegram. Panel memaparkan progress Follow-Up, ringkasan nombor personal mengikut akaun dan progress extract Telegram. Kawalan kempen sedia ada dikekalkan. Workspace Build 208 dibuang.

---

# WA PromoBot · Mini App (Build 203)

Panel tambahan dalam pemasangan WAPromoBot sedia ada. Bot dan Owner ID asal digunakan; tiada akaun panel baharu. Bot mengurus setup, bahan, target, bayaran dan cleanup. Panel memantau dan mengawal job yang telah dicipta.

## Mula menggunakan

1. Keluar controller dengan **Q → 0** sebelum kemas kini.
2. Muat turun ZIP Build 203 ke Downloads. Ikut blok Update di bawah supaya ZIP dipilih berdasarkan build sebenar, termasuk jika Downloads mengandungi beberapa versi lama.
3. Buka controller seperti biasa (menu 5).
4. Untuk percubaan pada Termux, pasang `pkg install cloudflared` sekali.
5. Dalam chat peribadi bot milik owner, hantar `.panel-quick`. Hantar `.panel` untuk status. Selepas pengesahan berjaya, tekan **Buka Live Panel**. Jika tunnel sudah didaftarkan tetapi semakan controller masih gagal, **Uji Buka Panel** tersedia dengan label belum disahkan.
6. Butang **Live Panel** juga dipasang sebagai menu chat owner. Jika menu belum muncul, gunakan butang dalam balasan `.panel`.

Controller dan telefon perlu terus hidup serta mempunyai internet. Android/Termux boleh menghentikan proses ketika penjimatan bateri aktif; panel bukan pengganti server/controller. Selepas restart, aturan pemulihan kempen lama kekal (semak dan resume melalui bot/panel).

## Sambungan HTTPS

- **Percubaan:** `.panel-quick` menjalankan proses `cloudflared` ke port lokal 8787. Alamat `trycloudflare.com` boleh berubah selepas restart. Buka panel daripada butang bot terkini. Jika proses tunnel tamat, hantar `.panel-quick` semula. Jika proses masih hidup, arahan ini mengekalkan alamat dan sambungan yang sama, termasuk selepas panel sedia. Ini bukan jaminan hosting kekal atau SLA.
- **Pemasangan tetap:** sediakan hostname HTTPS/tunnel tetap yang menghala ke `http://127.0.0.1:8787`, kemudian hantar `.panel-url https://panel.domain-anda.com`. Domain/tunnel disediakan oleh pemilik pemasangan. HTTPS mesti menggunakan sijil sah.
- `.panel-setup`: semak sambungan dan panduan.
- `.panel-off`: hentikan server panel dan tunnel percubaan miliknya; job bot tidak dihentikan.
- Server panel bind ke `127.0.0.1`; jangan dedahkan folder projek sebagai static web root. Hanya direktori `miniapp` ialah aset awam.

## Akses setiap pembeli

Token bot di backend mengesahkan tandatangan `Telegram.WebApp.initData`; ID Telegram mesti sepadan dengan Owner ID konfigurasi pemasangan. Semua API data dan tindakan mengulang semakan ini. Token bot tidak dihantar ke frontend. Username/nama bukan bukti identiti. Pautan panel sahaja tidak memberi akses data. Owner ID sama pada bot lain masih perlu tandatangan bot pemasangan yang betul.

Sesi Telegram panel sah maksimum satu jam; apabila luput, tutup dan buka semula dari bot. `initData` kekal dalam memori halaman; localStorage hanya menyimpan tema. Token bot/Owner ID jangan diletakkan dalam URL. Pemasangan V1 ialah satu owner, bukan SaaS berbilang tenant.

## Flow paparan

- **Utama:** akaun ONLINE yang disahkan runtime, group unik, job belum tamat dan rekod.
- **Progress:** Auto Join, Auto Post sendiri/client, Status Group; tapisan Sync memaparkan progress sync sedia ada. Pilih satu job untuk dashboard. Job baru muncul dalam senarai tanpa menukar job pilihan secara senyap.
- **Rekod:** job STOPPED/COMPLETED; ringkasan dan hasil berhalaman. Rekod yang dibersihkan mengikut polisi ditandakan. Tidak mencipta semula butiran yang telah dipadam.
- **Lagi:** akaun, group, client, storage sistem, panduan. Client menggunakan ID asal walaupun nama sama.
- **Dashboard:** kiraan modul asal, akaun (5 setiap halaman), maksimum 10 hasil terkini, carian/tapis rekod, ringkasan laporan serta CSV bagi halaman dipaparkan.
- Padam satu rekod tersedia melalui Rekod → pilih job → Urus Rekod → Padam Rekod. Setup, tambah/edit bahan, bayaran dan cleanup storage kekal melalui flow bot yang sedia ada; panel menyediakan command untuk disalin dan butang kembali ke bot.

## Kawalan

Jeda/resume/stop menggunakan store dan runner asal, tanpa enjin penghantaran kedua. Kunci rujukan ialah jenis modul + ID kekal. Resume memeriksa akaun, media dan masa tamat. Auto Post STOPPED tamat; Auto Join/Status Group STOPPED dengan baki boleh disambung. Stop dan Padam Rekod memerlukan pengesahan sementara yang terikat kepada job sebenar. Klik berulang dengan ID permintaan sama tidak mengulang mutasi.

Operasi in-flight boleh selesai selepas pause/stop. Laporan dan dashboard Telegram diteruskan oleh lifecycle modul asal. Sync dipantau sahaja kerana modul sync asal tidak mempunyai pause/resume. Membuka panel tidak memulakan job.

## Padam rekod dari panel

Hanya job STOPPED/COMPLETED yang layak boleh dipadam. Preview menyatakan nama, ID, client dan baki.
Backend menyemak semula keadaan serta baki yang dipreview. Pengesahan luput selepas dua minit.
Job aktif atau operasi in-flight tidak boleh dipadam. Auto Post memerlukan laporan SENT dan cleanup
selesai; Status Group memerlukan pengesahan laporan dihantar. Jika belum layak, sebab dipaparkan.
Auto Join menggunakan perlindungan proses dan store asalnya; ia tidak mempunyai outbox laporan berasingan.

Rekod dan baki job dipadam dari database pemasangan, bukan sekadar disembunyikan di browser.
Akaun, sesi, client dan transaksi tidak dipadam. Group yang telah disertai, posting/Status yang
sudah diterbitkan serta salinan Telegram kekal. Media tidak dirujuk tertakluk pada polisi cleanup.
Pemadaman baris database tidak menjamin saiz fail SQLite terus mengecil.

## Live dan ketepatan

Panel mengambil keadaan terbaru kira-kira setiap **5 saat** semasa halaman kelihatan; rangkaian boleh melambatkannya. Tiada SSE/WebSocket diperlukan. Bacaan gagal menghentikan animasi live dan menyahaktifkan kawalan sehingga keadaan disegarkan. Denyutan logo/bar hanyalah petunjuk aktiviti, tidak menambah kiraan. Reduced Motion dihormati. Mode HARI/BERTERUSAN tidak diberi peratus target palsu. ACK Status Group bukan bukti Status telah muncul atau dilihat.

Masa paparan menggunakan MYT. Nama group belum diketahui dinyatakan; sebab ralat tidak direka. Countdown ialah anggaran pada waktu data diambil.

## Update daripada Build 188–199

Simpan ZIP di Downloads. Keluar controller **Q → 0**. Blok berikut memilih ZIP Build 203
berdasarkan package.json; nama fail dengan nombor muat turun tidak menjadi masalah.
ZIP lama yang lebih baharu tarikh muat turunnya tidak dipilih.

```bash
cd "$HOME/WAPromoBot"
node --input-type=commonjs <<'NODE'
const fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process');
try {
  const dir=path.join(os.homedir(),'storage','downloads');
  const files=fs.readdirSync(dir)
    .filter(n=>/^WAPromoBot.*\.zip$/i.test(n))
    .map(n=>path.join(dir,n)).filter(p=>fs.statSync(p).isFile())
    .sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs);
  const read=(zip,name)=>{
    const r=cp.spawnSync('unzip',['-p',zip,'WAPromoBot/'+name],{maxBuffer:16*1024*1024});
    if(r.error||r.status!==0)throw Error('ZIP tidak lengkap.');
    return r.stdout;
  };
  const zip=files.find(p=>{
    try {const x=JSON.parse(read(p,'package.json'));return x.name==='wapromobot'&&x.wapromobot?.build===203;}
    catch {return false;}
  });
  if(!zip)throw Error('Build 203 belum ditemui. Download ZIP Build 203 ke Downloads dahulu.');
  console.log('Dipilih: '+path.basename(zip)+' | Build 203');
  const r=cp.spawnSync(process.execPath,['--input-type=commonjs','-',zip],{
    input:read(zip,'scripts/update.cjs'),stdio:['pipe','inherit','inherit']
  });
  if(r.error)throw r.error;
  process.exitCode=r.status??1;
} catch(e) {
  console.error('Update tidak dijalankan: '+e.message);
  process.exitCode=1;
}
NODE
```

Apabila **Build 203 siap** muncul, jalankan `bash "$HOME/WAPromoBot/start.sh"`, buka controller
seperti biasa, kemudian buka semula Mini App melalui `.panel`. Jika tunnel belum sedia,
semak `.panel-setup` atau `.panel-quick`. Jangan unzip seluruh pakej di atas data pengguna.
`config/miniapp.json` dan sesi pemasangan asal dikekalkan.

## Ujian dan batas pengesahan

Ujian automatik menggunakan database sementara dan tiga akaun simulasi: akses owner/token/expiry, pengasingan ID client, pilihan job berjenis, pause/resume/stop, masa tunggu dikekalkan, guard offline, stop berkonfirmasi, klik berulang, serta API tanpa pengesahan ditolak. Ujian tambahan meliputi pemadaman berkonfirmasi, laporan menunggu, operasi in-flight, perubahan baki selepas preview dan pengekalan rekod job lain. Ujian browser menggunakan `?demo=1` berlabel DATA CONTOH; demo tidak menghubungi API penghantaran.

Ujian Telegram Mini App sebenar, tunnel Termux dan penghantaran WhatsApp tidak dilakukan dalam workspace ini kerana sesi/token/peranti pengguna tidak tersedia. Sahkan di telefon sebelum diedarkan sebagai keluaran yang telah diuji pengguna. Tiada jaminan sifar masalah rangkaian/peranti.

Rujukan: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app · https://core.telegram.org/bots/api#setchatmenubutton · https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/

## Semakan kawalan Build 200 (aset UI dikekalkan)

Kawalan browser diuji terus ke PanelServer → panelActions → store SQLite asal. Ujian klik meliputi Auto Join/Status Group/Auto Post client: Jeda, Sambung, pengesahan Stop, batal, serta Padam Auto Join. Perubahan dibaca semula dari database; job lain dan caj/bayaran client tidak berubah. CSV halaman dimuat turun dan kandungannya disemak.

Ujian tambahan meliputi respons lambat selepas tukar kempen, pengesahan lama, klik berganda, status berubah, owner/token salah, laporan menunggu, hasil in-flight, runner Auto Join, dan pemeliharaan delay/rehat.

Semakan HTTPS dibuat dari controller. Ia tidak menjamin DNS/rangkaian setiap telefon akan pulih pada saat yang sama. Quick Tunnel kekal sambungan percubaan. Ujian ini tidak menghantar bahan ke WhatsApp sebenar, tidak menguji tindakan tutup WebView Telegram pada telefon, dan bukan ujian ketahanan 24 jam.

## Pemulihan Build 201 (dikekalkan)

Semakan HTTPS yang gagal tidak mematikan tunnel yang masih hidup. Alamat yang sama dicuba dalam sehingga enam pusingan (12 cubaan/pusingan, sela 15 saat antara pusingan). Selepas itu semakan automatik dijeda; `.panel-quick` menguji semula alamat yang sama. `.panel-off` diikuti `.panel-quick` meminta tunnel baharu.

`.panel` menunjukkan sebab DNS, timeout atau status HTTP. Butang ujian tidak mengisytiharkan panel sedia dan API masih mewajibkan tandatangan bot serta Owner ID. Respons dengan identiti panel tidak sepadan menyekat butang ujian.

Semakan pemulihan menggunakan kegagalan rangkaian terkawal dan HTTP lokal sebenar; punca rangkaian pada telefon memerlukan mesej diagnostik baharu.

## Konsistensi sambungan (dikekalkan daripada Build 202)

- `.panel` dan `.panel-quick` pada Quick Tunnel yang sudah sedia menggunakan alamat yang sama. Semakan berulang tidak lagi memulakan semula server/tunnel atau memadam butang menu.
- Catatan cubaan sambungan semula dibersihkan apabila log pendaftaran baharu diterima atau semakan HTTPS berjaya. Log lama tidak diproses berulang kali; cebisan log dipadankan dalam aliran masing-masing.
- Mesej gagal semakan menyebut status semakan, bukan menganggap Mini App tidak boleh dibuka. Mesej Telegram terdahulu ialah sejarah; balasan `.panel` menunjukkan keadaan terkini yang diketahui controller.
- `.panel-off` diikuti `.panel-quick` masih boleh digunakan jika memang mahu memulakan tunnel baharu. Proses tunnel yang benar-benar tamat juga boleh dimulakan semula.
- Owner ID, tandatangan bot, nonce pengesahan tindakan, runner kempen dan data simpanan tidak diubah.

Selepas update pada telefon yang menggunakan arahan HTTP/2 tadi, teruskan arahan mula yang sama:

```sh
TUNNEL_TRANSPORT_PROTOCOL=http2 bash "$HOME/WAPromoBot/start.sh"
```

Build ini tidak menukar protokol lalai cloudflared. Screenshot pengguna sebelum kemas kini menunjukkan panel berjaya dibuka, diikuti pengesahan HTTPS oleh controller pada 14:13 MYT. Bukti tersebut tidak membuktikan sebab tepat kelewatan DNS atau menjamin operasi 24 jam.


## Baharu Build 203 — Extract nombor ahli

Dalam chat owner bot: `.group` → `.extract`.

1. Pilih akaun ONLINE menggunakan `.extract-account N` yang dipaparkan.
2. Pilih group dengan `.extract-group N`. Jika group tiada, sync melalui `.group-sync N` dahulu.
3. Cari nama melalui `.extract-search kelas`, atau gunakan `.extract-page N`.
4. Semak group dan mula dengan `.extract-run`.
5. Semak `.extract-status`. Muat turun `.extract-txt` atau `.extract-csv`.
6. `.extract-cancel` membatalkan bacaan / membuang hasil sementara.

Nombor bersumber daripada PN, medan nombor ahli atau pemetaan LID yang sudah tersedia pada sesi WhatsApp. Username dan LID tanpa padanan dilangkau. Ringkasan membezakan nombor unik, duplicate, nombor belum tersedia dan format/padanan tidak sah. Semakan ialah format dan sumber nombor; bukan pengesahan nombor aktif atau jaminan semua ahli mempunyai nombor tersedia.

TXT: satu nombor antarabangsa berawalan + setiap baris. CSV: nombor sebagai teks, nama group, peranan, sumber dan masa Malaysia (MYT). Apostrof pelindung pada sel nombor CSV mengelakkan tafsiran formula; guna TXT untuk import senarai nombor terus.

Hasil disimpan dalam memori selama 30 minit selepas aktiviti, hilang apabila controller restart, dibatalkan atau memulakan pilihan baharu. Fail hanya dihantar apabila owner meminta muat turun dalam chat peribadi bot. Proses tidak menghantar mesej WhatsApp atau mengubah kempen. Akses baharu ini melalui bot; Mini App sedia ada dikekalkan.
