import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const chrome = readFileSync(new URL('../app/editor/presentation/pre-refactor-chrome.tsx', import.meta.url), 'utf8');

test('mobile drawing actions keep multi-select but do not duplicate pan or delete', () => {
  const drawingActions = chrome.match(/\{canEdit && <div className="drawing-actions">([\s\S]*?)<\/div>\}/)?.[1] ?? '';
  assert.doesNotMatch(drawingActions, /props\.touchMode[^\n]*props\.onTool\([^\n]*"pan"/);
  assert.match(drawingActions, /props\.touchMode[^\n]*props\.tool === "select"[^\n]*props\.onToggleMultiSelect/);
  assert.doesNotMatch(drawingActions, /props\.touchMode[^\n]*props\.onDelete/);
});
