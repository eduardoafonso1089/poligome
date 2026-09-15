import assert from 'node:assert/strict';
import test from 'node:test';
import { ViewportController } from '../app/editor/viewport/viewport-controller.ts';
import { pinchZoom } from '../app/lib/touch-gestures.ts';

test('ordinary images keep the historical minimum 400% zoom capacity', () => {
  const controller = new ViewportController({
    viewport: { width: 1000, height: 700 },
    image: { width: 1200, height: 800 },
    zoom: 92,
    scrollLeft: 0,
    scrollTop: 0,
  });
  assert.equal(controller.maxZoom(), 400);
  controller.setZoom(800);
  assert.equal(controller.snapshot().zoom, 400);
});

test('large COG rasters can zoom to two screen pixels per source pixel', () => {
  const controller = new ViewportController({
    viewport: { width: 1000, height: 700 },
    image: { width: 50_000, height: 30_000 },
    zoom: 92,
    scrollLeft: 0,
    scrollTop: 0,
  });
  assert.equal(controller.maxZoom(), 10_000);
  controller.setZoom(20_000);
  assert.equal(controller.snapshot().zoom, 10_000);
});

test('touch pinch can request deep zoom while viewport remains final clamp authority', () => {
  assert.equal(pinchZoom(1000, 100, 800, 10_000), 8000);
  assert.equal(pinchZoom(1000, 100, 2000, 10_000), 10_000);
});
