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

/**
 * Surfaces this branch removed on purpose, with the change that retired them.
 *
 * The gate catches a key that silently stops being consumed. A deliberate
 * removal is recorded here so it stays reviewable, instead of relaxing the
 * comparison for every key.
 */
const retiredKeys = {
  // Every new .plgm is annotation-only, so the save dialog that let the user
  // choose between a lightweight file and a bundled-image project is gone.
  "annotation-only project save": [
    "annotationsOnly", "annotationsOnlyHint", "generateProjectFile", "imageReferences",
    "imagesAndAnnotations", "imagesAndAnnotationsHint", "projectSavePrivacy",
    "saveProjectDescription", "saveProjectTitle", "sizeCalculatedOnSave",
  ],
};
const retired = new Set(Object.values(retiredKeys).flat());

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

const missing = [...mainKeys].filter((key) => !currentKeys.has(key) && !retired.has(key)).sort();
if (missing.length) {
  console.error('Editor i18n regression gate failed.');
  console.error('Keys consumed by canonical main but missing from this branch:', missing.join(', '));
  process.exit(1);
}

const revived = [...retired].filter((key) => currentKeys.has(key)).sort();
if (revived.length) {
  console.error('Editor i18n regression gate failed.');
  console.error('Keys listed as retired but consumed again; drop them from retiredKeys:', revived.join(', '));
  process.exit(1);
}

console.log(`Editor i18n regression gate passed: ${currentKeys.size} key(s) consumed; canonical main baseline ${mainKeys.size}; ${retired.size} retired.`);
