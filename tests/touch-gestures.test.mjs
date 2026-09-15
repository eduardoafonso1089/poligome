import assert from "node:assert/strict";
import test from "node:test";
import { TouchGesture, pinchZoom, touchToolUsesTap } from "../app/lib/touch-gestures.ts";

test("one finger commits one point only on release, tolerating small finger jitter", () => {
  const gesture = new TouchGesture();
  assert.equal(gesture.down(1, 50, 70), false);
  gesture.move(1, 54, 73);
  assert.deepEqual(gesture.end(1), { tracked: true, blocked: false, tap: true });
  assert.equal(gesture.end(1).tap, false);
});

test("dragging or dragging back to the origin does not create a polygon point", () => {
  const gesture = new TouchGesture();
  gesture.down(1, 50, 70);
  gesture.move(1, 80, 70);
  gesture.move(1, 50, 70);
  assert.equal(gesture.end(1).tap, false);
});

test("second finger switches to navigation and neither release commits a point", () => {
  const gesture = new TouchGesture();
  gesture.down(1, 50, 70);
  assert.equal(gesture.down(2, 150, 70), true);
  assert.deepEqual(gesture.pair(), { x: 100, y: 70, distance: 100 });
  assert.deepEqual(gesture.end(2), { tracked: true, blocked: true, tap: false });
  gesture.move(1, 80, 70);
  assert.equal(gesture.navigating, true);
  assert.equal(gesture.end(1).blocked, true);
  gesture.down(3, 50, 70);
  assert.equal(gesture.end(3).tap, true);
});

test("three fingers and reversed release order remain locked until all lift", () => {
  const gesture = new TouchGesture();
  gesture.down(1, 0, 0); gesture.down(2, 20, 0); gesture.down(3, 40, 0);
  assert.equal(gesture.end(1).tap, false);
  assert.deepEqual(gesture.pair(), { x: 30, y: 0, distance: 20 });
  assert.equal(gesture.end(2).tap, false);
  assert.equal(gesture.navigating, true);
  assert.equal(gesture.end(3).tap, false);
  assert.equal(gesture.navigating, false);
});

test("pointer cancellation never commits a tap and a new gesture can start", () => {
  const gesture = new TouchGesture();
  gesture.down(1, 1, 1);
  assert.deepEqual(gesture.end(1, true), { tracked: true, blocked: true, tap: false });
  gesture.down(2, 1, 1);
  assert.equal(gesture.end(2).tap, true);
});

test("cancelling one pointer of a pinch does not reactivate drawing with the other", () => {
  const gesture = new TouchGesture();
  gesture.down(1, 1, 1); gesture.down(2, 10, 10);
  gesture.end(1, true);
  assert.equal(gesture.navigating, true);
  assert.equal(gesture.end(2).tap, false);
});

test("pinch zoom preserves starting zoom and clamps both zoom limits", () => {
  assert.equal(pinchZoom(92, 100, 200), 184);
  assert.equal(pinchZoom(92, 100, 50), 46);
  assert.equal(pinchZoom(300, 100, 200), 400);
  assert.equal(pinchZoom(20, 100, 1), 10);
  assert.equal(pinchZoom(92, 0, 100), 400);
  assert.equal(pinchZoom(1000, 100, 800, 10_000), 8000);
});

test("all discrete creation tools defer touch actions; drawing and editing support dragging", () => {
  for (const tool of ["polygon", "ring", "line", "point", "sam", "split"]) assert.equal(touchToolUsesTap(tool), true, tool);
  for (const tool of ["box", "freehand", "reshape", "select", "transform", "pan"]) assert.equal(touchToolUsesTap(tool), false, tool);
});

test("a fresh primary touch cannot pinch against an orphaned selection pointer", () => {
  const gesture = new TouchGesture();
  gesture.down(1, 50, 70, true);
  assert.equal(gesture.down(2, 150, 170, true), false);
  gesture.move(2, 152, 170);
  assert.equal(gesture.pair(), null);
  assert.equal(gesture.end(2).tap, true);
});

test("new primary touch recovers from an interrupted pinch but a real second finger still zooms", () => {
  const gesture = new TouchGesture();
  gesture.down(1, 50, 70, true); gesture.down(2, 150, 70);
  assert.equal(gesture.navigating, true);
  assert.equal(gesture.down(3, 80, 90, true), false);
  assert.equal(gesture.down(4, 180, 90, false), true);
  assert.deepEqual(gesture.pair(), { x: 130, y: 90, distance: 100 });
});
