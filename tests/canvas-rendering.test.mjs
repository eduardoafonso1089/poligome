/**
 * Component layer: the canvas that composes the annotation layers.
 *
 * Replaces the source-text assertions in editor-canvas.test.mjs.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { render, handlers, attributeValues, uniqueAttributeValues, countClass } from "./helpers/render.mjs";
import { LAYER_HANDLER_NAMES, polygon, box, point, line, labels } from "./helpers/editor-fixtures.mjs";
import { EditorCanvas } from "../app/editor/canvas/editor-canvas.tsx";

const canvasHandlers = handlers([
  ...LAYER_HANDLER_NAMES,
  "onPointerDown", "onPointerMove", "onPointerUp", "onPointerCancel",
]);

const canvas = (overrides = {}) => render(EditorCanvas, {
  imageSize: { width: 1200, height: 780 },
  annotations: [],
  labels: labels(),
  tool: "select",
  selectedId: null,
  selectedIds: [],
  selectedVertex: null,
  selectionMarquee: null,
  lineThickness: 2,
  touchMode: false,
  touchRadius: 20,
  markerRadius: 5,
  markerAspect: 1,
  boxTouchRadius: 28,
  boxRotationTouchRadius: 20,
  ...canvasHandlers,
  ...overrides,
});

test("the viewBox is the source image, with no normalized space in between", () => {
  assert.equal(attributeValues(canvas(), "viewBox")[0], "0 0 1200 780");
  assert.equal(
    attributeValues(canvas({ imageSize: { width: 40000, height: 28000 } }), "viewBox")[0],
    "0 0 40000 28000",
  );
});

test("a degenerate image size still produces a usable viewBox", () => {
  assert.equal(attributeValues(canvas({ imageSize: { width: 0, height: 0 } }), "viewBox")[0], "0 0 1 1");
});

test("every annotation reaches the canvas, in order", () => {
  const annotations = [polygon(), box(), point(), line()];
  const markup = canvas({ annotations });
  assert.deepEqual(
    uniqueAttributeValues(markup, "data-annotation-id"),
    ["poly", "box", "point", "line"],
  );
});

test("each annotation is painted with its own class colour", () => {
  const markup = canvas({ annotations: [polygon(), point()] });
  // class-a is #6c8cff, class-b is #ff8a65 in the fixture labels.
  assert.ok(attributeValues(markup, "stroke").includes("#6c8cff"));
  assert.ok(attributeValues(markup, "stroke").includes("#ff8a65"));
});

test("an annotation whose class no longer exists falls back to the neutral colour", () => {
  const orphan = polygon({ label: "deleted-class" });
  assert.ok(attributeValues(canvas({ annotations: [orphan] }), "stroke").includes("#929a95"));
});

test("only the primary selection shows vertex handles", () => {
  const first = polygon();
  const second = polygon({ id: "poly2", vertices: polygon().vertices.map((v) => ({ ...v, id: `b-${v.id}` })) });
  const both = canvas({ annotations: [first, second], selectedIds: ["poly", "poly2"], selectedId: "poly" });
  // Two annotations selected means neither is the single primary selection.
  assert.equal(attributeValues(both, "data-vertex-id").length, 0);

  const single = canvas({ annotations: [first, second], selectedIds: ["poly"], selectedId: "poly" });
  assert.deepEqual(uniqueAttributeValues(single, "data-vertex-id"), ["v0", "v1", "v2", "v3"]);
});

test("the marquee renders only while a selection drag is open", () => {
  assert.equal(countClass(canvas(), "selection-marquee"), 0);
  const dragging = canvas({
    selectionMarquee: { startX: 10, startY: 20, currentX: 110, currentY: 140, additiveIds: [] },
  });
  assert.match(dragging, /<rect[^>]*x="10"[^>]*y="20"[^>]*width="100"[^>]*height="120"/);
});

test("a marquee dragged up and to the left is normalised before drawing", () => {
  const dragging = canvas({
    selectionMarquee: { startX: 110, startY: 140, currentX: 10, currentY: 20, additiveIds: [] },
  });
  assert.match(dragging, /<rect[^>]*x="10"[^>]*y="20"[^>]*width="100"[^>]*height="120"/);
});

test("overlay content is rendered above the annotations", () => {
  const markup = canvas({
    annotations: [polygon()],
    overlay: null,
  });
  assert.ok(markup.includes("data-annotation-id=\"poly\""));
});

test("hidden annotations simply are not passed in", () => {
  // Visibility is filtered by the workbench, so the canvas renders what it gets.
  assert.equal(attributeValues(canvas({ annotations: [] }), "data-annotation-id").length, 0);
});
