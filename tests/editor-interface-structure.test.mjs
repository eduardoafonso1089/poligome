import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const read = (path) => fs.readFile(new URL(path, import.meta.url), 'utf8');

test('annotate route delegates directly to the canonical workbench while presentation lives in editor chrome', async () => {
  const [page, workbench, chrome, exactCss] = await Promise.all([
    read('../app/annotate/page.tsx'),
    read('../app/editor/workbench/canonical-editor-workbench.tsx'),
    read('../app/editor/presentation/pre-refactor-chrome.tsx'),
    read('../app/editor/presentation/pre-refactor-canonical.module.css'),
  ]);
  assert.match(page, /CanonicalEditorWorkbench/);
  assert.doesNotMatch(page, /annotate-interface\.module\.css|annotate-drawer-state\.module\.css/);
  assert.match(workbench, /PreRefactorTopbar/);
  assert.match(workbench, /PreRefactorToolbar/);
  assert.match(workbench, /PreRefactorStatus/);
  assert.match(chrome, /className="topbar"/);
  assert.match(chrome, /className="menubar"/);
  assert.match(chrome, /className="tools"/);
  assert.match(exactCss, /canonical-management-panels/);
  assert.match(exactCss, /@media \(max-width: 860px\)/);
});

test('management, vector and review surfaces keep canonical editor behavior modules', async () => {
  const [panels, vector, review, css] = await Promise.all([
    read('../app/editor/panels/editor-management-panels.tsx'),
    read('../app/editor/vector/vector-toolbar.tsx'),
    read('../app/editor/review/quality-review-panel.tsx'),
    read('../app/editor/editor-interface.module.css'),
  ]);
  for (const source of [panels, vector, review]) assert.match(source, /editor-interface\.module\.css/);
  assert.doesNotMatch(panels, /const panelStyle|const listStyle|const rowStyle/);
  assert.doesNotMatch(vector, /style=\{\{/);
  assert.match(css, /\.managementGrid/);
  assert.match(css, /\.vectorBar/);
  assert.match(css, /\.reviewPanel/);
});

test('documentation calls this an interface structure and records SAM as a separate-branch integration', async () => {
  const [architecture, readme] = await Promise.all([
    read('../docs/EDITOR_ARCHITECTURE.md'),
    read('../README.md'),
  ]);
  assert.match(architecture, /## Interface structure/);
  assert.doesNotMatch(architecture, /canonical shell|editor shell/i);
  assert.match(architecture, /SAM is not a merge blocker/);
  assert.match(architecture, /integrated from a separate branch/);
  assert.match(readme, /local SAM UI is intentionally not part of this\s+> branch's merge target/i);
  assert.match(readme, /canonical editor uses the same global visual tokens/);
});
