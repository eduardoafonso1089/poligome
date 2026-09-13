import test from 'node:test'; import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs';
test('canonical editor honors persisted language/theme and presentation uses theme tokens',()=>{
  const workbench=readFileSync(new URL('../app/editor/workbench/canonical-editor-workbench.tsx',import.meta.url),'utf8');
  const chrome=readFileSync(new URL('../app/editor/presentation/pre-refactor-chrome.tsx',import.meta.url),'utf8');
  const css=readFileSync(new URL('../app/globals.css',import.meta.url),'utf8');
  assert.match(workbench,/storedLanguage\(\)/); assert.match(workbench,/storedTheme\(\)/); assert.match(workbench,/const copy = getCopy\(language\)/);
  assert.doesNotMatch(workbench,/getCopy\("pt"\)/);
  assert.match(chrome,/localStorage\.setItem\("poligome-theme", mode\)/); assert.match(chrome,/document\.documentElement\.dataset\.theme = mode/);
  assert.match(css,/var\(--paper\)/); assert.match(css,/var\(--canvas-bg\)/); assert.doesNotMatch(workbench,/background: "#111315"/);
});
