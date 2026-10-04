import type { EditorAnnotation } from "../editor/models/annotation-model";

/** Restore replaced results without duplicating objects already restored by Ctrl+Z. */
export function preannotationUndoPlan(
  current: readonly EditorAnnotation[],
  createdIds: readonly string[],
  previous: readonly EditorAnnotation[] = [],
): { removeIds: string[]; annotations: EditorAnnotation[]; selectIds: string[] } {
  const created = new Set(createdIds);
  const removeIds = current.filter((annotation) => created.has(annotation.id)).map((annotation) => annotation.id);
  const remaining = new Set(current.filter((annotation) => !created.has(annotation.id)).map((annotation) => annotation.id));
  return { removeIds, annotations: previous.filter((annotation) => !remaining.has(annotation.id)), selectIds: [] };
}
