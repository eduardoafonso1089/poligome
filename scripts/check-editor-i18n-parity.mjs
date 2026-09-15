import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['app/editor', 'app/raster', 'app/annotate'];
const keyPattern = /\bcopy\.([A-Za-z0-9_]+)/g;
const keysFrom = (source) => new Set([...source.matchAll(keyPattern)].map((match) => match[1]));

const mainFiles = execFileSync('git', ['ls-tree', '-r', '--name-only', 'origin/main', '--', ...roots], { encoding: 'utf8' })
  .trim().split('\n').filter((file) => /\.[cm]?[jt]sx?$/.test(file));
const mainKeys = new Set();
for (const file of mainFiles) {
  const source = execFileSync('git', ['show', `origin/main:${file}`], { encoding: 'utf8' });
  for (const key of keysFrom(source)) mainKeys.add(key);
}

const currentKeys = new Set();
function walk(path) {
  for (const name of readdirSync(path)) {
    const full = join(path, name);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full);
    else if (/\.[cm]?[jt]sx?$/.test(name)) {
      for (const key of keysFrom(readFileSync(full, 'utf8'))) currentKeys.add(key);
    }
  }
}
for (const root of roots) walk(root);

const missing = [...mainKeys].filter((key) => !currentKeys.has(key)).sort();
if (missing.length) {
  console.error('Editor i18n regression gate failed.');
  console.error('Keys consumed by canonical main but missing from this branch:', missing.join(', '));
  process.exit(1);
}

console.log(`Editor i18n regression gate passed: ${currentKeys.size} key(s) consumed; canonical main baseline ${mainKeys.size}.`);
