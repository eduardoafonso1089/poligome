import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { relinkMissingAssets } from '../app/editor/session/image-assets.ts';

function installImageMock(width, height) {
  const originalImage = globalThis.Image;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  let next = 0;
  globalThis.Image = class {
    naturalWidth = width;
    naturalHeight = height;
    onload = null;
    onerror = null;
    set src(_value) { queueMicrotask(() => this.onload?.()); }
  };
  URL.createObjectURL = () => `blob:relink-${++next}`;
  URL.revokeObjectURL = () => {};
  return () => {
    globalThis.Image = originalImage;
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  };
}

test('annotation-only relink preserves asset id and reconnects by basename', async () => {
  const restore = installImageMock(640, 480);
  try {
    const assets = [{ id: 'image-stable', name: 'Photo.JPG', src: '', local: true, missing: true, width: 640, height: 480 }];
    const file = new File(['pixels'], 'photo.jpg', { type: 'image/jpeg' });
    const result = await relinkMissingAssets(assets, [file]);
    assert.deepEqual(result.restoredIds, ['image-stable']);
    assert.equal(result.assets[0].id, 'image-stable');
    assert.equal(result.assets[0].missing, false);
    assert.equal(result.assets[0].width, 640);
    assert.equal(result.assets[0].height, 480);
    assert.equal(result.rejected.length, 0);
    assert.equal(result.objectUrls.length, 1);
  } finally { restore(); }
});

test('annotation-only relink refuses a same-named image with incompatible dimensions', async () => {
  const restore = installImageMock(320, 240);
  try {
    const assets = [{ id: 'image-stable', name: 'photo.jpg', src: '', local: true, missing: true, width: 640, height: 480 }];
    const file = new File(['pixels'], 'photo.jpg', { type: 'image/jpeg' });
    const result = await relinkMissingAssets(assets, [file]);
    assert.deepEqual(result.restoredIds, []);
    assert.equal(result.assets[0].missing, true);
    assert.deepEqual(result.rejected, [file]);
  } finally { restore(); }
});

test('canonical workbench exposes relink only for missing project assets', () => {
  const source = readFileSync(new URL('../app/editor/workbench/canonical-editor-workbench.tsx', import.meta.url), 'utf8');
  assert.match(source, /relinkMissingAssets/);
  assert.match(source, /!missingImageCount/);
  assert.match(source, /asset\?\.missing/);
  assert.match(source, /copy\.reloadProjectImages/);
  assert.match(source, /relinkInputRef/);
});
