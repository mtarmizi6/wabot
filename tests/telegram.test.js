import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getMe, getWebhookInfo, getUpdates, sendMessage, sendPhotoBuffer, sendVideoBuffer, answerCallbackQuery, retryTelegramCheck } from '../src/telegram/api.js';
import { saveTelegramState, loadTelegramState, isTelegramStateCurrent, tokenFingerprint } from '../src/telegram/state.js';

const token = '123456789:' + 'x'.repeat(35);
const config = { schemaVersion: 1, telegram: { botToken: token, ownerUserId: '123456789' } };

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

test('Telegram getMe accepts valid bot response without exposing token', async () => {
  const bot = await getMe(token, { fetchImpl: async () => response({ ok: true, result: { id: 777, is_bot: true, username: 'DemoBot', first_name: 'Demo' } }) });
  assert.deepEqual(bot, { id: '777', username: 'DemoBot', firstName: 'Demo' });
});

test('Telegram API error does not expose bot token', async () => {
  await assert.rejects(
    getMe(token, { fetchImpl: async () => response({ ok: false, description: `bad bot${token}` }, 401) }),
    error => !error.message.includes(token)
  );
});

test('Webhook status is normalized', async () => {
  const info = await getWebhookInfo(token, { fetchImpl: async () => response({ ok: true, result: { url: '', pending_update_count: 2 } }) });
  assert.deepEqual(info, { url: '', pendingUpdateCount: 2 });
});

test('Telegram verification state is private and bound to current config', t => {
  const dir = mkdtempSync(join(tmpdir(), 'wapromobot-telegram-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'state.json');
  const state = saveTelegramState({
    schemaVersion: 1,
    botId: '777',
    botUsername: 'DemoBot',
    botFirstName: 'Demo',
    ownerUserId: config.telegram.ownerUserId,
    tokenFingerprint: tokenFingerprint(token),
    verifiedAt: new Date().toISOString()
  }, path);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.deepEqual(loadTelegramState(path), state);
  assert.equal(isTelegramStateCurrent(config, state), true);
  assert.equal(isTelegramStateCurrent({ ...config, telegram: { ...config.telegram, ownerUserId: '999' } }, state), false);
});


test('Telegram sendMessage supports polished HTML command UI without leaking token', async () => {
  let request;
  await sendMessage(token, '123456789', '<b>WhatsApp</b>\n→ <code>.accounts</code>', {
    parseMode: 'HTML',
    fetchImpl: async (url, options) => {
      request = { url, body: JSON.parse(options.body) };
      return response({ ok: true, result: { message_id: 1 } });
    }
  });
  assert.equal(request.body.chat_id, '123456789');
  assert.equal(request.body.parse_mode, 'HTML');
  assert.equal(request.body.reply_markup, undefined);
  assert.equal(JSON.stringify(request.body).includes(token), false);
});

test('Telegram callback query acknowledgement uses callback id', async () => {
  let body;
  await answerCallbackQuery(token, 'cb-123', {
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return response({ ok: true, result: true });
    }
  });
  assert.equal(body.callback_query_id, 'cb-123');
});

test('manual campaign feedback replies to the dashboard and tolerates a deleted original message', async () => {
 let body;
 await sendMessage(token,'123456789','Info kempen',{parseMode:'HTML',replyToMessageId:42,fetchImpl:async(_url,options)=>{body=JSON.parse(options.body);return response({ok:true,result:{message_id:43}});}});
 assert.deepEqual(body.reply_parameters,{message_id:42,allow_sending_without_reply:true});assert.equal(body.reply_markup,undefined);assert.equal(body.parse_mode,'HTML');
});


test('Telegram fetch failures are converted to a short user-facing connection message', async () => {
  await assert.rejects(
    getMe(token, { fetchImpl: async () => { throw new TypeError('fetch failed'); } }),
    error => /Sambungan Telegram tidak tersedia/.test(error.message) && !/fetch failed/i.test(error.message)
  );
});

test('Telegram connectivity check retries transient failures once then succeeds', async () => {
  let attempts = 0;
  const value = await retryTelegramCheck(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('Sambungan Telegram tidak tersedia. Semak internet dan cuba semula.');
    return 'ok';
  }, { attempts: 2, delayMs: 0 });
  assert.equal(value, 'ok');
  assert.equal(attempts, 2);
});


test('Telegram long-poll keeps a generous client timeout above the server poll window', async () => {
  let abortedAtStart = false;
  let body;
  await getUpdates(token, 10, 25, {
    fetchImpl: async (_url, options) => {
      abortedAtStart = options.signal.aborted;
      body = JSON.parse(options.body);
      return response({ ok: true, result: [] });
    }
  });
  assert.equal(abortedAtStart, false);
  assert.equal(body.timeout, 25);
  assert.equal(body.offset, 10);
});


test('Build 146 Telegram media preview supports real URL buttons on photo and video', async () => {
  const seen = [];
  const fetchImpl = async (_url, options) => {
    const markup = options.body.get('reply_markup');
    seen.push({ markup: markup ? JSON.parse(markup) : null, caption: options.body.get('caption') });
    return response({ ok: true, result: { message_id: seen.length } });
  };
  const replyMarkup = { inline_keyboard: [[{ text: 'WhatsApp Saya', url: 'https://wa.me/60123456789' }]] };
  await sendPhotoBuffer(token, '123456789', Buffer.from('photo'), { caption: 'Foto', replyMarkup, fetchImpl });
  await sendVideoBuffer(token, '123456789', Buffer.from('video'), { caption: 'Video', replyMarkup, fetchImpl });
  assert.deepEqual(seen[0].markup, replyMarkup);
  assert.deepEqual(seen[1].markup, replyMarkup);
  assert.equal(seen[0].caption, 'Foto');
  assert.equal(seen[1].caption, 'Video');
});
