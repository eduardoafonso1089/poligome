"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import type { Size2D } from "../../lib/editor-viewport";
import type { EditorAnnotation } from "../models/annotation-model";
import { snapPointToAnnotations } from "../geometry/vector-operations";
import { clientPointToImage } from "../viewport/svg-image-space";
import {
  annotationBase,
  boxFromDraft,
  freehandFromDraft,
  lineFromDraft,
  pointFromDraft,
  polygonFromDraft,
  type BoxDraft,
} from "./annotation-builder";

export type DrawingTool = "select" | "pan" | "box" | "polygon" | "line" | "point" | "freehand";

export type DrawingDraft =
  | { type: "box"; box: BoxDraft }
  | { type: "polygon"; points: number[] }
  | { type: "line"; points: number[] }
  | { type: "freehand"; points: number[] }
  | null;

export type DrawingInteractionOptions = {
  svgRef: RefObject<SVGSVGElement | null>;
  imageSize: Size2D;
  tool: DrawingTool;
  assetId: string | null;
  labelId: string;
  makeId: (prefix: string) => string;
  addAnnotation: (annotation: EditorAnnotation, select?: boolean) => void;
  snap?: { enabled: boolean; tolerance: number; annotations: EditorAnnotation[] };
};

type StartState = {
  x: number;
  y: number;
  clientX: number;
  clientY: number;
  pointerId: number;
  pointerType: string;
  moved: boolean;
};

function flatPoint(point: { x: number; y: number }) {
  return [point.x, point.y];
}

export function useDrawingInteractions({
  svgRef,
  imageSize,
  tool,
  assetId,
  labelId,
  makeId,
  addAnnotation,
  snap,
}: DrawingInteractionOptions) {
  const [draft, setDraft] = useState<DrawingDraft>(null);
  const draftRef = useRef<DrawingDraft>(null);
  const startRef = useRef<StartState | null>(null);

  const updateDraft = useCallback((next: DrawingDraft | ((current: DrawingDraft) => DrawingDraft)) => {
    setDraft((current) => {
      const value = typeof next === "function" ? next(current) : next;
      draftRef.current = value;
      return value;
    });
  }, []);

  const canFinish = useMemo(() => {
    if (draft?.type === "polygon") return draft.points.length >= 6;
    if (draft?.type === "line") return draft.points.length >= 4;
    return false;
  }, [draft]);

  const canRemoveLastPoint = useMemo(
    () => (draft?.type === "polygon" || draft?.type === "line") && draft.points.length >= 2,
    [draft],
  );

  const commit = useCallback((annotation: EditorAnnotation | null) => {
    if (!annotation) return false;
    addAnnotation(annotation, true);
    return true;
  }, [addAnnotation]);

  const cancelDraft = useCallback(() => {
    startRef.current = null;
    draftRef.current = null;
    setDraft(null);
  }, []);

  const removeLastPoint = useCallback(() => {
    updateDraft((current) => {
      if (current?.type !== "polygon" && current?.type !== "line") return current;
      if (current.points.length <= 2) return null;
      return { ...current, points: current.points.slice(0, -2) };
    });
  }, [updateDraft]);

  const finishDraft = useCallback(() => {
    if (!assetId) return false;
    const current = draftRef.current ?? draft;
    let annotation: EditorAnnotation | null = null;
    if (current?.type === "polygon") annotation = polygonFromDraft(annotationBase(makeId("polygon"), assetId, labelId), current.points);
    else if (current?.type === "line") annotation = lineFromDraft(annotationBase(makeId("line"), assetId, labelId), current.points);
    const committed = commit(annotation);
    if (committed) updateDraft(null);
    return committed;
  }, [assetId, commit, draft, labelId, makeId, updateDraft]);

  const snapDiscretePoint = useCallback((point: { x: number; y: number }) => {
    if (!snap?.enabled) return point;
    return snapPointToAnnotations(point, snap.annotations, "", snap.tolerance);
  }, [snap]);

  const appendDiscretePoint = useCallback((rawPoint: { x: number; y: number }) => {
    if (!assetId) return;
    const point = snapDiscretePoint(rawPoint);
    if (tool === "point") {
      commit(pointFromDraft(annotationBase(makeId("point"), assetId, labelId), point));
      return;
    }
    if (tool === "polygon") {
      const current = draftRef.current;
      if (current?.type === "polygon" && current.points.length >= 6) {
        const first = { x: current.points[0], y: current.points[1] };
        const closureTolerance = Math.max(snap?.tolerance ?? 0, Math.min(imageSize.width, imageSize.height) * .012);
        if (Math.hypot(rawPoint.x - first.x, rawPoint.y - first.y) <= closureTolerance) {
          const annotation = polygonFromDraft(annotationBase(makeId("polygon"), assetId, labelId), current.points);
          if (commit(annotation)) updateDraft(null);
          return;
        }
      }
    }
    if (tool === "polygon" || tool === "line") {
      updateDraft((current) => {
        const points = current?.type === tool ? current.points : [];
        return { type: tool, points: [...points, ...flatPoint(point)] };
      });
    }
  }, [assetId, commit, imageSize.height, imageSize.width, labelId, makeId, snap?.tolerance, snapDiscretePoint, tool, updateDraft]);

  const onPointerDown = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    if (tool === "select" || tool === "pan" || !assetId || event.button !== 0) return;
    const svg = svgRef.current;
    if (!svg) return;
    const point = clientPointToImage(svg, event.clientX, event.clientY, imageSize);

    if (event.pointerType === "touch" && (tool === "point" || tool === "polygon" || tool === "line")) {
      startRef.current = { ...point, clientX: event.clientX, clientY: event.clientY, pointerId: event.pointerId, pointerType: event.pointerType, moved: false };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      return;
    }

    if (tool === "point" || tool === "polygon" || tool === "line") {
      appendDiscretePoint(point);
      return;
    }

    const startPoint = tool === "freehand" ? snapDiscretePoint(point) : point;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    startRef.current = { ...startPoint, clientX: event.clientX, clientY: event.clientY, pointerId: event.pointerId, pointerType: event.pointerType, moved: false };
    if (tool === "box") updateDraft({ type: "box", box: { x: startPoint.x, y: startPoint.y, w: 0, h: 0 } });
    else if (tool === "freehand") updateDraft({ type: "freehand", points: flatPoint(startPoint) });
  }, [appendDiscretePoint, assetId, imageSize, snapDiscretePoint, svgRef, tool, updateDraft]);

  const onPointerMove = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    const start = startRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) > 8) start.moved = true;
    if (start.pointerType === "touch" && (tool === "point" || tool === "polygon" || tool === "line")) return;

    const svg = svgRef.current;
    if (!svg) return;
    const point = clientPointToImage(svg, event.clientX, event.clientY, imageSize);

    if (tool === "box") {
      updateDraft({
        type: "box",
        box: {
          x: Math.min(start.x, point.x),
          y: Math.min(start.y, point.y),
          w: Math.abs(point.x - start.x),
          h: Math.abs(point.y - start.y),
        },
      });
    } else if (tool === "freehand") {
      updateDraft((current) => {
        if (current?.type !== "freehand") return current;
        const lastX = current.points.at(-2) ?? point.x;
        const lastY = current.points.at(-1) ?? point.y;
        if (Math.hypot(point.x - lastX, point.y - lastY) < 2) return current;
        return { type: "freehand", points: [...current.points, ...flatPoint(point)] };
      });
    }
  }, [imageSize, svgRef, tool, updateDraft]);

  const onPointerUp = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    const start = startRef.current;
    if (!start || start.pointerId !== event.pointerId || !assetId) return;
    startRef.current = null;

    if (start.pointerType === "touch" && (tool === "point" || tool === "polygon" || tool === "line")) {
      if (!start.moved) appendDiscretePoint({ x: start.x, y: start.y });
      return;
    }

    const current = draftRef.current ?? draft;
    if (current?.type === "box") {
      commit(boxFromDraft(annotationBase(makeId("box"), assetId, labelId), current.box));
      updateDraft(null);
      return;
    }
    if (current?.type === "freehand") {
      commit(freehandFromDraft(annotationBase(makeId("freehand"), assetId, labelId), current.points));
      updateDraft(null);
    }
  }, [appendDiscretePoint, assetId, commit, draft, labelId, makeId, tool, updateDraft]);

  return {
    draft,
    canFinish,
    canRemoveLastPoint,
    hasDraft: Boolean(draft),
    onPointerDown,
    onPointerMove,
    onPointerUp,
    finishDraft,
    removeLastPoint,
    cancelDraft,
  };
}
