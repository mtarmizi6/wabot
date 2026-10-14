import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { databasePath } from '../src/system/paths.js';
import { initializeDatabase } from '../src/database/connection.js';

process.umask(0o077);
try {
  mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  const info = initializeDatabase(databasePath);
  console.log('\n🤖 WAPromoBot');
  console.log('✅ DATABASE SEDIA');
  console.log(`Install : ${info.installId}`);
  console.log(`Schema  : ${info.schemaVersion}`);
  console.log('↳ Setup boleh dijalankan semula tanpa reset data.\n');
} catch {
  console.error('❌ Database tidak dapat disediakan. Jangan padam fail data. Hantar screenshot ini untuk semakan.');
  process.exitCode = 1;
}
