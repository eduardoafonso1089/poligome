"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import type { Size2D } from "../../lib/editor-viewport";
import type { EditorAnnotation } from "../models/annotation-model";
import type { BoxCorner } from "../layers/box-layer";
import type { EditorAction, EditorState } from "../state/editor-state";
import { VERTEX_SCREEN_DISTANCE, resizeBoxFromCorner } from "../geometry/annotation-geometry";
import { snapPointToAnnotations } from "../geometry/vector-operations";
import { clientPointToImage, screenPixelsToImageUnits } from "../viewport/svg-image-space";
import { selectRange, selectSingle, selectionFromMarquee, type SelectionMarquee } from "../selection/selection-model";
import { dragIntent, passedDragThreshold, type DragIntent } from "./pointer-drag";

export type CanvasInteractionOptions = {
  svgRef: RefObject<SVGSVGElement | null>;
  imageSize: Size2D;
  state: EditorState;
  dispatch: (action: EditorAction) => void;
  makeId: (prefix: string) => string;
  activeAssetId?: string | null;
  activeAnnotations?: EditorAnnotation[];
  addToSelection?: boolean;
  /** Rendered canvas width in screen pixels, used to keep guards zoom-aware. */
  renderedWidth?: number;
  snap?: { enabled: boolean; tolerance: number; annotations: EditorAnnotation[] };
};

type DragState = DragIntent & {
  pointerId: number;
  last: { x: number; y: number };
  annotationIds: string[];
};
type VertexDragState = DragIntent & { pointerId: number; annotationId: string; vertexId: string; inserted?: boolean };
type BoxTransformState = DragIntent & {
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

export function useCanvasInteractions({ svgRef, imageSize, state, dispatch, makeId, activeAssetId, activeAnnotations, addToSelection = false, renderedWidth, snap }: CanvasInteractionOptions) {
  const annotationDrag = useRef<DragState | null>(null);
  const vertexDrag = useRef<VertexDragState | null>(null);
  const boxTransform = useRef<BoxTransformState | null>(null);
  const marqueeRef = useRef<SelectionMarquee | null>(null);
  const marqueePointerRef = useRef<number | null>(null);
  const [selectionMarquee, setSelectionMarquee] = useState<SelectionMarquee | null>(null);

  const selectionScope = useMemo(
    () => activeAssetId ? activeAnnotations ?? state.annotations.filter((annotation) => annotation.asset === activeAssetId) : state.annotations,
    [activeAssetId, activeAnnotations, state.annotations],
  );
  const vertexMinDistance = useMemo(
    () => screenPixelsToImageUnits(VERTEX_SCREEN_DISTANCE, imageSize, renderedWidth ?? imageSize.width),
    [imageSize, renderedWidth],
  );
  const selectedIds = useMemo(
    () => state.selection.multiSelected.length ? state.selection.multiSelected : state.selection.selected ? [state.selection.selected] : [],
    [state.selection.multiSelected, state.selection.selected],
  );

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
    // Selection repaints/reorders the shape and adds handles. Capture on the
    // stable SVG so the release cannot disappear with the original hit target.
    (svgRef.current ?? event.currentTarget).setPointerCapture?.(event.pointerId);
    const ids = selectedIds.includes(annotation.id) ? selectedIds : [annotation.id];
    if (!selectedIds.includes(annotation.id)) dispatch({ type: "set-selection", selection: selectSingle(annotation.id) });
    annotationDrag.current = {
      pointerId: event.pointerId,
      ...dragIntent(event),
      last: point,
      annotationIds: ids,
    };
  }, [addToSelection, dispatch, imageSize, selectedIds, selectionScope, state.selection, svgRef, toggleOnly]);

  const finishAnnotation = useCallback((event: ReactPointerEvent<SVGElement>) => {
    const drag = annotationDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    annotationDrag.current = null;
    if (drag.started) dispatch({ type: "commit-gesture" });
  }, [dispatch]);

  const moveAnnotation = useCallback((event: ReactPointerEvent<SVGElement>) => {
    const drag = annotationDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    // Also recover when a release occurred outside the browser or capture was
    // interrupted: hovering must never translate an annotation.
    if ((event.buttons & 1) === 0) { finishAnnotation(event); return; }
    if (!drag.started && !passedDragThreshold(drag, event)) return;
    const point = eventPoint(svgRef, imageSize, event);
    if (!point) return;
    const dx = point.x - drag.last.x;
    const dy = point.y - drag.last.y;
    if (!dx && !dy) return;
    if (!drag.started) {
      dispatch({ type: "begin-gesture" });
      drag.started = true;
    }
    dispatch({ type: "translate-annotations", ids: drag.annotationIds, dx, dy });
    drag.last = point;
  }, [dispatch, finishAnnotation, imageSize, svgRef]);

  const beginVertexDrag = useCallback((event: ReactPointerEvent<SVGElement>, annotation: EditorAnnotation, vertexId: string) => {
    if (event.button !== 0) return;
    if (annotation.type !== "polygon" && annotation.type !== "line") return;
    if (addToSelection) { toggleOnly(event, annotation.id); return; }
    event.stopPropagation();
    (svgRef.current ?? event.currentTarget).setPointerCapture?.(event.pointerId);
    dispatch({ type: "select-vertex", vertex: { annotationId: annotation.id, vertexId } });
    vertexDrag.current = { ...dragIntent(event), pointerId: event.pointerId, annotationId: annotation.id, vertexId };
  }, [addToSelection, dispatch, svgRef, toggleOnly]);

  const moveVertex = useCallback((event: ReactPointerEvent<SVGElement>) => {
    const drag = vertexDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return false;
    if ((event.buttons & 1) === 0) {
      vertexDrag.current = null;
      if (drag.started || drag.inserted) dispatch({ type: "commit-gesture" });
      return true;
    }
    if (!drag.started && !passedDragThreshold(drag, event)) return true;
    const raw = eventPoint(svgRef, imageSize, event);
    if (!raw) return true;
    const point = snap?.enabled
      ? snapPointToAnnotations(raw, snap.annotations, drag.annotationId, snap.tolerance)
      : raw;
    if (!drag.started) {
      if (!drag.inserted) dispatch({ type: "begin-gesture" });
      drag.started = true;
    }
    dispatch({ type: "update-vertex", annotationId: drag.annotationId, vertexId: drag.vertexId, point, minDistance: vertexMinDistance });
    return true;
  }, [dispatch, imageSize, snap, svgRef, vertexMinDistance]);

  const finishVertex = useCallback((event: ReactPointerEvent<SVGElement>) => {
    const drag = vertexDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return false;
    vertexDrag.current = null;
    if (drag.started || drag.inserted) dispatch({ type: "commit-gesture" });
    return true;
  }, [dispatch]);

  const insertVertex = useCallback((event: ReactPointerEvent<SVGElement>, annotation: EditorAnnotation, afterVertexId: string, x: number, y: number) => {
    if (event.button !== 0) return;
    if (addToSelection) { toggleOnly(event, annotation.id); return; }
    event.stopPropagation();
    const raw = { x, y };
    const point = snap?.enabled ? snapPointToAnnotations(raw, snap.annotations, annotation.id, snap.tolerance) : raw;
    const vertexId = makeId(`${annotation.id}:v`);
    (svgRef.current ?? event.currentTarget).setPointerCapture?.(event.pointerId);
    dispatch({ type: "begin-gesture" });
    dispatch({ type: "insert-vertex", annotationId: annotation.id, afterVertexId, vertexId, point, minDistance: vertexMinDistance });
    vertexDrag.current = { ...dragIntent(event), pointerId: event.pointerId, annotationId: annotation.id, vertexId, inserted: true };
  }, [addToSelection, dispatch, makeId, snap, svgRef, toggleOnly, vertexMinDistance]);

  const resizeStart = useCallback((event: ReactPointerEvent<SVGElement>, annotation: EditorAnnotation, corner: BoxCorner) => {
    if (event.button !== 0) return;
    if (annotation.type !== "box") return;
    if (addToSelection) { toggleOnly(event, annotation.id); return; }
    event.preventDefault();
    event.stopPropagation();
    (svgRef.current ?? event.currentTarget).setPointerCapture?.(event.pointerId);
    boxTransform.current = {
      ...dragIntent(event),
      pointerId: event.pointerId,
      annotation,
      kind: "resize",
      corner,
      center: { x: annotation.x + annotation.width / 2, y: annotation.y + annotation.height / 2 },
    };
  }, [addToSelection, svgRef, toggleOnly]);

  const resizeMove = useCallback((event: ReactPointerEvent<SVGElement>) => {
    const transform = boxTransform.current;
    if (!transform || transform.kind !== "resize" || transform.pointerId !== event.pointerId || !transform.corner) return;
    if ((event.buttons & 1) === 0) {
      boxTransform.current = null;
      if (transform.started) dispatch({ type: "commit-gesture" });
      return;
    }
    if (!transform.started && !passedDragThreshold(transform, event)) return;
    event.preventDefault();
    const point = eventPoint(svgRef, imageSize, event);
    if (!point) return;
    if (!transform.started) { dispatch({ type: "begin-gesture" }); transform.started = true; }
    dispatch({ type: "replace-annotation", annotation: resizeBoxFromCorner(transform.annotation, transform.corner, point) });
  }, [dispatch, imageSize, svgRef]);

  const rotateStart = useCallback((event: ReactPointerEvent<SVGElement>, annotation: EditorAnnotation) => {
    if (event.button !== 0) return;
    if (annotation.type !== "box") return;
    if (addToSelection) { toggleOnly(event, annotation.id); return; }
    const point = eventPoint(svgRef, imageSize, event);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    (svgRef.current ?? event.currentTarget).setPointerCapture?.(event.pointerId);
    const center = { x: annotation.x + annotation.width / 2, y: annotation.y + annotation.height / 2 };
    boxTransform.current = {
      ...dragIntent(event),
      pointerId: event.pointerId,
      annotation,
      kind: "rotate",
      center,
      startAngle: Math.atan2(point.y - center.y, point.x - center.x) - (annotation.rotation ?? 0),
    };
  }, [addToSelection, imageSize, svgRef, toggleOnly]);

  const transformMove = useCallback((event: ReactPointerEvent<SVGElement>) => {
    const transform = boxTransform.current;
    if (!transform || transform.kind !== "rotate" || transform.pointerId !== event.pointerId) return;
    if ((event.buttons & 1) === 0) {
      boxTransform.current = null;
      if (transform.started) dispatch({ type: "commit-gesture" });
      return;
    }
    if (!transform.started && !passedDragThreshold(transform, event)) return;
    event.preventDefault();
    const point = eventPoint(svgRef, imageSize, event);
    if (!point) return;
    const rotation = Math.atan2(point.y - transform.center.y, point.x - transform.center.x) - (transform.startAngle ?? 0);
    if (!transform.started) { dispatch({ type: "begin-gesture" }); transform.started = true; }
    dispatch({ type: "replace-annotation", annotation: { ...transform.annotation, rotation } });
  }, [dispatch, imageSize, svgRef]);

  const transformEnd = useCallback((event: ReactPointerEvent<SVGElement>) => {
    const transform = boxTransform.current;
    if (!transform || transform.pointerId !== event.pointerId) return;
    boxTransform.current = null;
    if (transform.started) dispatch({ type: "commit-gesture" });
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
    if ((event.buttons & 1) === 0) {
      marqueePointerRef.current = null;
      marqueeRef.current = null;
      setSelectionMarquee(null);
      return;
    }
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

  return {
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
