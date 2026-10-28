import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useCanvasInteractions } from '../app/editor/interactions/use-canvas-interactions.ts';
import { createEditorState, editorReducer } from '../app/editor/state/editor-state.ts';
import { box, polygon } from './helpers/editor-fixtures.mjs';
import { useAdvancedVectorInteractions } from '../app/editor/interactions/use-advanced-vector-interactions.ts';

// Run the real hook callbacks against the real reducer. No DOM simulation is
// needed for this layer; capture routing and repainting are checked in-browser.
function setup({ scale = 1, multi = false, shapes } = {}) {
  const masks = shapes ?? [polygon(), polygon({ id: 'second' })];
  let state = createEditorState(masks);
  if (multi) state = editorReducer(state, { type: 'set-selection', selection: { selected: 'poly', multiSelected: ['poly', 'second'] } });
  const captures = [];
  const svg = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000 * scale, height: 1000 * scale }),
    setPointerCapture: id => captures.push(id),
  };
  const shape = { setPointerCapture: () => assert.fail('capture must stay on the stable SVG') };
  let interactions;
  function Harness() {
    interactions = useCanvasInteractions({
      svgRef: { current: svg }, imageSize: { width: 1000, height: 1000 }, state,
      dispatch: action => { state = editorReducer(state, action); }, makeId: prefix => `${prefix}:new`,
    });
    return null;
  }
  renderToStaticMarkup(React.createElement(Harness));
  const event = (x, y, overrides = {}) => ({
    clientX: x, clientY: y, pointerId: 1, button: 0, buttons: 1,
    currentTarget: shape, stopPropagation() {}, preventDefault() {}, ...overrides,
  });
  return { interactions, event, masks, captures, state: () => state,
    dispatch: action => { state = editorReducer(state, action); } };
}

test('a selection click and small hand jitter leave every vertex and undo history unchanged', () => {
  const h = setup();
  h.interactions.beginAnnotationDrag(h.event(14, 14), h.masks[0]);
  h.interactions.moveAnnotation(h.event(16, 15));
  h.interactions.finishAnnotation(h.event(16, 15, { buttons: 0 }));
  h.interactions.moveAnnotation(h.event(300, 200, { buttons: 0 }));
  assert.deepEqual(h.state().annotations, h.masks);
  assert.equal(h.state().selection.selected, 'poly');
  assert.equal(h.state().history.length, 0);
  assert.equal(h.state().gesture, null);
  assert.deepEqual(h.captures, [1]);
});

test('vertex selection ignores jitter, missed release and right-click without deforming a mask', () => {
  const h = setup();
  h.interactions.beginVertexDrag(h.event(10, 10), h.masks[0], 'v0');
  h.interactions.moveVertex(h.event(12, 11));
  h.interactions.moveVertex(h.event(300, 200, { buttons: 0 }));
  h.interactions.beginVertexDrag(h.event(10, 10, { button: 2 }), h.masks[0], 'v0');
  h.interactions.moveVertex(h.event(300, 200));
  assert.deepEqual(h.state().annotations, h.masks);
  assert.equal(h.state().history.length, 0);
  assert.equal(h.state().selectedVertex.vertexId, 'v0');
});

test('intentional vertex editing is one undo step and stops on release', () => {
  const h = setup();
  h.interactions.beginVertexDrag(h.event(10, 10), h.masks[0], 'v0');
  h.interactions.moveVertex(h.event(20, 20));
  h.interactions.finishVertex(h.event(20, 20, { buttons: 0 }));
  h.interactions.moveVertex(h.event(400, 300, { buttons: 0 }));
  assert.equal(h.state().annotations[0].vertices[0].x, 20);
  assert.equal(h.state().history.length, 1);
  h.dispatch({ type: 'undo' });
  assert.deepEqual(h.state().annotations, h.masks);
});

test('box resize and rotation require primary-button movement, not clicks or hover', () => {
  for (const kind of ['resize', 'rotate']) {
    const h = setup({ shapes: [box()] });
    const begin = event => kind === 'resize'
      ? h.interactions.resizeStart(event, h.masks[0], 'nw')
      : h.interactions.rotateStart(event, h.masks[0]);
    const move = kind === 'resize' ? h.interactions.resizeMove : h.interactions.transformMove;
    begin(h.event(40, 50));
    move(h.event(41, 51));
    move(h.event(300, 200, { buttons: 0 }));
    begin(h.event(40, 50, { button: 2 }));
    move(h.event(300, 200));
    assert.deepEqual(h.state().annotations, h.masks);
    assert.equal(h.state().history.length, 0);
  }
});

test('clicking polygon transform leaves fractional coordinates exactly intact', () => {
  const original = polygon({ vertices: [{ id: 'a', x: 10.3, y: 12.7 }, { id: 'b', x: 150.6, y: 17.2 }, { id: 'c', x: 101.4, y: 180.9 }] });
  let state = createEditorState([original]);
  let advanced;
  const svg = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }) };
  const event = (x, y, buttons = 1) => ({ clientX: x, clientY: y, pointerId: 1, button: 0, buttons, currentTarget: svg });
  function Harness() {
    advanced = useAdvancedVectorInteractions({ svgRef: { current: svg }, imageSize: { width: 1000, height: 1000 }, tool: 'transform', activePolygon: original, makeId: () => 'id', dispatch: action => { state = editorReducer(state, action); } });
    return null;
  }
  renderToStaticMarkup(React.createElement(Harness));
  advanced.onPointerDown(event(150.6, 17.2));
  advanced.onPointerMove(event(151, 18));
  advanced.onPointerUp(event(151, 18, 0));
  assert.deepEqual(state.annotations, [original]);
  assert.equal(state.history.length, 0);
  advanced.onPointerDown(event(150, 18));
  advanced.onPointerMove(event(800, 700, 0));
  assert.deepEqual(state.annotations, [original]);
  advanced.onPointerDown(event(150, 18));
  advanced.onPointerMove(event(180, 35));
  advanced.onLostPointerCapture(event(0, 0, 0));
  assert.notDeepEqual(state.annotations, [original]);
  assert.equal(state.history.length, 1);
  state = editorReducer(state, { type: 'undo' });
  assert.deepEqual(state.annotations, [original]);
});

test('a missed release is recovered before a hover can move a mask or start a later drag', () => {
  const h = setup();
  h.interactions.beginAnnotationDrag(h.event(14, 14), h.masks[0]);
  h.interactions.moveAnnotation(h.event(300, 200, { buttons: 0 }));
  h.interactions.moveAnnotation(h.event(350, 250));
  assert.deepEqual(h.state().annotations, h.masks);
  assert.equal(h.state().history.length, 0);
});

test('an intentional drag moves the whole selection and commits one undo step on capture loss', () => {
  const h = setup({ multi: true });
  h.interactions.beginAnnotationDrag(h.event(20, 20), h.masks[0]);
  h.interactions.moveAnnotation(h.event(30, 25));
  h.interactions.moveAnnotation(h.event(40, 30));
  h.interactions.finishAnnotation(h.event(40, 30, { type: 'lostpointercapture', buttons: 0 }));
  h.interactions.moveAnnotation(h.event(400, 300, { buttons: 0 }));
  assert.equal(h.state().annotations[0].vertices[0].x, 30);
  assert.equal(h.state().annotations[1].vertices[0].x, 30);
  assert.equal(h.state().history.length, 1);
  h.dispatch({ type: 'undo' });
  assert.deepEqual(h.state().annotations, h.masks);
});

test('drag threshold stays in screen pixels when zoom changes', () => {
  const h = setup({ scale: 0.1 });
  h.interactions.beginAnnotationDrag(h.event(10, 10), h.masks[0]);
  h.interactions.moveAnnotation(h.event(12, 11));
  assert.deepEqual(h.state().annotations, h.masks);
  h.interactions.moveAnnotation(h.event(15, 10));
  h.interactions.finishAnnotation(h.event(15, 10, { buttons: 0 }));
  assert.equal(h.state().annotations[0].vertices[0].x, 60);
  assert.equal(h.state().history.length, 1);
});

test('a different pointer cannot move or finish the drag, and cancel restores its geometry', () => {
  const h = setup();
  h.interactions.beginAnnotationDrag(h.event(20, 20), h.masks[0]);
  h.interactions.moveAnnotation(h.event(60, 60, { pointerId: 2 }));
  h.interactions.finishAnnotation(h.event(60, 60, { pointerId: 2 }));
  assert.deepEqual(h.state().annotations, h.masks);
  h.interactions.moveAnnotation(h.event(30, 30));
  h.interactions.cancel();
  assert.deepEqual(h.state().annotations, h.masks);
  assert.equal(h.state().history.length, 0);
});

test('right-click and modifier selections never arm an annotation drag', () => {
  for (const modifiers of [{ button: 2, buttons: 2 }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
    const h = setup();
    h.interactions.beginAnnotationDrag(h.event(20, 20, modifiers), h.masks[0]);
    h.interactions.moveAnnotation(h.event(50, 50));
    assert.deepEqual(h.state().annotations, h.masks);
    assert.equal(h.state().gesture, null);
    assert.deepEqual(h.captures, []);
  }
});
