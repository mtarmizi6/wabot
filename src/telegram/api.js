const DEFAULT_TIMEOUT_MS = 15000;

function cleanError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const code = String(error?.cause?.code || error?.code || '').toUpperCase();
  const safe = message.replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot<hidden>');

  if (/fetch failed|network|socket|tls|dns|getaddrinfo|econnreset|enetunreach|ehostunreach|eai_again/i.test(`${safe} ${code}`)) {
    return 'Sambungan Telegram tidak tersedia. Semak internet dan cuba semula.';
  }
  return safe;
}

export function isTransientTelegramError(error) {
  const value = `${String(error?.message || error || '')} ${String(error?.cause?.code || error?.code || '')}`.toLowerCase();
  return /fetch failed|sambungan telegram|tamat masa|network|socket|tls|dns|getaddrinfo|econnreset|enetunreach|ehostunreach|eai_again|temporary/.test(value);
}

export async function retryTelegramCheck(operation, { attempts = 2, delayMs = 1200, onRetry } = {}) {
  let lastError;
  const total = Math.max(1, Number(attempts) || 1);
  for (let attempt = 1; attempt <= total; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= total || !isTransientTelegramError(error)) throw error;
      onRetry?.(attempt, error);
      await new Promise(resolve => setTimeout(resolve, Math.max(0, Number(delayMs) || 0)));
    }
  }
  throw lastError;
}

export async function telegramRequest(token, method, params = {}, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Fetch API tidak tersedia.');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const externalSignal = options.signal;
  const onExternalAbort = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener?.('abort', onExternalAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
      signal: controller.signal
    });
    let body;
    try { body = await response.json(); }
    catch { throw new Error(`Telegram memberi respons tidak sah (HTTP ${response.status}).`); }
    if (!response.ok || body?.ok !== true) {
      const description = typeof body?.description === 'string' ? body.description : `HTTP ${response.status}`;
      throw new Error(`Telegram API gagal: ${description}`);
    }
    return body.result;
  } catch (error) {
    if (error?.name === 'AbortError') {
      if (externalSignal?.aborted) throw new Error('Permintaan Telegram dibatalkan.');
      throw new Error('Sambungan Telegram tamat masa.');
    }
    throw new Error(cleanError(error));
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener?.('abort', onExternalAbort);
  }
}

export async function getMe(token, options) {
  const bot = await telegramRequest(token, 'getMe', {}, options);
  if (!bot?.is_bot || bot.id == null) throw new Error('Token tidak merujuk kepada bot Telegram yang sah.');
  return {
    id: String(bot.id),
    username: bot.username || '',
    firstName: bot.first_name || 'WAPromoBot'
  };
}

export async function getWebhookInfo(token, options) {
  const info = await telegramRequest(token, 'getWebhookInfo', {}, options);
  return { url: info?.url || '', pendingUpdateCount: Number(info?.pending_update_count || 0) };
}

export async function getUpdates(token, offset, timeout = 20, options = {}) {
  return telegramRequest(token, 'getUpdates', {
    offset,
    timeout,
    allowed_updates: ['message', 'callback_query']
  }, { ...options, timeoutMs: options.timeoutMs ?? Math.max(60000, (timeout + 30) * 1000) });
}

export async function sendMessage(token, chatId, text, options = {}) {
  const { replyMarkup, parseMode, replyToMessageId, ...requestOptions } = options;
  const params = {
    chat_id: chatId,
    text,
    disable_web_page_preview: true
  };
  if (parseMode) params.parse_mode = parseMode;
  if (replyMarkup) params.reply_markup = replyMarkup;
  if (Number.isSafeInteger(Number(replyToMessageId)) && Number(replyToMessageId) > 0) {
    params.reply_parameters = { message_id: Number(replyToMessageId), allow_sending_without_reply: true };
  }
  return telegramRequest(token, 'sendMessage', params, requestOptions);
}

export async function answerCallbackQuery(token, callbackQueryId, options = {}) {
  return telegramRequest(token, 'answerCallbackQuery', {
    callback_query_id: callbackQueryId
  }, options);
}

export async function sendPhotoBuffer(token, chatId, buffer, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Fetch API tidak tersedia.');
  const controller = new AbortController();
  const externalSignal = options.signal;
  const onExternalAbort = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener?.('abort', onExternalAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20000);
  try {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('photo', new Blob([buffer], { type: options.mimeType || 'image/png' }), options.filename || 'wapromobot-image.png');
    if (options.caption) form.append('caption', options.caption);
    if (options.parseMode) form.append('parse_mode', options.parseMode);
    if (options.replyMarkup) form.append('reply_markup', JSON.stringify(options.replyMarkup));
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: 'POST', body: form, signal: controller.signal
    });
    const body = await response.json();
    if (!response.ok || body?.ok !== true) throw new Error(`Telegram API gagal: ${body?.description || `HTTP ${response.status}`}`);
    return body.result;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(externalSignal?.aborted ? 'Permintaan Telegram dibatalkan.' : 'Sambungan Telegram tamat masa.');
    throw new Error(cleanError(error));
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener?.('abort', onExternalAbort);
  }
}

export async function sendVideoBuffer(token, chatId, buffer, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Fetch API tidak tersedia.');
  const controller = new AbortController();
  const externalSignal = options.signal;
  const onExternalAbort = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener?.('abort', onExternalAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30000);
  try {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('video', new Blob([buffer], { type: options.mimeType || 'video/mp4' }), options.filename || 'wapromobot-video.mp4');
    if (options.caption) form.append('caption', options.caption);
    if (options.parseMode) form.append('parse_mode', options.parseMode);
    if (options.replyMarkup) form.append('reply_markup', JSON.stringify(options.replyMarkup));
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendVideo`, {
      method: 'POST', body: form, signal: controller.signal
    });
    const body = await response.json();
    if (!response.ok || body?.ok !== true) throw new Error(`Telegram API gagal: ${body?.description || `HTTP ${response.status}`}`);
    return body.result;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(externalSignal?.aborted ? 'Permintaan Telegram dibatalkan.' : 'Sambungan Telegram tamat masa.');
    throw new Error(cleanError(error));
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener?.('abort', onExternalAbort);
  }
}

export async function getFileInfo(token, fileId, options = {}) {
  const result = await telegramRequest(token, 'getFile', { file_id: String(fileId) }, options);
  if (!result?.file_path) throw new Error('Telegram tidak memulangkan lokasi fail.');
  return { fileId: String(result.file_id || fileId), filePath: String(result.file_path), fileSize: Number(result.file_size || 0) };
}

export async function downloadTelegramFile(token, filePath, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Fetch API tidak tersedia.');
  const controller = new AbortController();
  const externalSignal = options.signal;
  const onExternalAbort = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener?.('abort', onExternalAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20000);
  try {
    const response = await fetchImpl(`https://api.telegram.org/file/bot${token}/${String(filePath).replace(/^\/+/, '')}`, {
      method: 'GET', signal: controller.signal
    });
    if (!response.ok) throw new Error(`Telegram file download gagal (HTTP ${response.status}).`);
    const bytes = await response.arrayBuffer();
    return Buffer.from(bytes);
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(externalSignal?.aborted ? 'Permintaan Telegram dibatalkan.' : 'Muat turun fail tamat masa.');
    throw new Error(cleanError(error));
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener?.('abort', onExternalAbort);
  }
}

export async function editMessageText(token, chatId, messageId, text, options = {}) {
  const { replyMarkup, parseMode, ...requestOptions } = options;
  const params = {
    chat_id: chatId,
    message_id: Number(messageId),
    text,
    disable_web_page_preview: true
  };
  if (parseMode) params.parse_mode = parseMode;
  if (replyMarkup) params.reply_markup = replyMarkup;
  return telegramRequest(token, 'editMessageText', params, requestOptions);
}

export async function sendDocumentBuffer(token, chatId, buffer, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Fetch API tidak tersedia.');
  const controller = new AbortController();
  const externalSignal = options.signal;
  const onExternalAbort = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener?.('abort', onExternalAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30000);
  try {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('document', new Blob([buffer], { type: options.mimeType || 'text/plain' }), options.filename || 'WAPromoBot-Report.txt');
    if (options.caption) form.append('caption', String(options.caption));
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendDocument`, { method: 'POST', body: form, signal: controller.signal });
    const body = await response.json();
    if (!response.ok || body?.ok !== true) throw new Error(`Telegram API gagal: ${body?.description || `HTTP ${response.status}`}`);
    return body.result;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(externalSignal?.aborted ? 'Permintaan Telegram dibatalkan.' : 'Sambungan Telegram tamat masa.');
    throw new Error(cleanError(error));
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener?.('abort', onExternalAbort);
  }
}

export async function editPhotoBuffer(token, chatId, messageId, buffer, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Fetch API tidak tersedia.');
  const controller = new AbortController();
  const externalSignal = options.signal;
  const onExternalAbort = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener?.('abort', onExternalAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20000);
  try {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('message_id', String(messageId));
    form.append('media', JSON.stringify({ type:'photo', media:'attach://photo', caption:options.caption || '', ...(options.parseMode ? { parse_mode:options.parseMode } : {}) }));
    form.append('photo', new Blob([buffer], { type: options.mimeType || 'image/png' }), options.filename || 'wapromobot-image.png');
    if (options.replyMarkup) form.append('reply_markup', JSON.stringify(options.replyMarkup));
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/editMessageMedia`, {
      method: 'POST', body: form, signal: controller.signal
    });
    const body = await response.json();
    if (!response.ok || body?.ok !== true) throw new Error(`Telegram API gagal: ${body?.description || `HTTP ${response.status}`}`);
    return body.result;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(externalSignal?.aborted ? 'Permintaan Telegram dibatalkan.' : 'Sambungan Telegram tamat masa.');
    throw new Error(cleanError(error));
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener?.('abort', onExternalAbort);
  }
}


export async function deleteTelegramMessage(token, chatId, messageId, options = {}) {
  return telegramRequest(token, 'deleteMessage', { chat_id:chatId, message_id:messageId }, options);
}
