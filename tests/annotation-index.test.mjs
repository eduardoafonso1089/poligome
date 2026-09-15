import test from 'node:test';
import assert from 'node:assert/strict';
import { indexAnnotations } from '../app/editor/state/annotation-index.ts';

const point = (id, asset, label = 'label') => ({ id, asset, label, type: 'point', x: 1, y: 1 });

test('progressive imports keep untouched image buckets stable', () => {
  const active = point('active-1', 'active-image');
  const initial = indexAnnotations([active]);
  const afterOtherImage = indexAnnotations([active, point('other-1', 'other-image', 'other-label')], initial);

  assert.equal(afterOtherImage.byAsset.get('active-image'), initial.byAsset.get('active-image'));
  assert.equal(afterOtherImage.countByAsset.get('active-image'), 1);
  assert.equal(afterOtherImage.countByAsset.get('other-image'), 1);
  assert.equal(afterOtherImage.countByLabel.get('other-label'), 1);
});

test('an append for the active image updates only its bucket', () => {
  const active = point('active-1', 'active-image');
  const other = point('other-1', 'other-image');
  const initial = indexAnnotations([active, other]);
  const next = indexAnnotations([active, other, point('active-2', 'active-image')], initial);

  assert.notEqual(next.byAsset.get('active-image'), initial.byAsset.get('active-image'));
  assert.equal(next.byAsset.get('other-image'), initial.byAsset.get('other-image'));
  assert.equal(next.countByAsset.get('active-image'), 2);
});
