import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEGENERATE_VERTEX_DISTANCE,
  VERTEX_SCREEN_DISTANCE,
  edgeMidpoints,
  insertAnnotationVertex,
  updateAnnotationVertex,
} from '../app/editor/geometry/annotation-geometry.ts';
import { screenPixelsToImageUnits } from '../app/editor/viewport/svg-image-space.ts';

const polygon = {
  id: 'p', asset: 'a', label: 'c', type: 'polygon', holes: [],
  vertices: [{ id: 'v0', x: 0, y: 0 }, { id: 'v1', x: 1000, y: 0 }, { id: 'v2', x: 1000, y: 1000 }],
};

// O editor inteiro converte limiares de tela para unidades da imagem.
const toleranceFor = (imageWidth, renderedWidth) =>
  screenPixelsToImageUnits(VERTEX_SCREEN_DISTANCE, { width: imageWidth, height: imageWidth }, renderedWidth);

test('the guard tolerance follows the zoom, like every other threshold', () => {
  // Mesmos 10 px de tela, três imagens muito diferentes.
  assert.ok(toleranceFor(320, 850) < 5, 'miniatura: poucos px de imagem');
  assert.ok(toleranceFor(1200, 850) > 10 && toleranceFor(1200, 850) < 20, 'foto comum');
  assert.ok(toleranceFor(40000, 850) > 400, 'ortomosaico: centenas de px de imagem');
});

test('a fat-finger move is rejected at the tolerance it is given', () => {
  const tolerance = 60;
  // 50 px da imagem de v1 — dentro da tolerância, recusa.
  assert.equal(updateAnnotationVertex(polygon, 'v0', { x: 950, y: 0 }, tolerance), polygon);
  // 200 px da imagem — aceita.
  const moved = updateAnnotationVertex(polygon, 'v0', { x: 800, y: 0 }, tolerance);
  assert.notEqual(moved, polygon);
  assert.deepEqual(moved.vertices[0], { id: 'v0', x: 800, y: 0 });
});

test('the same move is accepted when the zoom makes the tolerance small', () => {
  // Zoom fechado: a mesma distância de imagem agora é longe na tela.
  const moved = updateAnnotationVertex(polygon, 'v0', { x: 950, y: 0 }, 5);
  assert.notEqual(moved, polygon);
  assert.deepEqual(moved.vertices[0], { id: 'v0', x: 950, y: 0 });
});

test('degenerate geometry is refused at any zoom, even with no tolerance', () => {
  // Exatamente em cima de outro vértice: nunca aceita, nem com tolerância zero.
  assert.equal(updateAnnotationVertex(polygon, 'v0', { x: 1000, y: 0 }, 0), polygon);
  assert.equal(insertAnnotationVertex(polygon, 'v0', { x: 1000, y: 0 }, 'v-new', 0), polygon);
  assert.ok(DEGENERATE_VERTEX_DISTANCE > 0 && DEGENERATE_VERTEX_DISTANCE < 1);
});

test('inserting respects the tolerance it is given', () => {
  assert.equal(insertAnnotationVertex(polygon, 'v0', { x: 980, y: 0 }, 'v-new', 60), polygon);
  const inserted = insertAnnotationVertex(polygon, 'v0', { x: 500, y: 0 }, 'v-new', 60);
  assert.deepEqual(inserted.vertices.map((vertex) => vertex.id), ['v0', 'v-new', 'v1', 'v2']);
});

test('the insert handle appears on edges long enough to be grabbed', () => {
  const short = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 40, y: 0 }, { id: 'c', x: 40, y: 400 }];
  // Aresta a-b tem 40 px de imagem: some quando o handle pede 120.
  assert.deepEqual(edgeMidpoints(short, true, 120).map((m) => m.afterVertexId), ['b']);
  // Com um limite menor, ela reaparece.
  assert.deepEqual(edgeMidpoints(short, true, 30).map((m) => m.afterVertexId), ['a', 'b']);
});

test('callers that pass no tolerance keep the previous defaults', () => {
  // Contrato antigo preservado para quem chama sem o parâmetro.
  const near = updateAnnotationVertex(polygon, 'v0', { x: 995, y: 0 });
  assert.equal(near, polygon, 'ainda recusa dentro dos 10 px de imagem herdados');
});
