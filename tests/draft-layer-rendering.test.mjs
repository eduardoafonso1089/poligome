/**
 * Component layer: the drafts drawn while a gesture is still open.
 *
 * These layers are what the user sees between pointerdown and pointerup. The
 * gesture itself belongs to the functional tier, but what it paints is pure
 * rendering: a shape, a colour and a dash pattern, in source-image coordinates.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { render, attributeValues } from "./helpers/render.mjs";
import { DrawingDraftLayer } from "../app/editor/drawing/drawing-draft-layer.tsx";
import { AdvancedVectorDraftLayer } from "../app/editor/layers/advanced-vector-draft-layer.tsx";

const drawing = (draft, props) => render(DrawingDraftLayer, { draft, ...props });
const advanced = (draft, props) => render(AdvancedVectorDraftLayer, { draft, ...props });
const only = (markup, name) => attributeValues(markup, name)[0];

test("no draft paints nothing at all", () => {
  assert.equal(drawing(null), "");
  assert.equal(advanced(null), "");
});

test("a box draft is a dashed rectangle in source-image pixels", () => {
  const markup = drawing({ type: "box", box: { x: 10, y: 20, w: 100, h: 60 } });
  assert.match(markup, /^<rect/);
  assert.deepEqual(
    ["x", "y", "width", "height"].map((name) => only(markup, name)),
    ["10", "20", "100", "60"],
  );
  assert.equal(only(markup, "stroke-dasharray"), "8 5");
  // A draft must never swallow the pointer events that are still driving it.
  assert.equal(only(markup, "pointer-events"), "none");
});

test("a polygon draft is the open polyline of the points placed so far", () => {
  const markup = drawing({ type: "polygon", points: [0, 0, 90, 40, 180, 0] });
  assert.match(markup, /^<polyline/);
  assert.equal(only(markup, "points"), "0,0 90,40 180,0");
  assert.equal(only(markup, "fill"), "none", "an unfinished polygon is not filled");
});

test("a freehand trace is solid while a line draft stays dashed", () => {
  const trace = drawing({ type: "freehand", points: [0, 0, 5, 5, 10, 20] });
  const line = drawing({ type: "line", points: [0, 0, 10, 20] });
  assert.equal(only(trace, "stroke-dasharray"), undefined);
  assert.equal(only(line, "stroke-dasharray"), "8 5");
});

test("the draft is painted in the active class colour at the active thickness", () => {
  const markup = drawing({ type: "polygon", points: [0, 0, 10, 10] }, { color: "#6c8cff", lineThickness: 7 });
  assert.equal(only(markup, "stroke"), "#6c8cff");
  assert.equal(only(markup, "stroke-width"), "7");
  // Stroke width is a screen measure, so it must not scale with the zoom.
  assert.equal(only(markup, "vector-effect"), "non-scaling-stroke");
});

test("an odd trailing coordinate is dropped instead of drawing a half point", () => {
  assert.equal(only(drawing({ type: "polygon", points: [0, 0, 90, 40, 180] }), "points"), "0,0 90,40");
});

test("a split draft is the straight cut between the two points", () => {
  const markup = advanced({ type: "split", start: { x: 5, y: 5 }, end: { x: 95, y: 65 } });
  assert.match(markup, /^<line/);
  assert.deepEqual(["x1", "y1", "x2", "y2"].map((name) => only(markup, name)), ["5", "5", "95", "65"]);
});

test("a hole draft is dashed and a reshape draft is not", () => {
  const points = [{ x: 0, y: 0 }, { x: 10, y: 10 }];
  assert.equal(only(advanced({ type: "hole", points }), "stroke-dasharray"), "6 5");
  assert.equal(only(advanced({ type: "reshape", points }), "stroke-dasharray"), undefined);
  assert.equal(only(advanced({ type: "reshape", points }), "points"), "0,0 10,10");
});
