import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const vertexHandles = readFileSync(new URL('../app/editor/layers/vertex-handles.tsx', import.meta.url), 'utf8');
const polygonLayer = readFileSync(new URL('../app/editor/layers/polygon-layer.tsx', import.meta.url), 'utf8');
const polylineLayer = readFileSync(new URL('../app/editor/layers/polyline-layer.tsx', import.meta.url), 'utf8');
const interactions = readFileSync(new URL('../app/editor/interactions/use-canvas-interactions.ts', import.meta.url), 'utf8');

test('vertex handles consume canonical vertices and preserve ids through events', () => {
  assert.match(vertexHandles, /vertices: Vertex\[\]/);
  assert.match(vertexHandles, /data-vertex-id/);
  assert.match(vertexHandles, /vertex\.id/);
  assert.match(vertexHandles, /afterVertexId/);
  assert.doesNotMatch(vertexHandles, /verticesFromFlatPoints/);
  assert.doesNotMatch(vertexHandles, /vertexIndex/);
});

test('polygon and polyline layers share canonical vertex controls', () => {
  assert.match(polygonLayer, /PolygonAnnotation/);
  assert.match(polylineLayer, /PolylineAnnotation/);
  assert.match(polygonLayer, /vertices=\{annotation\.vertices\}/);
  assert.match(polylineLayer, /vertices=\{annotation\.vertices\}/);
  assert.match(polylineLayer, /open/);
  assert.doesNotMatch(polygonLayer, /annotation\.pts/);
  assert.doesNotMatch(polylineLayer, /annotation\.pts/);
});

test('extracted layers remain presentational and expose annotation ids', () => {
  assert.match(polygonLayer, /data-annotation-id=\{annotation\.id\}/);
  assert.match(polylineLayer, /data-annotation-id=\{annotation\.id\}/);
  assert.doesNotMatch(polygonLayer, /useState\(/);
  assert.doesNotMatch(polylineLayer, /useState\(/);
});

test('vertex insertion starts direct manipulation and handles expose their edit cursor', () => {
  assert.match(vertexHandles, /cursor: "copy"/);
  assert.match(vertexHandles, /cursor: "nwse-resize"/);
  assert.match(interactions, /setPointerCapture/);
  assert.match(interactions, /type: "begin-gesture"/);
  assert.match(interactions, /vertexDrag\.current = \{ pointerId: event\.pointerId, annotationId: annotation\.id, vertexId \}/);
});
