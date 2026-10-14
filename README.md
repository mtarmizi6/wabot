# Build 212 — Notifikasi Mini App senyap

Semakan latar belakang, sedia, retry DNS dan kegagalan tunnel tidak menghantar mesej Telegram secara automatik. Status/error kekal tersedia apabila owner meminta .panel, .panel-quick atau .panel-setup. Semakan, kemaskini butang Live Panel, monitor dan kawalan kempen kekal.

# Build 211 — Extract Ahli & DM Follow-Up

Fungsi Nombor Chat Personal dihentikan sepenuhnya: tiada menu, command, pengumpul event sejarah, permintaan sync atau import chat ke kempen baharu. Sambungan WhatsApp kembali tepat kepada pengurus sambungan Build 207, sebelum modul sejarah ditambah.

Extract Ahli (.extract) dan DM Follow-Up (.followup) dikekalkan. Penerima follow-up melalui tampal nombor / fail TXT daripada extract atau senarai sendiri. Kuota, baki, jeda, sambung dan stop dikekalkan. Mini App memantau progress dan mengawal kempen sedia ada; setup kekal di Telegram.

Migrasi database lama dikekalkan untuk keserasian update. Data/sesi/token dan kempen sedia ada tidak dipadam. Modul sejarah lama digantikan dengan fail kosong tanpa fungsi supaya update turut melumpuhkan fail lama pada pemasangan sedia ada. Draf pemilihan chat lama kembali ke langkah input nombor.

Update ke folder projek utama: keluar controller Q → 0, simpan WAPromoBot.zip dalam Downloads, jalankan node scripts/update.cjs kemudian bash start.sh dari ~/WAPromoBot.


## Build 213
Build 213 — Auto Status teruskan baki selepas UNKNOWN atau penolakan group.
Keputusan kekal FAILED/UNKNOWN; tiada penghantaran semula automatik.
Delay dan rehat kekal. Jeda lama jenis ini dibuka melalui .gs-resume.
Akaun offline, sesi tamat, protokol tidak disokong dan bahan rosak kekal dikendalikan oleh perlindungan sedia ada.
