import test from 'node:test';
import assert from 'node:assert/strict';
import { region, sourceOf } from './helpers/source.mjs';
import { ViewportController } from '../app/editor/viewport/viewport-controller.ts';

const WORKBENCH = 'app/editor/workbench/canonical-editor-workbench.tsx';
const touch = sourceOf('app/editor/viewport/use-touch-navigation.ts');
const drawing = sourceOf('app/editor/drawing/use-drawing-interactions.ts');

test('one-finger pan follows the pointer while preserving logical geometry', () => {
  const viewport = new ViewportController({
    viewport: { width: 500, height: 325 },
    image: { width: 1000, height: 650 },
    zoom: 200,
    scrollLeft: 250,
    scrollTop: 150,
  });
  const before = viewport.snapshot();
  const after = viewport.panBy(40, -25);
  assert.equal(after.zoom, before.zoom);
  assert.deepEqual(after.image, before.image);
  assert.equal(after.scrollLeft, 210);
  assert.equal(after.scrollTop, 175);
});

test('pinch-pan combines scale and moving midpoint without annotation rescaling', () => {
  const viewport = new ViewportController({
    viewport: { width: 500, height: 325 },
    image: { width: 1000, height: 650 },
    zoom: 200,
    scrollLeft: 200,
    scrollTop: 100,
  });
  const before = viewport.snapshot();
  const after = viewport.pinchPan(
    220,
    { left: -200, top: -100, width: 1000, height: 650 },
    { x: 250, y: 160 },
    { x: 270, y: 175 },
  );
  assert.equal(after.zoom, 220);
  assert.deepEqual(after.image, before.image);
  assert.ok(Number.isFinite(after.scrollLeft));
  assert.ok(Number.isFinite(after.scrollTop));
});

// Everything below is pointer handling: it needs a real touchscreen, which the
// mobile audits under scripts/ provide. Here only the decisions are checked —
// what cancels what, and in which order — since a browser cannot show that a
// step was skipped, only that the result looked right by accident.

test('pinch publishes scroll synchronously so the next touch frame matches controller state', () => {
  const hook = sourceOf('app/editor/viewport/use-editor-viewport.ts');
  assert.match(hook, /const applyScrollImmediately = useCallback/);
  // Asynchronous publication would let the next touchmove read a stale scroll.
  assert.match(hook, /applyScrollImmediately\(next\); publish\(next\);/);
});

test('select mode reserves empty-canvas one-finger drag for thresholded pan', () => {
  assert.match(touch, /tool === "select" && event\.target === event\.currentTarget/);
  assert.match(touch, /PAN_THRESHOLD_PX/);
  assert.match(touch, /cancelEditing\(\)/);
});

test('second touch cancels editing and drawing before pinch owns the gesture', () => {
  assert.match(touch, /cancelEditing\(\)/);
  assert.match(touch, /cancelDrawing\(\)/);
  assert.match(touch, /gesture\.points\.size/);
  assert.match(touch, /pinchZoom/);
  assert.match(touch, /stopPropagation\(\)/);
});

test('discrete touch drawing commits on pointerup, not pointerdown', () => {
  assert.match(drawing, /event\.pointerType === "touch"/);
  assert.match(drawing, /start\.pointerType === "touch"/);
  assert.match(drawing, /if \(!start\.moved\) appendDiscretePoint/);
});

test('the workbench routes touch navigation in the capture phase', () => {
  // Capture phase is the point: navigation must win over the drawing handlers
  // attached below it, or a two-finger pinch would draw a polygon.
  const workbench = sourceOf(WORKBENCH);
  assert.match(workbench, /onPointerDownCapture=\{touch\.onPointerDownCapture\}/);
  assert.match(workbench, /onPointerMoveCapture=\{routePointerMoveCapture\}/);
  assert.match(region(WORKBENCH, 'function routePointerMoveCapture', 'onPointerMoveCapture='), /touch\.onPointerMoveCapture\(event\)/);
  assert.match(workbench, /touchMode=\{touch\.touchMode\}/);
});
