import test from 'node:test';
import assert from 'node:assert/strict';
import {
  annotationBounds,
  deleteAnnotationVertex,
  edgeMidpoints,
  insertAnnotationVertex,
  translateAnnotation,
  updateAnnotationVertex,
} from '../app/editor/geometry/annotation-geometry.ts';

const polygon = {
  id:'p',asset:'a',label:'c',type:'polygon',holes:[],
  vertices:[
    {id:'v0',x:10,y:10},
    {id:'v1',x:100,y:10},
    {id:'v2',x:100,y:100},
  ],
};

test('canonical vertex mutations preserve stable ids', () => {
  const moved=updateAnnotationVertex(polygon,'v1',{x:120,y:20});
  assert.deepEqual(moved.vertices.map(vertex=>vertex.id),['v0','v1','v2']);
  assert.deepEqual(moved.vertices[1],{id:'v1',x:120,y:20});

  const inserted=insertAnnotationVertex(moved,'v1',{x:120,y:60},'v-new');
  assert.deepEqual(inserted.vertices.map(vertex=>vertex.id),['v0','v1','v-new','v2']);

  const deleted=deleteAnnotationVertex(inserted,'v-new');
  assert.deepEqual(deleted.vertices.map(vertex=>vertex.id),['v0','v1','v2']);
});

test('canonical geometry translates polygon holes and computes bounds', () => {
  const withHole={...polygon,holes:[[
    {id:'h0',x:30,y:30},{id:'h1',x:40,y:30},{id:'h2',x:35,y:40},
  ]]};
  const translated=translateAnnotation(withHole,5,7);
  assert.deepEqual(translated.vertices[0],{id:'v0',x:15,y:17});
  assert.deepEqual(translated.holes[0][0],{id:'h0',x:35,y:37});
  assert.deepEqual(annotationBounds(translated),{x:15,y:17,width:90,height:90});
});

test('edge midpoints use vertex ids and omit short edges', () => {
  assert.deepEqual(edgeMidpoints(polygon.vertices,true),[
    {afterVertexId:'v0',x:55,y:10},
    {afterVertexId:'v1',x:100,y:55},
  ]);
});
