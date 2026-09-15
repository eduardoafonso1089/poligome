import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addPolygonHole,
  canAddPolygonHole,
  isValidRing,
  pointInRing,
  reshapePolygonAnnotation,
  simplifyPolygonAnnotation,
  snapPointToAnnotations,
  splitPolygonAnnotation,
  unionPolygonAnnotations,
} from '../app/editor/geometry/vector-operations.ts';

let nextId = 0;
const makeId = (prefix) => `${prefix}-${++nextId}`;
const vertices = (pairs, prefix='v') => pairs.map(([x,y]) => ({ id: makeId(prefix), x, y }));
const polygon = (id, pairs, label='a') => ({ id, asset:'img', label, type:'polygon', vertices:vertices(pairs,id), holes:[] });

test('ring validation and point-in-ring use native source pixels', () => {
  const ring = vertices([[100,100],[900,100],[900,700],[100,700]]);
  assert.equal(isValidRing(ring), true);
  assert.equal(pointInRing({x:500,y:400}, ring), true);
  assert.equal(pointInRing({x:50,y:400}, ring), false);
  assert.equal(isValidRing(vertices([[0,0],[100,100],[0,100],[100,0]])), false);
});

test('hole must be fully inside and non-crossing', () => {
  const outer = vertices([[0,0],[1000,0],[1000,800],[0,800]]);
  const valid = vertices([[200,200],[400,200],[400,400],[200,400]]);
  const crossing = vertices([[900,200],[1100,200],[1100,400],[900,400]]);
  assert.equal(canAddPolygonHole(outer, valid, []), true);
  assert.equal(canAddPolygonHole(outer, crossing, []), false);
  const base = { id:'p', asset:'img', label:'a', type:'polygon', vertices:outer, holes:[] };
  const updated = addPolygonHole(base, valid, makeId);
  assert.equal(updated.holes.length, 1);
  assert.equal(updated.holes[0].length, 4);
});

test('snap prefers nearby vertex or edge without fixed editor dimensions', () => {
  const target = polygon('p', [[1000,1000],[3000,1000],[3000,3000],[1000,3000]]);
  const vertexSnap = snapPointToAnnotations({x:1006,y:1004}, [target], '', 20);
  assert.deepEqual({x:vertexSnap.x,y:vertexSnap.y,snapped:vertexSnap.snapped},{x:1000,y:1000,snapped:true});
  const edgeSnap = snapPointToAnnotations({x:2000,y:1008}, [target], '', 20);
  assert.equal(edgeSnap.snapped, true);
  assert.equal(edgeSnap.x, 2000);
  assert.equal(edgeSnap.y, 1000);
});

test('simplify preserves a valid polygon while reducing noisy vertices', () => {
  const source = polygon('p', [[0,0],[100,0],[200,1],[300,0],[300,300],[0,300]]);
  const simplified = simplifyPolygonAnnotation(source, 4);
  assert.ok(simplified.vertices.length < source.vertices.length);
  assert.equal(isValidRing(simplified.vertices), true);
});

test('union returns canonical polygon vertices and preserves first polygon label', () => {
  const a = polygon('a', [[0,0],[100,0],[100,100],[0,100]], 'weed');
  const b = polygon('b', [[50,0],[150,0],[150,100],[50,100]], 'weed');
  const result = unionPolygonAnnotations([a,b], makeId);
  assert.equal(result.length, 1);
  assert.equal(result[0].label, 'weed');
  assert.equal(result[0].id, 'a');
  assert.ok(result[0].vertices.length >= 4);
});

test('split uses image dimensions rather than a 1000x650 normalized space', () => {
  const source = polygon('large', [[10000,10000],[40000,10000],[40000,25000],[10000,25000]]);
  const result = splitPolygonAnnotation(source,{x:25000,y:5000},{x:25000,y:30000},{width:50000,height:30000},makeId);
  assert.equal(result.length, 2);
  assert.ok(result.every((item) => item.vertices.every((v) => v.x > 9000 && v.x < 41000)));
});

test('reshape can add an outside bulge while staying in source pixels', () => {
  const source = polygon('r', [[100,100],[500,100],[500,500],[100,500]]);
  const path = [{x:180,y:180},{x:180,y:60},{x:420,y:60},{x:420,y:180}];
  const result = reshapePolygonAnnotation(source,path,makeId);
  assert.equal(result.mode,'add');
  assert.equal(result.reason,null);
  assert.ok(result.annotation);
  assert.ok(result.annotation.vertices.some((v) => v.y === 60));
});
