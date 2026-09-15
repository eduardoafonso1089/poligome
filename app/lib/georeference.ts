import type { GeoRef, RasterTransform } from './types';

export type RasterReference = { transform?: RasterTransform; crs?: string };

/** Pixel edges -> source CRS. Legacy projects used north-up origin/scale fields. */
export function rasterTransform(geo: GeoRef): RasterTransform {
  return geo.transform ?? [geo.scaleX, 0, geo.originX, 0, -geo.scaleY, geo.originY];
}

export function transformPoint(t: RasterTransform, x: number, y: number): [number, number] {
  return [t[0] * x + t[1] * y + t[2], t[3] * x + t[4] * y + t[5]];
}

export function validateTransform(values: number[]): RasterTransform {
  if (values.length !== 6 || !values.every(Number.isFinite) || values[0] * values[4] - values[1] * values[3] === 0) {
    throw new Error('rasterInvalidReference');
  }
  return values as RasterTransform;
}

/** World files use A,D,B,E,C,F and locate the centre of the upper-left pixel. */
export function parseWorldFile(text: string): RasterTransform {
  const values = text.replace(/^\uFEFF/, '').trim().split(/\s+/).map(Number);
  if (values.length !== 6) throw new Error('rasterInvalidReference');
  const [a, d, b, e, c, f] = values;
  return validateTransform([a, b, c - (a + b) / 2, d, e, f - (d + e) / 2]);
}

export function geoReference(source: string, width: number, height: number, reference: RasterReference): GeoRef | undefined {
  if (!reference.transform) return undefined;
  const t = validateTransform(reference.transform);
  return {
    source, crs: reference.crs || 'sem CRS', transform: t,
    originX: t[2], originY: t[5], scaleX: Math.hypot(t[0], t[3]), scaleY: Math.hypot(t[1], t[4]),
    sourceWidth: width, sourceHeight: height, window: { x: 0, y: 0, w: width, h: height },
    cropWidth: width, cropHeight: height,
  };
}


/** Match full filename first, then the exact stem. Never borrow another image's CRS. */
export async function readRasterSidecars(image: File, files: File[]): Promise<RasterReference> {
  const name = image.name.toLowerCase();
  const stem = name.replace(/\.[^.]+$/, '');
  const ext = name.split('.').at(-1) ?? '';
  const names = [`${name}w`, `${stem}.${ext[0]}${ext.at(-1)}w`, `${stem}.${ext}w`, `${stem}.wld`];
  const find = (candidates: string[]) => {
    for (const candidate of candidates) {
      const matches = files.filter(file => file.name.toLowerCase() === candidate);
      if (matches.length > 1) throw new Error('rasterInvalidReference');
      if (matches[0]) return matches[0];
    }
  };
  const world = find(names);
  const prj = find([`${name}.prj`, `${stem}.prj`]);
  const aux = find([`${name}.aux.xml`]);
  const result: RasterReference = {};
  if (aux) {
    const doc = new DOMParser().parseFromString(await aux.text(), 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('rasterInvalidReference');
    const gt = doc.querySelector('GeoTransform')?.textContent;
    if (gt) {
      const values = gt.trim().split(',').map(Number);
      if (values.length !== 6) throw new Error('rasterInvalidReference');
      const [c, a, b, f, d, e] = values;
      result.transform = validateTransform([a, b, c, d, e, f]);
    }
    result.crs = doc.querySelector('SRS')?.textContent?.trim() || undefined;
  }
  if (world) result.transform = parseWorldFile(await world.text());
  if (prj) result.crs = (await prj.text()).trim();
  return result;
}
