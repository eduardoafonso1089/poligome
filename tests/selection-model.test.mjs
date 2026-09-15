import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizedSelectionRect,
  selectRange,
  selectionFromMarquee,
  selectSingle,
  toggleSelection,
} from "../app/editor/selection/selection-model.ts";

const annotations = [
  { id: "a", asset: "img", label: "x", type: "box", x: 10, y: 10, width: 50, height: 50 },
  { id: "b", asset: "img", label: "x", type: "box", x: 100, y: 10, width: 50, height: 50 },
  { id: "c", asset: "img", label: "x", type: "box", x: 200, y: 10, width: 50, height: 50 },
];

test("normalizes marquee regardless of drag direction", () => {
  assert.deepEqual(normalizedSelectionRect({ startX: 80, startY: 70, currentX: 20, currentY: 10, additiveIds: [] }), {
    x: 20, y: 10, width: 60, height: 60,
  });
});

test("single, toggle and range selection preserve deterministic active id", () => {
  const single = selectSingle("b");
  assert.deepEqual(single, { selected: "b", multiSelected: ["b"], anchorId: "b" });
  const toggled = toggleSelection(single, "c");
  assert.deepEqual(toggled.multiSelected, ["b", "c"]);
  assert.equal(toggled.selected, "c");
  const range = selectRange(annotations, { selected: "a", multiSelected: ["a"], anchorId: "a" }, "c");
  assert.deepEqual(range.multiSelected, ["a", "b", "c"]);
  assert.equal(range.selected, "c");
});

test("marquee selection supports additive ids and click-like empty drags", () => {
  const selected = selectionFromMarquee(annotations, {
    startX: 0, startY: 0, currentX: 170, currentY: 80, additiveIds: ["c"],
  });
  assert.deepEqual(selected.multiSelected, ["c", "a", "b"]);
  const click = selectionFromMarquee(annotations, {
    startX: 10, startY: 10, currentX: 12, currentY: 12, additiveIds: ["a"],
  });
  assert.deepEqual(click.multiSelected, ["a"]);
});
