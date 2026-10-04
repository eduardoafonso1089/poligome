import test from 'node:test';
import assert from 'node:assert/strict';
import { localEndpointError } from '../app/lib/local-endpoint.ts';
import { connectorBaseUrl } from '../app/lib/sam-connector.ts';
import { registerRuntimeImage, fetchRuntimeHealth } from '../app/lib/runtime-client.ts';
import { preannotationUndoPlan } from '../app/lib/preannotation-undo.ts';
import { createEditorState, editorReducer } from '../app/editor/state/editor-state.ts';
import { requestSamPredictions } from '../app/lib/sam.ts';
import { getCopy } from '../app/lib/i18n.ts';
import { getAiCopy } from '../app/lib/ai-copy.ts';
import { ConnectionsPanel } from '../app/components/AiHubPanels.tsx';
import { render, text, buttons } from './helpers/render.mjs';
import { box } from './helpers/editor-fixtures.mjs';
import { QualityReviewPanel } from '../app/editor/review/quality-review-panel.tsx';
import { containModalFocus } from '../app/lib/modal-focus.ts';

test('model endpoints reject malformed URLs and non-local destinations', () => {
  for (const address of ['http://127.0.0.1:7861', 'https://localhost:7860/predict', 'http://[::1]:7861']) {
    assert.equal(localEndpointError(address), null);
  }
  for (const address of ['', 'abc', 'file:///etc/passwd', 'http://localhost:99999', 'http://user:password@localhost', 'http://localhost?q=x']) {
    assert.equal(localEndpointError(address), 'invalid');
  }
  for (const address of ['https://example.com', 'http://localhost.example.com', 'http://192.168.0.3:7861']) {
    assert.equal(localEndpointError(address), 'remote');
    assert.equal(connectorBaseUrl(address), '');
  }
});

test('runtime rejects image upload to a remote URL before sending any bytes', async () => {
  await assert.rejects(registerRuntimeImage('https://example.com', 'test', new Blob(['image'])), { code: 'invalid_endpoint' });
  assert.equal(await fetchRuntimeHealth('abc'), null);
});

test('SAM rejects a saved remote endpoint before preparing or sending an image', async () => {
  const copy = getCopy('pt');
  await assert.rejects(requestSamPredictions({ endpoint: 'https://example.com/predict', asset: {}, copy }), { message: copy.errSamInvalidEndpoint });
});

test('invalid addresses have an accessible error and a disabled Check button in each language', () => {
  for (const language of ['pt', 'en', 'fr', 'es']) {
    const copy = getAiCopy(language);
    const service = { state: 'offline', endpoint: 'abc', host: null, serving: '', onEndpoint() {}, onRetry() {} };
    const markup = render(ConnectionsPanel, { copy, connector: service, runtime: service, containers: [], onShowInstall() {}, onShowAddModel() {}, onShowRuntimeInstall() {} });
    assert.match(markup, /aria-invalid="true"/);
    assert.match(markup, /role="alert"/);
    assert.ok(text(markup).includes(copy.connInvalidAddress));
    assert.equal(buttons(markup).filter(button => /disabled/.test(button)).length, 2);
  }
});

test('undoing repeated container inference restores previous geometry and keeps manual work', () => {
  const previous = { ...box(), id: 'byom:example-old', x: 123 };
  const generated = { ...box(), id: 'byom:example-new', x: 456 };
  const manual = { ...box(), id: 'manual', x: 789 };
  const state = createEditorState([generated, manual]);
  const plan = preannotationUndoPlan(state.annotations, [generated.id], [previous]);
  const restored = editorReducer(state, { type: 'replace-annotations-batch', ...plan });
  assert.deepEqual(restored.annotations, [previous, manual]);
  assert.deepEqual(editorReducer(restored, { type: 'undo' }).annotations, [generated, manual]);
});

test('preannotation Undo does not duplicate an old result already restored with Ctrl+Z', () => {
  const previous = { ...box(), id: 'byom:example-old' };
  assert.deepEqual(preannotationUndoPlan([previous], ['new'], [previous]), { removeIds: [], annotations: [], selectIds: [] });
});

test('AI dialog focuses its first control, wraps Tab and Shift+Tab, and restores the opener', () => {
  const listeners = new Map();
  const doc = {
    activeElement: null,
    addEventListener(name, handler) { listeners.set(name, handler); },
    removeEventListener(name, handler) { if (listeners.get(name) === handler) listeners.delete(name); },
    querySelectorAll() { return [dialog]; },
  };
  const control = (disabled = false) => ({
    isConnected: true, tabIndex: 0,
    focus() { doc.activeElement = this; },
    matches() { return disabled; }, closest() { return null; }, getClientRects() { return [1]; },
  });
  const opener = control();
  const first = control();
  const disabled = control(true);
  const last = control();
  const dialog = {
    ownerDocument: doc,
    querySelectorAll() { return [first, disabled, last]; },
    contains(node) { return [first, disabled, last].includes(node); },
    focus() { doc.activeElement = this; },
  };
  doc.activeElement = opener;
  const cleanup = containModalFocus(dialog);
  assert.equal(doc.activeElement, first);
  let prevented = false;
  last.focus();
  listeners.get('keydown')({ key: 'Tab', shiftKey: false, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(doc.activeElement, first);
  listeners.get('keydown')({ key: 'Tab', shiftKey: true, preventDefault() {} });
  assert.equal(doc.activeElement, last);
  opener.focus();
  listeners.get('focusin')();
  assert.equal(doc.activeElement, first);
  cleanup();
  assert.equal(doc.activeElement, opener);
  assert.equal(listeners.size, 0);
});

test('review scores are disabled until their image, annotation or class exists', () => {
  const props = { mode: 'review', assets: [], labels: [], annotations: [], activeAsset: null, activeAnnotation: null, activeLabelId: '', copy: getCopy('pt'), language: 'pt', onModeChange() {}, onActiveLabelChange() {}, onAssetReview() {}, onAnnotationReview() {}, onLabelReview() {} };
  assert.equal(buttons(render(QualityReviewPanel, props)).filter(button => /disabled/.test(button)).length, 15);
  for (const language of ['pt', 'en', 'fr', 'es']) {
    const copy = getCopy(language);
    const markup = render(QualityReviewPanel, { ...props, copy, language });
    assert.ok(text(markup).includes(copy.reviewNoScore));
    assert.ok(buttons(markup).some(button => button.includes(copy.reviewScoreNumber.replace('{score}', '1'))));
  }
  const available = { ...props, activeAsset: { id: 'img', name: 'example.jpg' }, activeAnnotation: box(), labels: [{ id: 'class-a', name: 'Object', color: '#000' }], activeLabelId: 'class-a' };
  assert.equal(buttons(render(QualityReviewPanel, available)).filter(button => /disabled/.test(button)).length, 0);
});
