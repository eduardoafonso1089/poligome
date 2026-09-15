import type { Point2D, Size2D } from "../../lib/editor-viewport";

function safeSize(value: number) {
  return Math.max(1, value);
}

export function clampImagePoint(point: Point2D, image: Size2D): Point2D {
  return {
    x: Math.max(0, Math.min(image.width, point.x)),
    y: Math.max(0, Math.min(image.height, point.y)),
  };
}

/**
 * Converts a browser client point directly into source-image pixel coordinates.
 * This mirrors the CVAT approach: invert the SVG screen CTM instead of rewriting
 * annotation geometry when the viewport, zoom or device size changes.
 */
export function clientPointToImage(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
  image: Size2D,
  clamp = true,
): Point2D {
  const matrix = svg.getScreenCTM?.();
  if (matrix) {
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const local = point.matrixTransform(matrix.inverse());
    const result = { x: local.x, y: local.y };
    return clamp ? clampImagePoint(result, image) : result;
  }

  // DOM implementations without SVG CTM support (or tests) still get a stable fallback.
  const rect = svg.getBoundingClientRect();
  const result = {
    x: (clientX - rect.left) / safeSize(rect.width) * image.width,
    y: (clientY - rect.top) / safeSize(rect.height) * image.height,
  };
  return clamp ? clampImagePoint(result, image) : result;
}

/** Convert a desired on-screen size to source-image units for SVG handles/strokes. */
export function screenPixelsToImageUnits(screenPixels: number, image: Size2D, renderedWidth: number) {
  return screenPixels * image.width / safeSize(renderedWidth);
}
