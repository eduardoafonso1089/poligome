import { contours } from "d3-contour";

// Match the editor's image limit and reject hostile dimensions before allocating.
const MAX_PIXELS = 16_000_000;
export type CocoRle = { size: [number, number]; counts: number[] };

export function parseCocoRle(value: unknown): CocoRle | null {
  if (!value || typeof value !== "object") return null;
  const { size, counts } = value as { size?: unknown; counts?: unknown };
  if (!Array.isArray(size) || size.length !== 2 || !size.every((n) => Number.isSafeInteger(n) && n > 0)) return null;
  const pixels = size[0] * size[1];
  if (!Number.isSafeInteger(pixels) || pixels > MAX_PIXELS) return null;
  const runs: number[] = [];
  if (typeof counts === "string") {
    let cursor = 0;
    while (cursor < counts.length) {
      let number = 0;
      let shift = 0;
      let byte: number;
      do {
        if (cursor >= counts.length || shift > 30) return null;
        byte = counts.charCodeAt(cursor++) - 48;
        if (byte < 0 || byte > 63) return null;
        number += (byte & 31) * 2 ** shift;
        shift += 5;
      } while (byte & 32);
      if (byte & 16) number -= 2 ** shift;
      if (runs.length > 2) number += runs[runs.length - 2];
      if (!Number.isSafeInteger(number) || number < 0 || number > pixels) return null;
      runs.push(number);
      if (runs.length > pixels + 1) return null;
    }
  } else if (Array.isArray(counts)) {
    if (counts.length > pixels + 1) return null;
    for (const run of counts) {
      if (!Number.isSafeInteger(run) || run < 0 || run > pixels) return null;
      runs.push(run);
    }
  } else return null;
  if (!runs.length || runs.reduce((sum, run) => sum + run, 0) !== pixels) return null;
  return { size: [size[0], size[1]], counts: runs };
}

export function rlePolygons(rle: CocoRle): number[][][][] {
  const [height, width] = rle.size;
  const pixels = new Uint8Array(width * height);
  let offset = 0;
  rle.counts.forEach((run, index) => {
    if (index % 2) for (let end = offset + run; offset < end; offset++) {
      pixels[(offset % height) * width + Math.floor(offset / height)] = 1;
    }
    else offset += run;
  });
  // d3-contour accepts indexed numeric arrays, including typed arrays at runtime.
  return contours().size([width, height]).contour(pixels as unknown as number[], .5).coordinates;
}

/** Rasterize pixel centres using even/odd rings, preserving holes in standard COCO. */
export function polygonRle(rings: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>, width: number, height: number): CocoRle {
  if (![width, height].every((n) => Number.isSafeInteger(n) && n > 0) || width * height > MAX_PIXELS) throw new Error("Invalid COCO mask dimensions");
  const counts: number[] = [0];
  let current = 0;
  const append = (bit: number, length: number) => {
    if (length <= 0) return;
    if (current !== bit) { counts.push(0); current = bit; }
    counts[counts.length - 1] += length;
  };
  for (let x = 0; x < width; x++) {
    const centre = x + .5;
    const intersections: number[] = [];
    for (const ring of rings) for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      if ((a.x <= centre && b.x > centre) || (b.x <= centre && a.x > centre)) intersections.push(a.y + (centre - a.x) * (b.y - a.y) / (b.x - a.x));
    }
    intersections.sort((a, b) => a - b);
    let cursor = 0;
    for (let i = 0; i + 1 < intersections.length; i += 2) {
      const start = Math.max(0, Math.min(height, Math.ceil(intersections[i] - .5)));
      const end = Math.max(start, Math.min(height, Math.ceil(intersections[i + 1] - .5)));
      append(0, start - cursor); append(1, end - start); cursor = end;
    }
    append(0, height - cursor);
  }
  return { size: [height, width], counts };
}
