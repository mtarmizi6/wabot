import { createInterface } from 'node:readline/promises';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { projectRoot } from '../src/system/paths.js';
import { loadConfig } from '../src/system/config.js';
import { loadTelegramState, isTelegramStateCurrent } from '../src/telegram/state.js';
import { printHeader, printFooter, printRows, row, divider, panelWidth, cyan, green, yellow, dim, clearScreen } from '../src/system/ui.js';
import { termuxWakeLock } from '../src/system/runtime.js';

const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
process.umask(0o077);

if (!process.stdin.isTTY) {
  console.error('Interactive terminal required.');
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true, historySize: 0 });
let cancelled = false;

async function promptLine(label, { dimmed = false } = {}) {
  const controller = new AbortController();
  const onSigint = () => {
    cancelled = true;
    controller.abort();
  };

  rl.once('SIGINT', onSigint);
  try {
    const value = await rl.question(dimmed ? dim(label) : cyan(label), { signal: controller.signal });
    return String(value || '').trim();
  } catch (error) {
    if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR' || error?.code === 'ERR_USE_AFTER_CLOSE') {
      cancelled = true;
      return '';
    }
    throw error;
  } finally {
    rl.off('SIGINT', onSigint);
  }
}

async function ask(label = 'Pilihan > ') {
  return promptLine(label);
}

async function pause() {
  if (cancelled) return;
  console.log();
  await promptLine('Tekan Enter untuk kembali ke menu...', { dimmed: true });
}

function run(relative, extraEnv = {}) {
  return spawnSync(process.execPath, [join(projectRoot, relative)], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv }
  });
}

function snapshot() {
  try {
    const config = loadConfig();
    const state = loadTelegramState();
    return {
      configured: Boolean(config),
      ownerId: config?.telegram?.ownerUserId ?? '-',
      verified: Boolean(config && isTelegramStateCurrent(config, state))
    };
  } catch {
    return { configured: false, ownerId: '-', verified: false, invalid: true };
  }
}


function renderControllerStarting() {
  const width = printHeader('TELEGRAM CONTROLLER', 'Owner-only Remote Control');
  console.log(row('', width));
  console.log(cyan(row('STARTUP', width)));
  console.log(yellow(row('Controller   ● STARTING', width)));
  console.log(row('Telegram     Menyambung...', width));
  console.log(row('WhatsApp     Menunggu...', width));
  console.log(row('', width));
  console.log(cyan(divider(width)));
  console.log(dim(row('Sila tunggu sebentar. Sistem sedang bersedia.', width)));
  console.log(row('', width));
  printFooter(`Build ${pkg.wapromobot.build} • ${pkg.wapromobot.stage}`, width);
}

function render() {
  const s = snapshot();
  const width = printHeader('CONTROL PANEL', 'Telegram Setup & Controller');
  console.log(row('', width));
  console.log(cyan(row('STATUS SISTEM', width)));
  printRows([
    { text: `Telegram    ${s.configured ? '● CONFIGURED' : '● NOT SET'}`, paint: s.configured ? green : yellow },
    { text: `Owner ID    ${s.ownerId}` },
    { text: `Verification ${s.verified ? '● VERIFIED' : '● PENDING'}`, paint: s.verified ? green : yellow }
  ], width);
  console.log(row('', width));
  console.log(cyan(divider(width)));
  console.log(cyan(row('MENU UTAMA', width)));
  printRows([
    ' [1] Setup / Ubah Telegram',
    ' [2] Verify Owner Telegram',
    ' [3] Semak Live Status',
    ' [4] System Doctor',
    ' [5] Start Telegram Controller',
    ' [0] Keluar'
  ], width);
  console.log(row('', width));
  printFooter(`Build ${pkg.wapromobot.build} • ${pkg.wapromobot.stage}`, width);
}

try {
  while (!cancelled) {
    render();
    const choice = await ask();
    if (cancelled) break;
    if (choice === '0') break;
    if (!['1', '2', '3', '4', '5'].includes(choice)) continue;

    if (choice === '5') {
      renderControllerStarting();
      const wakeLockActive = termuxWakeLock('lock');
      const result = run('scripts/telegram-controller.js', { WAPROMOBOT_WAKE_LOCK: wakeLockActive ? '1' : '0' });
      if (wakeLockActive) termuxWakeLock('unlock');
      if (Number(result?.status || 0) !== 0) await pause();
      continue;
    }

    clearScreen();
    if (choice === '1') run('scripts/setup.js');
    if (choice === '2') run('scripts/telegram-connect.js');
    if (choice === '3') run('scripts/telegram-status.js');
    if (choice === '4') run('src/system/doctor.js');
    await pause();
  }
} catch (error) {
  if (!cancelled) {
    console.error(`WAPromoBot menu error: ${String(error?.message || error)}`);
    process.exitCode = 1;
  }
} finally {
  clearScreen();
  if (!cancelled) console.log(green('WAPromoBot ditutup dengan selamat.\n'));
  rl.close();
}
