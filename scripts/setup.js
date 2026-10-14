import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { loadConfig, saveConfig, validateConfig } from '../src/system/config.js';
import { getMe } from '../src/telegram/api.js';
import { loadTelegramState, isTelegramStateCurrent } from '../src/telegram/state.js';
import { printHeader, printFooter, printRows, row, divider, cyan, green, yellow, red, dim } from '../src/system/ui.js';

process.umask(0o077);
let muted = false;
let cancelled = false;

const output = new Writable({
  write(chunk, encoding, callback) {
    if (!muted) process.stdout.write(chunk, encoding);
    callback();
  }
});

let rl;
async function ask(label, secret = false) {
  if (cancelled) throw new Error('Cancelled');
  const pending = rl.question(cyan(label));
  muted = secret;
  try { return (await pending).trim(); }
  finally {
    muted = false;
    if (secret) process.stdout.write('\n');
  }
}

function home(current) {
  const state = loadTelegramState();
  const verified = Boolean(current && isTelegramStateCurrent(current, state));
  const width = printHeader('TELEGRAM SETUP', 'Private Owner Configuration');
  console.log(row('', width));
  console.log(cyan(row('CURRENT STATUS', width)));
  printRows([
    { text: `Telegram     ${current ? '● CONFIGURED' : '● NOT SET'}`, paint: current ? green : yellow },
    { text: 'Bot Token    ••••••••••••••••', paint: current ? green : yellow },
    { text: `Owner ID     ${current?.telegram.ownerUserId ?? '-'}` },
    { text: `Verification ${verified ? '● VERIFIED' : '● PENDING'}`, paint: verified ? green : yellow }
  ], width);
  console.log(row('', width));
  console.log(cyan(divider(width)));
  printRows([
    current ? ' [1] Ubah Tetapan Telegram' : ' [1] Setup Telegram Bot',
    ' [0] Kembali'
  ], width);
  console.log(row('', width));
  printFooter('Token tidak pernah dipaparkan', width);
}

function tokenPage(problem = '', hasCurrent = false) {
  const width = printHeader('CONNECT TELEGRAM', 'STEP 1 / 3 • BOT TOKEN');
  console.log(row('', width));
  printRows([
    'Paste Bot Token daripada BotFather.',
    'Token akan disembunyikan ketika ditaip.',
    hasCurrent ? 'Enter kosong = kekalkan token lama.' : ''
  ].filter(Boolean), width);
  if (problem) {
    console.log(row('', width));
    console.log(red(row(problem, width)));
  }
  console.log(row('', width));
  printFooter('Input rahsia dilindungi', width);
}

function ownerPage(problem = '', hasCurrent = false) {
  const width = printHeader('CONNECT TELEGRAM', 'STEP 2 / 3 • OWNER ID');
  console.log(row('', width));
  printRows([
    { text: 'Bot Token     ● ACCEPTED', paint: green },
    '',
    'Masukkan Telegram User ID nombor.',
    'Jangan guna @username atau +telefon.',
    hasCurrent ? 'Enter kosong = kekalkan ID lama.' : ''
  ].filter(item => item !== '' || true), width);
  if (problem) {
    console.log(red(row(problem, width)));
  }
  console.log(row('', width));
  printFooter('Owner sahaja boleh kawal bot', width);
}

function reviewPage(owner) {
  const width = printHeader('REVIEW & VERIFY', 'STEP 3 / 3');
  console.log(row('', width));
  printRows([
    { text: 'Bot Token     ● HIDDEN', paint: green },
    `Owner ID      ${owner}`,
    '',
    'Menghubungi Telegram API...'
  ], width);
  return width;
}

try {
  if (!process.stdin.isTTY) throw new Error('Interactive terminal required');
  rl = createInterface({ input: process.stdin, output, terminal: true, historySize: 0 });
  rl.on('SIGINT', () => { cancelled = true; rl.close(); });

  const current = loadConfig();
  let choice;
  do {
    home(current);
    choice = await ask('Pilihan > ');
  } while (!['0', '1'].includes(choice));

  if (choice === '0') process.exit(0);

  let token;
  let owner;
  let problem = '';

  while (!token) {
    tokenPage(problem, Boolean(current));
    const value = await ask('Bot Token > ', true);
    try {
      token = validateConfig({
        schemaVersion: 1,
        telegram: { botToken: value || current?.telegram.botToken, ownerUserId: '1' }
      }).telegram.botToken;
      problem = '';
    } catch {
      problem = 'Format Bot Token tidak sah.';
    }
  }

  while (!owner) {
    ownerPage(problem, Boolean(current));
    const value = await ask('User ID > ');
    try {
      owner = validateConfig({
        schemaVersion: 1,
        telegram: { botToken: token, ownerUserId: value || current?.telegram.ownerUserId }
      }).telegram.ownerUserId;
      problem = '';
    } catch {
      problem = 'User ID mesti nombor yang sah.';
    }
  }

  const width = reviewPage(owner);
  let bot;
  try {
    bot = await getMe(token);
    console.log(green(row(`Bot           ${bot.username ? '@' + bot.username : bot.firstName}`, width)));
    console.log(green(row('Token         ● VALID', width)));
  } catch (error) {
    console.log(red(row('Token         ● FAILED', width)));
    console.log(red(row(error.message, width)));
    printFooter('Tetapan asal tidak diubah', width);
    throw error;
  }

  console.log(row('', width));
  console.log(cyan(divider(width)));
  console.log(yellow(row('Taip YA untuk SAVE & VERIFY.', width)));
  console.log(dim(row('Enter kosong = batal.', width)));
  printFooter('', width);

  if ((await ask('Simpan > ')).toUpperCase() === 'YA') {
    saveConfig({ schemaVersion: 1, telegram: { botToken: token, ownerUserId: owner } });
    const doneWidth = printHeader('SETUP COMPLETE');
    console.log(row('', doneWidth));
    console.log(green(row('● TELEGRAM SETTINGS SAVED', doneWidth)));
    console.log(green(row(`Bot      ${bot.username ? '@' + bot.username : bot.firstName}`, doneWidth)));
    console.log(row(`Owner ID ${owner}`, doneWidth));
    console.log(row('', doneWidth));
    console.log(yellow(row('Next: pilih Verify Owner di menu.', doneWidth)));
    console.log(row('', doneWidth));
    printFooter('Configuration protected', doneWidth);
  } else {
    const cancelWidth = printHeader('SETUP CANCELLED');
    console.log(row('', cancelWidth));
    console.log(yellow(row('Tetapan asal dikekalkan.', cancelWidth)));
    console.log(row('', cancelWidth));
    printFooter('', cancelWidth);
  }
} catch (error) {
  muted = false;
  if (!cancelled && process.exitCode !== 1) {
    const width = printHeader('SETUP ERROR');
    console.log(row('', width));
    console.log(red(row('Setup tidak selesai.', width)));
    console.log(yellow(row('Tetapan asal dikekalkan.', width)));
    console.log(row('', width));
    printFooter('', width);
    process.exitCode = 1;
  }
} finally {
  muted = false;
  rl?.close();
}
