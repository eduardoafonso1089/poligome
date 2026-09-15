import assert from 'node:assert/strict';
import test from 'node:test';
import { planRasterTiles } from '../app/editor/raster/tile-plan.ts';
import { COG_TILE_CACHE_LIMIT, LruCache } from '../app/editor/raster/tile-cache.ts';

function decodedPixels(tiles) {
  return tiles.reduce((sum, tile) => sum + tile.outputWidth * tile.outputHeight, 0);
}

function scenario(renderedWidth, renderedHeight, scrollLeft = 0, scrollTop = 0) {
  return planRasterTiles({
    sourceWidth: 50_000,
    sourceHeight: 30_000,
    renderedWidth,
    renderedHeight,
    canvasLeft: 0,
    canvasTop: 0,
    scrollLeft,
    scrollTop,
    viewportWidth: 1000,
    viewportHeight: 700,
  });
}

test('50k COG fit view decodes only a bounded low-resolution tile set', () => {
  const tiles = scenario(1000, 600);
  assert.ok(tiles.length <= 20, `fit view planned ${tiles.length} tiles`);
  assert.ok(tiles.every((tile) => tile.reduction >= 32));
  assert.ok(decodedPixels(tiles) <= 20 * 256 * 256);
});

test('native-resolution COG view remains bounded by viewport rather than raster dimensions', () => {
  const tiles = scenario(50_000, 30_000, 20_000, 12_000);
  assert.ok(tiles.length <= 42, `native view planned ${tiles.length} tiles`);
  assert.ok(tiles.every((tile) => tile.reduction === 1));
  assert.ok(decodedPixels(tiles) <= 42 * 256 * 256);
});

test('deep zoom still decodes a bounded viewport-sized tile working set', () => {
  const tiles = scenario(100_000, 60_000, 40_000, 24_000);
  assert.ok(tiles.length <= 30, `deep view planned ${tiles.length} tiles`);
  assert.ok(decodedPixels(tiles) <= 30 * 256 * 256);
});

test('panning across a huge COG does not make tile count grow with source extent', () => {
  let maximumTiles = 0;
  let maximumDecodedPixels = 0;
  for (let i = 0; i < 200; i++) {
    const x = i * 211 % 49_000;
    const y = i * 137 % 29_300;
    const tiles = scenario(50_000, 30_000, x, y);
    maximumTiles = Math.max(maximumTiles, tiles.length);
    maximumDecodedPixels = Math.max(maximumDecodedPixels, decodedPixels(tiles));
  }
  assert.ok(maximumTiles <= 42, `maximum tile count was ${maximumTiles}`);
  assert.ok(maximumDecodedPixels <= 42 * 256 * 256);
});

test('COG tile cache is bounded and evicts least-recently-used entries', () => {
  const cache = new LruCache(COG_TILE_CACHE_LIMIT);
  for (let i = 0; i < COG_TILE_CACHE_LIMIT; i++) cache.set(`tile-${i}`, i);
  assert.equal(cache.size, COG_TILE_CACHE_LIMIT);

  assert.equal(cache.get('tile-0'), 0); // promote tile-0 to most recent
  cache.set('tile-new', 999);
  assert.equal(cache.size, COG_TILE_CACHE_LIMIT);
  assert.equal(cache.has('tile-0'), true);
  assert.equal(cache.has('tile-1'), false);
  assert.equal(cache.has('tile-new'), true);
});
