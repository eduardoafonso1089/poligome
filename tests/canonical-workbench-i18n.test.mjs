import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workbench = readFileSync(new URL('../app/editor/workbench/canonical-editor-workbench.tsx', import.meta.url), 'utf8');
const chrome = readFileSync(new URL('../app/editor/presentation/pre-refactor-chrome.tsx', import.meta.url), 'utf8');
const coco = readFileSync(new URL('../app/editor/import/coco-import-control.tsx', import.meta.url), 'utf8');
const raster = readFileSync(new URL('../app/editor/import/raster-import-control.tsx', import.meta.url), 'utf8');
const exportsSource = readFileSync(new URL('../app/editor/export/export-controls.tsx', import.meta.url), 'utf8');

test('canonical workbench persists and presentation exposes all supported UI languages', () => {
  assert.match(workbench, /localStorage\.setItem\("poligome-language", next\)/);
  for (const language of ['pt', 'en', 'fr', 'es']) {
    assert.match(chrome, new RegExp(`onLanguageChange\\(\\"${language}\\"\\)`));
  }
  assert.match(chrome, /copy\.language/);
});

test('canonical workbench propagates language to COCO, raster and export controls', () => {
  assert.match(workbench, /<RasterImportControl[^>]*language=\{language\}/s);
  assert.match(workbench, /<CocoImportControl[^>]*language=\{language\}/s);
  assert.match(workbench, /<ExportControls[^>]*language=\{language\}/s);
});

test('standalone canonical controls honor explicit or persisted language', () => {
  for (const source of [coco, raster, exportsSource]) {
    assert.match(source, /getCopy\(language \?\? storedLanguage\(\)\)/);
  }
});
