#!/data/data/com.termux/files/usr/bin/bash
set -e
cd -- "$(dirname -- "$0")"
node scripts/update.cjs
exec bash ./start.sh
