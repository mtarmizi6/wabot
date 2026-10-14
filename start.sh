#!/data/data/com.termux/files/usr/bin/bash
set -e
cd -- "$(dirname -- "$0")"
export TZ=Asia/Kuala_Lumpur
exec node scripts/menu.js
