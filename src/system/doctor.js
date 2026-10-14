import { readFileSync, statSync, accessSync, constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { readDatabaseInfo } from '../database/connection.js';
import { whatsappAccountSummary } from '../whatsapp/store.js';
import { createRequire } from 'node:module';
import { databasePath } from './paths.js';
import { loadConfig } from './config.js';
import { loadTelegramState, isTelegramStateCurrent } from '../telegram/state.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
let failures = 0;
function check(label, operation) {
  try {
    const detail = operation();
    console.log(`✅ ${label}${detail ? `: ${detail}` : ''}`);
  } catch {
    failures++;
    console.log(`❌ ${label} — pemeriksaan gagal`);
  }
}

console.log('\n🤖 WAPromoBot\n🩺 PEMERIKSAAN ASAS\n');
check('Maklumat aplikasi', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (pkg.name !== 'wapromobot') throw new Error('Wrong project');
  return `v${pkg.version} · Build ${pkg.wapromobot.build}`;
});
check('Node.js', () => {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Unsupported runtime');
  return process.versions.node;
});

for (const folder of ['src', 'migrations', 'scripts', 'tests', 'config', 'data', 'sessions', 'media', 'reports', 'logs', 'temp']) {
  check(`Folder ${folder}`, () => {
    const path = join(root, folder);
    if (!statSync(path).isDirectory()) throw new Error('Not a directory');
    accessSync(path, constants.R_OK | constants.W_OK | constants.X_OK);
  });
}

let db;
try {
  const { DatabaseSync } = await import('node:sqlite');
  db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE probe (id INTEGER PRIMARY KEY, value INTEGER NOT NULL); BEGIN IMMEDIATE; INSERT INTO probe VALUES (1, 1); ROLLBACK;');
  if (db.prepare('SELECT count(*) AS count FROM probe').get().count !== 0) throw new Error('Rollback failed');
  const version = db.prepare('SELECT sqlite_version() AS version').get().version;
  console.log(`✅ SQLite: ${version} · transaksi berjaya`);
} catch {
  failures++;
  console.log('❌ SQLite — pemeriksaan transaksi gagal');
} finally {
  if (db) db.close();
}

check('Tetapan Telegram', () => {
  const config = loadConfig();
  if (!config) return 'BELUM DIISI · jalankan npm run setup';
  const state = loadTelegramState();
  return isTelegramStateCurrent(config, state)
    ? 'DISIMPAN · OWNER VERIFIED'
    : 'DISIMPAN · owner belum disahkan';
});
console.log('Telegram: gunakan npm run telegram:status untuk semakan sambungan live');
check('WhatsApp Engine', () => {
  require.resolve('@whiskeysockets/baileys');
  require.resolve('qrcode');
  const summary = whatsappAccountSummary(databasePath);
  return `READY · ${summary.connected}/${summary.total} Connected`;
});
check('Database aplikasi', () => {
  const info = readDatabaseInfo(databasePath);
  return `READY · ${info.installId} · Schema ${info.schemaVersion}`;
});
console.log(failures ? `\n⚠️ ${failures} pemeriksaan gagal.\n` : '\n✅ PEMERIKSAAN ASAS LULUS\n');
process.exitCode = failures ? 1 : 0;
