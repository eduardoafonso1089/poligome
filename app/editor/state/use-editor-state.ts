"use client";

import { useCallback, useMemo, useReducer } from "react";
import type { EditorAnnotation } from "../models/annotation-model";
import type { SelectionState } from "../selection/selection-model";
import { createEditorState, editorReducer, type SelectedVertex } from "./editor-state";

export function useEditorState(initialAnnotations: EditorAnnotation[] = []) {
  const [state, dispatch] = useReducer(editorReducer, initialAnnotations, createEditorState);

  const selectedAnnotation = useMemo(
    () => state.annotations.find((annotation) => annotation.id === state.selection.selected) ?? null,
    [state.annotations, state.selection.selected],
  );

  const selectedAnnotations = useMemo(() => {
    const ids = new Set(state.selection.multiSelected);
    return state.annotations.filter((annotation) => ids.has(annotation.id));
  }, [state.annotations, state.selection.multiSelected]);

  const replaceAnnotations = useCallback((annotations: EditorAnnotation[], markSaved = true) => {
    dispatch({ type: "replace-annotations", annotations, markSaved });
  }, []);

  const appendAnnotations = useCallback((annotations: EditorAnnotation[], markSaved = false) => {
    dispatch({ type: "append-annotations", annotations, markSaved });
  }, []);

  const addAnnotation = useCallback((annotation: EditorAnnotation, select = true) => {
    dispatch({ type: "add-annotation", annotation, select });
  }, []);

  const deleteAnnotations = useCallback((ids: string[]) => {
    dispatch({ type: "delete-annotations", ids });
  }, []);

  const setSelection = useCallback((selection: SelectionState) => {
    dispatch({ type: "set-selection", selection });
  }, []);

  const selectVertex = useCallback((vertex: SelectedVertex) => {
    dispatch({ type: "select-vertex", vertex });
  }, []);

  const beginGesture = useCallback(() => dispatch({ type: "begin-gesture" }), []);
  const commitGesture = useCallback(() => dispatch({ type: "commit-gesture" }), []);
  const cancelGesture = useCallback(() => dispatch({ type: "cancel-gesture" }), []);
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);
  const markSaved = useCallback(() => dispatch({ type: "mark-saved" }), []);

  return {
    state,
    dispatch,
    annotations: state.annotations,
    history: state.history,
    redoHistory: state.redo,
    gesture: state.gesture,
    selection: state.selection,
    selected: state.selection.selected,
    multiSelected: state.selection.multiSelected,
    selectedVertex: state.selectedVertex,
    selectedAnnotation,
    selectedAnnotations,
    saved: state.saved,
    replaceAnnotations,
    appendAnnotations,
    addAnnotation,
    deleteAnnotations,
    setSelection,
    selectVertex,
    beginGesture,
    commitGesture,
    cancelGesture,
    undo,
    redo,
    markSaved,
  };
}
