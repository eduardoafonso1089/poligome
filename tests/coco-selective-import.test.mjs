import test from 'node:test';
import assert from 'node:assert/strict';
import { planCocoDocument, importCocoDocument } from '../app/editor/import/coco-document-import.ts';

const assets = [
  { id: 'a', name: 'one.png', src: 'blob:a', local: true, width: 1000, height: 500 },
  { id: 'b', name: 'two.png', src: 'blob:b', local: true, width: 800, height: 600 },
];
const labels = [{ id: 'unlabeled', name: 'Sem label', color: '#999999', key: '' }];
const document = {
  images: [
    { id: 1, file_name: 'one.png', width: 1000, height: 500 },
    { id: 2, file_name: 'two.png', width: 800, height: 600 },
    { id: 3, file_name: 'missing.png', width: 200, height: 200 },
  ],
  categories: [
    { id: 10, name: 'weed' },
    { id: 20, name: 'crop' },
  ],
  annotations: [
    { image_id: 1, category_id: 10, segmentation: [[0, 0, 100, 0, 100, 100]], bbox: [0, 0, 100, 100] },
    { image_id: 2, category_id: 20, bbox: [10, 20, 30, 40] },
    { image_id: 3, category_id: 10, bbox: [1, 2, 3, 4] },
  ],
};

function makeId(prefix) { return `${prefix}-${Math.random()}`; }

test('COCO planning exposes only annotations whose images are loaded', () => {
  const plan = planCocoDocument(document, assets);
  assert.equal(plan.candidates.length, 2);
  assert.equal(plan.unmatched, 1);
  assert.deepEqual(plan.geometryTypes, ['box', 'polygon']);
  assert.equal(plan.candidates[0].labelName, 'weed');
  assert.equal(plan.candidates[1].imageName, 'two.png');
});

test('selective COCO import filters annotation indexes and geometry types', () => {
  const result = importCocoDocument(document, assets, labels, makeId, {
    selectedAnnotationIndexes: [0],
    geometryTypes: ['polygon'],
  });
  assert.equal(result.annotations.length, 1);
  assert.equal(result.annotations[0].type, 'polygon');
  assert.equal(result.labels.some((label) => label.name === 'weed'), true);
  assert.equal(result.labels.some((label) => label.name === 'crop'), false);
});

test('selective COCO import does not materialize a class when its geometry is filtered out', () => {
  const result = importCocoDocument(document, assets, labels, makeId, {
    selectedAnnotationIndexes: [1],
    geometryTypes: ['polygon'],
  });
  assert.equal(result.annotations.length, 0);
  assert.equal(result.labels.some((label) => label.name === 'crop'), false);
});
