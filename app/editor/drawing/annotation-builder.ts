import type { AnnotationBase, EditorAnnotation } from "../models/annotation-model";
import {
  createBox,
  createPoint,
  createPolygonFromFlat,
  createPolylineFromFlat,
} from "../models/annotation-factory";

export type BoxDraft = { x: number; y: number; w: number; h: number };

export function annotationBase(id: string, asset: string, label: string): AnnotationBase {
  return { id, asset, label };
}

export function boxFromDraft(base: AnnotationBase, draft: BoxDraft): EditorAnnotation | null {
  if (draft.w < 8 || draft.h < 8) return null;
  return createBox(base, { x: draft.x, y: draft.y, width: draft.w, height: draft.h });
}

export function polygonFromDraft(base: AnnotationBase, points: number[], holes: number[][] = []): EditorAnnotation | null {
  if (points.length < 6 || points.length % 2 !== 0) return null;
  return createPolygonFromFlat(base, points, holes);
}

export function lineFromDraft(base: AnnotationBase, points: number[]): EditorAnnotation | null {
  if (points.length < 4 || points.length % 2 !== 0) return null;
  return createPolylineFromFlat(base, points);
}

export function pointFromDraft(base: AnnotationBase, point: { x: number; y: number }): EditorAnnotation {
  return createPoint(base, point);
}

export function freehandFromDraft(base: AnnotationBase, points: number[]): EditorAnnotation | null {
  if (points.length < 6 || points.length % 2 !== 0) return null;
  return createPolygonFromFlat(base, points);
}
