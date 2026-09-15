import type { Asset, Label } from "../../lib/types";
import type { BoxAnnotation, EditorAnnotation } from "../models/annotation-model";
import type { Vertex } from "../models/vertex-model";
import { annotationBounds, boxCornerPoints } from "../geometry/annotation-geometry";

export function verticesToFlat(vertices: Vertex[]) {
  return vertices.flatMap((vertex) => [vertex.x, vertex.y]);
}

export function polygonArea(vertices: Vertex[]) {
  if (vertices.length < 3) return 0;
  let area = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index];
    const next = vertices[(index + 1) % vertices.length];
    area += current.x * next.y - next.x * current.y;
  }
  return Math.abs(area / 2);
}

export function boxCorners(annotation: BoxAnnotation): Vertex[] {
  return boxCornerPoints(annotation).map((corner, index) => ({ id: `${annotation.id}:corner:${index}`, ...corner }));
}

/** Kept as the export-side name; annotationBounds already accounts for rotation. */
export function exportBounds(annotation: EditorAnnotation) {
  return annotationBounds(annotation);
}

/**
 * Position of the first item carrying each id, matching `findIndex` semantics
 * for the duplicate-id case so the exported ids stay identical.
 */
function firstIndexById(items: ReadonlyArray<{ id: string }>) {
  const indexes = new Map<string, number>();
  items.forEach((item, index) => {
    if (!indexes.has(item.id)) indexes.set(item.id, index);
  });
  return indexes;
}

export type ExportIndexes = {
  imageIndexById: ReadonlyMap<string, number>;
  categoryIndexById: ReadonlyMap<string, number>;
};

/** Built once per document so a large export does not rescan the arrays per annotation. */
export function buildExportIndexes(assets: Asset[], labels: Label[]): ExportIndexes {
  return { imageIndexById: firstIndexById(assets), categoryIndexById: firstIndexById(labels) };
}

export function annotationToCoco(
  annotation: EditorAnnotation,
  annotationIndex: number,
  assets: Asset[],
  labels: Label[],
  indexes: ExportIndexes = buildExportIndexes(assets, labels),
) {
  const imageIndex = indexes.imageIndexById.get(annotation.asset) ?? -1;
  const categoryIndex = indexes.categoryIndexById.get(annotation.label) ?? -1;
  const bounds = exportBounds(annotation);
  const segmentation = annotation.type === "polygon"
    ? [annotation.vertices, ...annotation.holes].map(verticesToFlat)
    : annotation.type === "box" && Math.abs(annotation.rotation ?? 0) > 0.0001
      ? [verticesToFlat(boxCorners(annotation))]
      : [];
  const line = annotation.type === "line" ? verticesToFlat(annotation.vertices) : [];
  const area = annotation.type === "polygon"
    ? polygonArea(annotation.vertices) - annotation.holes.reduce((sum, hole) => sum + polygonArea(hole), 0)
    : annotation.type === "line"
      ? 0
      : annotation.type === "box"
        ? annotation.width * annotation.height
        : 0;

  return {
    id: annotationIndex + 1,
    image_id: imageIndex + 1,
    category_id: categoryIndex + 1,
    bbox: [bounds.x, bounds.y, bounds.width, bounds.height],
    segmentation,
    line,
    keypoints: annotation.type === "point" ? [annotation.x, annotation.y, 2] : [],
    num_keypoints: annotation.type === "point" ? 1 : 0,
    area,
    rotation: annotation.type === "box" ? annotation.rotation ?? 0 : undefined,
    iscrowd: 0,
  };
}

export function annotationToYolo(
  annotation: EditorAnnotation,
  labels: Label[],
  asset: Asset,
  categoryIndexById: ReadonlyMap<string, number> = firstIndexById(labels),
) {
  const classIndex = categoryIndexById.get(annotation.label) ?? -1;
  const width = Number(asset.width);
  const height = Number(asset.height);
  if (classIndex < 0 || !Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return null;

  if (annotation.type === "box") {
    const bounds = exportBounds(annotation);
    return [
      classIndex,
      (bounds.x + bounds.width / 2) / width,
      (bounds.y + bounds.height / 2) / height,
      bounds.width / width,
      bounds.height / height,
    ].map((value, index) => index === 0 ? String(value) : Number(value).toFixed(6)).join(" ");
  }

  if (annotation.type === "polygon") {
    const normalized = annotation.vertices.flatMap((vertex) => [
      (vertex.x / width).toFixed(6),
      (vertex.y / height).toFixed(6),
    ]);
    return `${classIndex} ${normalized.join(" ")}`;
  }

  return null;
}

export type GeoPointProjector = (x: number, y: number) => [number, number];

function closeRing(points: Array<[number, number]>) {
  if (!points.length) return points;
  const first = points[0];
  const last = points.at(-1)!;
  return first[0] === last[0] && first[1] === last[1] ? points : [...points, first];
}

export function annotationToGeoJsonGeometry(annotation: EditorAnnotation, project: GeoPointProjector) {
  if (annotation.type === "point") return { type: "Point", coordinates: project(annotation.x, annotation.y) } as const;
  if (annotation.type === "line") return { type: "LineString", coordinates: annotation.vertices.map((vertex) => project(vertex.x, vertex.y)) } as const;
  if (annotation.type === "box") {
    return { type: "Polygon", coordinates: [closeRing(boxCorners(annotation).map((vertex) => project(vertex.x, vertex.y)))] } as const;
  }
  return {
    type: "Polygon",
    coordinates: [
      closeRing(annotation.vertices.map((vertex) => project(vertex.x, vertex.y))),
      ...annotation.holes.map((hole) => closeRing(hole.map((vertex) => project(vertex.x, vertex.y)))),
    ],
  } as const;
}
