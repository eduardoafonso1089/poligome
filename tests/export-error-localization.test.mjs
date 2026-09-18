import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceOf } from './helpers/source.mjs';

const controls = sourceOf('app/editor/export/export-controls.tsx');
const raster = sourceOf('app/editor/import/raster-import-control.tsx');
const tiled = sourceOf('app/editor/raster/cog-tiled-layer.tsx');

test('new canonical controls translate thrown domain codes before showing UI text', () => {
  // The message the user reads must come from the locale, never from the text
  // of an Error thrown deep in a codec. tests/localized-error-message.test.mjs
  // covers the translation itself.
  for (const source of [controls, raster, tiled]) assert.match(source, /translateErrorCode/);
  assert.doesNotMatch(controls, /onMessage\?\.\(error instanceof Error \? error\.message/);
  assert.doesNotMatch(raster, /: error instanceof Error \? error\.message/);
  assert.doesNotMatch(tiled, /Falha ao abrir COG tiled/);
});

test('YOLO archive README uses the active locale copy', () => {
  assert.match(controls, /exportEditorYoloZip\(assets, labels, annotations, copy\.yoloReadme,/);
});
