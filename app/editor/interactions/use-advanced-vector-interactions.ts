"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import type { Size2D } from "../../lib/editor-viewport";
import type { EditorAnnotation, PolygonAnnotation } from "../models/annotation-model";
import type { EditorAction } from "../state/editor-state";
import type { VectorTool } from "../commands/editor-shortcuts";
import { clientPointToImage } from "../viewport/svg-image-space";
import { polygonTransformCenter, transformPolygonAnnotation } from "../geometry/polygon-transform";
import {
  addPolygonHole,
  reshapePolygonAnnotation,
  snapPointToAnnotations,
  splitPolygonAnnotation,
  type Point,
} from "../geometry/vector-operations";

export type AdvancedVectorDraft =
  | { type: "hole"; points: Point[] }
  | { type: "split"; start: Point; end: Point }
  | { type: "reshape"; points: Point[] }
  | null;

export type AdvancedVectorResult =
  | "hole-added"
  | "hole-invalid"
  | "split-done"
  | "split-invalid"
  | "reshape-added"
  | "reshape-removed"
  | "reshape-mixed"
  | "reshape-crossings"
  | "reshape-direction";

type Options = {
  svgRef: RefObject<SVGSVGElement | null>;
  imageSize: Size2D;
  tool: VectorTool;
  activePolygon: PolygonAnnotation | null;
  makeId: (prefix: string) => string;
  dispatch: (action: EditorAction) => void;
  snap?: { enabled: boolean; tolerance: number; annotations: EditorAnnotation[] };
  onResult?: (result: AdvancedVectorResult) => void;
};

type DrawStroke = { pointerId: number; points: Point[] };
type TransformStroke = {
  pointerId: number;
  original: PolygonAnnotation;
  center: Point;
  startDistance: number;
  startAngle: number;
};
type PointerStroke = DrawStroke | TransformStroke | null;

function isTransformStroke(stroke: PointerStroke): stroke is TransformStroke {
  return Boolean(stroke && "original" in stroke);
}

export function useAdvancedVectorInteractions({ svgRef, imageSize, tool, activePolygon, makeId, dispatch, snap, onResult }: Options) {
  const [draft, setDraft] = useState<AdvancedVectorDraft>(null);
  const strokeRef = useRef<PointerStroke>(null);

  const canFinish = useMemo(() => draft?.type === "hole" && draft.points.length >= 3, [draft]);
  const canRemoveLastPoint = useMemo(() => draft?.type === "hole" && draft.points.length > 0, [draft]);

  const cancel = useCallback(() => {
    if (isTransformStroke(strokeRef.current)) dispatch({ type: "cancel-gesture" });
    strokeRef.current = null;
    setDraft(null);
  }, [dispatch]);

  const removeLastPoint = useCallback(() => {
    setDraft((current) => {
      if (current?.type !== "hole") return current;
      if (current.points.length <= 1) return null;
      return { type: "hole", points: current.points.slice(0, -1) };
    });
  }, []);

  const finishHole = useCallback(() => {
    if (!activePolygon || draft?.type !== "hole" || draft.points.length < 3) return false;
    const updated = addPolygonHole(activePolygon, draft.points, makeId);
    if (updated === activePolygon) {
      onResult?.("hole-invalid");
      return false;
    }
    dispatch({ type: "replace-annotation", annotation: updated });
    setDraft(null);
    onResult?.("hole-added");
    return true;
  }, [activePolygon, dispatch, draft, makeId, onResult]);

  const pointFor = useCallback((event: ReactPointerEvent<SVGSVGElement>, applySnap = false) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const point = clientPointToImage(svg, event.clientX, event.clientY, imageSize);
    if (!applySnap || !snap?.enabled) return point;
    return snapPointToAnnotations(point, snap.annotations, activePolygon?.id ?? "", snap.tolerance);
  }, [activePolygon?.id, imageSize, snap, svgRef]);

  const onPointerDown = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    if (!tool || !activePolygon || event.button !== 0) return;
    // During an advanced vector mode the canvas router has already decided that
    // this gesture belongs to this hook. The original target may still be a
    // rendered annotation/handle, so rejecting non-SVG targets made Hole, Split
    // and Reshape silently ignore valid gestures over the polygon itself.
    const point = pointFor(event, tool === "split" || tool === "reshape");
    if (!point) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);

    if (tool === "transform") {
      const center = polygonTransformCenter(activePolygon);
      const startDistance = Math.hypot(point.x - center.x, point.y - center.y);
      if (startDistance < 1) return;
      strokeRef.current = {
        pointerId: event.pointerId,
        original: activePolygon,
        center,
        startDistance,
        startAngle: Math.atan2(point.y - center.y, point.x - center.x),
      };
      dispatch({ type: "begin-gesture" });
      return;
    }

    if (tool === "hole") {
      setDraft((current) => ({ type: "hole", points: current?.type === "hole" ? [...current.points, point] : [point] }));
      return;
    }
    strokeRef.current = { pointerId: event.pointerId, points: [point] };
    if (tool === "split") setDraft({ type: "split", start: point, end: point });
    else setDraft({ type: "reshape", points: [point] });
  }, [activePolygon, dispatch, pointFor, tool]);

  const onPointerMove = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    const stroke = strokeRef.current;
    if (!stroke || stroke.pointerId !== event.pointerId || !tool) return;
    const point = pointFor(event);
    if (!point) return;

    if (isTransformStroke(stroke)) {
      const distance = Math.hypot(point.x - stroke.center.x, point.y - stroke.center.y);
      const scale = distance / stroke.startDistance;
      const angle = Math.atan2(point.y - stroke.center.y, point.x - stroke.center.x) - stroke.startAngle;
      dispatch({ type: "replace-annotation", annotation: transformPolygonAnnotation(stroke.original, stroke.center, scale, angle) });
      return;
    }

    if (tool === "split") {
      const start = stroke.points[0];
      setDraft({ type: "split", start, end: point });
      return;
    }
    if (tool === "reshape") {
      const last = stroke.points.at(-1)!;
      if (Math.hypot(point.x - last.x, point.y - last.y) < 1) return;
      stroke.points.push(point);
      setDraft({ type: "reshape", points: [...stroke.points] });
    }
  }, [dispatch, pointFor, tool]);

  const onPointerUp = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    const stroke = strokeRef.current;
    if (!stroke || stroke.pointerId !== event.pointerId || !activePolygon || !tool) return;
    const point = pointFor(event, tool === "split" || tool === "reshape");

    if (isTransformStroke(stroke)) {
      strokeRef.current = null;
      if (!point) { dispatch({ type: "cancel-gesture" }); return; }
      const distance = Math.hypot(point.x - stroke.center.x, point.y - stroke.center.y);
      const scale = distance / stroke.startDistance;
      const angle = Math.atan2(point.y - stroke.center.y, point.x - stroke.center.x) - stroke.startAngle;
      dispatch({ type: "replace-annotation", annotation: transformPolygonAnnotation(stroke.original, stroke.center, scale, angle) });
      dispatch({ type: "commit-gesture" });
      return;
    }

    strokeRef.current = null;
    if (!point) { setDraft(null); return; }

    if (tool === "split") {
      const result = splitPolygonAnnotation(activePolygon, stroke.points[0], point, imageSize, makeId);
      setDraft(null);
      if (result.length < 2) { onResult?.("split-invalid"); return; }
      dispatch({ type: "replace-annotations-batch", removeIds: [activePolygon.id], annotations: result, selectIds: result.map((item) => item.id) });
      onResult?.("split-done");
      return;
    }

    if (tool === "reshape") {
      const points = [...stroke.points, point];
      const result = reshapePolygonAnnotation(activePolygon, points, makeId);
      setDraft(null);
      if (!result.annotation) {
        onResult?.(result.reason === "mixed" ? "reshape-mixed" : result.reason === "direction" ? "reshape-direction" : "reshape-crossings");
        return;
      }
      dispatch({ type: "replace-annotation", annotation: result.annotation });
      onResult?.(result.mode === "add" ? "reshape-added" : "reshape-removed");
    }
  }, [activePolygon, dispatch, imageSize, makeId, onResult, pointFor, tool]);

  return {
    draft,
    canFinish,
    canRemoveLastPoint,
    hasDraft: Boolean(draft),
    finishHole,
    removeLastPoint,
    cancel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}
