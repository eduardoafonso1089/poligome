import test from 'node:test';
import assert from 'node:assert/strict';
import polygonClipping from 'polygon-clipping';
import { simplifyPolygonAnnotation, simplifyPolygonBatch, simplifyPolygonStep } from '../app/editor/geometry/polygon-simplification.ts';
import { canAddPolygonHole, isValidRing } from '../app/editor/geometry/vector-operations.ts';
import { runPolygonSimplification } from '../app/editor/interactions/polygon-simplification-task.ts';
import { createEditorState, editorReducer } from '../app/editor/state/editor-state.ts';
import { visibleVertexIndices } from '../app/editor/layers/vertex-handle-visibility.ts';
import { freehandFromDraft } from '../app/editor/drawing/annotation-builder.ts';

const ring = (pairs, prefix = 'v') => pairs.map(([x, y], i) => ({ id: `${prefix}${i}`, x, y }));
const circle = (n, radius, cx = 0, cy = 0, prefix = 'v') => ring(Array.from({ length: n }, (_, i) => {
  const a = i * 2 * Math.PI / n;
  return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)];
}), prefix);
const polygon = (vertices, holes = []) => ({ id: 'p', asset: 'image', label: 'object', type: 'polygon', vertices, holes });
const area = ring => Math.abs(ring.reduce((sum, [x, y], i) => {
  const [nx, ny] = ring[(i + 1) % ring.length];
  return sum + x * ny - y * nx;
}, 0)) / 2;
const shape = p => [p.vertices, ...p.holes].map(r => [...r.map(v => [v.x, v.y]), [r[0].x, r[0].y]]);
const maskArea = p => shape(p).reduce((sum, r, i) => sum + (i ? -1 : 1) * area(r), 0);
const difference = (p, q) => polygonClipping.xor(shape(p), shape(q)).reduce((sum, polygon) => sum + polygon.reduce((s, r, i) => s + (i ? -1 : 1) * area(r), 0), 0);
const ids = p => p.vertices.map(v => v.id).sort();

// Uneven hand tracing: asymmetric lobes, deep concavities and small high-frequency tremor.
const freehand = (n = 2400) => freehandFromDraft({ id: 'p', asset: 'image', label: 'object' }, Array.from({ length: n }, (_, i) => {
  const t = i / n * 2 * Math.PI;
  const r = 260 + 80 * Math.sin(7 * t + 0.2) + 35 * Math.cos(13 * t) +
    18 * Math.sin(23 * t + 1) + 3 * Math.sin(97 * t) + 1.5 * Math.cos(181 * t);
  return [600 + r * Math.cos(t) * 1.35, 390 + r * Math.sin(t) * 0.9];
}).flat());

test('successive clicks progressively simplify an irregular freehand mask, with one exact undo per click', () => {
  const original = freehand();
  let state = createEditorState([original]);
  const steps = [original];
  for (let click = 0; click < 8; click++) {
    const p = state.annotations[0], q = simplifyPolygonStep(p);
    const removed = p.vertices.length - q.vertices.length;
    assert.ok(removed > 0, `click ${click + 1}: ${p.vertices.length} points did not simplify`);
    assert.ok(removed <= Math.max(1, Math.floor(p.vertices.length * 0.2)));
    assert.ok(isValidRing(q.vertices));
    assert.ok(q.vertices.every(v => p.vertices.includes(v)));
    state = editorReducer(state, { type: 'replace-annotations-by-id', annotations: [q], expected: [p] });
    steps.push(q);
  }
  assert.ok(steps[8].vertices.length < original.vertices.length / 3);
  for (let i = steps.length - 2; i >= 0; i--) {
    state = editorReducer(state, { type: 'undo' });
    assert.equal(state.annotations[0], steps[i]);
  }
  for (let i = 1; i < steps.length; i++) {
    state = editorReducer(state, { type: 'redo' });
    assert.equal(state.annotations[0], steps[i]);
  }
});

test('interactive steps remain gradual on 100,000-point masks and simplify again without hidden click state', () => {
  const p = freehand(100_000);
  const q = simplifyPolygonStep(p);
  const r = simplifyPolygonStep(structuredClone(q));
  assert.equal(q.vertices.length, 80_000);
  assert.equal(r.vertices.length, 64_000);
  assert.ok(difference(p, q) <= maskArea(p) * 0.02);
  assert.ok(difference(q, r) <= maskArea(q) * 0.02);
});

test('interactive hole simplification preserves every hole and ring validity over repeated clicks', () => {
  let p = freehand();
  p = { ...p, holes: [circle(240, 30, 550, 380, 'h'), circle(240, 24, 640, 400, 'j')] };
  for (let click = 0; click < 5; click++) {
    const q = simplifyPolygonStep(p);
    assert.equal(q.holes.length, 2);
    assert.ok(q.vertices.length < p.vertices.length);
    assert.ok(q.holes.every((h, i) => h.length < p.holes[i].length && canAddPolygonHole(q.vertices, h, q.holes.slice(0, i))));
    assert.ok(difference(p, q) <= maskArea(p) * 0.02 + 1e-6);
    p = q;
  }
});

test('interactive simplification intentionally passes the old area and corner limits down to triangles', () => {
  const rectangle = polygon(ring([[0,0], [100,0], [100,100], [0,100]]));
  const spike = polygon(ring([[0,0], [500,0], [500,248], [550,248], [550,252], [500,252], [500,500], [0,500]]));
  const triangle = simplifyPolygonStep(rectangle);
  assert.equal(triangle.vertices.length, 3);
  assert.ok(difference(rectangle, triangle) > maskArea(rectangle) * 0.4);
  assert.equal(simplifyPolygonStep(triangle), triangle);
  const crossed = polygon(ring([[0,0], [100,100], [0,100], [100,0]]));
  assert.equal(simplifyPolygonStep(crossed).vertices.length, 3);
  for (let p of [spike, polygon(circle(180, 100)), freehand(360)]) {
    for (let click = 0; p.vertices.length > 3 && click < 60; click++) {
      const q = simplifyPolygonStep(p);
      assert.ok(q.vertices.length < p.vertices.length, `stalled with ${p.vertices.length} points`);
      assert.ok(isValidRing(q.vertices));
      p = q;
    }
    assert.equal(p.vertices.length, 3);
    assert.equal(simplifyPolygonStep(p), p);
  }
});

test('self-crossing freehand traces and repeated positions continue simplifying without moving retained vertices', () => {
  const p = freehandFromDraft({ id: 'p', asset: 'image', label: 'object' }, Array.from({ length: 900 }, (_, i) => {
    const t = i / 900 * Math.PI * 2;
    return [300 + 200 * Math.sin(t), 300 + 120 * Math.sin(2 * t)];
  }).flat());
  let current = p;
  for (let step = 0; step < 40 && current.vertices.length > 3; step++) {
    const q = simplifyPolygonStep(current);
    assert.ok(q.vertices.length < current.vertices.length);
    assert.ok(q.vertices.every(v => p.vertices.includes(v)));
    current = q;
  }
  assert.equal(current.vertices.length, 3);
  assert.ok(isValidRing(current.vertices));
  const repeated = polygon(ring([[0,0], [100,0], [100,100], [100,100], [50,50], [100,0], [0,100], [0,0]]));
  assert.ok(simplifyPolygonStep(repeated).vertices.length < repeated.vertices.length);
  const invalid = polygon(ring([[0,0], [100,0], [NaN,100], [0,100]]));
  assert.equal(simplifyPolygonStep(invalid), invalid);
});

test('long simplification chains retain every undo/redo step and selection, including the original drawing', () => {
  const original = freehand(1500);
  let state = editorReducer(createEditorState([original]), { type: 'select-single', id: original.id });
  const steps = [original];
  while (state.annotations[0].vertices.length > 3) {
    const p = state.annotations[0], q = simplifyPolygonStep(p);
    assert.notEqual(q, p);
    state = editorReducer(state, { type: 'replace-annotations-by-id', annotations: [q], expected: [p], extendHistory: true });
    steps.push(q);
  }
  assert.ok(state.history.length > 25);
  for (let i = steps.length - 2; i >= 0; i--) {
    state = editorReducer(state, { type: 'undo' });
    assert.equal(state.annotations[0], steps[i]);
    assert.equal(state.selection.selected, original.id);
  }
  assert.equal(state.annotations[0], original);
  for (let i = 1; i < steps.length; i++) {
    state = editorReducer(state, { type: 'redo' });
    assert.equal(state.annotations[0], steps[i]);
    assert.equal(state.selection.selected, original.id);
  }
});

test('coiled narrow freehand outlines keep their gaps while simplifying in repeated steps', () => {
  const points = [];
  for (const [side, direction] of [[1, 1], [-1, -1]]) {
    for (let i = 0; i < 1800; i++) {
      const t = (direction === 1 ? i : 1799 - i) / 1799 * 4 * Math.PI;
      const r = 50 + t * 18 + side * 5;
      points.push([600 + r * Math.cos(t), 390 + r * Math.sin(t)]);
    }
  }
  let p = freehandFromDraft({ id: 'p', asset: 'image', label: 'object' }, points.flat());
  for (let i = 0; i < 6; i++) {
    const q = simplifyPolygonStep(p);
    assert.ok(q.vertices.length < p.vertices.length);
    assert.ok(isValidRing(q.vertices));
    assert.ok(difference(p, q) <= maskArea(p) * 0.02 + 1e-6);
    p = q;
  }
});

test('interactive ring order, winding and coordinates far from the origin remain safe', () => {
  const p = freehand(350);
  const expected = ids(simplifyPolygonStep(p));
  const offset = 129, vertices = [...p.vertices.slice(offset), ...p.vertices.slice(0, offset)];
  assert.deepEqual(ids(simplifyPolygonStep({ ...p, vertices })), expected);
  assert.deepEqual(ids(simplifyPolygonStep({ ...p, vertices: vertices.toReversed() })), expected);
  const shifted = { ...p, vertices: p.vertices.map(v => ({ ...v, x: v.x + 1e9, y: v.y + 1e9 })) };
  const q = simplifyPolygonStep(shifted);
  assert.equal(q.vertices.length, p.vertices.length - Math.floor(p.vertices.length * 0.2));
  assert.ok(q.vertices.every(v => shifted.vertices.includes(v)));
});

test('the background worker applies the progressive mode on each fresh click', async () => {
  let p = freehand(4000), terminated = 0;
  for (let click = 0; click < 3; click++) {
    const worker = { terminate: () => terminated++, postMessage: payload => queueMicrotask(() =>
      worker.onmessage({ data: { annotations: simplifyPolygonBatch(structuredClone(payload)) } })) };
    const [q] = await runPolygonSimplification([{ annotation: p, progressive: true }], new AbortController().signal, () => worker);
    assert.equal(q.vertices.length, p.vertices.length - Math.floor(p.vertices.length * 0.2));
    p = q;
  }
  assert.equal(terminated, 3);
});

test('dense large masks reduce substantially and keep the filled-mask error below 2%', () => {
  const p = polygon(circle(50_000, 10_000, 20_000, 20_000));
  const q = simplifyPolygonAnnotation(p, 20);
  assert.ok(q.vertices.length < 200, `${q.vertices.length} vertices`);
  assert.ok(difference(p, q) <= maskArea(p) * 0.02);
  assert.ok(q.vertices.every(v => p.vertices.includes(v)));
  assert.equal(p.vertices.length, 50_000);
});

test('very large raster coordinates retain the same vertices as a translated small mask', () => {
  const p = polygon(circle(256, 120, 300, 300));
  const shifted = { ...p, vertices: p.vertices.map(v => ({ ...v, x: v.x + 1e9, y: v.y + 1e9 })) };
  assert.deepEqual(ids(simplifyPolygonAnnotation(p, 2)), ids(simplifyPolygonAnnotation(shifted, 2)));
});

test('closed-ring simplification is independent of the stored first vertex and winding', () => {
  const p = polygon(circle(512, 100));
  const expected = ids(simplifyPolygonAnnotation(p, 2));
  for (const offset of [1, 19, 127, 250]) {
    const vertices = [...p.vertices.slice(offset), ...p.vertices.slice(0, offset)];
    assert.deepEqual(ids(simplifyPolygonAnnotation({ ...p, vertices }, 2)), expected);
    assert.deepEqual(ids(simplifyPolygonAnnotation({ ...p, vertices: vertices.toReversed() }, 2)), expected);
  }
});

test('holes are simplified, retained inside the outer ring and never merged or removed', () => {
  const p = polygon(circle(2048, 1000), [circle(512, 150, -350, 0, 'h'), circle(512, 150, 350, 0, 'j')]);
  const q = simplifyPolygonAnnotation(p, 20);
  assert.equal(q.holes.length, 2);
  assert.ok(q.holes.every(h => h.length < 100));
  assert.ok(q.holes.every((h, i) => canAddPolygonHole(q.vertices, h, q.holes.slice(0, i))));
  assert.ok(difference(p, q) <= maskArea(p) * 0.02);
});

test('an unchanged triangular shell does not prevent simplifying a dense hole', () => {
  const p = polygon(ring([[-1000, -1000], [1000, -1000], [0, 1000]]), [circle(256, 100, 0, 0, 'h')]);
  const q = simplifyPolygonAnnotation(p, 10);
  assert.equal(q.vertices, p.vertices);
  assert.ok(q.holes[0].length < p.holes[0].length);
});

test('zoomed-out tolerances do not collapse small masks or narrow extensions', () => {
  const p = polygon(circle(256, 2, 50, 50));
  const q = simplifyPolygonAnnotation(p, 100_000);
  assert.ok(q.vertices.length >= 16);
  assert.ok(difference(p, q) <= maskArea(p) * 0.02);
  const thin = polygon(ring([[0,0], [500,0], [500,248], [550,248], [550,252], [500,252], [500,500], [0,500]]));
  const result = simplifyPolygonAnnotation(thin, 100_000);
  assert.ok(result.vertices.some(v => v.x === 550 && v.y === 248));
  assert.ok(result.vertices.some(v => v.x === 550 && v.y === 252));
});

test('dense axis-aligned boundaries and duplicate closing vertices simplify without moving corners', () => {
  const pairs = [];
  for (let i = 0; i < 5000; i++) pairs.push([i, 0]);
  for (let i = 0; i < 5000; i++) pairs.push([5000, i]);
  for (let i = 0; i < 5000; i++) pairs.push([5000 - i, 5000]);
  for (let i = 0; i < 5000; i++) pairs.push([0, 5000 - i]);
  const p = polygon(ring([...pairs, pairs[0], pairs[0]]));
  const q = simplifyPolygonAnnotation(p, 4);
  assert.equal(q.vertices.length, 4);
  assert.equal(difference(p, q), 0);
  assert.ok(isValidRing(q.vertices));
});

test('invalid coordinates, overlapping edges, crossing shells and invalid holes stay untouched', () => {
  const cases = [
    polygon(ring([[0,0], [100,100], [0,100], [100,0]])),
    polygon(ring([[0,0], [100,0], [50,0], [100,100], [0,100]])),
    polygon(ring([[0,0], [100,0], [NaN,100], [0,100]])),
    polygon(ring([[0,0], [100,0], [100,100], [0,100]]), [ring([[90,10], [110,10], [110,20], [90,20]], 'h')]),
    polygon(ring([[0,0], [100,0], [100,100], [0,100]]), [ring([[0,10], [20,10], [20,20], [0,20]], 'h')]),
  ];
  for (const p of cases) assert.equal(simplifyPolygonAnnotation(p, 10), p);
});

test('invalid tolerances and already minimal polygons are true no-ops', () => {
  const p = polygon(ring([[0,0], [100,0], [100,100], [0,100]]));
  for (const tolerance of [NaN, Infinity, -1, 0, 2]) assert.equal(simplifyPolygonAnnotation(p, tolerance), p);
  assert.deepEqual(simplifyPolygonBatch([{ annotation: p, tolerance: 2 }]), []);
});

test('concave noisy masks retain valid rings and meet the geometric error budget', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const points = Array.from({ length: 180 }, (_, i) => {
      const a = 2 * Math.PI * i / 180;
      const r = 200 + 60 * Math.sin(a * 5) + 0.2 * Math.sin(i * seed);
      return [r * Math.cos(a), r * Math.sin(a)];
    });
    const p = polygon(ring(points));
    const q = simplifyPolygonAnnotation(p, 25);
    assert.ok(isValidRing(q.vertices));
    assert.ok(difference(p, q) <= maskArea(p) * 0.02 + 1e-6);
  }
});

const denseJob = () => [{ annotation: polygon(circle(2200, 100)), tolerance: 2 }];
test('large simplification batches use a worker and terminate it after delivery', async () => {
  const jobs = denseJob();
  let terminated = 0;
  const worker = { terminate: () => terminated++, postMessage: payload => queueMicrotask(() => worker.onmessage({ data: { annotations: simplifyPolygonBatch(payload) } })) };
  const result = await runPolygonSimplification(jobs, new AbortController().signal, () => worker);
  assert.equal(result.length, 1);
  assert.ok(result[0].vertices.length < 100);
  assert.equal(terminated, 1);
});

test('small edits do not create workers, and aborted jobs cannot deliver late replacements', async () => {
  const controller = new AbortController();
  const small = [{ annotation: polygon(circle(100, 100)), tolerance: 2 }];
  await runPolygonSimplification(small, controller.signal, () => { throw Error('unnecessary worker'); });
  let terminated = 0;
  const worker = { terminate: () => terminated++, postMessage: () => {} };
  const pending = runPolygonSimplification(denseJob(), controller.signal, () => worker);
  const late = worker.onmessage;
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  late({ data: { annotations: [] } });
  assert.equal(terminated, 1);
  await assert.rejects(runPolygonSimplification(denseJob(), controller.signal), { name: 'AbortError' });
});

test('worker failures are surfaced and cleaned up without returning partial results', async () => {
  let terminated = 0;
  const worker = { terminate: () => terminated++, postMessage: () => queueMicrotask(() => worker.onmessage({ data: { error: 'failed' } })) };
  await assert.rejects(runPolygonSimplification(denseJob(), new AbortController().signal, () => worker), /failed/);
  assert.equal(terminated, 1);
});

test('background simplification never overwrites newer edits and remains one exact undo step', () => {
  const original = polygon(circle(256, 100));
  const result = simplifyPolygonAnnotation(original, 2);
  const state = createEditorState([original]);
  const simplified = editorReducer(state, { type: 'replace-annotations-by-id', annotations: [result], expected: [original] });
  assert.equal(simplified.history.length, 1);
  assert.equal(editorReducer(simplified, { type: 'undo' }).annotations[0], original);
  const edited = editorReducer(state, { type: 'translate-annotations', ids: ['p'], dx: 10, dy: 0 });
  assert.equal(editorReducer(edited, { type: 'replace-annotations-by-id', annotations: [result], expected: [original] }), edited);
  const drawing = editorReducer(state, { type: 'begin-gesture' });
  assert.equal(editorReducer(drawing, { type: 'replace-annotations-by-id', annotations: [result], expected: [original] }), drawing);
});

test('dense-mask edit handles remain sparse at overview zoom without modifying any vertices', () => {
  const vertices = circle(50_000, 1000);
  const before = vertices.map(v => ({ ...v }));
  const overview = visibleVertexIndices(vertices, 5, 1, 'v17');
  const close = visibleVertexIndices(vertices, 0.5, 1, 'v17');
  assert.ok(overview.length < 500);
  assert.ok(close.length > overview.length);
  assert.ok(overview.includes(17));
  assert.deepEqual(vertices, before);
  const line = visibleVertexIndices(vertices, 5, 1, undefined, true);
  assert.ok(line.includes(0) && line.includes(vertices.length - 1));
});
