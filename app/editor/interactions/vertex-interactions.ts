import type { EditorAnnotation } from "../models/annotation-model";
import type { Vertex } from "../models/vertex-model";

export const MIN_VERTEX_DISTANCE = 10;

export type VertexRef = { annotationId: string; vertexId: string };

export function nearestVertexId(
  vertices: Vertex[],
  point: { x: number; y: number },
  options: { markerAspect?: number; maxDistance?: number } = {},
) {
  const markerAspect = Math.max(options.markerAspect ?? 1, 0.01);
  const maxDistance = options.maxDistance ?? Number.POSITIVE_INFINITY;
  let closest: string | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const vertex of vertices) {
    const distance = Math.hypot(
      vertex.x - point.x,
      (vertex.y - point.y) / markerAspect,
    );
    if (distance < closestDistance) {
      closest = vertex.id;
      closestDistance = distance;
    }
  }

  return closestDistance <= maxDistance ? closest : null;
}

/** Vertices created by splits can be near-coincident; edit them as one topological node. */
export function linkedVertices(
  annotations: EditorAnnotation[],
  source: { x: number; y: number },
  tolerance = 3,
): VertexRef[] {
  return annotations.flatMap((annotation) => {
    if (annotation.type !== "polygon" && annotation.type !== "line") return [];
    return annotation.vertices
      .filter((vertex) => Math.hypot(vertex.x - source.x, vertex.y - source.y) <= tolerance)
      .map((vertex) => ({ annotationId: annotation.id, vertexId: vertex.id }));
  });
}

export function nearbyVertexId(vertices: Vertex[], x: number, y: number, tolerance = MIN_VERTEX_DISTANCE * 1.5) {
  return vertices.find((vertex) => Math.hypot(vertex.x - x, vertex.y - y) < tolerance)?.id ?? null;
}

export function insertedVertexId(afterVertexId: string, sequence = 0) {
  return `${afterVertexId}:inserted:${sequence}`;
}
