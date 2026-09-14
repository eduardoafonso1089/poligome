"use client";

import { useCallback, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import type { Size2D } from "../../lib/editor-viewport";
import type { EditorAnnotation } from "../models/annotation-model";
import type { BoxCorner } from "../layers/box-layer";
import type { EditorAction, EditorState } from "../state/editor-state";
import { annotationBounds, resizeBoxFromCorner } from "../geometry/annotation-geometry";
import { snapPointToAnnotations } from "../geometry/vector-operations";
import { clientPointToImage } from "../viewport/svg-image-space";
import { selectRange, selectSingle, selectionFromMarquee, type SelectionMarquee } from "../selection/selection-model";

export type CanvasInteractionOptions = {
  svgRef: RefObject<SVGSVGElement | null>;
  imageSize: Size2D;
  state: EditorState;
  dispatch: (action: EditorAction) => void;
  makeId: (prefix: string) => string;
  activeAssetId?: string | null;
  activeAnnotations?: EditorAnnotation[];
  addToSelection?: boolean;
  snap?: { enabled: boolean; tolerance: number; annotations: EditorAnnotation[] };
};

type DragState = { pointerId: number; last: { x: number; y: number }; annotationIds: string[] };
type VertexDragState = { pointerId: number; annotationId: string; vertexId: string };
type BoxTransformState = {
  pointerId: number;
  annotation: Extract<EditorAnnotation, { type: "box" }>;
  kind: "resize" | "rotate";
  corner?: BoxCorner;
  center: { x: number; y: number };
  startAngle?: number;
};

function eventPoint(svgRef: RefObject<SVGSVGElement | null>, imageSize: Size2D, event: ReactPointerEvent<SVGElement>) {
  const svg = svgRef.current;
  return svg ? clientPointToImage(svg, event.clientX, event.clientY, imageSize) : null;
}

export function useCanvasInteractions({ svgRef, imageSize, state, dispatch, makeId, activeAssetId, activeAnnotations, addToSelection = false, snap }: CanvasInteractionOptions) {
  const annotationDrag = useRef<DragState | null>(null);
  const vertexDrag = useRef<VertexDragState | null>(null);
  const boxTransform = useRef<BoxTransformState | null>(null);
  const marqueeRef = useRef<SelectionMarquee | null>(null);
  const marqueePointerRef = useRef<number | null>(null);
  const [selectionMarquee, setSelectionMarquee] = useState<SelectionMarquee | null>(null);

  const selectionScope = activeAssetId ? activeAnnotations ?? state.annotations.filter((annotation) => annotation.asset === activeAssetId) : state.annotations;
  const selectedIds = state.selection.multiSelected.length ? state.selection.multiSelected : state.selection.selected ? [state.selection.selected] : [];

  const toggleOnly = useCallback((event: ReactPointerEvent<SVGElement>, annotationId: string) => {
    event.preventDefault();
    event.stopPropagation();
    dispatch({ type: "toggle-selection", id: annotationId });
  }, [dispatch]);

  const beginAnnotationDrag = useCallback((event: ReactPointerEvent<SVGElement>, annotation: EditorAnnotation) => {
    if (event.button !== 0) return;
    if (addToSelection) { toggleOnly(event, annotation.id); return; }
    const point = eventPoint(svgRef, imageSize, event);
    if (!point) return;
    event.stopPropagation();
    const additive = event.ctrlKey || event.metaKey;
    if (event.shiftKey) {
      dispatch({ type: "set-selection", selection: selectRange(selectionScope, state.selection, annotation.id, additive) });
      return;
    }
    if (additive) {
      dispatch({ type: "toggle-selection", id: annotation.id });
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const ids = selectedIds.includes(annotation.id) ? selectedIds : [annotation.id];
    if (!selectedIds.includes(annotation.id)) dispatch({ type: "set-selection", selection: selectSingle(annotation.id) });
    dispatch({ type: "begin-gesture" });
    annotationDrag.current = { pointerId: event.pointerId, last: point, annotationIds: ids };
  }, [addToSelection, dispatch, imageSize, selectedIds, selectionScope, state.selection, svgRef, toggleOnly]);

  const moveAnnotation = useCallback((event: ReactPointerEvent<SVGElement>) => {
    const drag = annotationDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = eventPoint(svgRef, imageSize, event);
    if (!point) return;
    const dx = point.x - drag.last.x;
    const dy = point.y - drag.last.y;
    if (!dx && !dy) return;
    dispatch({ type: "translate-annotations", ids: drag.annotationIds, dx, dy });
    drag.last = point;
  }, [dispatch, imageSize, svgRef]);

  const finishAnnotation = useCallback((event: ReactPointerEvent<SVGElement>) => {
    const drag = annotationDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    annotationDrag.current = null;
    dispatch({ type: "commit-gesture" });
  }, [dispatch]);

  const beginVertexDrag = useCallback((event: ReactPointerEvent<SVGElement>, annotation: EditorAnnotation, vertexId: string) => {
    if (annotation.type !== "polygon" && annotation.type !== "line") return;
    if (addToSelection) { toggleOnly(event, annotation.id); return; }
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dispatch({ type: "select-vertex", vertex: { annotationId: annotation.id, vertexId } });
    dispatch({ type: "begin-gesture" });
    vertexDrag.current = { pointerId: event.pointerId, annotationId: annotation.id, vertexId };
  }, [addToSelection, dispatch, toggleOnly]);

  const moveVertex = useCallback((event: ReactPointerEvent<SVGElement>) => {
    const drag = vertexDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const raw = eventPoint(svgRef, imageSize, event);
    if (!raw) return;
    const point = snap?.enabled
      ? snapPointToAnnotations(raw, snap.annotations, drag.annotationId, snap.tolerance)
      : raw;
    dispatch({ type: "update-vertex", annotationId: drag.annotationId, vertexId: drag.vertexId, point });
  }, [dispatch, imageSize, snap, svgRef]);

  const finishVertex = useCallback((event: ReactPointerEvent<SVGElement>) => {
    const drag = vertexDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    vertexDrag.current = null;
    dispatch({ type: "commit-gesture" });
  }, [dispatch]);

  const insertVertex = useCallback((event: ReactPointerEvent<SVGElement>, annotation: EditorAnnotation, afterVertexId: string, x: number, y: number) => {
    if (addToSelection) { toggleOnly(event, annotation.id); return; }
    event.stopPropagation();
    const raw = { x, y };
    const point = snap?.enabled ? snapPointToAnnotations(raw, snap.annotations, annotation.id, snap.tolerance) : raw;
    dispatch({ type: "insert-vertex", annotationId: annotation.id, afterVertexId, vertexId: makeId(`${annotation.id}:v`), point });
  }, [addToSelection, dispatch, makeId, snap, toggleOnly]);

  const resizeStart = useCallback((event: ReactPointerEvent<SVGElement>, annotation: EditorAnnotation, corner: BoxCorner) => {
    if (annotation.type !== "box") return;
    if (addToSelection) { toggleOnly(event, annotation.id); return; }
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dispatch({ type: "begin-gesture" });
    boxTransform.current = {
      pointerId: event.pointerId,
      annotation,
      kind: "resize",
      corner,
      center: { x: annotation.x + annotation.width / 2, y: annotation.y + annotation.height / 2 },
    };
  }, [addToSelection, dispatch, toggleOnly]);

  const resizeMove = useCallback((event: ReactPointerEvent<SVGElement>) => {
    const transform = boxTransform.current;
    if (!transform || transform.kind !== "resize" || transform.pointerId !== event.pointerId || !transform.corner) return;
    const point = eventPoint(svgRef, imageSize, event);
    if (!point) return;
    dispatch({ type: "replace-annotation", annotation: resizeBoxFromCorner(transform.annotation, transform.corner, point) });
  }, [dispatch, imageSize, svgRef]);

  const rotateStart = useCallback((event: ReactPointerEvent<SVGElement>, annotation: EditorAnnotation) => {
    if (annotation.type !== "box") return;
    if (addToSelection) { toggleOnly(event, annotation.id); return; }
    const point = eventPoint(svgRef, imageSize, event);
    if (!point) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const center = { x: annotation.x + annotation.width / 2, y: annotation.y + annotation.height / 2 };
    dispatch({ type: "begin-gesture" });
    boxTransform.current = {
      pointerId: event.pointerId,
      annotation,
      kind: "rotate",
      center,
      startAngle: Math.atan2(point.y - center.y, point.x - center.x) - (annotation.rotation ?? 0),
    };
  }, [addToSelection, dispatch, imageSize, svgRef, toggleOnly]);

  const transformMove = useCallback((event: ReactPointerEvent<SVGElement>) => {
    const transform = boxTransform.current;
    if (!transform || transform.kind !== "rotate" || transform.pointerId !== event.pointerId) return;
    const point = eventPoint(svgRef, imageSize, event);
    if (!point) return;
    const rotation = Math.atan2(point.y - transform.center.y, point.x - transform.center.x) - (transform.startAngle ?? 0);
    dispatch({ type: "replace-annotation", annotation: { ...transform.annotation, rotation } });
  }, [dispatch, imageSize, svgRef]);

  const transformEnd = useCallback((event: ReactPointerEvent<SVGElement>) => {
    const transform = boxTransform.current;
    if (!transform || transform.pointerId !== event.pointerId) return;
    boxTransform.current = null;
    dispatch({ type: "commit-gesture" });
  }, [dispatch]);

  const selectAtCanvas = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.target !== event.currentTarget || event.button !== 0) return;
    const point = clientPointToImage(event.currentTarget, event.clientX, event.clientY, imageSize);
    const additive = addToSelection || event.ctrlKey || event.metaKey || event.shiftKey;
    const additiveIds = additive
      ? [...new Set(state.selection.multiSelected.length ? state.selection.multiSelected : state.selection.selected ? [state.selection.selected] : [])]
      : [];
    const marquee: SelectionMarquee = { startX: point.x, startY: point.y, currentX: point.x, currentY: point.y, additiveIds };
    marqueePointerRef.current = event.pointerId;
    marqueeRef.current = marquee;
    setSelectionMarquee(marquee);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [addToSelection, imageSize, state.selection.multiSelected, state.selection.selected]);

  const moveCanvasSelection = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    if (marqueePointerRef.current !== event.pointerId || !marqueeRef.current) return;
    const point = clientPointToImage(event.currentTarget, event.clientX, event.clientY, imageSize);
    const marquee = { ...marqueeRef.current, currentX: point.x, currentY: point.y };
    marqueeRef.current = marquee;
    setSelectionMarquee(marquee);
  }, [imageSize]);

  const finishCanvasSelection = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    if (marqueePointerRef.current !== event.pointerId || !marqueeRef.current) return;
    const point = clientPointToImage(event.currentTarget, event.clientX, event.clientY, imageSize);
    const marquee = { ...marqueeRef.current, currentX: point.x, currentY: point.y };
    dispatch({ type: "set-selection", selection: selectionFromMarquee(selectionScope, marquee) });
    marqueePointerRef.current = null;
    marqueeRef.current = null;
    setSelectionMarquee(null);
  }, [dispatch, imageSize, selectionScope]);

  const cancel = useCallback(() => {
    annotationDrag.current = null;
    vertexDrag.current = null;
    boxTransform.current = null;
    marqueePointerRef.current = null;
    marqueeRef.current = null;
    setSelectionMarquee(null);
    dispatch({ type: "cancel-gesture" });
  }, [dispatch]);

  const activeBounds = state.selection.selected
    ? (() => {
        const annotation = state.annotations.find((item) => item.id === state.selection.selected);
        return annotation ? annotationBounds(annotation) : null;
      })()
    : null;

  return {
    activeBounds,
    selectionMarquee,
    beginAnnotationDrag,
    moveAnnotation,
    finishAnnotation,
    beginVertexDrag,
    moveVertex,
    finishVertex,
    insertVertex,
    resizeStart,
    resizeMove,
    resizeEnd: transformEnd,
    rotateStart,
    transformMove,
    transformEnd,
    cancel,
    selectAtCanvas,
    moveCanvasSelection,
    finishCanvasSelection,
  };
}
