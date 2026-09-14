import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { anchoredScrollOffset, canvasLayout } from '../app/lib/editor-viewport.ts';

test('mobile canvas at 92% has an explicit size and centered origin', () => {
  assert.deepEqual(canvasLayout({ width: 350, height: 480 }, { width: 1200, height: 780 }, 92), {
    width: 322, height: 209.3, left: 14, top: 135.35, surfaceWidth: 350, surfaceHeight: 480,
  });
});

test('zoomed canvas keeps full overflow dimensions and a reachable top-left corner', () => {
  assert.deepEqual(canvasLayout({ width: 350, height: 480 }, { width: 1200, height: 780 }, 200), {
    width: 700, height: 455, left: 0, top: 12.5, surfaceWidth: 700, surfaceHeight: 480,
  });
  const tall = canvasLayout({ width: 350, height: 480 }, { width: 500, height: 2000 }, 100);
  assert.equal(tall.height, 1400);
  assert.equal(tall.top, 0);
  assert.equal(tall.surfaceHeight, 1400);
});

test('a zoomed mobile image has no artificial margin and both horizontal edges are reachable', () => {
  const viewport = { width: 350, height: 480 };
  const layout = canvasLayout(viewport, { width: 1200, height: 780 }, 400);
  assert.deepEqual(layout, {
    width: 1400, height: 910, left: 0, top: 0, surfaceWidth: 1400, surfaceHeight: 910,
  });
  const maximumScrollLeft = layout.surfaceWidth - viewport.width;
  assert.equal(layout.left, 0, 'the left image edge aligns at scrollLeft 0');
  assert.equal(layout.left + layout.width - maximumScrollLeft, viewport.width, 'the right image edge aligns at maximum scrollLeft');
});

test('mobile zoom remains centered and can anchor either image edge without clipping it', () => {
  const width = 1400;
  assert.equal(anchoredScrollOffset(0, 0, width, 0.5, 175), 525);
  assert.equal(anchoredScrollOffset(0, 0, width, 0, 0), 0);
  assert.equal(anchoredScrollOffset(0, 0, width, 1, 350), 1050);
});

test('large source images remain fit-to-viewport until the user deep-zooms', () => {
  const fit = canvasLayout({ width: 1000, height: 700 }, { width: 50_000, height: 30_000 }, 100);
  assert.equal(fit.width, 1000);
  assert.equal(fit.height, 600);
  const deep = canvasLayout({ width: 1000, height: 700 }, { width: 50_000, height: 30_000 }, 5000);
  assert.equal(deep.width, 50_000);
  assert.equal(deep.height, 30_000);
});

test('the editor scroll container aligns oversized canvases to the reachable origin', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const scrollRule = css.match(/\.editor \.scroll\{display:block;[^}]*\}/)?.[0] ?? '';
  assert.match(scrollRule, /place-items:start/);
  assert.match(scrollRule, /scrollbar-gutter:auto/);
});

test('laptop wheel zoom accepts Shift as well as platform zoom modifiers', () => {
  const hook = readFileSync(new URL('../app/editor/viewport/use-editor-viewport.ts', import.meta.url), 'utf8');
  assert.match(hook, /!event\.shiftKey && !event\.ctrlKey && !event\.metaKey/);
});
