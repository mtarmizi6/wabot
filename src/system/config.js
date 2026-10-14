import { readFileSync, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { projectRoot } from './paths.js';

export const configPath = join(projectRoot, 'config', 'settings.json');

export function validateConfig(input) {
  if (input?.schemaVersion !== 1) throw new Error('Versi tetapan tidak disokong.');
  const token = input.telegram?.botToken;
  const userId = input.telegram?.ownerUserId;
  if (typeof token !== 'string' || !/^[0-9]{5,20}:[A-Za-z0-9_-]{20,200}$/.test(token)) {
    throw new Error('Format Bot Token tidak sah. Salin token penuh daripada BotFather.');
  }
  if (typeof userId !== 'string' || !/^[1-9][0-9]{0,15}$/.test(userId) || !Number.isSafeInteger(Number(userId))) {
    throw new Error('User ID mesti nombor positif, bukan username atau nombor telefon berawalan +.');
  }
  return { schemaVersion: 1, telegram: { botToken: token, ownerUserId: userId } };
}

export function loadConfig(path = configPath) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error('Tetapan tidak dapat dibaca.');
  }
  try { return validateConfig(JSON.parse(raw)); }
  catch { throw new Error('Fail tetapan tidak sah. Fail asal dikekalkan untuk semakan.'); }
}

export function saveConfig(input, path = configPath) {
  const validated = validateConfig(input);
  // Refuse to silently replace unreadable, corrupt or future configuration.
  loadConfig(path);
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `.settings-${randomUUID()}.tmp`);
  let fd;
  try {
    fd = openSync(temporary, 'wx', 0o600);
    writeFileSync(fd, JSON.stringify(validated, null, 2) + '\n');
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, path);
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
