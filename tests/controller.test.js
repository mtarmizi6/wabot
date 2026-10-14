import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectRoot } from '../src/system/paths.js';
import {
  controllerKeyboard, routeTelegramUpdate, formatTelegramMessage, mainMenuText, statusMessage,
  helpMessage, helpTopicMessage, postingNewMessage, recordsMessage, systemKeyboard, systemMessage, autoReadMessage, storageMessage,
  groupMessage, groupListMessage, groupSyncCompleteMessage, whatsappMessage
} from '../src/telegram/controller.js';

const owner = '123456789';

function callbacks(keyboard) {
  return keyboard.inline_keyboard.flat().map(item => item.callback_data);
}

test('Owner /start routes to master menu', () => {
  const route = routeTelegramUpdate({ message: { from: { id: Number(owner) }, chat: { id: Number(owner), type: 'private' }, text: '/start' } }, owner);
  assert.equal(route.action, 'home');
  assert.equal(route.chatId, owner);
});

test('Slash and classic dot commands route to final UX sections', () => {
  const commands = new Map([
    ['/accounts', 'wa'], ['.accounts', 'wa'], ['/join', 'join'], ['.join', 'join'],
    ['/group', 'group'], ['.group', 'group'], ['/mula', 'posting_new'], ['.mula', 'posting_new'],
    ['.mula sendiri', 'posting_self'], ['.mula client', 'posting_client'],
    ['/status', 'posting_active'], ['.status', 'posting_active'], ['/rekod', 'records'], ['.rekod', 'records'],
    ['/report', 'report'], ['.report', 'report'], ['/system', 'system'], ['.system', 'system'], ['/help', 'help'], ['.help', 'help']
  ]);
  for (const [text, action] of commands) {
    const route = routeTelegramUpdate({ message: { from: { id: Number(owner) }, chat: { id: Number(owner), type: 'private' }, text } }, owner);
    assert.equal(route.action, action);
  }
});

test('Non-owner Telegram updates are ignored', () => {
  const route = routeTelegramUpdate({ message: { from: { id: 123 }, chat: { id: 123, type: 'private' }, text: '/system' } }, owner);
  assert.equal(route.action, 'ignore');
  assert.equal(route.reason, 'unauthorized');
});

test('Legacy callback menu remains compatible', () => {
  const items = callbacks(controllerKeyboard());
  assert.deepEqual(items, ['wa', 'join', 'group', 'posting_new', 'posting_active', 'records', 'report', 'system', 'help']);
});

test('Owner callback routes approved master and submenu actions', () => {
  for (const action of ['wa', 'posting_new', 'posting_client', 'system_check', 'help_posting']) {
    const route = routeTelegramUpdate({ callback_query: { id: 'cb1', from: { id: Number(owner) }, data: action, message: { chat: { id: Number(owner), type: 'private' } } } }, owner);
    assert.equal(route.action, action);
  }
});

test('Unknown callback safely returns home', () => {
  const route = routeTelegramUpdate({ callback_query: { id: 'cb1', from: { id: Number(owner) }, data: 'developer-secret-screen', message: { chat: { id: Number(owner), type: 'private' } } } }, owner);
  assert.equal(route.action, 'home');
});

test('Master wording follows classic arrow command style', () => {
  assert.match(mainMenuText('WAPromoBot'), /Urus akaun, group, posting, follow-up & laporan WhatsApp/);
  assert.match(mainMenuText('WAPromoBot'), /↳ \.accounts → Login, sambung & urus akaun/);
  assert.match(mainMenuText('WAPromoBot'), /↳ \.mula → Cipta kempen sendiri \/ client/);
  assert.match(postingNewMessage(), /SENDIRI/);
  assert.match(postingNewMessage(), /CLIENT/);
  assert.match(recordsMessage(), /STOP ≠ DELETE/);
  assert.match(helpMessage(), /Panduan ringkas/);
  assert.match(helpTopicMessage('help_posting'), /target SUCCESS sebenar/);
});



test('Polished Telegram formatter adds hierarchy without changing classic commands', () => {
  const formatted = formatTelegramMessage(mainMenuText('WAPromoBot'));
  assert.match(formatted, /<b>🤖 WA PROMO BOT<\/b>/);
  assert.match(formatted, /<b>WHATSAPP<\/b>/);
  assert.match(formatted, /↳ <code>\.accounts<\/code> → Login, sambung &amp; urus akaun/);
  assert.match(formatted, /📱 WhatsApp Online : <b>0\/0<\/b>/);
  assert.doesNotMatch(formatted, /<i>|<\/i>/);
  assert.doesNotMatch(formatted, /inline_keyboard|callback_data/);
});

test('Build 151 Auto Mark Read commands route and system UI exposes ON/OFF control', () => {
  const cases = [
    ['.auto-read', 'auto_read'],
    ['.auto-read on', 'auto_read_on'],
    ['.auto-read off', 'auto_read_off']
  ];
  for (const [text, action] of cases) {
    const route = routeTelegramUpdate({ message: { from: { id: Number(owner) }, chat: { id: Number(owner), type: 'private' }, text } }, owner);
    assert.equal(route.action, action);
  }
  assert.match(systemMessage({ build: 151, stage: 'auto-mark-read', autoMarkRead: true }), /Auto Mark Read/);
  assert.match(systemMessage({ build: 151, stage: 'auto-mark-read', autoMarkRead: true }), /✅ ON/);
  assert.match(autoReadMessage(false), /❌ OFF/);
  assert.match(autoReadMessage(false), /tidak clear chat/i);
});

test('System keyboard remains useful while other modules are skeletons', () => {
  const items = callbacks(systemKeyboard());
  assert.deepEqual(items, ['system_status', 'system_check', 'storage', 'version', 'wa', 'home']);
});

test('Status does not expose bot token or session secrets', () => {
  const status = statusMessage({ build: 111, botUsername: 'WAPromoBot', ownerUserId: owner, verified: true });
  assert.match(status, /Controller : 🟢 ONLINE/);
  assert.doesNotMatch(status, /botToken|session|[0-9]{5,20}:[A-Za-z0-9_-]{20,}/i);
});

test('Build 114 classic bold dashboard uses summary counters and clean command rows', () => {
  const text = mainMenuText('WAPromoBot', { connectedAccounts: 2, totalAccounts: 2, groups: 1730, activePostings: 2, records: 18 });
  assert.match(text, /Urus akaun, group, posting, follow-up & laporan WhatsApp\./);
  assert.match(text, /📱 WhatsApp Online : 2\/2/);
  assert.match(text, /🔗 Jumlah Akses Group : 1,730/);
  assert.match(text, /↳ \.accounts → Login, sambung & urus akaun/);
  assert.match(text, /↳ \.report → Semak hasil penghantaran setiap kempen/);
  const formatted = formatTelegramMessage(text);
  assert.match(formatted, /↳ <code>\.accounts<\/code> → Login, sambung &amp; urus akaun/);
  assert.match(formatted, /📱 WhatsApp Online : <b>2\/2<\/b>/);
});


test('WhatsApp account commands route with account arguments and confirmations', () => {
  const cases = [
    ['.account 3', 'wa_account', ['3']],
    ['.account-reconnect 3', 'wa_reconnect', ['3']],
    ['.account-replace 3', 'wa_replace', ['3']],
    ['.account-logout 3', 'wa_logout', ['3']],
    ['.account-logout 3 CONFIRM', 'wa_logout', ['3', 'confirm']],
    ['.account-delete 3 CONFIRM', 'wa_delete', ['3', 'confirm']],
    ['.account-group 3', 'wa_account_group', ['3']],
    ['.account-sync 3', 'wa_account_sync', ['3']]
  ];
  for (const [text, action, args] of cases) {
    const route = routeTelegramUpdate({ message: { from: { id: Number(owner) }, chat: { id: Number(owner), type: 'private' }, text } }, owner);
    assert.equal(route.action, action);
    assert.deepEqual(route.args, args);
  }
});


test('Group commands route account pages, info and sync targets', () => {
  const cases = [
    ['.group 1', 'group_account', ['1']],
    ['.group 1 3', 'group_account', ['1', '3']],
    ['.group-info 1 12', 'group_info', ['1', '12']],
    ['.group-sync 1', 'group_sync', ['1']],
    ['.group-sync all', 'group_sync', ['all']]
  ];
  for (const [text, action, args] of cases) {
    const route = routeTelegramUpdate({ message: { from: { id: Number(owner) }, chat: { id: Number(owner), type: 'private' }, text } }, owner);
    assert.equal(route.action, action);
    assert.deepEqual(route.args, args);
  }
});

test('Group UI follows locked classic pagination flow without exposing JID', () => {
  const account = { id: 1, label: 'Akaun 1', status: 'ONLINE', groupCount: 12 };
  const root = groupMessage([account]);
  assert.match(root, /\.group 1/);
  assert.match(root, /\.group-sync all/);
  const list = groupListMessage(account, {
    total: 12, page: 1, totalPages: 2, offset: 0,
    items: [{ subject: 'Marketplace Malaysia', participantCount: 21600, jid: 'secret@g.us' }]
  });
  assert.match(list, /Marketplace Malaysia/);
  assert.match(list, /21,600 Ahli/);
  assert.match(list, /\.group-info 1 1/);
  assert.match(list, /\.group 1 2/);
  assert.doesNotMatch(list, /secret@g\.us/);
  const done = groupSyncCompleteMessage({ account, before: 10, detected: 12, newCount: 2, restoredCount: 0, removedCount: 0 });
  assert.match(done, /SYNC GROUP SELESAI/);
  assert.match(done, /Baru\s+: \+2/);
});


test('Controller startup keeps retrying transient Telegram failures without long backoff', () => {
  const source = readFileSync(join(projectRoot, 'scripts', 'telegram-controller.js'), 'utf8');
  assert.match(source, /while \(!bot\)/);
  assert.match(source, /isTransientTelegramError/);
  assert.match(source, /const retryMs = 3000/);
  assert.match(source, /Telegram belum stabil · cuba lagi/);
  assert.doesNotMatch(source, /timeoutMs:\s*8000/);
  assert.match(source, /Telegram siap · WhatsApp sedang dipulihkan/);
});


test('Controller Q shutdown is visible, resumable and cannot linger on open handles', () => {
  const source = readFileSync(join(projectRoot, 'scripts', 'telegram-controller.js'), 'utf8');
  assert.match(source, /Controller   ● STOPPING/);
  assert.match(source, /function requestStop\(reason = 'USER'\)/);
  assert.match(source, /recoverAutoJoinJobs\(databasePath\)/);
  assert.match(source, /process\.stdin\.off\('data', stopKeyHandler\)/);
  assert.match(source, /setTimeout\(\(\) => process\.exit\(0\), 2500\)/);
  assert.match(source, /process\.exit\(0\)/);
});


test('Controller 24h panel separates process activity from Telegram connectivity', () => {
  const controller = readFileSync(join(projectRoot, 'scripts', 'telegram-controller.js'), 'utf8');
  const menu = readFileSync(join(projectRoot, 'scripts', 'menu.js'), 'utf8');
  assert.match(controller, /Telegram     \${telegramState}/);
  assert.match(controller, /Activity     \${lastAction}/);
  assert.match(controller, /WhatsApp     \${health.online}\/\${accounts.length} ONLINE/);
  assert.match(controller, /Health       \${healthText}/);
  assert.match(controller, /Uptime       \${formatUptime/);
  assert.match(controller, /Keep Alive/);
  assert.match(controller, /Retry        automatik/);
  assert.match(menu, /termuxWakeLock\('lock'\)/);
  assert.match(menu, /termuxWakeLock\('unlock'\)/);
  assert.match(menu, /WAPROMOBOT_WAKE_LOCK/);
});



test('Build 143 health panel does not treat raw Signal warning count as account failure', () => {
  const source = readFileSync(join(projectRoot, 'scripts', 'telegram-controller.js'), 'utf8');
  assert.match(source, /sessionWarningWindow/);
  assert.match(source, /event: 'signal_diagnostic'/);
  assert.doesNotMatch(source, /Session      \${sessionCounterWarnings}/);
  assert.match(source, /Health       \${healthText}/);
});

test('Controller uses resilient Telegram transport states and returns to IDLE after recovery', () => {
  const source = readFileSync(join(projectRoot, 'scripts', 'telegram-controller.js'), 'utf8');
  assert.match(source, /telegramFailureStreak \+= 1/);
  assert.match(source, /telegramRetryDelayMs\(telegramFailureStreak\)/);
  assert.match(source, /telegramFailureStreak === 1/);
  assert.match(source, /telegramConnected = false/);
  assert.match(source, /telegramConnected = true/);
  assert.match(source, /if \(updates.length === 0\) lastAction = 'IDLE'/);
  assert.match(source, /telegramFailureStreak = 0/);
  assert.match(source, /successful long-poll means Telegram connectivity has recovered/);
  assert.doesNotMatch(source, /progressiveRetryBackoffMs\(telegramRetryAttempt\)/);
});

test('Build 144 does not expose a single transient Telegram poll failure as reconnecting', () => {
  const source = readFileSync(join(projectRoot, 'scripts', 'telegram-controller.js'), 'utf8');
  assert.match(source, /One isolated transient poll failure is normal on a mobile network/);
  assert.match(source, /telegramFailureStreak >= 2 && telegramRetryInSec > 0/);
  assert.match(source, /telegramFailureStreak >= 2 && lastError !== '-'/);
  assert.match(source, /telegramMode === 'DEGRADED'/);
});

test('Build 154 hides direct libsignal SessionEntry stdout dumps without changing runtime features', () => {
  const source = readFileSync(join(projectRoot, 'scripts', 'telegram-controller.js'), 'utf8');
  assert.match(source, /originalStdoutWrite = process\.stdout\.write\.bind\(process\.stdout\)/);
  assert.match(source, /Closing stale open session for new outgoing prekey bundle/);
  assert.match(source, /Closing session:/);
  assert.match(source, /SessionEntry/);
  assert.match(source, /process\.stdout\.write = function filteredStdout/);
  assert.match(source, /process\.stdout\.write = originalStdoutWrite/);
  assert.match(source, /currentRatchet\|ephemeralKeyPair/);
});


test('Storage Manager routes cleanup commands and no longer shows NEXT PHASE placeholder', () => {
  for (const target of ['temp', 'logs', 'media', 'all']) {
    const first = routeTelegramUpdate({ message: { from: { id: Number(owner) }, chat: { id: Number(owner), type: 'private' }, text: `.storage-clean ${target}` } }, owner);
    assert.equal(first.action, 'storage_clean');
    assert.deepEqual(first.args, [target]);
    const confirmed = routeTelegramUpdate({ message: { from: { id: Number(owner) }, chat: { id: Number(owner), type: 'private' }, text: `.storage-clean ${target} CONFIRM` } }, owner);
    assert.equal(confirmed.action, 'storage_clean');
    assert.deepEqual(confirmed.args, [target, 'confirm']);
  }
  const screen = storageMessage({ database: '1.00 MB', media: '2.00 MB', reports: '0 B', logs: '4 KB', temp: '1 KB', managedTotal: '3.01 MB', deviceFree: '20.0 GB' });
  assert.match(screen, /STORAGE MANAGER/);
  assert.match(screen, /\.storage-clean all/);
  assert.match(screen, /WhatsApp Session · DILINDUNGI/);
  assert.doesNotMatch(screen, /NEXT PHASE/);
});





test('Legacy Contact commands remain inactive alongside new Follow-Up', () => {
  const master=mainMenuText('WAPromoBot');
  const wa=whatsappMessage([]);
  const help=helpMessage();
  assert.deepEqual(callbacks(controllerKeyboard()), ['wa','join','group','posting_new','posting_active','records','report','system','help']);
  for(const screen of [master,wa,help]) {
    assert.doesNotMatch(screen,/Contact & Follow Up|\.contact/);
  }
  for(const command of ['.contact','.contact-scan','.followup-new','.followup-status 1','.dm-test 1 60123456789 confirm']) {
    const route=routeTelegramUpdate({message:{from:{id:Number(owner)},chat:{id:Number(owner),type:'private'},text:command}},owner);
    assert.equal(route.action,'text',command);
  }
  const retired=routeTelegramUpdate({callback_query:{id:'cb1',from:{id:Number(owner)},data:'fu:status:1',message:{chat:{id:Number(owner),type:'private'}}}},owner);
  assert.equal(retired.action,'home');
});
