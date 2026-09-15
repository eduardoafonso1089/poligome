/**
 * Component layer: the box, whose resize and rotation handles are the only
 * direct-manipulation surface the annotation layers own.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { render, handlers, attributeValues, countClass } from "./helpers/render.mjs";
import { box } from "./helpers/editor-fixtures.mjs";
import { BoxLayer } from "../app/editor/layers/box-layer.tsx";

const boxHandlers = handlers([
  "onPointerDown", "onPointerMove", "onPointerUp", "onPointerCancel",
  "onResizeStart", "onResizeMove", "onResizeEnd",
  "onRotateStart", "onTransformMove", "onTransformEnd",
]);

const layer = (overrides = {}) => render(BoxLayer, {
  annotation: box(),
  color: "#6c8cff",
  selected: false,
  active: false,
  selecting: true,
  touchMode: false,
  markerRadius: 5,
  markerAspect: 1,
  touchRadius: 28,
  rotationTouchRadius: 20,
  lineThickness: 2,
  ...boxHandlers,
  ...overrides,
});

test("the stored rectangle is what gets drawn", () => {
  const markup = layer();
  assert.equal(attributeValues(markup, "x")[0], "40");
  assert.equal(attributeValues(markup, "y")[0], "50");
  assert.equal(attributeValues(markup, "width")[0], "120");
  assert.equal(attributeValues(markup, "height")[0], "80");
});

test("resize handles appear only for the active selection under the select tool", () => {
  assert.equal(countClass(layer(), "box-resize-handle"), 0);
  assert.equal(countClass(layer({ selected: true }), "box-resize-handle"), 0, "selected but not active");
  assert.equal(countClass(layer({ selected: true, active: true }), "box-resize-handle"), 4, "one per corner");
  assert.equal(countClass(layer({ selected: true, active: true, selecting: false }), "box-resize-handle"), 0);
});

const resizeHandles = (markup) =>
  [...markup.matchAll(/class="box-resize-handle ([a-z]{2})"[^>]*cx="([^"]*)"[^>]*cy="([^"]*)"/g)]
    .map(([, corner, cx, cy]) => ({ corner, at: `${cx},${cy}` }));

test("each resize handle sits on the corner it is named after", () => {
  const found = resizeHandles(layer({ selected: true, active: true }));
  assert.deepEqual(found, [
    { corner: "nw", at: "40,50" },
    { corner: "ne", at: "160,50" },
    { corner: "se", at: "160,130" },
    { corner: "sw", at: "40,130" },
  ]);
});

test("a rotation handle and its stem appear with the selection", () => {
  const plain = layer();
  const active = layer({ selected: true, active: true });
  assert.equal(countClass(plain, "box-rotation-handle"), 0);
  assert.equal(countClass(active, "box-rotation-handle"), 1);
  assert.equal(countClass(active, "box-rotation-stem"), 1);
});

test("the rotation handle sits above the top edge, on the centre line", () => {
  const markup = layer({ selected: true, active: true });
  const stem = markup.match(/class="box-rotation-stem"[^>]*x1="([^"]*)"[^>]*y1="([^"]*)"[^>]*x2="([^"]*)"[^>]*y2="([^"]*)"/);
  assert.equal(Number(stem[1]), 100, "stem starts on the horizontal centre");
  assert.equal(Number(stem[2]), 50, "stem starts on the top edge");
  assert.equal(Number(stem[3]), 100);
  assert.ok(Number(stem[4]) < 50, "stem reaches above the box");
});

test("touch mode enlarges the hit targets without adding visible handles", () => {
  const mouse = layer({ selected: true, active: true, touchMode: false });
  const touch = layer({ selected: true, active: true, touchMode: true });
  assert.equal(countClass(mouse, "box-resize-handle"), countClass(touch, "box-resize-handle"));
  assert.ok(countClass(touch, "touch-handle-hit") > countClass(mouse, "touch-handle-hit"));
});

test("a box stops taking pointer events outside the select tool", () => {
  assert.doesNotMatch(layer(), /pointer-events="none"/);
  assert.match(layer({ selecting: false }), /pointer-events="none"/);
});

test("selection thickens the outline without moving the rectangle", () => {
  const plain = layer({ lineThickness: 3 });
  const selected = layer({ lineThickness: 3, selected: true });
  assert.equal(attributeValues(plain, "x")[0], attributeValues(selected, "x")[0]);
  assert.notEqual(attributeValues(plain, "stroke-width")[0], attributeValues(selected, "stroke-width")[0]);
});

test("handles ride along with the rotation instead of staying axis-aligned", () => {
  const markup = layer({ selected: true, active: true, annotation: box({ rotation: Math.PI / 4 }) });
  // Everything lives inside the rotated group, so the corners keep their stored
  // coordinates and the transform does the work.
  const [, angle] = markup.match(/rotate\(([-\d.e]+) /);
  assert.ok(Math.abs(Number(angle) - 45) < 1e-6);
  assert.deepEqual(
    resizeHandles(markup).map((handle) => handle.at),
    ["40,50", "160,50", "160,130", "40,130"],
  );
});
