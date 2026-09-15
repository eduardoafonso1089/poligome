import type {
  AnnotationBase,
  BoxAnnotation,
  PointAnnotation,
  PolygonAnnotation,
  PolylineAnnotation,
} from "./annotation-model";
import type { Vertex } from "./vertex-model";

export type Coordinate = { x: number; y: number } | readonly [number, number];

function coordinatePoint(coordinate: Coordinate) {
  if ("x" in coordinate) return { x: coordinate.x, y: coordinate.y };
  return { x: coordinate[0], y: coordinate[1] };
}

function createVertices(annotationId: string, coordinates: Coordinate[], ring = "outer"): Vertex[] {
  return coordinates.map((coordinate, index) => {
    const point = coordinatePoint(coordinate);
    return { id: `${annotationId}:${ring}:v${index}`, x: point.x, y: point.y };
  });
}

function createVerticesFromFlat(annotationId: string, points: number[], ring = "outer"): Vertex[] {
  const coordinates: Array<[number, number]> = [];
  for (let index = 0; index + 1 < points.length; index += 2) coordinates.push([points[index], points[index + 1]]);
  return createVertices(annotationId, coordinates, ring);
}

export function createPolygon(
  base: AnnotationBase,
  coordinates: Coordinate[],
  holes: Coordinate[][] = [],
): PolygonAnnotation {
  return {
    ...base,
    type: "polygon",
    vertices: createVertices(base.id, coordinates),
    holes: holes.map((hole, index) => createVertices(base.id, hole, `hole-${index}`)),
  };
}

export function createPolygonFromFlat(
  base: AnnotationBase,
  points: number[],
  holes: number[][] = [],
): PolygonAnnotation {
  return {
    ...base,
    type: "polygon",
    vertices: createVerticesFromFlat(base.id, points),
    holes: holes.map((hole, index) => createVerticesFromFlat(base.id, hole, `hole-${index}`)),
  };
}

export function createPolylineFromFlat(base: AnnotationBase, points: number[]): PolylineAnnotation {
  return { ...base, type: "line", vertices: createVerticesFromFlat(base.id, points) };
}

export function createBox(
  base: AnnotationBase,
  geometry: { x: number; y: number; width: number; height: number; rotation?: number },
): BoxAnnotation {
  return { ...base, type: "box", ...geometry };
}

export function createPoint(base: AnnotationBase, point: { x: number; y: number }): PointAnnotation {
  return { ...base, type: "point", x: point.x, y: point.y };
}
