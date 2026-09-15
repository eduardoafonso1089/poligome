import assert from 'node:assert/strict';
import test from 'node:test';
import { polygonTransformCenter, transformPolygonAnnotation } from '../app/editor/geometry/polygon-transform.ts';

const polygon = {
  id: 'p', asset: 'a', label: 'weed', type: 'polygon',
  vertices: [
    { id: 'v1', x: 0, y: 0 },
    { id: 'v2', x: 10, y: 0 },
    { id: 'v3', x: 10, y: 10 },
    { id: 'v4', x: 0, y: 10 },
  ],
  holes: [[
    { id: 'h1', x: 3, y: 3 },
    { id: 'h2', x: 7, y: 3 },
    { id: 'h3', x: 5, y: 7 },
  ]],
};

test('polygon transform center uses canonical source-pixel bounds', () => {
  assert.deepEqual(polygonTransformCenter(polygon), { x: 5, y: 5 });
});

test('polygon transform scales and rotates outer ring and holes while preserving vertex ids', () => {
  const transformed = transformPolygonAnnotation(polygon, { x: 5, y: 5 }, 2, Math.PI / 2);
  assert.deepEqual(transformed.vertices.map((vertex) => vertex.id), ['v1', 'v2', 'v3', 'v4']);
  assert.deepEqual(transformed.holes[0].map((vertex) => vertex.id), ['h1', 'h2', 'h3']);
  assert.ok(Math.abs(transformed.vertices[0].x - 15) < 1e-9);
  assert.ok(Math.abs(transformed.vertices[0].y + 5) < 1e-9);
  assert.ok(Math.abs(transformed.holes[0][0].x - 9) < 1e-9);
  assert.ok(Math.abs(transformed.holes[0][0].y - 1) < 1e-9);
});

test('polygon transform clamps unsafe scale factors', () => {
  const transformed = transformPolygonAnnotation(polygon, { x: 5, y: 5 }, 0, 0);
  assert.ok(transformed.vertices[0].x > 4 && transformed.vertices[0].x < 5);
  assert.equal(transformed.vertices[0].id, 'v1');
});
