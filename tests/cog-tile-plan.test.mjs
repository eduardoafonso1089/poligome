import assert from 'node:assert/strict';
import test from 'node:test';
import { planRasterTiles } from '../app/editor/raster/tile-plan.ts';

test('plans only visible COG tiles plus one-tile overscan', () => {
  const tiles = planRasterTiles({
    sourceWidth: 10000,
    sourceHeight: 8000,
    renderedWidth: 10000,
    renderedHeight: 8000,
    canvasLeft: 0,
    canvasTop: 0,
    scrollLeft: 2048,
    scrollTop: 1024,
    viewportWidth: 1024,
    viewportHeight: 768,
  });
  assert.ok(tiles.length > 0);
  assert.ok(tiles.length < 60, `too many tiles: ${tiles.length}`);
  assert.ok(tiles.some((tile) => tile.x <= 2048 && tile.x + tile.width >= 2048));
  assert.ok(tiles.every((tile) => tile.reduction === 1));
});

test('uses power-of-two source reduction when raster is zoomed out', () => {
  const tiles = planRasterTiles({
    sourceWidth: 16000,
    sourceHeight: 12000,
    renderedWidth: 2000,
    renderedHeight: 1500,
    canvasLeft: 0,
    canvasTop: 0,
    scrollLeft: 0,
    scrollTop: 0,
    viewportWidth: 1000,
    viewportHeight: 750,
  });
  assert.ok(tiles.length > 0);
  assert.ok(tiles.every((tile) => tile.reduction === 8));
  assert.ok(tiles.every((tile) => tile.outputWidth <= 256 && tile.outputHeight <= 256));
});

test('tile keys remain stable for small viewport movements inside the same grid', () => {
  const base = {
    sourceWidth: 12000,
    sourceHeight: 8000,
    renderedWidth: 3000,
    renderedHeight: 2000,
    canvasLeft: 0,
    canvasTop: 0,
    viewportWidth: 900,
    viewportHeight: 600,
  };
  const first = planRasterTiles({ ...base, scrollLeft: 1200, scrollTop: 800 });
  const second = planRasterTiles({ ...base, scrollLeft: 1210, scrollTop: 810 });
  const common = new Set(first.map((tile) => tile.key));
  assert.ok(second.filter((tile) => common.has(tile.key)).length >= Math.min(first.length, second.length) - 2);
});

test('returns no tiles when canvas does not intersect viewport', () => {
  const tiles = planRasterTiles({
    sourceWidth: 4000,
    sourceHeight: 3000,
    renderedWidth: 1000,
    renderedHeight: 750,
    canvasLeft: 2000,
    canvasTop: 2000,
    scrollLeft: 0,
    scrollTop: 0,
    viewportWidth: 800,
    viewportHeight: 600,
  });
  assert.equal(tiles.length, 0);
});
