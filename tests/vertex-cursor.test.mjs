import test from 'node:test';
import assert from 'node:assert/strict';
import { boxCornerCursors } from '../app/editor/layers/box-layer.tsx';
import { vertexCursorDirections, vertexMoveCursor } from '../app/editor/layers/vertex-handles.tsx';

const vertices = (points) => points.map(([x, y], index) => ({ id: `v${index}`, x, y }));

test('straight vertices build a bidirectional cursor perpendicular to their actual segment', () => {
  const [normal] = vertexCursorDirections(vertices([[0, 0], [100, 35]]), 0, true);
  assert.ok(Math.abs(normal.x + 0.33) < 0.01);
  assert.ok(Math.abs(normal.y - 0.94) < 0.01);
  const cursor = vertexMoveCursor(vertices([[0, 0], [100, 35]]), 0, true);
  assert.match(cursor, /data:image\/svg\+xml/);
  assert.match(decodeURIComponent(cursor), /stroke="white"/);
  assert.match(decodeURIComponent(cursor), /stroke="#111"/);
  assert.match(decodeURIComponent(cursor), /stroke-width="4"/);
});

test('corners build a bidirectional cursor along the angle bisector', () => {
  const arms = vertexCursorDirections(vertices([[0, 0], [100, 0], [100, 100]]), 1, true);
  assert.equal(arms.length, 2);
  assert.ok(Math.abs(arms[0].x + Math.SQRT1_2) < 0.01);
  assert.ok(Math.abs(arms[0].y - Math.SQRT1_2) < 0.01);
});

test('rotating a box rotates the cursor directions on all of its resize corners', () => {
  const base = { id: 'box', asset: 'image', label: 'class', type: 'box', x: 0, y: 0, width: 100, height: 50 };
  const upright = boxCornerCursors(base);
  const rotated = boxCornerCursors({ ...base, rotation: Math.PI / 2 });

  assert.equal(rotated.length, 4);
  assert.ok(rotated.every((cursor, index) => cursor !== upright[index]));
  assert.match(decodeURIComponent(rotated[0]), /L8\.22 23\.78/);
});

test('rotated polygon and polyline vertices derive their cursor direction from transformed geometry', () => {
  const [lineNormal] = vertexCursorDirections(vertices([[0, 0], [0, 100]]), 0, true);
  assert.ok(Math.abs(lineNormal.x + 1) < 0.01);
  assert.ok(Math.abs(lineNormal.y) < 0.01);

  const [polygonBisector] = vertexCursorDirections(vertices([[100, 0], [100, 100], [0, 100]]), 1);
  assert.ok(Math.abs(polygonBisector.x + Math.SQRT1_2) < 0.01);
  assert.ok(Math.abs(polygonBisector.y + Math.SQRT1_2) < 0.01);
});
