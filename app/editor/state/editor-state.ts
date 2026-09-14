import type { EditorAnnotation } from "../models/annotation-model";
import type { SelectionState } from "../selection/selection-model";
import { selectSingle, toggleSelection } from "../selection/selection-model";
import {
  deleteAnnotationVertex,
  insertAnnotationVertex,
  translateAnnotation,
  updateAnnotationVertex,
} from "../geometry/annotation-geometry";

export type SelectedVertex = { annotationId: string; vertexId: string } | null;

export type EditorGesture = {
  annotations: EditorAnnotation[];
  selection: SelectionState;
  selectedVertex: SelectedVertex;
} | null;

export type EditorState = {
  annotations: EditorAnnotation[];
  history: EditorAnnotation[][];
  redo: EditorAnnotation[][];
  selection: SelectionState;
  selectedVertex: SelectedVertex;
  gesture: EditorGesture;
  saved: boolean;
};

export type EditorAction =
  | { type: "replace-annotations"; annotations: EditorAnnotation[]; markSaved?: boolean }
  | { type: "append-annotations"; annotations: EditorAnnotation[]; markSaved?: boolean }
  | { type: "add-annotation"; annotation: EditorAnnotation; select?: boolean }
  | { type: "delete-annotations"; ids: string[] }
  | { type: "replace-annotations-batch"; removeIds: string[]; annotations: EditorAnnotation[]; selectIds?: string[] }
  | { type: "reorder-annotation"; id: string; delta: -1 | 1 }
  | { type: "reclassify-annotations"; ids: string[]; labelId: string }
  | { type: "select-single"; id: string }
  | { type: "toggle-selection"; id: string }
  | { type: "set-selection"; selection: SelectionState }
  | { type: "clear-selection" }
  | { type: "select-vertex"; vertex: SelectedVertex }
  | { type: "begin-gesture" }
  | { type: "commit-gesture" }
  | { type: "cancel-gesture" }
  | { type: "update-vertex"; annotationId: string; vertexId: string; point: { x: number; y: number } }
  | { type: "insert-vertex"; annotationId: string; afterVertexId: string; vertexId: string; point: { x: number; y: number } }
  | { type: "delete-vertex"; annotationId: string; vertexId: string }
  | { type: "translate-annotations"; ids: string[]; dx: number; dy: number }
  | { type: "replace-annotation"; annotation: EditorAnnotation }
  | { type: "replace-annotations-by-id"; annotations: EditorAnnotation[] }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "mark-saved" };

export function createEditorState(annotations: EditorAnnotation[] = []): EditorState {
  return {
    annotations,
    history: [],
    redo: [],
    selection: { selected: null, multiSelected: [], anchorId: null },
    selectedVertex: null,
    gesture: null,
    saved: true,
  };
}

function snapshot(state: EditorState): EditorState {
  return {
    ...state,
    history: [...state.history.slice(-24), state.annotations],
    redo: [],
    gesture: null,
    saved: false,
  };
}

function mutate(state: EditorState, annotations: EditorAnnotation[]): EditorState {
  if (annotations === state.annotations) return state;
  if (state.gesture) return { ...state, annotations, saved: false };
  const next = snapshot(state);
  return { ...next, annotations };
}

function keepExistingSelection(state: EditorState, annotations: EditorAnnotation[]) {
  const ids = new Set(annotations.map((annotation) => annotation.id));
  const multiSelected = state.selection.multiSelected.filter((id) => ids.has(id));
  const selected = state.selection.selected && ids.has(state.selection.selected)
    ? state.selection.selected
    : multiSelected.at(-1) ?? null;
  const selectedVertex = state.selectedVertex && ids.has(state.selectedVertex.annotationId)
    ? state.selectedVertex
    : null;
  return {
    selection: { ...state.selection, selected, multiSelected },
    selectedVertex,
  };
}

function reorderAnnotationWithinAsset(items: EditorAnnotation[], id: string, delta: -1 | 1) {
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return items;
  const assetId = items[index].asset;
  const peerIndexes = items.reduce<number[]>((indexes, item, itemIndex) => {
    if (item.asset === assetId) indexes.push(itemIndex);
    return indexes;
  }, []);
  const peerIndex = peerIndexes.indexOf(index);
  const targetPeerIndex = peerIndex + delta;
  if (peerIndex < 0 || targetPeerIndex < 0 || targetPeerIndex >= peerIndexes.length) return items;
  const targetIndex = peerIndexes[targetPeerIndex];
  const next = [...items];
  [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
  return next;
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "replace-annotations":
      return {
        ...state,
        annotations: action.annotations,
        history: [],
        redo: [],
        selection: { selected: null, multiSelected: [], anchorId: null },
        selectedVertex: null,
        gesture: null,
        saved: action.markSaved ?? true,
      };

    case "append-annotations": {
      if (!action.annotations.length) return { ...state, saved: action.markSaved ?? state.saved };
      const existingIds = new Set(state.annotations.map((annotation) => annotation.id));
      const additions = action.annotations.filter((annotation) => !existingIds.has(annotation.id));
      if (!additions.length) return state;
      // Imports arrive incrementally. Appending must not reset an active edit,
      // selection or undo gesture merely because another image finished loading.
      if (state.gesture) {
        return {
          ...state,
          annotations: [...state.annotations, ...additions],
          gesture: { ...state.gesture, annotations: [...state.gesture.annotations, ...additions] },
          saved: action.markSaved ?? false,
        };
      }
      return { ...state, annotations: [...state.annotations, ...additions], saved: action.markSaved ?? false };
    }

    case "add-annotation": {
      const next = snapshot(state);
      const annotations = [...state.annotations, action.annotation];
      return {
        ...next,
        annotations,
        selection: action.select ? selectSingle(action.annotation.id) : state.selection,
        selectedVertex: null,
      };
    }

    case "delete-annotations": {
      const ids = new Set(action.ids);
      if (!state.annotations.some((annotation) => ids.has(annotation.id))) return state;
      const next = snapshot(state);
      const annotations = state.annotations.filter((annotation) => !ids.has(annotation.id));
      return { ...next, annotations, ...keepExistingSelection(state, annotations) };
    }

    case "replace-annotations-batch": {
      const removeIds = new Set(action.removeIds);
      if (!state.annotations.some((annotation) => removeIds.has(annotation.id)) && !action.annotations.length) return state;
      const next = snapshot(state);
      const firstRemovedIndex = state.annotations.findIndex((annotation) => removeIds.has(annotation.id));
      const kept = state.annotations.filter((annotation) => !removeIds.has(annotation.id));
      const insertionIndex = firstRemovedIndex < 0 ? kept.length : Math.min(firstRemovedIndex, kept.length);
      const annotations = [...kept.slice(0, insertionIndex), ...action.annotations, ...kept.slice(insertionIndex)];
      const selectIds = (action.selectIds ?? action.annotations.map((annotation) => annotation.id)).filter((id) => annotations.some((annotation) => annotation.id === id));
      return {
        ...next,
        annotations,
        selection: { selected: selectIds.at(-1) ?? null, multiSelected: selectIds, anchorId: selectIds[0] ?? null },
        selectedVertex: null,
      };
    }

    case "reorder-annotation": {
      const annotations = reorderAnnotationWithinAsset(state.annotations, action.id, action.delta);
      return annotations === state.annotations ? state : mutate(state, annotations);
    }

    case "reclassify-annotations": {
      const ids = new Set(action.ids);
      if (!state.annotations.some((annotation) => ids.has(annotation.id) && annotation.label !== action.labelId)) return state;
      const annotations = state.annotations.map((annotation) =>
        ids.has(annotation.id) ? { ...annotation, label: action.labelId } : annotation,
      );
      return mutate(state, annotations);
    }

    case "select-single":
      return { ...state, selection: selectSingle(action.id), selectedVertex: null };

    case "toggle-selection":
      return { ...state, selection: toggleSelection(state.selection, action.id), selectedVertex: null };

    case "set-selection":
      return { ...state, selection: action.selection, selectedVertex: null };

    case "clear-selection":
      return {
        ...state,
        selection: { selected: null, multiSelected: [], anchorId: null },
        selectedVertex: null,
      };

    case "select-vertex":
      return {
        ...state,
        selectedVertex: action.vertex,
        selection: action.vertex ? selectSingle(action.vertex.annotationId) : state.selection,
      };

    case "begin-gesture":
      if (state.gesture) return state;
      return {
        ...state,
        gesture: {
          annotations: state.annotations,
          selection: state.selection,
          selectedVertex: state.selectedVertex,
        },
      };

    case "commit-gesture": {
      if (!state.gesture) return state;
      const changed = state.annotations !== state.gesture.annotations;
      if (!changed) return { ...state, gesture: null };
      return {
        ...state,
        history: [...state.history.slice(-24), state.gesture.annotations],
        redo: [],
        gesture: null,
        saved: false,
      };
    }

    case "cancel-gesture":
      if (!state.gesture) return state;
      return {
        ...state,
        annotations: state.gesture.annotations,
        selection: state.gesture.selection,
        selectedVertex: state.gesture.selectedVertex,
        gesture: null,
      };

    case "update-vertex": {
      const target = state.annotations.find((annotation) => annotation.id === action.annotationId);
      if (!target) return state;
      const updated = updateAnnotationVertex(target, action.vertexId, action.point);
      if (updated === target) return state;
      const annotations = state.annotations.map((annotation) => annotation.id === target.id ? updated : annotation);
      return {
        ...mutate(state, annotations),
        selectedVertex: { annotationId: action.annotationId, vertexId: action.vertexId },
      };
    }

    case "insert-vertex": {
      const target = state.annotations.find((annotation) => annotation.id === action.annotationId);
      if (!target) return state;
      const updated = insertAnnotationVertex(target, action.afterVertexId, action.point, action.vertexId);
      if (updated === target) return state;
      const next = snapshot(state);
      return {
        ...next,
        annotations: state.annotations.map((annotation) => annotation.id === target.id ? updated : annotation),
        selectedVertex: { annotationId: action.annotationId, vertexId: action.vertexId },
        selection: selectSingle(action.annotationId),
      };
    }

    case "delete-vertex": {
      const target = state.annotations.find((annotation) => annotation.id === action.annotationId);
      if (!target) return state;
      const updated = deleteAnnotationVertex(target, action.vertexId);
      const next = snapshot(state);
      if (!updated) {
        const annotations = state.annotations.filter((annotation) => annotation.id !== target.id);
        return { ...next, annotations, ...keepExistingSelection(state, annotations) };
      }
      return {
        ...next,
        annotations: state.annotations.map((annotation) => annotation.id === target.id ? updated : annotation),
        selectedVertex: null,
      };
    }

    case "translate-annotations": {
      const ids = new Set(action.ids);
      if (!state.annotations.some((annotation) => ids.has(annotation.id))) return state;
      const annotations = state.annotations.map((annotation) =>
        ids.has(annotation.id) ? translateAnnotation(annotation, action.dx, action.dy) : annotation,
      );
      return mutate(state, annotations);
    }

    case "replace-annotation": {
      const index = state.annotations.findIndex((annotation) => annotation.id === action.annotation.id);
      if (index < 0) return state;
      const annotations = state.annotations.map((annotation) => annotation.id === action.annotation.id ? action.annotation : annotation);
      return mutate(state, annotations);
    }

    case "replace-annotations-by-id": {
      const replacements = new Map(action.annotations.map((annotation) => [annotation.id, annotation]));
      if (!state.annotations.some((annotation) => replacements.has(annotation.id))) return state;
      const annotations = state.annotations.map((annotation) => replacements.get(annotation.id) ?? annotation);
      return mutate(state, annotations);
    }

    case "undo": {
      const previous = state.history.at(-1);
      if (!previous || state.gesture) return state;
      return {
        ...state,
        annotations: previous,
        history: state.history.slice(0, -1),
        redo: [...state.redo.slice(-24), state.annotations],
        selection: { selected: null, multiSelected: [], anchorId: null },
        selectedVertex: null,
        saved: false,
      };
    }

    case "redo": {
      const restored = state.redo.at(-1);
      if (!restored || state.gesture) return state;
      return {
        ...state,
        annotations: restored,
        history: [...state.history.slice(-24), state.annotations],
        redo: state.redo.slice(0, -1),
        selection: { selected: null, multiSelected: [], anchorId: null },
        selectedVertex: null,
        saved: false,
      };
    }

    case "mark-saved":
      return { ...state, saved: true };
  }
}
