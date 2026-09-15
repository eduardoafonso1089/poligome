import {
  ViewportTransform,
  anchoredScrollOffset,
  canvasLayout,
  type Point2D,
  type ScreenFrame,
  type Size2D,
} from "../../lib/editor-viewport";

export type ViewportState = {
  viewport: Size2D;
  image: Size2D;
  zoom: number;
  scrollLeft: number;
  scrollTop: number;
};

const MIN_ZOOM = 10;
const BASE_MAX_ZOOM = 400;
const ABSOLUTE_MAX_ZOOM = 50_000;

/** Pure viewport model. Canonical annotation coordinates are source-image pixels. */
export class ViewportController {
  constructor(private state: ViewportState) {}

  snapshot(): ViewportState {
    return { ...this.state, viewport: { ...this.state.viewport }, image: { ...this.state.image } };
  }

  maxZoom() {
    const nativeWidthZoom = this.state.image.width / Math.max(1, this.state.viewport.width) * 100;
    return Math.min(ABSOLUTE_MAX_ZOOM, Math.max(BASE_MAX_ZOOM, Math.ceil(nativeWidthZoom * 2)));
  }

  private clampZoom(zoom: number) {
    return Math.max(MIN_ZOOM, Math.min(this.maxZoom(), zoom));
  }

  layout() {
    return canvasLayout(this.state.viewport, this.state.image, this.state.zoom);
  }

  transform(frame: ScreenFrame) {
    return new ViewportTransform(frame, this.state.image);
  }

  private clampScroll(scrollLeft: number, scrollTop: number) {
    const layout = this.layout();
    const maxLeft = Math.max(0, layout.surfaceWidth - this.state.viewport.width);
    const maxTop = Math.max(0, layout.surfaceHeight - this.state.viewport.height);
    return {
      scrollLeft: Math.max(0, Math.min(maxLeft, scrollLeft)),
      scrollTop: Math.max(0, Math.min(maxTop, scrollTop)),
    };
  }

  setViewport(viewport: Size2D) {
    this.state = { ...this.state, viewport: { ...viewport } };
    this.state = { ...this.state, zoom: this.clampZoom(this.state.zoom) };
    this.state = { ...this.state, ...this.clampScroll(this.state.scrollLeft, this.state.scrollTop) };
  }

  setImage(image: Size2D) {
    this.state = { ...this.state, image: { ...image } };
    this.state = { ...this.state, zoom: this.clampZoom(this.state.zoom) };
    this.state = { ...this.state, ...this.clampScroll(this.state.scrollLeft, this.state.scrollTop) };
  }

  setZoom(zoom: number) {
    this.state = { ...this.state, zoom: this.clampZoom(zoom) };
    this.state = { ...this.state, ...this.clampScroll(this.state.scrollLeft, this.state.scrollTop) };
  }

  setScroll(scrollLeft: number, scrollTop: number) {
    this.state = { ...this.state, ...this.clampScroll(scrollLeft, scrollTop) };
  }

  sync(partial: Partial<ViewportState>) {
    if (partial.viewport) this.setViewport(partial.viewport);
    if (partial.image) this.setImage(partial.image);
    if (typeof partial.zoom === "number") this.setZoom(partial.zoom);
    if (typeof partial.scrollLeft === "number" || typeof partial.scrollTop === "number") {
      this.setScroll(partial.scrollLeft ?? this.state.scrollLeft, partial.scrollTop ?? this.state.scrollTop);
    }
    return this.snapshot();
  }

  panBy(pointerDx: number, pointerDy: number) {
    this.setScroll(this.state.scrollLeft - pointerDx, this.state.scrollTop - pointerDy);
    return this.snapshot();
  }

  zoomAt(nextZoom: number, frame: ScreenFrame, pointer: Point2D) {
    const target = Math.round(this.clampZoom(nextZoom));
    if (target === this.state.zoom) return this.snapshot();

    const anchorX = Math.max(0, Math.min(1, (pointer.x - frame.left) / Math.max(1, frame.width)));
    const anchorY = Math.max(0, Math.min(1, (pointer.y - frame.top) / Math.max(1, frame.height)));
    const oldLayout = this.layout();
    const nextLayout = canvasLayout(this.state.viewport, this.state.image, target);

    const oldCanvasLeft = frame.left;
    const oldCanvasTop = frame.top;
    const nextCanvasLeft = oldCanvasLeft + nextLayout.left - oldLayout.left;
    const nextCanvasTop = oldCanvasTop + nextLayout.top - oldLayout.top;
    const scrollLeft = anchoredScrollOffset(this.state.scrollLeft, nextCanvasLeft, nextLayout.width, anchorX, pointer.x);
    const scrollTop = anchoredScrollOffset(this.state.scrollTop, nextCanvasTop, nextLayout.height, anchorY, pointer.y);

    this.state = { ...this.state, zoom: target };
    this.state = { ...this.state, ...this.clampScroll(scrollLeft, scrollTop) };
    return this.snapshot();
  }

  pinchPan(nextZoom: number, frame: ScreenFrame, previousCenter: Point2D, currentCenter: Point2D) {
    this.zoomAt(nextZoom, frame, previousCenter);
    this.setScroll(
      this.state.scrollLeft + previousCenter.x - currentCenter.x,
      this.state.scrollTop + previousCenter.y - currentCenter.y,
    );
    return this.snapshot();
  }
}
