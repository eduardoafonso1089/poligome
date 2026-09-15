import test from 'node:test';
import assert from 'node:assert/strict';
import { linkedVertices, nearestVertexId, nearbyVertexId, insertedVertexId } from '../app/editor/interactions/vertex-interactions.ts';

const vertices = [
  { id: 'v0', x: 100, y: 100 },
  { id: 'v1', x: 200, y: 100 },
  { id: 'v2', x: 200, y: 200 },
];

test('nearest vertex returns stable id and respects hit radius', () => {
  assert.equal(nearestVertexId(vertices, { x: 198, y: 102 }, { maxDistance: 10 }), 'v1');
  assert.equal(nearestVertexId(vertices, { x: 150, y: 150 }, { maxDistance: 10 }), null);
});

test('linked vertices groups near-coincident polygon and line nodes by id', () => {
  const annotations = [
    { id: 'a', asset: 'img', label: 'c', type: 'polygon', vertices: [
      { id: 'a0', x: 10, y: 10 }, { id: 'a1', x: 20, y: 10 }, { id: 'a2', x: 20, y: 20 },
    ], holes: [] },
    { id: 'b', asset: 'img', label: 'c', type: 'line', vertices: [
      { id: 'b0', x: 11, y: 11 }, { id: 'b1', x: 30, y: 30 },
    ] },
  ];
  assert.deepEqual(linkedVertices(annotations, { x: 10, y: 10 }, 2), [
    { annotationId: 'a', vertexId: 'a0' },
    { annotationId: 'b', vertexId: 'b0' },
  ]);
});

test('nearby and inserted vertex helpers preserve id semantics', () => {
  assert.equal(nearbyVertexId(vertices, 202, 101, 5), 'v1');
  assert.equal(nearbyVertexId(vertices, 50, 50, 5), null);
  assert.equal(insertedVertexId('v2', 3), 'v2:inserted:3');
});
