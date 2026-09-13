import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const workbench = readFileSync(new URL('../app/editor/workbench/canonical-editor-workbench.tsx', import.meta.url), 'utf8');
const chrome = readFileSync(new URL('../app/editor/presentation/pre-refactor-chrome.tsx', import.meta.url), 'utf8');
const toolbar = readFileSync(new URL('../app/editor/vector/vector-toolbar.tsx', import.meta.url), 'utf8');

test('canonical project lifecycle protects unsaved replacement and can reset or rename', () => {
  assert.match(workbench, /window\.confirm\(copy\.replaceUnsavedWithNewProject\)/);
  assert.match(workbench, /window\.confirm\(copy\.replaceUnsavedProject\)/);
  assert.match(workbench, /function resetProjectState\(\)/);
  assert.match(workbench, /editor\.replaceAnnotations\(\[\], true\)/);
  assert.match(workbench, /onRenameProject: \(name: string\) => \{ setProjectName\(name\); setSessionDirty\(true\); \}/);
  assert.match(chrome, /className="project-name-input"/);
  assert.match(chrome, /props\.onRenameProject\(next\)/);
  assert.match(workbench, /setMessage\(copy\.newProjectReady\)/);
});

test('polygon duplicate gets a new annotation id and fresh vertex ids', () => {
  assert.match(workbench, /const id = makeId\("copy"\)/);
  assert.match(workbench, /id: `\$\{id\}:outer:v\$\{index\}`/);
  assert.match(workbench, /id: `\$\{id\}:hole-\$\{holeIndex\}:v\$\{vertexIndex\}`/);
  assert.match(workbench, /editor\.addAnnotation\(duplicate, true\)/);
  assert.match(toolbar, /copy\.duplicate/);
  assert.match(toolbar, /onDuplicate/);
});
