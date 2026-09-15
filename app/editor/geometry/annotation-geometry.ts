import type { BoxAnnotation, EditorAnnotation } from "../models/annotation-model";
import type { Vertex } from "../models/vertex-model";
import { deleteVertex, insertVertex, moveVertices, updateVertex } from "../models/vertex-model";

/**
 * Two different jobs used to share one constant, in source-image pixels, which
 * meant the guard grew and shrank with the image: ~27 screen px on a thumbnail,
 * 0.2 screen px on a 40.000 px orthomosaic, where it never fired at all.
 *
 * - DEGENERATE_VERTEX_DISTANCE refuses coincident vertices. That is a geometry
 *   concern, so it stays absolute and tiny.
 * - VERTEX_SCREEN_DISTANCE is the fat-finger guard. It is a screen measure, so
 *   callers convert it through screenPixelsToImageUnits like snapping does.
 */
export const DEGENERATE_VERTEX_DISTANCE = 0.25;
export const VERTEX_SCREEN_DISTANCE = 10;

/** Inherited default for callers that cannot derive a zoom-aware tolerance. */
export const MIN_VERTEX_DISTANCE = 10;

export type Bounds = { x: number; y: number; width: number; height: number };
export type BoxResizeCorner = "nw" | "ne" | "se" | "sw";

function rotateAround(point: { x: number; y: number }, center: { x: number; y: number }, angle: number) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cosine - dy * sine,
    y: center.y + dx * sine + dy * cosine,
  };
}

function pointsBounds(points: ReadonlyArray<{ x: number; y: number }>): Bounds {
  if (!points.length) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = points[0].x, maxX = points[0].x, minY = points[0].y, maxY = points[0].y;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** The four drawn corners of a box, already rotated around its own centre. */
export function boxCornerPoints(annotation: BoxAnnotation) {
  const rotation = annotation.rotation ?? 0;
  const center = { x: annotation.x + annotation.width / 2, y: annotation.y + annotation.height / 2 };
  return [
    { x: annotation.x, y: annotation.y },
    { x: annotation.x + annotation.width, y: annotation.y },
    { x: annotation.x + annotation.width, y: annotation.y + annotation.height },
    { x: annotation.x, y: annotation.y + annotation.height },
  ].map((corner) => rotateAround(corner, center, rotation));
}

export function verticesBounds(vertices: Vertex[]): Bounds {
  return pointsBounds(vertices);
}

/**
 * Extent of the shape as it is actually drawn. A rotated box reaches past the
 * rectangle its x/y/width/height describe, so the corners are rotated first —
 * otherwise marquee selection misses corners the user can see and click.
 */
export function annotationBounds(annotation: EditorAnnotation): Bounds {
  if (annotation.type === "polygon" || annotation.type === "line") return verticesBounds(annotation.vertices);
  if (annotation.type === "box") {
    if (!annotation.rotation) return { x: annotation.x, y: annotation.y, width: annotation.width, height: annotation.height };
    return pointsBounds(boxCornerPoints(annotation));
  }
  return { x: annotation.x - 4, y: annotation.y - 4, width: 8, height: 8 };
}

export function translateAnnotation(annotation: EditorAnnotation, dx: number, dy: number): EditorAnnotation {
  if (annotation.type === "polygon") {
    return {
      ...annotation,
      vertices: moveVertices(annotation.vertices, dx, dy),
      holes: annotation.holes.map((hole) => moveVertices(hole, dx, dy)),
    };
  }
  if (annotation.type === "line") return { ...annotation, vertices: moveVertices(annotation.vertices, dx, dy) };
  return { ...annotation, x: annotation.x + dx, y: annotation.y + dy };
}

/** Resize in source-image pixel space while preserving the opposite visual corner. */
export function resizeBoxFromCorner(
  annotation: BoxAnnotation,
  corner: BoxResizeCorner,
  pointer: { x: number; y: number },
  minimumSize = 1,
): BoxAnnotation {
  const rotation = annotation.rotation ?? 0;
  const center = { x: annotation.x + annotation.width / 2, y: annotation.y + annotation.height / 2 };
  const localPointer = rotateAround(pointer, center, -rotation);
  const left = annotation.x;
  const right = annotation.x + annotation.width;
  const top = annotation.y;
  const bottom = annotation.y + annotation.height;

  const fixedX = corner.includes("w") ? right : left;
  const fixedY = corner.includes("n") ? bottom : top;
  const dragX = corner.includes("w")
    ? Math.min(localPointer.x, fixedX - minimumSize)
    : Math.max(localPointer.x, fixedX + minimumSize);
  const dragY = corner.includes("n")
    ? Math.min(localPointer.y, fixedY - minimumSize)
    : Math.max(localPointer.y, fixedY + minimumSize);

  const localCenter = { x: (dragX + fixedX) / 2, y: (dragY + fixedY) / 2 };
  const worldCenter = rotateAround(localCenter, center, rotation);
  const width = Math.max(minimumSize, Math.abs(fixedX - dragX));
  const height = Math.max(minimumSize, Math.abs(fixedY - dragY));

  return { ...annotation, x: worldCenter.x - width / 2, y: worldCenter.y - height / 2, width, height };
}

export function updateAnnotationVertex(
  annotation: EditorAnnotation,
  vertexId: string,
  point: { x: number; y: number },
  minDistance = MIN_VERTEX_DISTANCE,
): EditorAnnotation {
  if (annotation.type !== "polygon" && annotation.type !== "line") return annotation;
  const tolerance = Math.max(minDistance, DEGENERATE_VERTEX_DISTANCE);
  const overlaps = annotation.vertices.some((vertex) =>
    vertex.id !== vertexId && Math.hypot(vertex.x - point.x, vertex.y - point.y) < tolerance,
  );
  if (overlaps) return annotation;
  return { ...annotation, vertices: updateVertex(annotation.vertices, vertexId, point) };
}

export function insertAnnotationVertex(
  annotation: EditorAnnotation,
  afterVertexId: string,
  point: { x: number; y: number },
  vertexId: string,
  minDistance = MIN_VERTEX_DISTANCE,
): EditorAnnotation {
  if (annotation.type !== "polygon" && annotation.type !== "line") return annotation;
  const tolerance = Math.max(minDistance, DEGENERATE_VERTEX_DISTANCE);
  const tooClose = annotation.vertices.some((vertex) => Math.hypot(vertex.x - point.x, vertex.y - point.y) < tolerance);
  if (tooClose) return annotation;
  return { ...annotation, vertices: insertVertex(annotation.vertices, afterVertexId, point, () => vertexId) };
}

export function deleteAnnotationVertex(annotation: EditorAnnotation, vertexId: string): EditorAnnotation | null {
  if (annotation.type !== "polygon" && annotation.type !== "line") return annotation;
  const minimum = annotation.type === "line" ? 2 : 3;
  if (annotation.vertices.length <= minimum) return null;
  return { ...annotation, vertices: deleteVertex(annotation.vertices, vertexId, minimum) };
}

export function edgeMidpoints(vertices: Vertex[], open = false, minEdgeLength = MIN_VERTEX_DISTANCE * 3) {
  if (vertices.length < 2) return [];
  const limit = open ? vertices.length - 1 : vertices.length;
  const result: Array<{ afterVertexId: string; x: number; y: number }> = [];
  for (let index = 0; index < limit; index += 1) {
    const current = vertices[index];
    const next = vertices[(index + 1) % vertices.length];
    if (Math.hypot(current.x - next.x, current.y - next.y) < minEdgeLength) continue;
    result.push({ afterVertexId: current.id, x: (current.x + next.x) / 2, y: (current.y + next.y) / 2 });
  }
  return result;
}
