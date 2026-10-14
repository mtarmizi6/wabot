import { spawnSync } from 'node:child_process';

export function progressiveRetryBackoffMs(attempt = 1, random = Math.random) {
  const steps = [2500, 5000, 10000, 30000, 60000];
  const index = Math.max(0, Math.min(steps.length - 1, Number(attempt || 1) - 1));
  const base = steps[index];
  const value = Number(random());
  const safe = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
  const factor = 0.85 + (safe * 0.30);
  return Math.max(1500, Math.round(base * factor));
}


export function telegramRetryDelayMs(failureStreak = 1) {
  const streak = Math.max(1, Number(failureStreak) || 1);
  if (streak === 1) return 1000;
  if (streak === 2) return 2000;
  if (streak === 3) return 3000;
  return 5000;
}

export function telegramTransportState(failureStreak = 0) {
  const streak = Math.max(0, Number(failureStreak) || 0);
  if (streak >= 3) return 'RECONNECTING';
  if (streak === 2) return 'DEGRADED';
  return 'CONNECTED';
}

export function formatUptime(ms = 0) {
  const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = value => String(value).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export function termuxWakeLock(action = 'lock', runner = spawnSync) {
  const command = action === 'unlock' ? 'termux-wake-unlock' : 'termux-wake-lock';
  try {
    const result = runner(command, [], {
      stdio: 'ignore',
      timeout: 1500,
      env: process.env
    });
    return !result?.error && Number(result?.status ?? 0) === 0;
  } catch {
    return false;
  }
}
