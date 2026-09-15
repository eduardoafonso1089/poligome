import test from 'node:test';
import assert from 'node:assert/strict';
import { resizeBoxFromCorner } from '../app/editor/geometry/annotation-geometry.ts';
import { boxCorners } from '../app/editor/export/annotation-export.ts';

function close(actual, expected, epsilon=1e-8) {
  assert.ok(Math.abs(actual-expected) < epsilon, `${actual} != ${expected}`);
}

test('resizing a rotated box keeps the opposite visual corner fixed', () => {
  const box={
    id:'b',asset:'img',label:'x',type:'box',
    x:200,y:150,width:240,height:120,rotation:Math.PI/4,
  };
  const before=boxCorners(box);
  // Drag the north-west visual corner to an arbitrary editor-space point.
  const resized=resizeBoxFromCorner(box,'nw',{x:140,y:90});
  const after=boxCorners(resized);
  // SE is the corner opposite NW and must remain visually anchored.
  close(after[2].x,before[2].x);
  close(after[2].y,before[2].y);
  assert.equal(resized.rotation,box.rotation);
  assert.ok(resized.width > 0);
  assert.ok(resized.height > 0);
});

test('axis-aligned resize preserves canonical width/height semantics', () => {
  const box={id:'b',asset:'img',label:'x',type:'box',x:100,y:100,width:100,height:80};
  const resized=resizeBoxFromCorner(box,'se',{x:260,y:240});
  assert.deepEqual(
    {x:resized.x,y:resized.y,width:resized.width,height:resized.height},
    {x:100,y:100,width:160,height:140},
  );
});
