import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workbench=readFileSync(new URL('../app/editor/workbench/canonical-editor-workbench.tsx',import.meta.url),'utf8');
const drawing=readFileSync(new URL('../app/editor/drawing/use-drawing-interactions.ts',import.meta.url),'utf8');
const advanced=readFileSync(new URL('../app/editor/interactions/use-advanced-vector-interactions.ts',import.meta.url),'utf8');

test('canonical snap toggle is wired into editing, creation and advanced vector interactions',()=>{
  assert.match(workbench,/const snap = useMemo\(\s*\(\) => \(\{ enabled: snapEnabled, tolerance: snapTolerance, annotations: visibleAnnotations \}\),\s*\[snapEnabled, snapTolerance, visibleAnnotations\],\s*\)/);
  assert.match(workbench,/useCanvasInteractions\(\{[\s\S]*?\bsnap,/);
  assert.match(workbench,/useDrawingInteractions\(\{[\s\S]*?\bsnap,/);
  assert.match(workbench,/useAdvancedVectorInteractions\(\{[\s\S]*?\bsnap,/);
});

test('freehand starts snapped while split and reshape snap their endpoints',()=>{
  assert.match(drawing,/const startPoint = tool === "freehand" \? snapDiscretePoint\(point\) : point/);
  assert.match(advanced,/pointFor\(event, tool === "split" \|\| tool === "reshape"\)/);
  assert.match(advanced,/snapPointToAnnotations/);
});
