import test from 'node:test';
import assert from 'node:assert/strict';
import { region, sourceOf } from './helpers/source.mjs';
import { demoRouteTarget } from '../app/editor/session/demo-route.ts';

test('demo query is consumed while preserving other URL state', () => {
  assert.equal(demoRouteTarget('https://poligome.com/annotate?demo=1&foo=bar#x'), '/annotate?foo=bar#x');
  assert.equal(demoRouteTarget('https://poligome.com/annotate?foo=bar'), null);
});

test('canonical workbench consumes demo=1, clears URL and loads demo', () => {
  // The consumption happens in an effect against window.location, so the
  // assertion is on the wiring; scripts/run-demo-entry-audit.mjs proves the
  // effect in a browser.
  const workbench = sourceOf('app/editor/workbench/canonical-editor-workbench.tsx');
  assert.match(workbench, /demoRouteTarget\(window\.location\.href\)/);
  assert.match(workbench, /window\.history\.replaceState/);
  assert.match(workbench, /loadDemo\(/);
});

test('tutorial transitions preserve the user-selected tool', () => {
  const path = 'app/editor/workbench/canonical-editor-workbench.tsx';
  const transitions = region(path, 'function advanceDemoToEdit', 'function exploreDemoModels');
  const firstStep = region(path, 'if (demoTutorialStep === 0)', 'if (demoTutorialStep === 2)');
  assert.doesNotMatch(transitions, /setTool\(/);
  assert.doesNotMatch(firstStep, /setTool\(/);
});
