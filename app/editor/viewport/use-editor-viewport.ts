"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { WheelEvent as ReactWheelEvent } from "react";
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
    const scroller = scrollRef.current;
    if (scroller) {
      controllerRef.current.setViewport({ width: scroller.clientWidth || 1, height: scroller.clientHeight || 1 });
      controllerRef.current.setZoom(historicalFitZoom(
        { width: scroller.clientWidth || 1, height: scroller.clientHeight || 1 },
        image,
      ));
    }
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

  const zoomBy = useCallback((delta: number) => {
    const scroller = scrollRef.current;
    const point = scroller
      ? { x: scroller.getBoundingClientRect().left + scroller.clientWidth / 2, y: scroller.getBoundingClientRect().top + scroller.clientHeight / 2 }
      : undefined;
    zoomTo(state.zoom + delta, point);
  }, [state.zoom, zoomTo]);

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

  const onWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.2 : 1 / 1.2;
    zoomTo(state.zoom * factor, { x: event.clientX, y: event.clientY });
  }, [state.zoom, zoomTo]);

  useLayoutEffect(() => {
    const next = controllerRef.current.snapshot();
    applyScroll(next);
  }, [applyScroll, state.zoom]);

  return {
    scrollRef,
    canvasRef,
    state,
    layout: controllerRef.current.layout(),
    maxZoom: controllerRef.current.maxZoom(),
    onScroll,
    onWheel,
    zoomTo,
    zoomBy,
    panBy,
    pinchPan,
    syncViewport,
  };
}