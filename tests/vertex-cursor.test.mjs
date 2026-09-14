import test from 'node:test';
import assert from 'node:assert/strict';
import { vertexCursorDirections, vertexMoveCursor } from '../app/editor/layers/vertex-handles.tsx';

const vertices = (points) => points.map(([x, y], index) => ({ id: `v${index}`, x, y }));

test('straight vertices build a cursor perpendicular to their actual segment', () => {
  const [normal] = vertexCursorDirections(vertices([[0, 0], [100, 35]]), 0, true);
  assert.ok(Math.abs(normal.x + 0.33) < 0.01);
  assert.ok(Math.abs(normal.y - 0.94) < 0.01);
  assert.match(vertexMoveCursor(vertices([[0, 0], [100, 35]]), 0, true), /data:image\/svg\+xml/);
});

test('corners build a double arrow along the angle bisector', () => {
  const arms = vertexCursorDirections(vertices([[0, 0], [100, 0], [100, 100]]), 1, true);
  assert.equal(arms.length, 2);
  assert.ok(Math.abs(arms[0].x + Math.SQRT1_2) < 0.01);
  assert.ok(Math.abs(arms[0].y - Math.SQRT1_2) < 0.01);
  assert.ok(Math.abs(arms[1].x - Math.SQRT1_2) < 0.01);
  assert.ok(Math.abs(arms[1].y + Math.SQRT1_2) < 0.01);
});
