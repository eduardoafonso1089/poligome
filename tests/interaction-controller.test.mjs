import test from 'node:test';
import assert from 'node:assert/strict';
import { InteractionController } from '../app/editor/interactions/interaction-controller.ts';

test('only one editor interaction can own the pointer at a time', () => {
  const controller = new InteractionController();
  assert.equal(controller.begin('edit', { pointerId: 7, annotationId: 'a' }), true);
  assert.equal(controller.begin('pan', { pointerId: 8 }), false);
  assert.equal(controller.is('edit'), true);
  assert.equal(controller.finish(8), false);
  assert.equal(controller.finish(7), true);
  assert.equal(controller.is('idle'), true);
});

test('cancel always restores idle state', () => {
  const controller = new InteractionController();
  controller.begin('draw', { pointerId: 2 });
  controller.cancel();
  assert.deepEqual(controller.snapshot(), {
    mode: 'idle', pointerId: null, annotationId: null, vertexId: null,
  });
});
