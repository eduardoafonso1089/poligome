import assert from 'node:assert/strict';
import test from 'node:test';
import { createEditorState, editorReducer } from '../app/editor/state/editor-state.ts';
import { createLabel, ensureUnlabeledLabel, moveItemById, recolorLabel, removeLabelsAndReclassify, renameLabel, stackAnnotationsByLabel } from '../app/editor/panels/panel-model.ts';

const labels = [
  { id: 'unlabeled', name: 'Sem label', color: '#929a95', key: '' },
  { id: 'weed', name: 'Weed', color: '#00ff00', key: '1' },
  { id: 'crop', name: 'Crop', color: '#0000ff', key: '2' },
];
const annotations = [
  { id: 'a1', asset: 'img-a', label: 'weed', type: 'point', x: 10, y: 10 },
  { id: 'b1', asset: 'img-b', label: 'crop', type: 'point', x: 20, y: 20 },
  { id: 'a2', asset: 'img-a', label: 'crop', type: 'point', x: 30, y: 30 },
];

test('class deletion moves affected annotations to the protected unlabeled class', () => {
  const result = removeLabelsAndReclassify(labels, annotations, ['weed']);
  assert.equal(result.affected, 1);
  assert.equal(result.labels.some((label) => label.id === 'weed'), false);
  assert.equal(result.annotations.find((annotation) => annotation.id === 'a1').label, 'unlabeled');
  assert.equal(result.annotations.find((annotation) => annotation.id === 'a2').label, 'crop');
});

test('protected unlabeled class cannot be renamed, recolored, or removed', () => {
  assert.equal(renameLabel(labels, 'unlabeled', 'Other'), labels);
  assert.equal(recolorLabel(labels, 'unlabeled', '#ffffff'), labels);
  const result = removeLabelsAndReclassify(labels, annotations, ['unlabeled']);
  assert.equal(result.labels, labels);
  assert.equal(result.annotations, annotations);
});

test('class creation rejects duplicate names and image reorder is stable', () => {
  assert.equal(createLabel(labels, 'duplicate', 'Weed'), labels);
  const created = createLabel(labels, 'tree', 'Tree', '#123456');
  assert.equal(created.at(-1).name, 'Tree');
  const assets = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(moveItemById(assets, 'b', -1).map((item) => item.id), ['b', 'a', 'c']);
});

test('unlabeled class is created only when an annotation needs a fallback class', () => {
  const fallback = ensureUnlabeledLabel([], 'Sem label');
  assert.deepEqual(fallback, [{ id: 'unlabeled', name: 'Sem label', color: '#929a95', key: '' }]);
  assert.equal(ensureUnlabeledLabel(fallback, 'Outro nome'), fallback);
});

test('annotation stacking draws classes from the first list item in back to the last item in front', () => {
  const overlapping = [
    { id: 'crop-first', asset: 'img-a', label: 'crop', type: 'point', x: 10, y: 10 },
    { id: 'weed', asset: 'img-a', label: 'weed', type: 'point', x: 10, y: 10 },
    { id: 'crop-second', asset: 'img-a', label: 'crop', type: 'point', x: 10, y: 10 },
  ];

  assert.deepEqual(
    stackAnnotationsByLabel(overlapping, labels).map((annotation) => annotation.id),
    ['weed', 'crop-first', 'crop-second'],
  );
});

test('annotation reorder stays inside the same asset even when global array is interleaved', () => {
  let state = createEditorState(annotations);
  state = editorReducer(state, { type: 'reorder-annotation', id: 'a2', delta: -1 });
  assert.deepEqual(state.annotations.map((annotation) => annotation.id), ['a2', 'b1', 'a1']);
  assert.equal(state.history.length, 1);
});

test('batch reclassification is one undoable editor operation', () => {
  let state = createEditorState(annotations);
  state = editorReducer(state, { type: 'reclassify-annotations', ids: ['a1', 'a2'], labelId: 'crop' });
  assert.equal(state.annotations.find((annotation) => annotation.id === 'a1').label, 'crop');
  assert.equal(state.history.length, 1);
  state = editorReducer(state, { type: 'undo' });
  assert.equal(state.annotations.find((annotation) => annotation.id === 'a1').label, 'weed');
});
