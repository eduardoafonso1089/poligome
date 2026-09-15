/**
 * The COG import path.
 *
 * Opening a raster needs a File, a decoder and a network, so the behaviour
 * itself is covered by tests/tiled-raster-asset.test.mjs and tests/raster.test.mjs.
 * What is asserted here is that the control keeps using them, keeps the
 * georeference it read, and stays localized.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceOf } from './helpers/source.mjs';

const control = sourceOf('app/editor/import/raster-import-control.tsx');
const workbench = sourceOf('app/editor/workbench/canonical-editor-workbench.tsx');

test('canonical raster control preserves georeference metadata and keeps localized crop mode available', () => {
  assert.match(control, /readRasterSidecars/);
  assert.match(control, /CogCropDialog/);
  assert.match(control, /geo: recorte\.geo/);
  assert.match(control, /URL\.createObjectURL\(recorte\.blob\)/);
  assert.match(control, /getCopy\(language \?\? storedLanguage\(\)\)/);
  assert.match(control, /copy\.cogOpenTiff/);
  assert.match(control, /copy\.cogModeRect/);
});

test('canonical raster control opens local and remote COGs as native tiled assets independent of UI language', () => {
  assert.match(control, /createTiledRasterAsset/);
  assert.match(control, /COG URL/);
  assert.match(control, /new URL\(value\)/);
  // Only http(s): a remote raster is fetched, so no other scheme is accepted.
  assert.match(control, /\^https\?:\$/);
  assert.match(control, /origin: source/);
});

test('canonical workbench installs raster assets and renders tiled COGs behind annotations', () => {
  assert.match(workbench, /RasterImportControl/);
  assert.match(workbench, /CogTiledLayer/);
  assert.match(workbench, /asset\?\.raster\?\.mode === "tiled"/);
  assert.match(workbench, /setAssets\(\(items\) => \[\.\.\.items, result\.asset\]\)/);
  assert.match(workbench, /setCurrent\(result\.asset\.id\)/);
  // The blob URL is tracked so it can be revoked when the project closes.
  assert.match(workbench, /if \(result\.objectUrl\) objectUrls\.current\.push\(result\.objectUrl\)/);
});
