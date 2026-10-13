import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Idiomas con las mismas claves y marcadores, y todas las claves usadas en el código definidas.
test('i18n: los idiomas están completos y coherentes (scripts/check-i18n.mjs)', () => {
  const out = execFileSync(process.execPath, [path.join('scripts', 'check-i18n.mjs')], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
  assert.match(out, /i18n OK/);
});
