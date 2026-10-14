import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { projectRoot } from '../system/paths.js';

export const telegramStatePath = join(projectRoot, 'config', 'telegram-state.json');

export function tokenFingerprint(token) {
  return createHash('sha256').update(token).digest('hex').slice(0, 16);
}

export function validateTelegramState(input) {
  if (input?.schemaVersion !== 1) throw new Error('Versi status Telegram tidak disokong.');
  if (!/^\d{1,20}$/.test(input.botId || '')) throw new Error('Bot ID tidak sah.');
  if (typeof input.botUsername !== 'string' || input.botUsername.length > 64) throw new Error('Username bot tidak sah.');
  if (!/^[1-9][0-9]{0,15}$/.test(input.ownerUserId || '')) throw new Error('Owner ID tidak sah.');
  if (!/^[a-f0-9]{16}$/.test(input.tokenFingerprint || '')) throw new Error('Fingerprint token tidak sah.');
  if (Number.isNaN(Date.parse(input.verifiedAt))) throw new Error('Masa pengesahan tidak sah.');
  return {
    schemaVersion: 1,
    botId: input.botId,
    botUsername: input.botUsername,
    botFirstName: String(input.botFirstName || ''),
    ownerUserId: input.ownerUserId,
    tokenFingerprint: input.tokenFingerprint,
    verifiedAt: input.verifiedAt
  };
}

export function loadTelegramState(path = telegramStatePath) {
  try { return validateTelegramState(JSON.parse(readFileSync(path, 'utf8'))); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error('Status Telegram tidak dapat dibaca.');
  }
}

export function saveTelegramState(input, path = telegramStatePath) {
  const value = validateTelegramState(input);
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `.telegram-${randomUUID()}.tmp`);
  let fd;
  try {
    fd = openSync(temporary, 'wx', 0o600);
    writeFileSync(fd, JSON.stringify(value, null, 2) + '\n');
    fsyncSync(fd);
    closeSync(fd); fd = undefined;
    renameSync(temporary, path);
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return value;
}

export function isTelegramStateCurrent(config, state) {
  return Boolean(config && state &&
    state.ownerUserId === config.telegram.ownerUserId &&
    state.tokenFingerprint === tokenFingerprint(config.telegram.botToken));
}
