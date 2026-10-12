import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));

export const DIRS = {
  characters: path.join(DATA, 'characters'),
  chats: path.join(DATA, 'chats'),
  groups: path.join(DATA, 'groups'),
  groupChats: path.join(DATA, 'group-chats'),
  personas: path.join(DATA, 'personas'),
  lorebooks: path.join(DATA, 'lorebooks'),
};

export const SETTINGS_FILE = path.join(DATA, 'settings.json');
export const OPENROUTER_BASE = process.env.OPENROUTER_BASE || 'https://openrouter.ai/api/v1';

export function ensureDirs() {
  for (const dir of Object.values(DIRS)) fs.mkdirSync(dir, { recursive: true });
}
