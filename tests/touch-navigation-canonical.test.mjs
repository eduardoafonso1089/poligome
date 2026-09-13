import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ViewportController } from '../app/editor/viewport/viewport-controller.ts';

const touchSource=readFileSync(new URL('../app/editor/viewport/use-touch-navigation.ts',import.meta.url),'utf8');
const drawingSource=readFileSync(new URL('../app/editor/drawing/use-drawing-interactions.ts',import.meta.url),'utf8');
const workbenchSource=readFileSync(new URL('../app/editor/workbench/canonical-editor-workbench.tsx',import.meta.url),'utf8');
const chromeSource=readFileSync(new URL('../app/editor/presentation/pre-refactor-chrome.tsx',import.meta.url),'utf8');

test('one-finger pan follows the pointer while preserving logical geometry',()=>{
  const viewport=new ViewportController({
    viewport:{width:500,height:325},
    image:{width:1000,height:650},
    zoom:200,
    scrollLeft:250,
    scrollTop:150,
  });
  const before=viewport.snapshot();
  const after=viewport.panBy(40,-25);
  assert.equal(after.zoom,before.zoom);
  assert.deepEqual(after.image,before.image);
  assert.equal(after.scrollLeft,210);
  assert.equal(after.scrollTop,175);
});

test('pinch-pan combines scale and moving midpoint without annotation rescaling',()=>{
  const viewport=new ViewportController({
    viewport:{width:500,height:325},
    image:{width:1000,height:650},
    zoom:200,
    scrollLeft:200,
    scrollTop:100,
  });
  const before=viewport.snapshot();
  const after=viewport.pinchPan(
    220,
    {left:-200,top:-100,width:1000,height:650},
    {x:250,y:160},
    {x:270,y:175},
  );
  assert.equal(after.zoom,220);
  assert.deepEqual(after.image,before.image);
  assert.ok(Number.isFinite(after.scrollLeft));
  assert.ok(Number.isFinite(after.scrollTop));
});

test('second touch cancels editing and drawing before pinch owns the gesture',()=>{
  assert.match(touchSource,/cancelEditing\(\)/);
  assert.match(touchSource,/cancelDrawing\(\)/);
  assert.match(touchSource,/gesture\.points\.size/);
  assert.match(touchSource,/pinchZoom/);
  assert.match(touchSource,/stopPropagation\(\)/);
});

test('discrete touch drawing commits on pointerup, not pointerdown',()=>{
  assert.match(drawingSource,/event\.pointerType === "touch"/);
  assert.match(drawingSource,/start\.pointerType === "touch"/);
  assert.match(drawingSource,/if \(!start\.moved\) appendDiscretePoint/);
});

test('canonical workbench exposes localized hand tool through presentation and capture-phase touch navigation',()=>{
  assert.match(chromeSource,/title=\{copy\.pan\}[^>]*onClick=\{\(\) => props\.onTool\("pan"\)\}/);
  assert.match(workbenchSource,/onPointerDownCapture=\{touch\.onPointerDownCapture\}/);
  assert.match(workbenchSource,/onPointerMoveCapture=\{touch\.onPointerMoveCapture\}/);
  assert.match(workbenchSource,/touchMode=\{touch\.touchMode\}/);
});