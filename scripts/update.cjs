// Standalone so the first update can run directly from the downloaded archive.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const name = 'WAPromoBot';
const target = path.resolve(process.argv[3] || path.join(os.homedir(), name));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const allowed = /^(?:src\/[a-zA-Z0-9_./-]+\.js|scripts\/[a-zA-Z0-9_./-]+\.(?:js|cjs|sh)|tests\/[a-zA-Z0-9_./-]+\.js|miniapp\/[a-zA-Z0-9_./-]+\.(?:js|css|html|png|woff2|ttf|txt)|MINIAPP\.md|design-qa\.md|package\.json|README\.md|start\.sh|update\.sh|update-manifest\.json)$/;
let work, updateLock, applied = [];
function fail(message) { throw new Error(message); }
function safeFile(relative) {
  if (!allowed.test(relative) || relative.split('/').some(x => !x || x === '..' || x === '.')) fail('Laluan update tidak sah.');
  let current = target;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) fail('Fail kod menggunakan symlink. Update dihentikan.');
  }
  return current;
}
function unzip(args) {
  const result = spawnSync('unzip', args, { maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) fail('ZIP tidak dapat dibaca. Pastikan unzip tersedia dan muat turun lengkap.');
  return result.stdout;
}
function findArchive() {
  const downloads = path.join(os.homedir(), 'storage', 'downloads');
  if (!fs.existsSync(downloads)) fail('Downloads belum tersedia. Jalankan termux-setup-storage.');
  const files = fs.readdirSync(downloads).filter(x => /^WAPromoBot(?:\s*\(\d+\)|-\d+)?\.zip$/i.test(x))
    .map(x => path.join(downloads, x)).filter(x => fs.statSync(x).isFile())
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (!files.length) fail('Muat turun WAPromoBot.zip ke Downloads dahulu.');
  return files[0];
}
function checkController() {
  const lock = path.join(target, 'temp', 'telegram-controller.lock');
  if (!fs.existsSync(lock)) return;
  const pid = Number(fs.readFileSync(lock, 'utf8').trim());
  if (!Number.isSafeInteger(pid) || pid <= 0) fail('Lock controller tidak sah. Semak sebelum update.');
  try { process.kill(pid, 0); }
  catch (error) { if (error.code === 'ESRCH') return; throw error; }
  fail('Controller masih aktif. Tekan Q, kemudian 0 untuk keluar sebelum update.');
}
function atomicWrite(file, bytes, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + '.update-' + crypto.randomUUID();
  try { fs.writeFileSync(tmp, bytes, { mode, flag: 'wx' }); fs.renameSync(tmp, file); }
  finally { fs.rmSync(tmp, { force: true }); }
}
try {
  if (Number(process.versions.node.split('.')[0]) !== 24) fail('Update ini memerlukan Node.js 24 seperti projek asal.');
  if (!fs.existsSync(path.join(target, 'package.json'))) fail('Projek asal ~/WAPromoBot tidak ditemui. Tiada folder baru dicipta.');
  if (fs.lstatSync(target).isSymbolicLink()) fail('Folder projek menggunakan symlink. Semak lokasi asal dahulu.');
  checkController();
  fs.mkdirSync(path.join(target, 'temp'), { recursive: true, mode: 0o700 });
  const lockPath = path.join(target, 'temp', 'update.lock');
  try { updateLock = fs.openSync(lockPath, 'wx', 0o600); }
  catch { fail('Update lain masih aktif atau pernah terganggu. Semak temp/update.lock dahulu.'); }
  const archive = path.resolve(process.argv[2] || findArchive());
  const entries = unzip(['-Z', '-1', archive]).toString().split(/\r?\n/).filter(Boolean);
  if (new Set(entries).size !== entries.length) fail('ZIP mempunyai entri bertindih.');
  const readEntry = relative => {
    const key = name + '/' + relative;
    if (!entries.includes(key)) fail('Pakej tidak lengkap: ' + relative);
    return unzip(['-p', archive, key]);
  };
  const manifestBytes = readEntry('update-manifest.json');
  const manifest = JSON.parse(manifestBytes);
  if (manifest.project !== 'wapromobot' || manifest.schema !== 1 || !Array.isArray(manifest.files) || !manifest.files.length) fail('Manifest update tidak sah.');
  const current = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'));
  if (current.name !== 'wapromobot') fail('Folder ini bukan projek WAPromoBot asal.');
  if (![manifest.baseBuild, ...(manifest.compatibleBuilds || []), manifest.build].includes(current.wapromobot?.build)) fail(`Build tidak sepadan: telefon ${current.wapromobot?.build}, asas update ${manifest.baseBuild}. Kod dan data tidak diubah.`);
  if (new Set(manifest.files.map(x => x.path)).size !== manifest.files.length) fail('Senarai update bertindih.');
  const planned = [];
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'wapromobot-update-'));
  for (const item of manifest.files) {
    const file = safeFile(item.path);
    const bytes = readEntry(item.path);
    if (hash(bytes) !== item.sha256) fail('Semakan integriti gagal: ' + item.path);
    let before = null, mode = item.path.endsWith('.sh') ? 0o700 : 0o600;
    if (fs.existsSync(file)) {
      before = fs.readFileSync(file); mode = fs.statSync(file).mode & 0o777;
      const actual = hash(before);
      if (![item.before, ...(item.beforeAlso || []), item.sha256].includes(actual)) fail('Kod telefon berbeza daripada rujukan: ' + item.path + '. Hantar backup terkini untuk semakan.');
    } else if (item.before && !item.optionalExisting) fail('Fail asal tidak ditemui: ' + item.path);
    const staged = path.join(work, item.path);
    fs.mkdirSync(path.dirname(staged), { recursive: true }); fs.writeFileSync(staged, bytes);
    planned.push({ file, bytes, before, mode, staged, relative: item.path });
  }
  const nextPackage = planned.find(x => x.relative === 'package.json');
  if (!nextPackage || JSON.parse(nextPackage.bytes).wapromobot?.build !== manifest.build) fail('Versi pakej tidak sepadan.');
  for (const item of planned.filter(x => /\.(js|cjs)$/.test(x.relative))) {
    const result = spawnSync(process.execPath, ['--check', item.staged], { encoding: 'utf8' });
    if (result.error || result.status !== 0) fail('Semakan syntax gagal: ' + item.relative);
  }
  // Recheck after validation; a controller could have started while the ZIP was read.
  checkController();
  for (const item of planned) {
    applied.push(item);
    atomicWrite(item.file, item.bytes, item.mode);
  }
  console.log(`WA PROMO BOT · Build ${manifest.build} siap.`);
  console.log('Folder: ' + target);
  console.log('Token, sesi WhatsApp, database dan media dikekalkan.');
} catch (error) {
  let rollbackFailed = false;
  for (const item of applied.reverse()) {
    try {
      if (item.before === null) fs.rmSync(item.file, { force: true });
      else atomicWrite(item.file, item.before, item.mode);
    } catch { rollbackFailed = true; }
  }
  console.error('Update dihentikan: ' + error.message);
  if (rollbackFailed) console.error('Pemulihan kod tidak lengkap. Jangan start; hantar paparan ini untuk semakan.');
  else if (applied.length) console.error('Kod sebelumnya telah dipulihkan.');
  process.exitCode = 1;
} finally {
  if (work) fs.rmSync(work, { recursive: true, force: true });
  if (updateLock !== undefined) {
    fs.closeSync(updateLock);
    fs.rmSync(path.join(target, 'temp', 'update.lock'), { force: true });
  }
}
