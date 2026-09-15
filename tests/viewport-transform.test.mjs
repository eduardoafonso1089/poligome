import test from 'node:test';
import assert from 'node:assert/strict';
import { ViewportTransform } from '../app/lib/editor-viewport.ts';

test('screen -> image -> screen is reversible', () => {
  const transform = new ViewportTransform(
    { left: 50, top: 25, width: 800, height: 520 },
    { width: 1920, height: 1080 },
  );
  const screen = { x: 410, y: 251 };
  const image = transform.screenToImage(screen);
  const restored = transform.imageToScreen(image);
  assert.ok(Math.abs(restored.x - screen.x) < 1e-9);
  assert.ok(Math.abs(restored.y - screen.y) < 1e-9);
});

test('screen coordinates clamp directly to source-image bounds', () => {
  const transform = new ViewportTransform(
    { left: 100, top: 100, width: 500, height: 325 },
    { width: 4032, height: 3024 },
  );
  assert.deepEqual(transform.screenToImage({ x: -100, y: 1000 }), { x: 0, y: 3024 });
});

test('screen deltas scale with source-image resolution', () => {
  const low = new ViewportTransform(
    { left: 0, top: 0, width: 500, height: 300 },
    { width: 1000, height: 600 },
  );
  const high = new ViewportTransform(
    { left: 0, top: 0, width: 500, height: 300 },
    { width: 8000, height: 4800 },
  );
  assert.deepEqual(low.screenDeltaToImage(10, 5), { x: 20, y: 10 });
  assert.deepEqual(high.screenDeltaToImage(10, 5), { x: 160, y: 80 });
});

test('unclamped screen mapping can represent points outside the image', () => {
  const transform = new ViewportTransform(
    { left: 10, top: 20, width: 100, height: 50 },
    { width: 1000, height: 500 },
  );
  assert.deepEqual(transform.screenToImage({ x: 0, y: 10 }, false), { x: -100, y: -100 });
});
