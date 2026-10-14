import { loadConfig } from '../src/system/config.js';
import { getMe, getWebhookInfo, retryTelegramCheck } from '../src/telegram/api.js';
import { loadTelegramState, isTelegramStateCurrent } from '../src/telegram/state.js';
import { printHeader, printFooter, printRows, row, cyan, green, yellow, red } from '../src/system/ui.js';

try {
  const config = loadConfig();
  if (!config) throw new Error('Tetapan belum ada. Pilih Setup Telegram dahulu.');
  const [bot, webhook] = await retryTelegramCheck(() => Promise.all([
    getMe(config.telegram.botToken),
    getWebhookInfo(config.telegram.botToken)
  ]), { attempts: 2, delayMs: 1200 });
  const state = loadTelegramState();
  const verified = isTelegramStateCurrent(config, state);
  const width = printHeader('TELEGRAM LIVE STATUS');
  console.log(row('', width));
  printRows([
    { text: 'Token         ● VALID', paint: green },
    { text: `Bot           ${bot.username ? '@' + bot.username : bot.firstName}`, paint: green },
    `Bot ID        ${bot.id}`,
    `Owner ID      ${config.telegram.ownerUserId}`,
    { text: `Owner Verify  ${verified ? '● VERIFIED' : '● PENDING'}`, paint: verified ? green : yellow },
    { text: `Connection    ${webhook.url ? '● WEBHOOK ACTIVE' : '● POLLING READY'}`, paint: webhook.url ? yellow : green },
    { text: 'Bot Runner    ● NEXT PHASE', paint: yellow }
  ], width);
  console.log(row('', width));
  printFooter('Live check via Telegram API', width);
} catch (error) {
  const width = printHeader('TELEGRAM LIVE STATUS');
  console.log(row('', width));
  console.log(red(row(`● ${error.message}`, width)));
  console.log(row('', width));
  printFooter('Semakan gagal', width);
  process.exitCode = 1;
}
