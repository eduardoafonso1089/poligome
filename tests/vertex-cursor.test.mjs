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

test('corners build an angle-aware three-arm Y cursor', () => {
  const arms = vertexCursorDirections(vertices([[0, 0], [100, 0], [100, 100]]), 1, true);
  assert.equal(arms.length, 3);
  assert.deepEqual(arms.slice(0, 2), [{ x: -1, y: 0 }, { x: 0, y: 1 }]);
});
