#!/data/data/com.termux/files/usr/bin/bash
# Promote ONLY after on-device confirmation of text + photo/video GS and legacy group posting.
set -Eeuo pipefail
ROOT="$HOME/WAPromoBot"
echo 'GS PILOT: Promosi versi rasmi ditutup buat sementara sehingga masalah penerbitan disahkan melalui ujian sebenar.'
exit 1
REC="$HOME/.wapromobot-gs-recovery"
ZIP="$HOME/storage/downloads/WAPromoBot.zip"
[ -d "$REC" ] || { echo 'Pilot rollback backup tidak ditemui; hentikan untuk pemeriksaan.'; exit 1; }
[ -f "$ROOT/package.json" ] || exit 1
[ "$(node -p "require('$ROOT/package.json').wapromobot.build")" = '175' ] || { echo 'Build belum 175.'; exit 1; }
if [ -f "$ROOT/temp/telegram-controller.lock" ]; then
 PID="$(head -1 "$ROOT/temp/telegram-controller.lock" 2>/dev/null||true)"
 if [[ "$PID" =~ ^[0-9]+$ ]] && kill -0 "$PID" 2>/dev/null; then echo 'STOP controller dengan Q dahulu sebelum backup.'; exit 1; fi
fi
[ -s "$ZIP" ] && unzip -tq "$ZIP" >/dev/null || { echo 'ZIP lama tidak sah'; exit 1; }
[ "$(unzip -p "$ZIP" WAPromoBot/package.json | node -e "let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>console.log(JSON.parse(s).wapromobot.build))")" = '174' ] || { echo 'ZIP lama bukan 174, periksa.';exit 1; }
(cd "$ROOT" && npm run check && npm test && npm run doctor)
node --input-type=module - "$ROOT/data/wapromobot.sqlite" <<'JS'
import { DatabaseSync } from 'node:sqlite';
const d=new DatabaseSync(process.argv[2],{readOnly:true});
try {
 const v=d.prepare('SELECT count(*) n FROM schema_migrations WHERE version=16').get().n;
 const a=d.prepare("SELECT count(*) n FROM group_status_targets WHERE status='ACCEPTED'").get().n;
 if(!v||a<1) throw new Error('Belum ada sekurang-kurangnya satu pilot GS berstatus relay ACCEPTED.');
 console.log(`Pilot relay recorded: ${a}; still requires manual WhatsApp visual confirmation.`);
}finally{d.close();}
JS
printf '\nPastikan sendiri Status teks/media benar-benar muncul dalam GROUP, DAN Auto Posting asal masih berfungsi.\nSimpan salinan WAPromoBot.zip lama di tempat selamat di luar telefon dahulu.\n'
read -r -p 'Untuk sahkan dua ujian sebenar tersebut, taip SAH STATUS: ' CONFIRM
[ "$CONFIRM" = 'SAH STATUS' ] || { echo 'Batal. ZIP Build174 masih selamat.'; exit 1; }
cd "$HOME"
TMP="$(mktemp "$HOME/.wapromobot-175-backup.XXXXXX.zip")"
trap 'rm -f -- "$TMP"' EXIT
zip -qr "$TMP" WAPromoBot -x 'WAPromoBot/node_modules/*' 'WAPromoBot/temp/*' 'WAPromoBot/.git/*' 'WAPromoBot/logs/*'
unzip -tq "$TMP" >/dev/null
[ "$(unzip -p "$TMP" WAPromoBot/package.json | node -e "let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>console.log(JSON.parse(s).wapromobot.build))")" = '175' ]
unzip -Z1 "$TMP" | grep -qx 'WAPromoBot/data/wapromobot.sqlite'
unzip -Z1 "$TMP" | grep -qx 'WAPromoBot/sessions/'
mv -f -- "$TMP" "$ZIP"
trap - EXIT
rm -rf -- "$REC"
rm -f -- "$HOME/storage/downloads/WAPromoBot-B175-UPDATE.zip" "$HOME/storage/downloads/WAPromoBot-CODE.zip"
echo 'RASMI: Folder ~/WAPromoBot Build175, ZIP Download/WAPromoBot.zip Build175. Fail sementara dibuang.'
