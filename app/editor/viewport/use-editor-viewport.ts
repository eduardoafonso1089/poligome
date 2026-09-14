"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ViewportController, type ViewportState } from "./viewport-controller";
import type { Size2D } from "../../lib/editor-viewport";

export type UseEditorViewportOptions = {
  image: Size2D;
  initialZoom?: number;
};

function historicalFitZoom(viewport: Size2D, image: Size2D) {
  const imageWidth = Math.max(1, image.width);
  const imageHeight = Math.max(1, image.height);
  const widthAtHundred = Math.max(1, viewport.width);
  const heightAtHundred = widthAtHundred * imageHeight / imageWidth;
  const heightFit = Math.max(1, viewport.height) / Math.max(1, heightAtHundred) * 100;
  return Math.max(10, Math.min(100, Math.floor(Math.min(100, heightFit) * 0.96)));
}

export function useEditorViewport({ image, initialZoom = 92 }: UseEditorViewportOptions) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<SVGSVGElement>(null);
  const controllerRef = useRef(new ViewportController({
    viewport: { width: 1000, height: 650 },
    image,
    zoom: initialZoom,
    scrollLeft: 0,
    scrollTop: 0,
  }));
  const [state, setState] = useState<ViewportState>(() => controllerRef.current.snapshot());

  const syncViewport = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return controllerRef.current.snapshot();
    const next = controllerRef.current.sync({
      viewport: { width: scroller.clientWidth || 1, height: scroller.clientHeight || 1 },
      scrollLeft: scroller.scrollLeft,
      scrollTop: scroller.scrollTop,
    });
    setState(next);
    return next;
  }, []);

  useEffect(() => {
    controllerRef.current.setImage(image);
    setState(controllerRef.current.snapshot());
  }, [image.height, image.width]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const observer = new ResizeObserver(syncViewport);
    observer.observe(scroller);
    syncViewport();
    return () => observer.disconnect();
  }, [syncViewport]);

  const onScroll = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    controllerRef.current.setScroll(scroller.scrollLeft, scroller.scrollTop);
    setState(controllerRef.current.snapshot());
  }, []);

  const applyScroll = useCallback((next: ViewportState) => {
    requestAnimationFrame(() => {
      const scroller = scrollRef.current;
      if (!scroller) return;
      scroller.scrollLeft = next.scrollLeft;
      scroller.scrollTop = next.scrollTop;
    });
  }, []);

  const publish = useCallback((next: ViewportState) => {
    setState(next);
    applyScroll(next);
    return next;
  }, [applyScroll]);

  const syncBeforeGesture = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return controllerRef.current.snapshot();
    return controllerRef.current.sync({
      viewport: { width: scroller.clientWidth || 1, height: scroller.clientHeight || 1 },
      scrollLeft: scroller.scrollLeft,
      scrollTop: scroller.scrollTop,
    });
  }, []);

  const zoomTo = useCallback((zoom: number, clientPoint?: { x: number; y: number }) => {
    syncBeforeGesture();
    const scroller = scrollRef.current;
    const canvas = canvasRef.current;
    const targetZoom = !clientPoint && zoom === initialZoom && scroller
      ? historicalFitZoom(
          { width: scroller.clientWidth || 1, height: scroller.clientHeight || 1 },
          controllerRef.current.snapshot().image,
        )
      : zoom;
    let next: ViewportState;
    if (canvas && clientPoint) {
      const rect = canvas.getBoundingClientRect();
      next = controllerRef.current.zoomAt(
        targetZoom,
        { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        clientPoint,
      );
    } else {
      controllerRef.current.setZoom(targetZoom);
      next = controllerRef.current.snapshot();
    }
    publish(next);
  }, [initialZoom, publish, syncBeforeGesture]);

  const viewportCenter = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return undefined;
    const rect = scroller.getBoundingClientRect();
    return { x: rect.left + scroller.clientWidth / 2, y: rect.top + scroller.clientHeight / 2 };
  }, []);

  const zoomBy = useCallback((delta: number) => {
    zoomTo(state.zoom + delta, viewportCenter());
  }, [state.zoom, viewportCenter, zoomTo]);

  // Multiplicative step keeps the zoom-button feel consistent across the whole
  // range instead of a coarse fixed jump that is tiny when zoomed in and huge
  // when zoomed out.
  const zoomByRatio = useCallback((ratio: number) => {
    zoomTo(state.zoom * ratio, viewportCenter());
  }, [state.zoom, viewportCenter, zoomTo]);

  const panBy = useCallback((pointerDx: number, pointerDy: number) => {
    syncBeforeGesture();
    publish(controllerRef.current.panBy(pointerDx, pointerDy));
  }, [publish, syncBeforeGesture]);

  const pinchPan = useCallback((zoom: number, previousCenter: { x: number; y: number }, currentCenter: { x: number; y: number }) => {
    syncBeforeGesture();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    publish(controllerRef.current.pinchPan(
      zoom,
      { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      previousCenter,
      currentCenter,
    ));
  }, [publish, syncBeforeGesture]);

  const onWheel = useCallback((event: WheelEvent) => {
    event.preventDefault();
    // The wheel owns zooming in the canvas. Modifiers turn it into navigation
    // so Ctrl is never passed through to the browser's page zoom.
    if (event.shiftKey) {
      panBy(-(event.deltaX || event.deltaY), 0);
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      panBy(0, -event.deltaY);
      return;
    }
    // Scale the zoom by its delta so trackpad pinches stay smooth; clamp spikes
    // from a momentum event to keep a single wheel event bounded.
    const clampedDelta = Math.max(-120, Math.min(120, event.deltaY));
    const factor = Math.exp(-clampedDelta * 0.0018);
    zoomTo(controllerRef.current.snapshot().zoom * factor, { x: event.clientX, y: event.clientY });
  }, [panBy, zoomTo]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    // React may attach wheel listeners as passive, which means preventDefault
    // cannot stop the browser's Ctrl+wheel page zoom. The native listener is
    // explicitly non-passive so the canvas remains the only zoom target.
    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => scroller.removeEventListener("wheel", onWheel);
  }, [onWheel]);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    // Apply the post-zoom scroll synchronously, before paint, so the canvas does
    // not flash at the old scroll for a frame and then re-adjust on every zoom.
    const next = controllerRef.current.snapshot();
    scroller.scrollLeft = next.scrollLeft;
    scroller.scrollTop = next.scrollTop;
  }, [state.zoom]);

  return {
    scrollRef,
    canvasRef,
    state,
    layout: controllerRef.current.layout(),
    maxZoom: controllerRef.current.maxZoom(),
    onScroll,
    zoomTo,
    zoomBy,
    zoomByRatio,
    panBy,
    pinchPan,
    syncViewport,
  };
}
