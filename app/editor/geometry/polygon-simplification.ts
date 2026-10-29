import polygonClipping from "polygon-clipping";
import RBush from "ol/structs/RBush.js";
import type { PolygonAnnotation } from "../models/annotation-model";
import type { Vertex } from "../models/vertex-model";

type Point = { x: number; y: number };
type Segment = { a: Point; b: Point; ring: number; edge: number; minX: number; maxX: number; minY: number; maxY: number };
const MAX_CHANGED_AREA = 0.02;
const MAX_ATTEMPTS = 9;

// Subtracting a local origin avoids cancellation for small masks at large image coordinates.
function signedArea(ring: readonly Point[]) {
  const origin = ring[0];
  let sum = 0;
  for (let i = 1; i + 1 < ring.length; i++) {
    sum += (ring[i].x - origin.x) * (ring[i + 1].y - origin.y) - (ring[i + 1].x - origin.x) * (ring[i].y - origin.y);
  }
  return sum / 2;
}

function samePoint(a: Point, b: Point) { return a.x === b.x && a.y === b.y; }
function before(a: Point, b: Point) { return a.x < b.x || (a.x === b.x && a.y < b.y); }

function cleanRing(ring: Vertex[]) {
  const clean = ring.filter((v, i) => i === 0 || !samePoint(v, ring[i - 1]));
  if (clean.length > 1 && samePoint(clean[0], clean[clean.length - 1])) clean.pop();
  return clean.length === ring.length ? ring : clean;
}

function distanceSquared(p: Point, a: Point, b: Point) {
  // Identical arithmetic when the same segment is traversed in the opposite direction.
  if (before(b, a)) [a, b] = [b, a];
  const dx = b.x - a.x, dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
  return (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2;
}

function ringTolerance(ring: Vertex[], requested: number) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, perimeter = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    perimeter += Math.hypot(q.x - p.x, q.y - p.y);
  }
  // Also account for thin, diagonal objects, whose bounding box alone overstates their width.
  const scale = Math.min(maxX - minX, maxY - minY, 2 * Math.abs(signedArea(ring)) / perimeter);
  return Math.min(requested, scale * 0.025);
}

function protectedCorners(ring: Vertex[], tolerance: number) {
  const lengths = [0];
  for (let i = 0; i < ring.length; i++) {
    lengths.push(lengths[i] + Math.hypot(ring[(i + 1) % ring.length].x - ring[i].x, ring[(i + 1) % ring.length].y - ring[i].y));
  }
  const perimeter = lengths[ring.length];
  const window = Math.min(tolerance * 4, perimeter / 4);
  const sample = (distance: number) => {
    distance = ((distance % perimeter) + perimeter) % perimeter;
    let low = 0, high = ring.length;
    while (low + 1 < high) {
      const mid = (low + high) >>> 1;
      if (lengths[mid] <= distance) low = mid; else high = mid;
    }
    const a = ring[low], b = ring[(low + 1) % ring.length];
    const t = (distance - lengths[low]) / (lengths[low + 1] - lengths[low]);
    return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
  };
  return ring.flatMap((point, i) => {
    const previous = ring[(i + ring.length - 1) % ring.length], next = ring[(i + 1) % ring.length];
    const ax = point.x - previous.x, ay = point.y - previous.y, bx = next.x - point.x, by = next.y - point.y;
    if (ax * bx + ay * by > 0.5 * Math.hypot(ax, ay) * Math.hypot(bx, by)) return [];
    const a = sample(lengths[i] - window), b = sample(lengths[i] + window);
    const ux = point.x - a.x, uy = point.y - a.y, vx = b.x - point.x, vy = b.y - point.y;
    // Recognize sustained sharp corners/tips, rather than pinning every one-pixel staircase turn.
    return ux * vx + uy * vy <= Math.cos(75 * Math.PI / 180) * Math.hypot(ux, uy) * Math.hypot(vx, vy) ? [i] : [];
  });
}

function simplifyRing(ring: Vertex[], tolerance: number): Vertex[] {
  if (ring.length <= 3) return ring;
  let anchor = 0;
  for (let i = 1; i < ring.length; i++) if (before(ring[i], ring[anchor])) anchor = i;
  const ordered = [...ring.slice(anchor), ...ring.slice(0, anchor)];
  let opposite = 1, farthest = -1;
  for (let i = 1; i < ordered.length; i++) {
    const distance = (ordered[i].x - ordered[0].x) ** 2 + (ordered[i].y - ordered[0].y) ** 2;
    if (distance > farthest || (distance === farthest && before(ordered[i], ordered[opposite]))) {
      farthest = distance; opposite = i;
    }
  }
  const corners = protectedCorners(ordered, tolerance);
  ordered.push(ordered[0]);
  const keep = new Uint8Array(ordered.length);
  keep[0] = keep[opposite] = keep[ordered.length - 1] = 1;
  for (const corner of corners) keep[corner] = 1;
  // Two open arcs with distinct endpoints, rather than RDP starting and ending at the same point.
  const anchors = Array.from(keep.keys()).filter(i => keep[i]);
  const stack = anchors.slice(1).map((end, i) => [anchors[i], end]);
  const squared = tolerance * tolerance;
  while (stack.length) {
    const [start, end] = stack.pop()!;
    let split = -1, greatest = squared;
    for (let i = start + 1; i < end; i++) {
      const distance = distanceSquared(ordered[i], ordered[start], ordered[end]);
      if (distance > greatest || (split !== -1 && distance === greatest && before(ordered[i], ordered[split]))) {
        greatest = distance; split = i;
      }
    }
    if (split !== -1) { keep[split] = 1; stack.push([start, split], [split, end]); }
  }
  const retained = new Set(ordered.filter((_, i) => keep[i]));
  // Preserve original ordering, coordinates, IDs and object references of retained vertices.
  return retained.size === ring.length ? ring : ring.filter(v => retained.has(v));
}

function orientation(a: Point, b: Point, c: Point) {
  const left = (b.x - a.x) * (c.y - a.y), right = (b.y - a.y) * (c.x - a.x);
  const value = left - right;
  return Math.abs(value) <= Number.EPSILON * 16 * (Math.abs(left) + Math.abs(right)) ? 0 : Math.sign(value);
}

function contains(p: Point, ring: Vertex[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function validTopology(rings: Vertex[][]) {
  const segments: Segment[] = [];
  for (let ring = 0; ring < rings.length; ring++) {
    const points = rings[ring];
    if (points.length < 3 || !points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) return false;
    const area = Math.abs(signedArea(points));
    if (!Number.isFinite(area) || area <= 0) return false;
    for (let edge = 0; edge < points.length; edge++) {
      const a = points[edge], b = points[(edge + 1) % points.length], c = points[(edge + 2) % points.length];
      if (samePoint(a, b)) return false;
      // Adjacent edges may meet at their common endpoint, but must not double back over one another.
      if (!orientation(a, b, c) && (a.x - b.x) * (c.x - b.x) + (a.y - b.y) * (c.y - b.y) > 0) return false;
      segments.push({ a, b, ring, edge, minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y) });
    }
  }
  // Query only overlapping edge bounds, including dense vertical/horizontal raster staircases.
  const index = new RBush<Segment>();
  for (const segment of segments) {
    const bounds = [segment.minX, segment.minY, segment.maxX, segment.maxY];
    for (const other of index.getInExtent(bounds)) {
      if (segment.ring === other.ring) {
        const length = rings[segment.ring].length;
        const delta = Math.abs(segment.edge - other.edge);
        if (delta === 1 || delta === length - 1) continue;
      }
      if (orientation(segment.a, segment.b, other.a) * orientation(segment.a, segment.b, other.b) <= 0 &&
          orientation(other.a, other.b, segment.a) * orientation(other.a, other.b, segment.b) <= 0) return false;
    }
    index.insert(bounds, segment);
  }
  for (let hole = 1; hole < rings.length; hole++) {
    if (!contains(rings[hole][0], rings[0])) return false;
    for (let other = 1; other < hole; other++) {
      if (contains(rings[hole][0], rings[other]) || contains(rings[other][0], rings[hole])) return false;
    }
  }
  return true;
}

function clippingPolygon(rings: Vertex[][]): polygonClipping.Polygon {
  return rings.map(ring => [...ring.map(v => [v.x, v.y] as [number, number]), [ring[0].x, ring[0].y]]);
}

function changedArea(original: polygonClipping.Polygon, simplified: polygonClipping.Polygon) {
  return polygonClipping.xor(original, simplified).reduce((sum, polygon) => sum + polygon.reduce((area, ring, i) => {
    const points = ring.map(([x, y]) => ({ x, y }));
    return area + (i === 0 ? 1 : -1) * Math.abs(signedArea(points));
  }, 0), 0);
}

/** Reduce vertices while protecting the complete filled mask, including every hole. */
export function simplifyPolygonAnnotation(annotation: PolygonAnnotation, tolerance: number): PolygonAnnotation {
  if (!Number.isFinite(tolerance) || tolerance <= 0) return annotation;
  const sourceRings = [annotation.vertices, ...annotation.holes];
  const original = sourceRings.map(cleanRing);
  if (!validTopology(original)) return annotation;
  const areas = original.map(signedArea);
  const filledArea = Math.abs(areas[0]) - areas.slice(1).reduce((sum, area) => sum + Math.abs(area), 0);
  if (filledArea <= 0) return annotation;
  const tolerances = original.map(ring => ringTolerance(ring, tolerance));
  const source = clippingPolygon(original);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const rings = original.map((ring, i) => simplifyRing(ring, tolerances[i] / 2 ** attempt));
    if (rings.every((ring, i) => ring === original[i]) && original.every((ring, i) => ring === sourceRings[i])) return annotation;
    if (!rings.every((ring, i) => {
      const area = signedArea(ring);
      return Math.sign(area) === Math.sign(areas[i]) && Math.abs(area - areas[i]) <= Math.abs(areas[i]) * MAX_CHANGED_AREA;
    }) || !validTopology(rings)) continue;
    try {
      // Net area alone misses equal-sized losses and gains on opposite sides of an object.
      if (changedArea(source, clippingPolygon(rings)) > filledArea * MAX_CHANGED_AREA) continue;
    } catch {
      // Imported numerical degeneracies must never replace a mask with a damaged result.
      continue;
    }
    return { ...annotation, vertices: rings[0], holes: rings.slice(1) };
  }
  return annotation;
}

type StepNode = {
  vertex: Vertex; ring: number; previous: StepNode; next: StepNode;
  edge: StepEdge; removed: boolean; version: number;
};
type StepEdge = { a: StepNode; b: StepNode };
type Candidate = { node: StepNode; version: number; area: number; distance: number };

// A lazy min-heap orders dense freehand outlines without sorting after every edit.
class RemovalQueue {
  private items: Candidate[] = [];
  private before(a: Candidate, b: Candidate) {
    return a.area < b.area || (a.area === b.area && before(a.node.vertex, b.node.vertex));
  }
  push(value: Candidate) {
    let i = this.items.length;
    this.items.push(value);
    while (i) {
      const parent = (i - 1) >>> 1;
      if (!this.before(value, this.items[parent])) break;
      this.items[i] = this.items[parent]; i = parent;
    }
    this.items[i] = value;
  }
  pop() {
    const first = this.items[0], last = this.items.pop();
    if (this.items.length && last) {
      let i = 0;
      while (i * 2 + 1 < this.items.length) {
        let child = i * 2 + 1;
        if (child + 1 < this.items.length && this.before(this.items[child + 1], this.items[child])) child++;
        if (!this.before(this.items[child], last)) break;
        this.items[i] = this.items[child]; i = child;
      }
      this.items[i] = last;
    }
    return first;
  }
}

function edgeBounds(a: Point, b: Point) {
  return [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)];
}

function intersects(a: Point, b: Point, c: Point, d: Point) {
  if (Math.max(a.x, b.x) < Math.min(c.x, d.x) || Math.max(c.x, d.x) < Math.min(a.x, b.x) ||
      Math.max(a.y, b.y) < Math.min(c.y, d.y) || Math.max(c.y, d.y) < Math.min(a.y, b.y)) return false;
  return orientation(a, b, c) * orientation(a, b, d) <= 0 && orientation(c, d, a) * orientation(c, d, b) <= 0;
}

function canRemove(node: StepNode, index: RBush<StepEdge>, area: number) {
  const a = node.previous.vertex, b = node.vertex, c = node.next.vertex;
  const bounds = [Math.min(a.x, b.x, c.x), Math.min(a.y, b.y, c.y), Math.max(a.x, b.x, c.x), Math.max(a.y, b.y, c.y)];
  for (const edge of index.getInExtent(bounds)) {
    if (edge === node.previous.edge || edge === node.edge) continue;
    const p = edge.a.vertex, q = edge.b.vertex;
    // A shortcut may meet its two surviving neighbors, but cannot overlap their edges.
    const shared = p === a || p === c ? p : q === a || q === c ? q : null;
    if (shared) {
      const other = shared === p ? q : p;
      if (!orientation(a, c, other) && distanceSquared(other, a, c) === 0) return false;
    } else if (intersects(a, c, p, q)) return false;
    // Testing the swept triangle also prevents swallowing an entire hole or narrow peninsula.
    if (area > 0) for (const point of [p, q]) {
      if (point === a || point === c) continue;
      const turns = [orientation(a, b, point), orientation(b, c, point), orientation(c, a, point)];
      if (turns.every(t => t >= 0) || turns.every(t => t <= 0)) return false;
    }
  }
  return true;
}

/** One interactive Visvalingam-style step: remove up to 20% of each ring, least-impact first. */
export function simplifyPolygonStep(annotation: PolygonAnnotation): PolygonAnnotation {
  const sourceRings = [annotation.vertices, ...annotation.holes];
  const rings = sourceRings.map(cleanRing);
  if (!validTopology(rings)) return annotation;
  const areas = rings.map(ring => Math.abs(signedArea(ring)));
  const filledArea = areas[0] - areas.slice(1).reduce((sum, area) => sum + area, 0);
  if (filledArea <= 0) return annotation;
  const budgets = areas.map(area => area * MAX_CHANGED_AREA);
  let budget = filledArea * MAX_CHANGED_AREA;
  const remaining = rings.map((ring, i) => Math.min(ring.length - 3,
    Math.max(1, Math.floor(sourceRings[i].length * 0.2)) - (sourceRings[i].length - ring.length)));
  // Bound local displacement relative to object thickness, independent of viewport zoom.
  const distances = rings.map(ring => ringTolerance(ring, Infinity) * 4);
  const index = new RBush<StepEdge>();
  const queue = new RemovalQueue();
  const corners = rings.map((ring, i) => new Set(protectedCorners(ring, distances[i] / 4)));
  const protectedNodes = new Set<StepNode>();
  const nodes = rings.map((ring, r) => {
    const list = ring.map(vertex => ({ vertex, ring: r, removed: false, version: 0 } as StepNode));
    list.forEach((node, i) => {
      if (corners[r].has(i)) protectedNodes.add(node);
      node.previous = list[(i + list.length - 1) % list.length]; node.next = list[(i + 1) % list.length];
      node.edge = { a: node, b: node.next };
      index.insert(edgeBounds(node.vertex, node.next.vertex), node.edge);
    });
    return list;
  });
  const enqueue = (node: StepNode) => {
    if (protectedNodes.has(node)) return;
    node.version++;
    const a = node.previous.vertex, b = node.vertex, c = node.next.vertex;
    const area = Math.abs((a.x - b.x) * (c.y - b.y) - (a.y - b.y) * (c.x - b.x)) / 2;
    queue.push({ node, version: node.version, area, distance: Math.sqrt(distanceSquared(b, a, c)) });
  };
  nodes.forEach(ring => ring.forEach(enqueue));
  for (let candidate = queue.pop(); candidate; candidate = queue.pop()) {
    const { node, version, area, distance } = candidate, r = node.ring;
    if (node.removed || version !== node.version || remaining[r] <= 0 ||
        area > budgets[r] || area > budget || distance > distances[r] || !canRemove(node, index, area)) continue;
    const previous = node.previous, next = node.next;
    index.remove(previous.edge); index.remove(node.edge);
    previous.next = next; next.previous = previous; node.removed = true;
    previous.edge = { a: previous, b: next };
    index.insert(edgeBounds(previous.vertex, next.vertex), previous.edge);
    remaining[r]--; budgets[r] -= area; budget -= area;
    enqueue(previous); enqueue(next);
  }
  const simplified = nodes.map((ring, i) => {
    const retained = ring.filter(node => !node.removed).map(node => node.vertex);
    return retained.length === sourceRings[i].length ? sourceRings[i] : retained;
  });
  if (simplified.every((ring, i) => ring === sourceRings[i]) || !validTopology(simplified)) return annotation;
  // The sum of swept triangles already bounds the symmetric difference; verify the full mask too.
  try {
    if (changedArea(clippingPolygon(rings), clippingPolygon(simplified)) > filledArea * MAX_CHANGED_AREA) return annotation;
  } catch { return annotation; }
  return { ...annotation, vertices: simplified[0], holes: simplified.slice(1) };
}

export type SimplificationJob = { annotation: PolygonAnnotation } &
  ({ progressive: true } | { progressive?: false; tolerance: number });

export function simplifyPolygonBatch(jobs: SimplificationJob[]) {
  return jobs.flatMap(job => {
    const result = job.progressive ? simplifyPolygonStep(job.annotation) : simplifyPolygonAnnotation(job.annotation, job.tolerance);
    return result === job.annotation ? [] : [result];
  });
}
