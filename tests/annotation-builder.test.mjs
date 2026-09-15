import test from 'node:test';
import assert from 'node:assert/strict';
import { annotationBase, boxFromDraft, lineFromDraft, pointFromDraft, polygonFromDraft } from '../app/editor/drawing/annotation-builder.ts';

const base=annotationBase('a','img','weed');

test('box drafts become canonical width/height boxes',()=>{
  assert.deepEqual(boxFromDraft(base,{x:10,y:20,w:30,h:40}),{id:'a',asset:'img',label:'weed',type:'box',x:10,y:20,width:30,height:40});
  assert.equal(boxFromDraft(base,{x:0,y:0,w:4,h:4}),null);
});

test('polygon and line drafts become vertex annotations',()=>{
  const polygon=polygonFromDraft(base,[0,0,100,0,100,100]);
  assert.equal(polygon.type,'polygon');
  assert.deepEqual(polygon.vertices.map(vertex=>vertex.id),['a:outer:v0','a:outer:v1','a:outer:v2']);
  const line=lineFromDraft({...base,id:'l'},[0,0,50,50]);
  assert.equal(line.type,'line');
  assert.deepEqual(line.vertices.map(vertex=>vertex.id),['l:outer:v0','l:outer:v1']);
});

test('point drafts are canonical points',()=>{
  assert.deepEqual(pointFromDraft(base,{x:12,y:34}),{id:'a',asset:'img',label:'weed',type:'point',x:12,y:34});
});
