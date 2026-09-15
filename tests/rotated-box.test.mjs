import assert from "node:assert/strict";
import test from "node:test";
import { boxCorners, exportBounds } from "../app/editor/export/annotation-export.ts";

test("computes corners and export bounds for a canonical rotated bounding box", () => {
  const box = {
    id: "rotated",
    asset: "image",
    label: "object",
    type: "box",
    x: 400,
    y: 260,
    width: 200,
    height: 130,
    rotation: Math.PI / 2,
  };

  assert.deepEqual(
    boxCorners(box).map(({ x, y }) => [Math.round(x), Math.round(y)]),
    [[565, 225], [565, 425], [435, 425], [435, 225]],
  );
  const bounds = exportBounds(box);
  assert.deepEqual(
    Object.fromEntries(Object.entries(bounds).map(([key, value]) => [key, Math.round(value)])),
    { x: 435, y: 225, width: 130, height: 200 },
  );
});
