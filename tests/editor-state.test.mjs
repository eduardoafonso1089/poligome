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
