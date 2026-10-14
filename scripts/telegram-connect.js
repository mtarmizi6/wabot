import { loadConfig } from '../src/system/config.js';
import { getMe, getWebhookInfo, getUpdates, sendMessage, retryTelegramCheck } from '../src/telegram/api.js';
import { saveTelegramState, tokenFingerprint } from '../src/telegram/state.js';
import { printHeader, printFooter, printRows, row, divider, cyan, green, yellow, red, clearScreen } from '../src/system/ui.js';

const config = loadConfig();
if (!config) {
  const width = printHeader('VERIFY OWNER');
  console.log(row('', width));
  console.log(red(row('● Telegram belum disediakan.', width)));
  console.log(yellow(row('Pilih Setup Telegram dahulu.', width)));
  console.log(row('', width));
  printFooter('', width);
  process.exit(1);
}

const token = config.telegram.botToken;
const ownerId = config.telegram.ownerUserId;

try {
  let width = printHeader('VERIFY OWNER', 'Secure Telegram Pairing');
  console.log(row('', width));
  console.log(yellow(row('STEP 1 / 3  Checking Bot Token...', width)));
  const bot = await retryTelegramCheck(() => getMe(token), { attempts: 2, delayMs: 1200, onRetry: () => console.log(yellow(row('↳ Sambungan lambat · cuba semula...', width))) });
  console.log(green(row(`● Bot ${bot.username ? '@' + bot.username : bot.firstName}`, width)));

  console.log(row('', width));
  console.log(yellow(row('STEP 2 / 3  Checking Connection...', width)));
  const webhook = await retryTelegramCheck(() => getWebhookInfo(token), { attempts: 2, delayMs: 1200, onRetry: () => console.log(yellow(row('↳ Sambungan lambat · cuba semula...', width))) });
  if (webhook.url) throw new Error('Webhook aktif. Polling WAPromoBot belum boleh digunakan.');
  console.log(green(row('● Polling READY', width)));

  console.log(row('', width));
  console.log(cyan(divider(width)));
  console.log(yellow(row('STEP 3 / 3  OWNER VERIFICATION', width)));
  printRows([
    `Owner ID  ${ownerId}`,
    `Buka ${bot.username ? '@' + bot.username : 'bot anda'} di Telegram.`,
    'Hantar /start dalam private chat.',
    'Menunggu sehingga 5 minit...'
  ], width);
  console.log(row('', width));
  printFooter('Only configured Owner ID accepted', width);

  const deadline = Date.now() + 5 * 60 * 1000;
  let offset;
  let verified = false;
  let tick = 0;
  while (Date.now() < deadline && !verified) {
    const updates = await getUpdates(token, offset, 20);
    for (const update of updates) {
      offset = Math.max(offset ?? 0, Number(update.update_id) + 1);
      const message = update.message;
      if (!message?.from?.id || message.chat?.type !== 'private') continue;
      if (String(message.from.id) !== ownerId) continue;
      if (typeof message.text !== 'string' || !message.text.trim()) continue;
      verified = true;
      break;
    }
    if (!verified) {
      tick += 1;
      process.stdout.write(tick % 10 === 0 ? '•' : '.');
    }
  }

  if (!verified) throw new Error('Owner belum disahkan. Cuba semula dan hantar /start kepada bot.');

  const state = saveTelegramState({
    schemaVersion: 1,
    botId: bot.id,
    botUsername: bot.username,
    botFirstName: bot.firstName,
    ownerUserId: ownerId,
    tokenFingerprint: tokenFingerprint(token),
    verifiedAt: new Date().toISOString()
  });

  await sendMessage(token, ownerId,
    `✅ WAPromoBot berjaya disambungkan.\n\nBot: ${bot.username ? '@' + bot.username : bot.firstName}\nOwner ID: ${ownerId}\nStatus: VERIFIED\n\nKembali ke Termux untuk sambung setup.`
  );

  clearScreen();
  width = printHeader('OWNER VERIFIED');
  console.log(row('', width));
  console.log(green(row('● TELEGRAM CONNECTED', width)));
  console.log(green(row('● OWNER VERIFIED', width)));
  console.log(row(`Bot      ${bot.username ? '@' + bot.username : bot.firstName}`, width));
  console.log(row(`Owner ID ${ownerId}`, width));
  console.log(row('', width));
  console.log(yellow(row('Connection phase complete.', width)));
  console.log(row('', width));
  printFooter(`Verified ${state.verifiedAt.slice(0, 19).replace('T', ' ')}`, width);
} catch (error) {
  const width = printHeader('VERIFY OWNER');
  console.log(row('', width));
  console.log(red(row(`● ${error.message}`, width)));
  console.log(yellow(row('Tetapan dan data tidak dipadam.', width)));
  console.log(row('', width));
  printFooter('Verification not completed', width);
  process.exitCode = 1;
}
