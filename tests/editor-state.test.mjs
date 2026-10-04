import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditorState, editorReducer } from '../app/editor/state/editor-state.ts';

const polygon = {
  id: 'p', asset: 'img', label: 'weed', type: 'polygon', holes: [],
  vertices: [
    { id: 'p:v0', x: 10, y: 10 },
    { id: 'p:v1', x: 100, y: 10 },
    { id: 'p:v2', x: 100, y: 100 },
  ],
};

test('vertex edits are addressed by stable ids and participate in undo/redo', () => {
  let state=createEditorState([polygon]);
  state=editorReducer(state,{type:'update-vertex',annotationId:'p',vertexId:'p:v1',point:{x:120,y:20}});
  assert.equal(state.annotations[0].vertices[1].id,'p:v1');
  assert.deepEqual([state.annotations[0].vertices[1].x,state.annotations[0].vertices[1].y],[120,20]);
  assert.equal(state.history.length,1);
  state=editorReducer(state,{type:'undo'});
  assert.deepEqual([state.annotations[0].vertices[1].x,state.annotations[0].vertices[1].y],[100,10]);
  state=editorReducer(state,{type:'redo'});
  assert.deepEqual([state.annotations[0].vertices[1].x,state.annotations[0].vertices[1].y],[120,20]);
});

test('continuous gesture records one undo snapshot', () => {
  let state=createEditorState([polygon]);
  state=editorReducer(state,{type:'begin-gesture'});
  state=editorReducer(state,{type:'update-vertex',annotationId:'p',vertexId:'p:v1',point:{x:110,y:15}});
  state=editorReducer(state,{type:'update-vertex',annotationId:'p',vertexId:'p:v1',point:{x:120,y:20}});
  state=editorReducer(state,{type:'update-vertex',annotationId:'p',vertexId:'p:v1',point:{x:130,y:25}});
  assert.equal(state.history.length,0);
  state=editorReducer(state,{type:'commit-gesture'});
  assert.equal(state.history.length,1);
  assert.deepEqual([state.annotations[0].vertices[1].x,state.annotations[0].vertices[1].y],[130,25]);
  state=editorReducer(state,{type:'undo'});
  assert.deepEqual([state.annotations[0].vertices[1].x,state.annotations[0].vertices[1].y],[100,10]);
});

test('cancel gesture restores geometry and does not create history', () => {
  let state=createEditorState([polygon]);
  state=editorReducer(state,{type:'begin-gesture'});
  state=editorReducer(state,{type:'translate-annotations',ids:['p'],dx:40,dy:30});
  assert.deepEqual([state.annotations[0].vertices[0].x,state.annotations[0].vertices[0].y],[50,40]);
  state=editorReducer(state,{type:'cancel-gesture'});
  assert.deepEqual([state.annotations[0].vertices[0].x,state.annotations[0].vertices[0].y],[10,10]);
  assert.equal(state.history.length,0);
});

test('inserted vertices keep explicit identity', () => {
  let state=createEditorState([polygon]);
  state=editorReducer(state,{type:'insert-vertex',annotationId:'p',afterVertexId:'p:v0',vertexId:'p:new',point:{x:55,y:10}});
  assert.deepEqual(state.annotations[0].vertices.map(vertex=>vertex.id),['p:v0','p:new','p:v1','p:v2']);
  assert.deepEqual(state.selectedVertex,{annotationId:'p',vertexId:'p:new'});
});

test('deleting a minimum polygon vertex removes the annotation', () => {
  let state=createEditorState([polygon]);
  state=editorReducer(state,{type:'select-vertex',vertex:{annotationId:'p',vertexId:'p:v0'}});
  state=editorReducer(state,{type:'delete-vertex',annotationId:'p',vertexId:'p:v0'});
  assert.equal(state.annotations.length,0);
  assert.equal(state.selection.selected,null);
  assert.equal(state.selectedVertex,null);
});

test('replace-annotations-by-id updates many annotations in place as one undo step', () => {
  const a = { id: 'a', asset: 'img', label: 'weed', type: 'polygon', holes: [], vertices: [
    { id: 'a:v0', x: 0, y: 0 }, { id: 'a:v1', x: 10, y: 0 }, { id: 'a:v2', x: 10, y: 10 }] };
  const b = { id: 'b', asset: 'img', label: 'weed', type: 'polygon', holes: [], vertices: [
    { id: 'b:v0', x: 0, y: 0 }, { id: 'b:v1', x: 20, y: 0 }, { id: 'b:v2', x: 20, y: 20 }] };
  const c = { id: 'c', asset: 'img', label: 'weed', type: 'point', x: 5, y: 5 };
  let state = createEditorState([a, b, c]);
  const nextA = { ...a, vertices: [...a.vertices, { id: 'a:v3', x: 0, y: 10 }] };
  const nextB = { ...b, vertices: [...b.vertices, { id: 'b:v3', x: 0, y: 20 }] };
  state = editorReducer(state, { type: 'replace-annotations-by-id', annotations: [nextA, nextB] });
  // Both replaced, order preserved (a, b, c), single history entry.
  assert.deepEqual(state.annotations.map(annotation => annotation.id), ['a', 'b', 'c']);
  assert.equal(state.annotations[0].vertices.length, 4);
  assert.equal(state.annotations[1].vertices.length, 4);
  assert.equal(state.annotations[2].id, 'c');
  assert.equal(state.history.length, 1);
  state = editorReducer(state, { type: 'undo' });
  assert.equal(state.annotations[0].vertices.length, 3);
  assert.equal(state.annotations[1].vertices.length, 3);
});

test('annotation deletion prunes selection', () => {
  const point={id:'q',asset:'img',label:'weed',type:'point',x:50,y:50};
  let state=createEditorState([polygon,point]);
  state=editorReducer(state,{type:'select-single',id:'p'});
  state=editorReducer(state,{type:'delete-annotations',ids:['p']});
  assert.deepEqual(state.annotations.map(annotation=>annotation.id),['q']);
  assert.equal(state.selection.selected,null);
});

test('incremental imports preserve an active polygon edit and its undo baseline', () => {
  const incoming={id:'loaded',asset:'other-image',label:'weed',type:'point',x:50,y:50};
  let state=createEditorState([polygon]);
  state=editorReducer(state,{type:'select-vertex',vertex:{annotationId:'p',vertexId:'p:v1'}});
  state=editorReducer(state,{type:'begin-gesture'});
  state=editorReducer(state,{type:'update-vertex',annotationId:'p',vertexId:'p:v1',point:{x:120,y:20}});
  state=editorReducer(state,{type:'append-annotations',annotations:[incoming]});
  assert.deepEqual(state.selection.selected,'p');
  assert.deepEqual(state.selectedVertex,{annotationId:'p',vertexId:'p:v1'});
  state=editorReducer(state,{type:'commit-gesture'});
  state=editorReducer(state,{type:'undo'});
  assert.deepEqual(state.annotations.map(annotation=>annotation.id),['p','loaded']);
  assert.deepEqual([state.annotations[0].vertices[1].x,state.annotations[0].vertices[1].y],[100,10]);
});

test('replace-annotations-by-id simplifies multiple selected polygons in one undo step', () => {
  const other={id:'other',asset:'img',label:'weed',type:'polygon',holes:[],vertices:[
    {id:'other:v0',x:0,y:0},{id:'other:v1',x:20,y:0},{id:'other:v2',x:20,y:20},
  ]};
  let state=createEditorState([polygon,other]);
  const nextPolygon={...polygon,vertices:[...polygon.vertices,{id:'p:v3',x:10,y:100}]};
  const nextOther={...other,vertices:[...other.vertices,{id:'other:v3',x:0,y:20}]};
  state=editorReducer(state,{type:'replace-annotations-by-id',annotations:[nextPolygon,nextOther]});
  assert.deepEqual(state.annotations.map(annotation=>annotation.id),['p','other']);
  assert.equal(state.history.length,1);
  state=editorReducer(state,{type:'undo'});
  assert.deepEqual(state.annotations.map(annotation=>annotation.vertices.length),[3,3]);
});

test('inserting and immediately dragging a vertex is one undoable gesture', () => {
  let state=createEditorState([polygon]);
  state=editorReducer(state,{type:'begin-gesture'});
  state=editorReducer(state,{type:'insert-vertex',annotationId:'p',afterVertexId:'p:v0',vertexId:'p:new',point:{x:55,y:10}});
  state=editorReducer(state,{type:'update-vertex',annotationId:'p',vertexId:'p:new',point:{x:60,y:25}});
  state=editorReducer(state,{type:'commit-gesture'});
  assert.equal(state.history.length,1);
  assert.deepEqual(state.annotations[0].vertices.find(vertex=>vertex.id==='p:new'),{id:'p:new',x:60,y:25});
  state=editorReducer(state,{type:'undo'});
  assert.deepEqual(state.annotations[0].vertices.map(vertex=>vertex.id),['p:v0','p:v1','p:v2']);
});

test('settle-drafts decides on the state the action lands on, not on a stale copy', async () => {
  // The last partial and the final result arrive back to back, before any
  // render. Reconciling against the caller's snapshot saw no drafts at all and
  // left every one of them on the canvas next to the final set.
  const { reconcileDrafts, withoutEdited } = await import('../app/lib/runtime-annotations.ts');
  const box = (id, x) => ({ id, asset: 'img', label: 'l-1', type: 'box', x, y: 0, width: 50, height: 50 });
  const drafts = new Map([['d-1', box('d-1', 10)], ['d-2', box('d-2', 300)]]);
  let state = createEditorState([box('manual', 900)]);
  state = editorReducer(state, { type: 'append-annotations', annotations: [...drafts.values()] });
  // The person moved one draft while the stream was still running.
  state = editorReducer(state, { type: 'replace-annotation', annotation: box('d-2', 320) });

  const final = [box('f-1', 11), box('f-2', 301)];
  state = editorReducer(state, {
    type: 'settle-drafts',
    plan: (onCanvas) => {
      const { discard, keptOriginals } = reconcileDrafts(drafts, onCanvas);
      return { remove: discard, add: withoutEdited(final, keptOriginals) };
    },
  });

  assert.deepEqual(state.annotations.map((annotation) => annotation.id).sort(), ['d-2', 'f-1', 'manual']);
  assert.equal(state.annotations.find((annotation) => annotation.id === 'd-2').x, 320, 'the edited draft keeps the edit');
});

test('settle-drafts with nothing to add only clears untouched drafts', () => {
  const box = (id, x) => ({ id, asset: 'img', label: 'l-1', type: 'box', x, y: 0, width: 50, height: 50 });
  let state = createEditorState([box('d-1', 10), box('keep', 99)]);
  const before = state.history.length;
  state = editorReducer(state, { type: 'settle-drafts', plan: () => ({ remove: ['d-1'], add: [] }) });
  assert.deepEqual(state.annotations.map((annotation) => annotation.id), ['keep']);
  assert.equal(state.history.length, before, 'a stream settling is not an undo step of its own');
});
