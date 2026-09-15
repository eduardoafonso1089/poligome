import polygonClipping from "polygon-clipping";
import type { Size2D } from "../../lib/editor-viewport";
import type { EditorAnnotation, PolygonAnnotation } from "../models/annotation-model";
import type { Vertex } from "../models/vertex-model";

export type Point = { x: number; y: number };
export type ReshapeReason = "mixed" | "crossings" | "direction" | null;
export type ReshapeResult = { annotation: PolygonAnnotation | null; mode: "add" | "delete" | null; reason: ReshapeReason };

type MakeId = (prefix: string) => string;
type Pair = [number, number];

function pair(vertex: Point): Pair { return [vertex.x, vertex.y]; }

function closedRing(vertices: Vertex[]): Pair[] {
  if (!vertices.length) return [];
  return [...vertices.map(pair), pair(vertices[0])];
}

function verticesFromRing(ring: Pair[], makeId: MakeId, prefix: string): Vertex[] {
  const open = ring.length > 1 && ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1]
    ? ring.slice(0, -1)
    : ring;
  return open.map(([x, y]) => ({ id: makeId(prefix), x, y }));
}

export function ringArea(vertices: readonly Point[]) {
  let area = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const next = vertices[(index + 1) % vertices.length];
    area += vertices[index].x * next.y - next.x * vertices[index].y;
  }
  return Math.abs(area / 2);
}

export function pointInRing(point: Point, vertices: readonly Point[]) {
  let inside = false;
  for (let index = 0, previous = vertices.length - 1; index < vertices.length; previous = index, index += 1) {
    const a = vertices[index];
    const b = vertices[previous];
    const crosses = a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || Number.EPSILON) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function segmentIntersection(a: Point, b: Point, c: Point, d: Point) {
  const abx = b.x - a.x; const aby = b.y - a.y;
  const cdx = d.x - c.x; const cdy = d.y - c.y;
  const denominator = abx * cdy - aby * cdx;
  if (Math.abs(denominator) < 1e-12) return null;
  const acx = c.x - a.x; const acy = c.y - a.y;
  const pathT = (acx * cdy - acy * cdx) / denominator;
  const edgeT = (acx * aby - acy * abx) / denominator;
  if (pathT < 0 || pathT > 1 || edgeT < 0 || edgeT > 1) return null;
  return { x: a.x + pathT * abx, y: a.y + pathT * aby, pathT, edgeT };
}

function ringsCross(first: readonly Point[], second: readonly Point[]) {
  for (let i = 0; i < first.length; i += 1) {
    const a = first[i]; const b = first[(i + 1) % first.length];
    for (let j = 0; j < second.length; j += 1) {
      const c = second[j]; const d = second[(j + 1) % second.length];
      if (segmentIntersection(a, b, c, d)) return true;
    }
  }
  return false;
}

export function isValidRing(vertices: readonly Point[]) {
  if (vertices.length < 3 || ringArea(vertices) < 0.01) return false;
  for (let edge = 0; edge < vertices.length; edge += 1) {
    const next = (edge + 1) % vertices.length;
    const a = vertices[edge]; const b = vertices[next];
    if (a.x === b.x && a.y === b.y) return false;
    for (let other = edge + 1; other < vertices.length; other += 1) {
      const otherNext = (other + 1) % vertices.length;
      if (edge === other || next === other || otherNext === edge) continue;
      if (segmentIntersection(a, b, vertices[other], vertices[otherNext])) return false;
    }
  }
  return true;
}

export function canAddPolygonHole(outer: readonly Point[], hole: readonly Point[], existingHoles: readonly (readonly Point[])[] = []) {
  if (!isValidRing(outer) || !isValidRing(hole)) return false;
  if (!hole.every((vertex) => pointInRing(vertex, outer))) return false;
  if (ringsCross(outer, hole)) return false;
  return existingHoles.every((existing) =>
    !ringsCross(existing, hole) &&
    !pointInRing(hole[0], existing) &&
    !pointInRing(existing[0], hole),
  );
}

function segmentProjection(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared
    ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
    : 0;
  const x = start.x + t * dx;
  const y = start.y + t * dy;
  return { x, y, distance: Math.hypot(point.x - x, point.y - y) };
}

function ringsForSnap(annotation: EditorAnnotation): Vertex[][] {
  if (annotation.type === "line") return [annotation.vertices];
  if (annotation.type === "polygon") return [annotation.vertices, ...annotation.holes];
  return [];
}

export function snapPointToAnnotations(
  point: Point,
  annotations: EditorAnnotation[],
  excludeId = "",
  tolerance = 13,
) {
  let bestVertex: { x: number; y: number; snapped: boolean; distance: number } | null = null;
  for (const annotation of annotations) {
    if (annotation.id === excludeId) continue;
    for (const ring of ringsForSnap(annotation)) {
      for (const vertex of ring) {
        const distance = Math.hypot(point.x - vertex.x, point.y - vertex.y);
        if (distance <= tolerance && (!bestVertex || distance < bestVertex.distance)) {
          bestVertex = { x: vertex.x, y: vertex.y, snapped: true, distance };
        }
      }
    }
  }
  if (bestVertex) return bestVertex;

  let bestEdge = { ...point, snapped: false, distance: tolerance };
  for (const annotation of annotations) {
    if (annotation.id === excludeId) continue;
    for (const ring of ringsForSnap(annotation)) {
      const open = annotation.type === "line";
      for (let index = 0; index < ring.length; index += 1) {
        if (open && index === ring.length - 1) continue;
        const projection = segmentProjection(point, ring[index], ring[(index + 1) % ring.length]);
        if (projection.distance < bestEdge.distance) {
          bestEdge = { x: projection.x, y: projection.y, snapped: true, distance: projection.distance };
        }
      }
    }
  }
  return bestEdge;
}

function perpendicularDistance(point: Point, start: Point, end: Point) {
  return segmentProjection(point, start, end).distance;
}

function rdp<T extends Point>(points: T[], tolerance: number): T[] {
  if (points.length <= 2) return points;
  let maxDistance = 0;
  let splitIndex = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = perpendicularDistance(points[index], points[0], points.at(-1)!);
    if (distance > maxDistance) { maxDistance = distance; splitIndex = index; }
  }
  if (maxDistance <= tolerance) return [points[0], points.at(-1)!];
  return [...rdp(points.slice(0, splitIndex + 1), tolerance).slice(0, -1), ...rdp(points.slice(splitIndex), tolerance)];
}

export function simplifyPolygonAnnotation(annotation: PolygonAnnotation, tolerance: number) {
  if (annotation.vertices.length < 4 || tolerance <= 0) return annotation;
  const closed = [...annotation.vertices, annotation.vertices[0]];
  const simplified = rdp(closed, tolerance).slice(0, -1);
  if (simplified.length < 3 || !isValidRing(simplified)) return annotation;
  return { ...annotation, vertices: simplified };
}

function clippingPolygon(annotation: PolygonAnnotation): polygonClipping.Polygon {
  return [closedRing(annotation.vertices), ...annotation.holes.map(closedRing)] as polygonClipping.Polygon;
}

function annotationsFromMultiPolygon(
  multiPolygon: polygonClipping.MultiPolygon,
  base: PolygonAnnotation,
  makeId: MakeId,
) {
  return multiPolygon.flatMap((polygon, polygonIndex): PolygonAnnotation[] => {
    const [outer, ...holes] = polygon;
    if (!outer || outer.length < 4) return [];
    const vertices = verticesFromRing(outer as Pair[], makeId, `${base.id}:v`);
    if (!isValidRing(vertices)) return [];
    return [{
      ...base,
      id: polygonIndex === 0 ? base.id : makeId("polygon"),
      vertices,
      holes: holes.map((hole, holeIndex) => verticesFromRing(hole as Pair[], makeId, `${base.id}:h${holeIndex}`)).filter((hole) => hole.length >= 3),
    }];
  });
}

export function unionPolygonAnnotations(polygons: PolygonAnnotation[], makeId: MakeId) {
  if (polygons.length < 2) return polygons;
  const subject = clippingPolygon(polygons[0]);
  const clips = polygons.slice(1).map(clippingPolygon);
  return annotationsFromMultiPolygon(polygonClipping.union(subject, ...clips), polygons[0], makeId);
}

export function splitPolygonAnnotation(
  annotation: PolygonAnnotation,
  start: Point,
  end: Point,
  imageSize: Size2D,
  makeId: MakeId,
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return [annotation];
  const ux = dx / length;
  const uy = dy / length;
  const halfWidth = Math.max(0.5, Math.min(imageSize.width, imageSize.height) / 5000);
  const px = -uy * halfWidth;
  const py = ux * halfWidth;
  const extension = Math.hypot(imageSize.width, imageSize.height) * 2 + length;
  const ax = start.x - ux * extension;
  const ay = start.y - uy * extension;
  const bx = end.x + ux * extension;
  const by = end.y + uy * extension;
  const cutter: polygonClipping.Polygon = [[
    [ax + px, ay + py], [bx + px, by + py], [bx - px, by - py], [ax - px, ay - py], [ax + px, ay + py],
  ]];
  const result = annotationsFromMultiPolygon(polygonClipping.difference(clippingPolygon(annotation), cutter), annotation, makeId);
  return result.length >= 2 ? result : [annotation];
}

function ringArc(vertices: Point[], start: number, end: number) {
  const result: Point[] = [vertices[start]];
  let index = start;
  while (index !== end) {
    index = (index + 1) % vertices.length;
    result.push(vertices[index]);
  }
  return result;
}

export function reshapePolygonAnnotation(annotation: PolygonAnnotation, path: Point[], makeId: MakeId): ReshapeResult {
  if (annotation.vertices.length < 3 || path.length < 3) return { annotation: null, mode: null, reason: "crossings" };
  const ring = annotation.vertices.map(({ x, y }) => ({ x, y }));
  const startInside = pointInRing(path[0], ring);
  const endInside = pointInRing(path.at(-1)!, ring);
  if (startInside !== endInside) return { annotation: null, mode: null, reason: "mixed" };
  const mode: "add" | "delete" = startInside ? "add" : "delete";

  const intersections: Array<{ pathSegment: number; pathT: number; edge: number; edgeT: number; point: Point }> = [];
  for (let pathSegment = 0; pathSegment < path.length - 1; pathSegment += 1) {
    for (let edge = 0; edge < ring.length; edge += 1) {
      const hit = segmentIntersection(path[pathSegment], path[pathSegment + 1], ring[edge], ring[(edge + 1) % ring.length]);
      if (!hit) continue;
      if (!intersections.some((item) => item.point.x === hit.x && item.point.y === hit.y)) {
        intersections.push({ pathSegment, pathT: hit.pathT, edge, edgeT: hit.edgeT, point: { x: hit.x, y: hit.y } });
      }
    }
  }
  intersections.sort((a, b) => a.pathSegment + a.pathT - b.pathSegment - b.pathT);
  if (intersections.length < 2) return { annotation: null, mode, reason: "crossings" };
  const first = intersections[0];
  const last = intersections.at(-1)!;
  if (first.point.x === last.point.x && first.point.y === last.point.y) return { annotation: null, mode, reason: "crossings" };

  const traceSection: Point[] = [first.point];
  for (let index = first.pathSegment + 1; index <= last.pathSegment; index += 1) traceSection.push(path[index]);
  traceSection.push(last.point);

  const insertions = new Map<number, Array<{ endpoint: number; t: number; point: Point }>>();
  [first, last].forEach((hit, endpoint) => {
    const list = insertions.get(hit.edge) ?? [];
    list.push({ endpoint, t: hit.edgeT, point: hit.point });
    insertions.set(hit.edge, list);
  });
  const augmented: Point[] = [];
  ring.forEach((vertex, edge) => {
    augmented.push(vertex);
    for (const insertion of (insertions.get(edge) ?? []).sort((a, b) => a.t - b.t)) {
      if (insertion.t > 0 && insertion.t < 1) augmented.push(insertion.point);
    }
  });
  const endpointIndices = [first.point, last.point].map((target) => augmented.reduce((best, vertex, index) =>
    Math.hypot(vertex.x - target.x, vertex.y - target.y) < Math.hypot(augmented[best].x - target.x, augmented[best].y - target.y) ? index : best, 0));
  const [startIndex, endIndex] = endpointIndices;
  if (startIndex === endIndex) return { annotation: null, mode, reason: "crossings" };
  traceSection[0] = augmented[startIndex];
  traceSection[traceSection.length - 1] = augmented[endIndex];

  const forward = ringArc(augmented, startIndex, endIndex);
  const backward = ringArc(augmented, endIndex, startIndex);
  const candidates = [
    [...traceSection, ...backward.slice(1, -1)],
    [...forward, ...traceSection.slice(1, -1).reverse()],
  ].map((candidate) => candidate.filter((point, index) => {
    const previous = candidate[(index - 1 + candidate.length) % candidate.length];
    return point.x !== previous.x || point.y !== previous.y;
  })).filter((candidate) => candidate.length >= 3 && isValidRing(candidate));
  if (!candidates.length) return { annotation: null, mode, reason: "crossings" };

  const originalArea = ringArea(ring);
  const directional = candidates.filter((candidate) => mode === "add" ? ringArea(candidate) > originalArea : ringArea(candidate) < originalArea);
  if (!directional.length) return { annotation: null, mode, reason: "direction" };
  const selected = directional.reduce((best, candidate) => {
    const candidateArea = ringArea(candidate);
    const bestArea = ringArea(best);
    return mode === "add" ? candidateArea < bestArea ? candidate : best : candidateArea > bestArea ? candidate : best;
  });
  return {
    annotation: { ...annotation, vertices: selected.map(({ x, y }) => ({ id: makeId(`${annotation.id}:v`), x, y })) },
    mode,
    reason: null,
  };
}

export function addPolygonHole(annotation: PolygonAnnotation, hole: Point[], makeId: MakeId) {
  if (!canAddPolygonHole(annotation.vertices, hole, annotation.holes)) return annotation;
  const vertices = hole.map(({ x, y }) => ({ id: makeId(`${annotation.id}:hole`), x, y }));
  return { ...annotation, holes: [...annotation.holes, vertices] };
}
