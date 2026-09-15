import type { PolygonAnnotation } from "../models/annotation-model";

export type TransformCenter = { x: number; y: number };

export function polygonTransformCenter(annotation: PolygonAnnotation): TransformCenter {
  if (!annotation.vertices.length) return { x: 0, y: 0 };
  const xs = annotation.vertices.map((vertex) => vertex.x);
  const ys = annotation.vertices.map((vertex) => vertex.y);
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
}

function transformPoint(point: { x: number; y: number }, center: TransformCenter, scale: number, angle: number) {
  const dx = (point.x - center.x) * scale;
  const dy = (point.y - center.y) * scale;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: center.x + dx * cosine - dy * sine,
    y: center.y + dx * sine + dy * cosine,
  };
}

export function transformPolygonAnnotation(
  annotation: PolygonAnnotation,
  center: TransformCenter,
  scale: number,
  angle: number,
): PolygonAnnotation {
  const safeScale = Math.max(0.08, Math.min(12, scale));
  const transformVertex = <T extends { id: string; x: number; y: number }>(vertex: T): T => {
    const point = transformPoint(vertex, center, safeScale, angle);
    return { ...vertex, ...point };
  };
  return {
    ...annotation,
    vertices: annotation.vertices.map(transformVertex),
    holes: annotation.holes.map((hole) => hole.map(transformVertex)),
  };
}
