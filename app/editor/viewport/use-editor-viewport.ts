"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ViewportController, type ViewportState } from "./viewport-controller";
import type { ScreenFrame, Size2D } from "../../lib/editor-viewport";

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
  // A scroll offset the controller has computed but the element has not received
  // yet. While it is set, the DOM still describes the previous zoom, so every
  // read-back below is suspended and the controller stays the single source of
  // truth. Wheel events arrive far faster than React re-renders, and without
  // this a burst re-anchors each step against the offset of the step before it.
  const pendingScrollRef = useRef<{ scrollLeft: number; scrollTop: number } | null>(null);

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
    // The element is still catching up with a zoom. This event reports the
    // pre-zoom offset, and adopting it would discard the offset the zoom just
    // anchored. The flush below re-reads the element once it has landed.
    if (pendingScrollRef.current) return;
    controllerRef.current.setScroll(scroller.scrollLeft, scroller.scrollTop);
    setState(controllerRef.current.snapshot());
  }, []);

  const publish = useCallback((next: ViewportState) => {
    pendingScrollRef.current = { scrollLeft: next.scrollLeft, scrollTop: next.scrollTop };
    setState(next);
    return next;
  }, []);

  const syncBeforeGesture = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return controllerRef.current.snapshot();
    const viewport = { width: scroller.clientWidth || 1, height: scroller.clientHeight || 1 };
    // clientWidth/clientHeight do not change with zoom, so the viewport is always
    // safe to re-read. The scroll offset is not, hence the guard.
    if (pendingScrollRef.current) return controllerRef.current.sync({ viewport });
    return controllerRef.current.sync({
      viewport,
      scrollLeft: scroller.scrollLeft,
      scrollTop: scroller.scrollTop,
    });
  }, []);

  /**
   * The canvas frame in client coordinates, derived rather than measured.
   *
   * Measuring the canvas element itself is the obvious source, but its rect
   * reports the last *painted* zoom. During a wheel burst the controller is
   * already one or more steps ahead, so measuring hands zoomAt a frame that
   * belongs to a zoom it has left behind and the anchor drifts. The scroller's
   * own box is immune: it is a fixed-size element and its rect does not move
   * when the content inside it grows.
   */
  const canvasFrame = useCallback((): ScreenFrame | null => {
    const scroller = scrollRef.current;
    if (!scroller) return null;
    const rect = scroller.getBoundingClientRect();
    const { scrollLeft, scrollTop } = controllerRef.current.snapshot();
    const layout = controllerRef.current.layout();
    return {
      left: rect.left + scroller.clientLeft + layout.left - scrollLeft,
      top: rect.top + scroller.clientTop + layout.top - scrollTop,
      width: layout.width,
      height: layout.height,
    };
  }, []);

  const zoomTo = useCallback((zoom: number, clientPoint?: { x: number; y: number }) => {
    syncBeforeGesture();
    const scroller = scrollRef.current;
    const targetZoom = !clientPoint && zoom === initialZoom && scroller
      ? historicalFitZoom(
          { width: scroller.clientWidth || 1, height: scroller.clientHeight || 1 },
          controllerRef.current.snapshot().image,
        )
      : zoom;
    const frame = clientPoint ? canvasFrame() : null;
    let next: ViewportState;
    if (frame && clientPoint) {
      next = controllerRef.current.zoomAt(targetZoom, frame, clientPoint);
    } else {
      controllerRef.current.setZoom(targetZoom);
      next = controllerRef.current.snapshot();
    }
    publish(next);
  }, [canvasFrame, initialZoom, publish, syncBeforeGesture]);

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
    const frame = canvasFrame();
    if (!frame) return;
    publish(controllerRef.current.pinchPan(zoom, frame, previousCenter, currentCenter));
  }, [canvasFrame, publish, syncBeforeGesture]);

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
    const pending = pendingScrollRef.current;
    if (!scroller || !pending) return;
    // The surface has already been laid out at the new zoom, so this write is no
    // longer clamped by the old scrollWidth, and it happens before paint so the
    // canvas never shows a frame at the old offset. Clearing the ref here — and
    // only here — is what re-opens the read-backs above.
    pendingScrollRef.current = null;
    scroller.scrollLeft = pending.scrollLeft;
    scroller.scrollTop = pending.scrollTop;
  });

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
