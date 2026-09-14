import test from 'node:test';
import assert from 'node:assert/strict';
import { vertexMoveCursor } from '../app/editor/layers/vertex-handles.tsx';

const vertices = (points) => points.map(([x, y], index) => ({ id: `v${index}`, x, y }));

test('straight vertex cursors follow the segment normal', () => {
  assert.equal(vertexMoveCursor(vertices([[0, 0], [100, 0]]), 0, true), 'ns-resize');
  assert.equal(vertexMoveCursor(vertices([[0, 0], [0, 100]]), 0, true), 'ew-resize');
  assert.equal(vertexMoveCursor(vertices([[0, 0], [100, 100]]), 0, true), 'nesw-resize');
  assert.equal(vertexMoveCursor(vertices([[0, 100], [100, 0]]), 0, true), 'nwse-resize');
});

test('corners retain the diagonal direct-manipulation cursor', () => {
  assert.equal(vertexMoveCursor(vertices([[0, 0], [100, 0], [100, 100]]), 1, true), 'nwse-resize');
});
