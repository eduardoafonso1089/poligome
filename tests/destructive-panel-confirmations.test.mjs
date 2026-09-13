import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app/editor/panels/editor-management-panels.tsx', import.meta.url), 'utf8');

test('destructive panel actions require explicit confirmation', () => {
  assert.match(source, /function confirmAnnotationDelete/);
  assert.match(source, /function confirmAssetDelete/);
  assert.match(source, /function confirmLabelDelete/);
  assert.match(source, /window\.confirm/);
  assert.match(source, /copy\.confirmDeleteAnnotations/);
  assert.match(source, /copy\.deleteAnnotationsWarning/);
  assert.match(source, /copy\.confirmDeleteClass/);
  assert.match(source, /copy\.deleteClassWarning/);
});

test('visible delete controls route through confirmation helpers', () => {
  assert.match(source, /currentAsset && confirmAssetDelete\(currentAsset,/);
  assert.match(source, /confirmAnnotationDelete\(activeSelectedIds\)/);
  assert.match(source, /confirmAnnotationDelete\(\[annotation\.id\]\)/);
  assert.match(source, /confirmLabelDelete\(label\)/);
});

test('editor management surface has a localized application accessibility label', () => {
  assert.match(source, /aria-label=\{`\$\{copy\.appTitle\}/);
});
