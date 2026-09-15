import type { EditorAnnotation } from "../models/annotation-model";
import { annotationBounds } from "../geometry/annotation-geometry";

export type SelectionState = {
  selected: string | null;
  multiSelected: string[];
  anchorId: string | null;
};

export type SelectionMarquee = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  additiveIds: string[];
};

export function normalizedSelectionRect(marquee: SelectionMarquee) {
  return {
    x: Math.min(marquee.startX, marquee.currentX),
    y: Math.min(marquee.startY, marquee.currentY),
    width: Math.abs(marquee.currentX - marquee.startX),
    height: Math.abs(marquee.currentY - marquee.startY),
  };
}

export function annotationIntersectsRect(
  annotation: EditorAnnotation,
  rect: { x: number; y: number; width: number; height: number },
) {
  const bounds = annotationBounds(annotation);
  return bounds.x <= rect.x + rect.width && bounds.x + bounds.width >= rect.x &&
    bounds.y <= rect.y + rect.height && bounds.y + bounds.height >= rect.y;
}

export function toggleSelection(state: SelectionState, id: string): SelectionState {
  const base = state.selected && !state.multiSelected.includes(state.selected)
    ? [...state.multiSelected, state.selected]
    : state.multiSelected;
  const multiSelected = base.includes(id)
    ? base.filter((item) => item !== id)
    : [...base, id];
  return {
    selected: multiSelected.at(-1) ?? null,
    multiSelected,
    anchorId: id,
  };
}

export function selectSingle(id: string): SelectionState {
  return { selected: id, multiSelected: [id], anchorId: id };
}

export function selectRange(
  annotations: EditorAnnotation[],
  state: SelectionState,
  targetId: string,
  additive = false,
): SelectionState {
  const anchorIndex = state.anchorId ? annotations.findIndex((item) => item.id === state.anchorId) : -1;
  const targetIndex = annotations.findIndex((item) => item.id === targetId);
  if (anchorIndex < 0 || targetIndex < 0) return selectSingle(targetId);
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  const rangeIds = annotations.slice(start, end + 1).map((item) => item.id);
  const multiSelected = additive
    ? Array.from(new Set([...state.multiSelected, ...rangeIds]))
    : rangeIds;
  return { selected: targetId, multiSelected, anchorId: state.anchorId };
}

export function selectionFromMarquee(
  annotations: EditorAnnotation[],
  marquee: SelectionMarquee,
  clickThreshold = 4,
): SelectionState {
  const rect = normalizedSelectionRect(marquee);
  if (rect.width < clickThreshold && rect.height < clickThreshold) {
    const multiSelected = [...marquee.additiveIds];
    return { selected: multiSelected.at(-1) ?? null, multiSelected, anchorId: null };
  }
  const hits = annotations.filter((annotation) => annotationIntersectsRect(annotation, rect)).map((annotation) => annotation.id);
  const multiSelected = Array.from(new Set([...marquee.additiveIds, ...hits]));
  return { selected: multiSelected.at(-1) ?? null, multiSelected, anchorId: null };
}
