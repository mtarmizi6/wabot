#!/data/data/com.termux/files/usr/bin/bash
# Build175 pilot rollback; run only when the Telegram controller is stopped.
set -Eeuo pipefail
ROOT="$HOME/WAPromoBot"
REC="$HOME/.wapromobot-gs-recovery"
[ -f "$REC/restore-files.list" ] || { echo 'Tiada backup pemulihan Build 174.'; exit 1; }
[ -d "$REC/sessions" ] || { echo 'Snapshot sesi asal tiada. Hentikan dan semak.'; exit 1; }
[ -d "$REC/node_modules" ] || { echo 'Node_modules lama tiada. Jangan padam apa-apa.'; exit 1; }
[ "$(node -p "require('$ROOT/package.json').wapromobot.build")" = '175' ] || { echo 'Bukan Build175.'; exit 1; }
if [ -f "$ROOT/temp/telegram-controller.lock" ]; then
 PID="$(head -1 "$ROOT/temp/telegram-controller.lock" 2>/dev/null||true)"
 if [[ "$PID" =~ ^[0-9]+$ ]] && kill -0 "$PID" 2>/dev/null; then echo 'STOP controller dengan Q dahulu.'; exit 1; fi
fi
# Do not overwrite media or sessions from the pilot; only downgrade the isolated GS schema.
node --input-type=module - "$ROOT/data/wapromobot.sqlite" <<'JS'
import {DatabaseSync} from 'node:sqlite';
const d=new DatabaseSync(process.argv[2]);
try {
 d.exec('PRAGMA busy_timeout=5000;PRAGMA foreign_keys=OFF;BEGIN IMMEDIATE;');
 const v=d.prepare('SELECT version FROM schema_migrations WHERE version=16').get();
 if(v){d.exec('DROP TABLE IF EXISTS group_status_targets; DROP TABLE IF EXISTS group_status_jobs; DELETE FROM schema_migrations WHERE version=16;');}
 d.exec('COMMIT;PRAGMA wal_checkpoint(TRUNCATE);');
} catch(e){try{d.exec('ROLLBACK')}catch{};throw e;}finally{d.close();}
JS
while IFS= read -r rel; do mkdir -p "$ROOT/$(dirname "$rel")"; cp -p "$REC/original/$rel" "$ROOT/$rel"; done < "$REC/restore-files.list"
while IFS= read -r rel; do rm -f -- "$ROOT/$rel"; done < "$REC/new-files.list"
if [ -d "$ROOT/node_modules" ]; then rm -rf -- "$ROOT/node_modules"; fi
mv -- "$REC/node_modules" "$ROOT/node_modules"
# Restore original Build174 credential snapshot; do not silently leave migrated v7 auth files.
rm -rf -- "$ROOT/sessions"
cp -a -- "$REC/sessions" "$ROOT/sessions"
rmdir "$ROOT/src/groupstatus" 2>/dev/null || true
(cd "$ROOT" && npm run check && npm test && npm run doctor)
rm -rf -- "$REC"
echo 'Build 174 dipulihkan; sesi WhatsApp dipulihkan dari snapshot sebelum upgrade; data posting lain tidak dipadam.'
