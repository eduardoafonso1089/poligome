import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workbench = readFileSync(new URL('../app/editor/workbench/canonical-editor-workbench.tsx', import.meta.url), 'utf8');

test('annotation stroke defaults to 1px', () => {
  assert.match(workbench, /const \[strokePx, setStrokePx\] = useState\(1\);/);
});
