import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const chrome = readFileSync(new URL('../app/editor/presentation/pre-refactor-chrome.tsx', import.meta.url), 'utf8');

test('multi-select lives in the main toolbar only on touch devices', () => {
  const toolbar = chrome.match(/<div className="tools">([\s\S]*?)<\/div>\n    \{canEdit && <div className="drawing-actions">/)?.[1] ?? '';
  const drawingActions = chrome.match(/\{canEdit && <div className="drawing-actions">([\s\S]*?)<\/div>\}/)?.[1] ?? '';

  assert.match(toolbar, /props\.touchMode[^\n]*copy\.multipleSelection[^\n]*props\.onToggleMultiSelect/);
  assert.doesNotMatch(toolbar, /title=\{copy\.merge\}/);
  assert.doesNotMatch(toolbar, /onClick=\{props\.onMerge\}/);
  assert.doesNotMatch(drawingActions, /copy\.multipleSelection|props\.onToggleMultiSelect/);
});

test('mobile drawing actions do not duplicate pan or delete', () => {
  const drawingActions = chrome.match(/\{canEdit && <div className="drawing-actions">([\s\S]*?)<\/div>\}/)?.[1] ?? '';
  assert.doesNotMatch(drawingActions, /props\.touchMode[^\n]*props\.onTool\([^\n]*"pan"/);
  assert.doesNotMatch(drawingActions, /props\.touchMode[^\n]*props\.onDelete/);
});
