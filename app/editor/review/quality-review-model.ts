import type { Asset, Label } from "../../lib/types";
import type { EditorAnnotation, PolygonAnnotation } from "../models/annotation-model";

export type QualitySummary = {
  perImage: Array<{ item: Asset; count: number }>;
  counts: Array<{ label: Label; count: number }>;
  areas: Map<string, number>;
  minPerImage: number;
  maxPerImage: number;
  maxCount: number;
  emptyLabelIds: string[];
  emptyAssetIds: string[];
};

function validateReviewScore(score: number) {
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    throw new RangeError("Review score must be an integer between 1 and 5.");
  }
}

function updateReviewScore<T extends { id: string; reviewScore?: number }>(items: T[], id: string, score: number): T[] {
  validateReviewScore(score);
  const index = items.findIndex((item) => item.id === id);
  if (index < 0 || items[index].reviewScore === score) return items;
  return items.map((item, itemIndex) => itemIndex === index ? { ...item, reviewScore: score } : item);
}

export function setAssetReviewScore(assets: Asset[], assetId: string, score: number) {
  return updateReviewScore(assets, assetId, score);
}

export function setLabelReviewScore(labels: Label[], labelId: string, score: number) {
  return updateReviewScore(labels, labelId, score);
}

export function setAnnotationReviewScore(annotations: EditorAnnotation[], annotationId: string, score: number) {
  return updateReviewScore(annotations, annotationId, score);
}

function ringArea(vertices: PolygonAnnotation["vertices"]) {
  if (vertices.length < 3) return 0;
  let twiceArea = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index];
    const next = vertices[(index + 1) % vertices.length];
    twiceArea += current.x * next.y - next.x * current.y;
  }
  return Math.abs(twiceArea) / 2;
}

export function annotationPixelArea(annotation: EditorAnnotation) {
  if (annotation.type === "box") return Math.abs(annotation.width * annotation.height);
  if (annotation.type !== "polygon") return 0;
  const holes = annotation.holes.reduce((sum, hole) => sum + ringArea(hole), 0);
  return Math.max(0, ringArea(annotation.vertices) - holes);
}

export function buildQualitySummary(assets: Asset[], labels: Label[], annotations: EditorAnnotation[]): QualitySummary {
  const perImageCounts = new Map(assets.map((asset) => [asset.id, 0]));
  const labelCounts = new Map(labels.map((label) => [label.id, 0]));
  const areas = new Map(labels.map((label) => [label.id, 0]));

  for (const annotation of annotations) {
    if (perImageCounts.has(annotation.asset)) {
      perImageCounts.set(annotation.asset, (perImageCounts.get(annotation.asset) ?? 0) + 1);
    }
    if (labelCounts.has(annotation.label)) {
      labelCounts.set(annotation.label, (labelCounts.get(annotation.label) ?? 0) + 1);
      areas.set(annotation.label, (areas.get(annotation.label) ?? 0) + annotationPixelArea(annotation));
    }
  }

  const perImage = assets.map((item) => ({ item, count: perImageCounts.get(item.id) ?? 0 }));
  const counts = labels.map((label) => ({ label, count: labelCounts.get(label.id) ?? 0 }));
  const imageCounts = perImage.map(({ count }) => count);
  const classCounts = counts.map(({ count }) => count);

  return {
    perImage,
    counts,
    areas,
    minPerImage: imageCounts.length ? Math.min(...imageCounts) : 0,
    maxPerImage: imageCounts.length ? Math.max(...imageCounts) : 0,
    maxCount: classCounts.length ? Math.max(...classCounts) : 0,
    emptyLabelIds: counts.filter(({ count }) => count === 0).map(({ label }) => label.id),
    emptyAssetIds: perImage.filter(({ count }) => count === 0).map(({ item }) => item.id),
  };
}
