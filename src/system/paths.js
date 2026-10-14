import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
export const databasePath = join(projectRoot, 'data', 'wapromobot.sqlite');
export const sessionsPath = join(projectRoot, 'sessions', 'whatsapp');
