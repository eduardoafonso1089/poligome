import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deleteVertex,
  flatPointsFromVertices,
  insertVertex,
  moveVertices,
  updateVertex,
  verticesFromFlatPoints,
} from '../app/editor/models/vertex-model.ts';

test('vertex model round-trips the persisted flat point format', () => {
  const flat = [10, 20, 30, 40, 50, 60];
  assert.deepEqual(flatPointsFromVertices(verticesFromFlatPoints(flat)), flat);
});

test('vertex ids allow targeted updates without depending on array offsets', () => {
  const vertices = verticesFromFlatPoints([10, 20, 30, 40, 50, 60], (index) => `v${index}`);
  const updated = updateVertex(vertices, 'v1', { x: 33, y: 44 });
  assert.deepEqual(flatPointsFromVertices(updated), [10, 20, 33, 44, 50, 60]);
});

test('insert/delete preserves polygon compatibility and minimum vertex count', () => {
  const vertices = verticesFromFlatPoints([0, 0, 10, 0, 10, 10], (index) => `v${index}`);
  const inserted = insertVertex(vertices, 'v0', { x: 5, y: 0 }, () => 'inserted');
  assert.deepEqual(flatPointsFromVertices(inserted), [0, 0, 5, 0, 10, 0, 10, 10]);
  assert.deepEqual(flatPointsFromVertices(deleteVertex(inserted, 'inserted')), [0, 0, 10, 0, 10, 10]);
  assert.equal(deleteVertex(vertices, 'v0'), vertices);
});

test('moving vertices preserves ids', () => {
  const vertices = verticesFromFlatPoints([1, 2, 3, 4], (index) => `v${index}`);
  const moved = moveVertices(vertices, 5, -1);
  assert.deepEqual(moved.map(({ id }) => id), ['v0', 'v1']);
  assert.deepEqual(flatPointsFromVertices(moved), [6, 1, 8, 3]);
});
