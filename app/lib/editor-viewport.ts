export type Point2D = { x: number; y: number };
export type Size2D = { width: number; height: number };
export type ScreenFrame = Size2D & { left: number; top: number };

function safeSize(value: number) {
  return Math.max(1, value);
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

/**
 * Screen <-> source-image pixel transform used by the canonical editor.
 * Annotation geometry is already expressed in source-image pixels, so there is
 * deliberately no third normalized annotation coordinate space here.
 */
export class ViewportTransform {
  constructor(
    readonly frame: ScreenFrame,
    readonly image: Size2D,
  ) {}

  screenToImage(point: Point2D, clamp = true): Point2D {
    const normalizedX = (point.x - this.frame.left) / safeSize(this.frame.width);
    const normalizedY = (point.y - this.frame.top) / safeSize(this.frame.height);
    return {
      x: (clamp ? clamp01(normalizedX) : normalizedX) * this.image.width,
      y: (clamp ? clamp01(normalizedY) : normalizedY) * this.image.height,
    };
  }

  imageToScreen(point: Point2D): Point2D {
    return {
      x: this.frame.left + point.x / safeSize(this.image.width) * this.frame.width,
      y: this.frame.top + point.y / safeSize(this.image.height) * this.frame.height,
    };
  }

  screenDeltaToImage(dx: number, dy: number): Point2D {
    return {
      x: dx * this.image.width / safeSize(this.frame.width),
      y: dy * this.image.height / safeSize(this.frame.height),
    };
  }
}

/** Scroll offset that keeps the same image coordinate under a screen position after zoom. */
export function anchoredScrollOffset(currentScroll: number, canvasClientStart: number, canvasSize: number, anchor: number, pointerClient: number) {
  return currentScroll + canvasClientStart + clamp01(anchor) * canvasSize - pointerClient;
}

/** Fixed rendered geometry: surrounding UI reflow cannot silently change the zoom. */
export function canvasLayout(viewport: Size2D, image: Size2D, zoom: number) {
  const width = viewport.width * zoom / 100;
  const height = width * image.height / safeSize(image.width);
  return {
    width,
    height,
    left: Math.max(0, (viewport.width - width) / 2),
    top: Math.max(0, (viewport.height - height) / 2),
    surfaceWidth: Math.max(viewport.width, width),
    surfaceHeight: Math.max(viewport.height, height),
  };
}
