import test from 'node:test';
import assert from 'node:assert/strict';
import { region, sourceOf } from './helpers/source.mjs';

const workbench = sourceOf('app/editor/workbench/canonical-editor-workbench.tsx');

test('canonical snap toggle is wired into editing, creation and advanced vector interactions', () => {
  // One snap object, memoized once, handed to all three interaction hooks: if
  // it were rebuilt per render every hook below would resubscribe on each frame.
  assert.match(workbench, /const snap = useMemo\( \(\) => \(\{ enabled: snapEnabled, tolerance: snapTolerance, annotations: visibleAnnotations \}\), \[snapEnabled, snapTolerance, visibleAnnotations\],? \)/);
  for (const hook of ['useCanvasInteractions({', 'useDrawingInteractions({', 'useAdvancedVectorInteractions({']) {
    assert.match(region('app/editor/workbench/canonical-editor-workbench.tsx', hook, '});'), /\bsnap,/, `${hook} must receive snap`);
  }
});

test('freehand starts snapped while split and reshape snap their endpoints', () => {
  assert.match(
    sourceOf('app/editor/drawing/use-drawing-interactions.ts'),
    /const startPoint = tool === "freehand" \? snapDiscretePoint\(point\) : point/,
  );
  const advanced = sourceOf('app/editor/interactions/use-advanced-vector-interactions.ts');
  assert.match(advanced, /pointFor\(event, tool === "split" \|\| tool === "reshape"\)/);
  assert.match(advanced, /snapPointToAnnotations/);
});
