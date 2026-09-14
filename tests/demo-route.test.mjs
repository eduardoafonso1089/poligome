import test from 'node:test'; import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs';
import { demoRouteTarget } from '../app/editor/session/demo-route.ts';
test('demo query is consumed while preserving other URL state',()=>{
  assert.equal(demoRouteTarget('https://poligome.com/annotate?demo=1&foo=bar#x'),'/annotate?foo=bar#x');
  assert.equal(demoRouteTarget('https://poligome.com/annotate?foo=bar'),null);
});
test('canonical workbench consumes demo=1, clears URL and loads demo',()=>{
  const s=readFileSync(new URL('../app/editor/workbench/canonical-editor-workbench.tsx',import.meta.url),'utf8');
  assert.match(s,/demoRouteTarget\(window\.location\.href\)/); assert.match(s,/window\.history\.replaceState/); assert.match(s,/loadDemo\(/);
});
test('tutorial transitions preserve the user-selected tool',()=>{
  const s=readFileSync(new URL('../app/editor/workbench/canonical-editor-workbench.tsx',import.meta.url),'utf8');
  const transitions=s.slice(s.indexOf('function advanceDemoToEdit'),s.indexOf('function exploreDemoModels'));
  const firstStep=s.slice(s.indexOf('if (demoTutorialStep === 0)'),s.indexOf('if (demoTutorialStep === 2)'));
  assert.doesNotMatch(transitions,/setTool\(/);
  assert.doesNotMatch(firstStep,/setTool\(/);
});
