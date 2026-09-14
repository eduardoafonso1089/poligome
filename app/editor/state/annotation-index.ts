"use client";

import { useMemo, useRef } from "react";
import type { EditorAnnotation } from "../models/annotation-model";

export type AnnotationIndex = {
  annotations: EditorAnnotation[];
  byAsset: ReadonlyMap<string, EditorAnnotation[]>;
  countByAsset: ReadonlyMap<string, number>;
  countByLabel: ReadonlyMap<string, number>;
};

function increment(counts: Map<string, number>, key: string) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function buildIndex(annotations: EditorAnnotation[]): AnnotationIndex {
  const byAsset = new Map<string, EditorAnnotation[]>();
  const countByAsset = new Map<string, number>();
  const countByLabel = new Map<string, number>();

  for (const annotation of annotations) {
    const bucket = byAsset.get(annotation.asset);
    if (bucket) bucket.push(annotation);
    else byAsset.set(annotation.asset, [annotation]);
    increment(countByAsset, annotation.asset);
    increment(countByLabel, annotation.label);
  }

  return { annotations, byAsset, countByAsset, countByLabel };
}

function isAppend(previous: EditorAnnotation[], next: EditorAnnotation[]) {
  if (next.length < previous.length) return false;
  for (let index = 0; index < previous.length; index += 1) {
    if (previous[index] !== next[index]) return false;
  }
  return true;
}

/**
 * Keeps unaffected image buckets referentially stable during progressive imports.
 */
export function indexAnnotations(annotations: EditorAnnotation[], previous?: AnnotationIndex): AnnotationIndex {
  if (!previous || !isAppend(previous.annotations, annotations)) return buildIndex(annotations);
  if (previous.annotations === annotations) return previous;

  const byAsset = new Map(previous.byAsset);
  const countByAsset = new Map(previous.countByAsset);
  const countByLabel = new Map(previous.countByLabel);

  for (let index = previous.annotations.length; index < annotations.length; index += 1) {
    const annotation = annotations[index];
    const bucket = byAsset.get(annotation.asset) ?? [];
    byAsset.set(annotation.asset, [...bucket, annotation]);
    increment(countByAsset, annotation.asset);
    increment(countByLabel, annotation.label);
  }

  return { annotations, byAsset, countByAsset, countByLabel };
}

export function useAnnotationIndex(annotations: EditorAnnotation[]) {
  const previous = useRef<AnnotationIndex | undefined>(undefined);
  return useMemo(() => {
    const next = indexAnnotations(annotations, previous.current);
    previous.current = next;
    return next;
  }, [annotations]);
}
