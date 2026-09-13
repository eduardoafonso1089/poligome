import test from 'node:test'; import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs';
test('workbench and restored chrome expose complete and annotations-only saves',()=>{
  const workbench=readFileSync(new URL('../app/editor/workbench/canonical-editor-workbench.tsx',import.meta.url),'utf8');
  const chrome=readFileSync(new URL('../app/editor/presentation/pre-refactor-chrome.tsx',import.meta.url),'utf8');
  assert.match(workbench,/useState<ProjectSaveMode>\("complete"\)/);
  assert.match(workbench,/saveEditorProject\(projectName, assets, labels, editor\.annotations, mode, copy\)/);
  assert.match(chrome,/projectSaveMode === "complete"/);
  assert.match(chrome,/projectSaveMode === "annotations"/);
  assert.match(chrome,/props\.onSaveProject\(projectSaveMode\)/);
});
