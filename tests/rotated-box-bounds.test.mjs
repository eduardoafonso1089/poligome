import test from 'node:test';
import assert from 'node:assert/strict';
import { annotationBounds } from '../app/editor/geometry/annotation-geometry.ts';
import { exportBounds } from '../app/editor/export/annotation-export.ts';
import { annotationIntersectsRect } from '../app/editor/selection/selection-model.ts';

// 200 x 80 girada 30° em torno do próprio centro (300, 200).
// Cantos desenhados: (233,115) (407,215) (367,285) (193,185).
// O retângulo guardado vai de x 200..400, y 160..240 — bem menor que a forma.
const rotated = {
  id: 'b', asset: 'a', label: 'c', type: 'box',
  x: 200, y: 160, width: 200, height: 80, rotation: Math.PI / 6,
};
const upright = { ...rotated, id: 'u', rotation: 0 };

test('bounds of a rotated box cover the corners actually drawn', () => {
  const bounds = annotationBounds(rotated);
  assert.ok(Math.abs(bounds.x - 193.4) < 0.1, `x=${bounds.x}`);
  assert.ok(Math.abs(bounds.y - 115.4) < 0.1, `y=${bounds.y}`);
  assert.ok(Math.abs(bounds.width - 213.2) < 0.1, `width=${bounds.width}`);
  assert.ok(Math.abs(bounds.height - 169.3) < 0.1, `height=${bounds.height}`);
});

test('an unrotated box keeps the stored rectangle exactly', () => {
  assert.deepEqual(annotationBounds(upright), { x: 200, y: 160, width: 200, height: 80 });
  assert.deepEqual(annotationBounds({ ...upright, rotation: undefined }), { x: 200, y: 160, width: 200, height: 80 });
});

test('selection and export answer the same question the same way', () => {
  assert.deepEqual(annotationBounds(rotated), exportBounds(rotated));
  assert.deepEqual(annotationBounds(upright), exportBounds(upright));
});

test('a marquee over a visible corner selects the rotated box', () => {
  // A: canto superior, em (233,115) — acima do retângulo guardado, que começa em y 160.
  assert.equal(annotationIntersectsRect(rotated, { x: 220, y: 108, width: 34, height: 34 }), true);
  // B: canto direito, em (407,215) — à direita do retângulo guardado, que termina em x 400.
  assert.equal(annotationIntersectsRect(rotated, { x: 402, y: 202, width: 26, height: 26 }), true);
});

test('a marquee far from the rotated box still selects nothing', () => {
  assert.equal(annotationIntersectsRect(rotated, { x: 430, y: 300, width: 20, height: 20 }), false);
  assert.equal(annotationIntersectsRect(rotated, { x: 100, y: 40, width: 20, height: 20 }), false);
});

test('polygons, lines and points are untouched by the box rule', () => {
  const polygon = {
    id: 'p', asset: 'a', label: 'c', type: 'polygon', holes: [],
    vertices: [{ id: 'v0', x: 10, y: 10 }, { id: 'v1', x: 100, y: 10 }, { id: 'v2', x: 100, y: 100 }],
  };
  assert.deepEqual(annotationBounds(polygon), { x: 10, y: 10, width: 90, height: 90 });
  assert.deepEqual(annotationBounds({ id: 'k', asset: 'a', label: 'c', type: 'point', x: 50, y: 60 }), { x: 46, y: 56, width: 8, height: 8 });
});
