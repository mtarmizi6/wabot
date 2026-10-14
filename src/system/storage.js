import { DatabaseSync } from 'node:sqlite';
import {
  existsSync,
  lstatSync,
  readdirSync,
  rmSync,
  statSync,
  statfsSync
} from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';

const MEDIA_ORPHAN_MIN_AGE_MS = 10 * 60 * 1000;
const TEMP_KEEP_NAMES = new Set(['telegram-controller.lock']);

function safeLstat(path) {
  try { return lstatSync(path); } catch { return null; }
}

function isInside(root, target) {
  const base = resolve(root);
  const value = resolve(target);
  return value === base || value.startsWith(base + sep);
}

export function bytesToHuman(value = 0) {
  const bytes = Math.max(0, Number(value || 0));
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = bytes / 1024;
  let unit = units[0];
  for (let i = 1; i < units.length && size >= 1024; i += 1) {
    size /= 1024;
    unit = units[i];
  }
  const digits = size >= 100 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(digits)} ${unit}`;
}

export function pathSize(path) {
  const info = safeLstat(path);
  if (!info || info.isSymbolicLink()) return 0;
  if (info.isFile()) return Number(info.size || 0);
  if (!info.isDirectory()) return 0;
  let total = 0;
  let entries = [];
  try { entries = readdirSync(path, { withFileTypes: true }); } catch { return 0; }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    total += pathSize(join(path, entry.name));
  }
  return total;
}

function fileSize(path) {
  try { return Number(statSync(path).size || 0); } catch { return 0; }
}

function databaseStorageSize(databasePath) {
  return fileSize(databasePath) + fileSize(`${databasePath}-wal`) + fileSize(`${databasePath}-shm`);
}

function filesystemSpace(path) {
  try {
    const info = statfsSync(path);
    const blockSize = Number(info.bsize || info.frsize || 0);
    return {
      total: Number(info.blocks || 0) * blockSize,
      free: Number(info.bavail ?? info.bfree ?? 0) * blockSize
    };
  } catch {
    return { total: 0, free: 0 };
  }
}

export function storageSnapshot(projectRoot, databasePath) {
  const media = pathSize(join(projectRoot, 'media', 'postings'));
  const reports = pathSize(join(projectRoot, 'reports'));
  const logs = pathSize(join(projectRoot, 'logs'));
  const temp = pathSize(join(projectRoot, 'temp')) + pathSize(join(projectRoot, 'cache'));
  const database = databaseStorageSize(databasePath);
  const managedTotal = database + media + reports + logs + temp;
  const fs = filesystemSpace(projectRoot);
  return {
    database,
    media,
    reports,
    logs,
    temp,
    managedTotal,
    deviceFree: fs.free,
    deviceTotal: fs.total
  };
}

function deleteTreeContents(root, { keepNames = new Set(), minAgeMs = 0, nowMs = Date.now() } = {}) {
  const base = resolve(root);
  if (!existsSync(base)) return { files: 0, bytes: 0 };
  let files = 0;
  let bytes = 0;

  function visit(path, topLevel = false) {
    const info = safeLstat(path);
    if (!info || info.isSymbolicLink()) return false;
    if (!isInside(base, path)) return false;

    if (info.isFile()) {
      if (topLevel && keepNames.has(basename(path))) return false;
      if (minAgeMs > 0 && nowMs - Number(info.mtimeMs || 0) < minAgeMs) return false;
      const size = Number(info.size || 0);
      try {
        rmSync(path, { force: true });
        files += 1;
        bytes += size;
        return true;
      } catch { return false; }
    }

    if (!info.isDirectory()) return false;
    let entries = [];
    try { entries = readdirSync(path, { withFileTypes: true }); } catch { return false; }
    for (const entry of entries) visit(join(path, entry.name), path === base);
    if (path !== base) {
      try {
        if (readdirSync(path).length === 0) rmSync(path, { recursive: false, force: true });
      } catch {}
    }
    return true;
  }

  visit(base);
  return { files, bytes };
}

export function cleanTempCache(projectRoot) {
  const temp = deleteTreeContents(join(projectRoot, 'temp'), { keepNames: TEMP_KEEP_NAMES });
  const cache = deleteTreeContents(join(projectRoot, 'cache'));
  return { files: temp.files + cache.files, bytes: temp.bytes + cache.bytes };
}

export function cleanLogs(projectRoot) {
  return deleteTreeContents(join(projectRoot, 'logs'));
}

export function referencedPostingMedia(databasePath) {
  const paths = new Set();
  if (!existsSync(databasePath)) return paths;
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout = 5000;');
    for (const table of ['posting_ads', 'posting_job_ads']) {
      const exists = db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?").get(table);
      if (!exists) continue;
      for (const row of db.prepare(`SELECT media_path AS mediaPath FROM ${table} WHERE media_path IS NOT NULL`).all()) {
        const value = String(row.mediaPath || '').trim().replaceAll('\\', '/');
        if (value.startsWith('media/postings/') && !value.includes('..')) paths.add(value);
      }
    }
  } finally {
    db.close();
  }
  return paths;
}

export function cleanOrphanPostingMedia(projectRoot, databasePath, { nowMs = Date.now(), minAgeMs = MEDIA_ORPHAN_MIN_AGE_MS } = {}) {
  const mediaRoot = join(projectRoot, 'media', 'postings');
  if (!existsSync(mediaRoot)) return { files: 0, bytes: 0, skippedRecent: 0, referenced: 0 };
  const referenced = referencedPostingMedia(databasePath);
  const base = resolve(mediaRoot);
  let files = 0;
  let bytes = 0;
  let skippedRecent = 0;

  function visit(path) {
    const info = safeLstat(path);
    if (!info || info.isSymbolicLink() || !isInside(base, path)) return;
    if (info.isFile()) {
      const rel = relative(projectRoot, path).split(sep).join('/');
      if (referenced.has(rel)) return;
      if (nowMs - Number(info.mtimeMs || 0) < minAgeMs) {
        skippedRecent += 1;
        return;
      }
      const size = Number(info.size || 0);
      try {
        rmSync(path, { force: true });
        files += 1;
        bytes += size;
      } catch {}
      return;
    }
    if (!info.isDirectory()) return;
    let entries = [];
    try { entries = readdirSync(path, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) visit(join(path, entry.name));
    if (path !== base) {
      try {
        if (readdirSync(path).length === 0) rmSync(path, { recursive: false, force: true });
      } catch {}
    }
  }

  visit(base);
  return { files, bytes, skippedRecent, referenced: referenced.size };
}

export function cleanManagedStorage(projectRoot, databasePath) {
  const temp = cleanTempCache(projectRoot);
  const logs = cleanLogs(projectRoot);
  const media = cleanOrphanPostingMedia(projectRoot, databasePath);
  return {
    files: temp.files + logs.files + media.files,
    bytes: temp.bytes + logs.bytes + media.bytes,
    temp,
    logs,
    media
  };
}
