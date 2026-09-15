// Local, bounded TIFF decoding shared by the preview and annotation crops.
import type { GeoTIFF, GeoTIFFImage, Pool } from 'geotiff';
import type { GeoRef, RasterTransform } from './types';
import { geoReference, validateTransform } from './georeference';
import type { RasterReference } from './georeference';

export const RECORTE_LADO_MAX = 4096;
export const RECORTE_MP_MAX = 12;
const READ_BUDGET = 128 * 1024 * 1024;
export type PerfilCog = 'complete' | 'tiled-no-overviews' | 'striped';
export type JanelaRaster = { x: number; y: number; w: number; h: number };
export type MetadadosCog = {
  largura: number; altura: number; bandas: number; crs: string;
  origemX: number; origemY: number; escalaX: number; escalaY: number;
  transform?: RasterTransform;
  larguraTile: number; alturaTile: number; overviews: number; niveis: number[];
  tiled: boolean; semDado: number | null; perfil: PerfilCog;
};
export type SessaoRaster = MetadadosCog & {
  tiff: GeoTIFF; pool: Pool; signal: AbortSignal; masks: number[];
  ranges?: Array<{ min: number; max: number }>;
  close: () => void;
};

export function assinaturaTiff(bytes: Uint8Array) {
  if (bytes.length < 4) return null;
  const little = bytes[0] === 0x49 && bytes[1] === 0x49;
  const big = bytes[0] === 0x4d && bytes[1] === 0x4d;
  if (!little && !big) return null;
  const magic = little ? bytes[2] | (bytes[3] << 8) : (bytes[2] << 8) | bytes[3];
  return magic === 42 ? 'TIFF' : magic === 43 ? 'BigTIFF' : null;
}

export async function primeirosBytes(origem: File | string, signal?: AbortSignal) {
  if (typeof origem !== 'string') return new Uint8Array(await origem.slice(0, 4).arrayBuffer());
  const response = await fetch(origem, { headers: { Range: 'bytes=0-3' }, signal });
  // Never download an entire orthomosaic when a server ignores Range.
  if (response.status !== 206) {
    await response.body?.cancel();
    throw new Error('rasterRangeRequired');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('rasterInvalidTiff');
  const bytes = new Uint8Array(4);
  let count = 0;
  try {
    while (count < 4) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = value.subarray(0, 4 - count);
      bytes.set(chunk, count); count += chunk.length;
    }
  } finally { await reader.cancel(); }
  return bytes.subarray(0, count);
}

export function ehArquivoTiff(nome: string, tipo?: string) {
  return /\.(?:tiff?|geotiff?|btf|tf8|btf8)$/i.test(nome) || /image\/(?:x-)?tiff/i.test(tipo ?? '');
}

function tag(image: GeoTIFFImage, name: Parameters<GeoTIFFImage["fileDirectory"]["getValue"]>[0]): unknown {
  return image.getFileDirectory().getValue(name);
}
function numbers(value: unknown): number[] {
  return typeof value === 'number' ? [value] : value && typeof value === 'object' && 'length' in value
    ? Array.from(value as ArrayLike<number>) : [];
}

export function referenceFromImage(image: GeoTIFFImage): RasterReference {
  const keys = image.getGeoKeys();
  const code = numbers(keys?.ProjectedCSTypeGeoKey ?? keys?.GeographicTypeGeoKey)[0];
  const crs = code > 0 && code < 32767 ? `EPSG:${code}` : undefined;
  const matrix = numbers(tag(image, 'ModelTransformation'));
  const scale = numbers(tag(image, 'ModelPixelScale'));
  const tie = numbers(tag(image, 'ModelTiepoint'));
  let transform: RasterTransform | undefined;
  if (matrix.length === 16) transform = validateTransform([matrix[0], matrix[1], matrix[3], matrix[4], matrix[5], matrix[7]]);
  else if (scale.length >= 2 && tie.length >= 6) {
    transform = validateTransform([scale[0], 0, tie[3] - tie[0] * scale[0], 0, -scale[1], tie[4] + tie[1] * scale[1]]);
  }
  // RasterPixelIsPoint tie points are pixel centres, not pixel edges (GeoTIFF 1.1).
  if (transform && numbers(keys?.GTRasterTypeGeoKey)[0] === 2) {
    transform[2] -= (transform[0] + transform[1]) / 2;
    transform[5] -= (transform[3] + transform[4]) / 2;
  }
  return { crs, transform };
}

export async function leMetadados(origem: File | string, reference: RasterReference = {}, signal?: AbortSignal): Promise<SessaoRaster> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  let tiff: GeoTIFF | undefined;
  let pool: Pool | undefined;
  const close = () => { controller.abort(); signal?.removeEventListener('abort', abort); pool?.destroy(); void tiff?.close(); };
  try {
    if (!assinaturaTiff(await primeirosBytes(origem, controller.signal))) throw new Error('rasterInvalidTiff');
    const library = await import('geotiff');
    tiff = typeof origem === 'string'
      ? await library.fromUrl(origem, { allowFullFile: false, cacheSize: 64 }, controller.signal)
      : await library.fromBlob(origem, controller.signal);
    const image = await tiff.getImage(0);
    const largura = image.getWidth(), altura = image.getHeight();
    const bands = image.getSamplesPerPixel();
    if (!(largura > 0 && altura > 0 && bands > 0)) throw new Error('rasterInvalidTiff');
    const niveis = [0], masks: number[] = [];
    for (let i = 1, total = await tiff.getImageCount(); i < total; i++) {
      const level = await tiff.getImage(i);
      const flags = numbers(tag(level, 'NewSubfileType'))[0] ?? 0;
      if (flags & 4) masks.push(i);
      // Only reduced-resolution images, never masks or unrelated multipage TIFF pages.
      if ((flags & 1) && !(flags & 4) && level.getSamplesPerPixel() === bands &&
          level.getWidth() < largura && level.getHeight() <= altura &&
          Math.abs(level.getWidth() / largura - level.getHeight() / altura) <= 1 / Math.min(largura, altura)) niveis.push(i);
    }
    const embedded = referenceFromImage(image);
    const ref = { transform: embedded.transform ?? reference.transform, crs: embedded.crs ?? reference.crs };
    const geo = geoReference(typeof origem === 'string' ? origem : origem.name, largura, altura, ref);
    const tiled = image.isTiled;
    pool = new library.Pool(typeof Worker === 'undefined' ? 0 : Math.min(2, navigator.hardwareConcurrency || 2));
    return { tiff, pool, masks, signal: controller.signal, close,
      largura, altura, bandas: bands, crs: geo?.crs ?? ref.crs ?? 'sem CRS', transform: geo?.transform,
      origemX: geo?.originX ?? 0, origemY: geo?.originY ?? 0, escalaX: geo?.scaleX ?? 1, escalaY: geo?.scaleY ?? 1,
      larguraTile: image.getTileWidth(), alturaTile: image.getTileHeight(), niveis, overviews: niveis.length - 1,
      tiled, semDado: image.getGDALNoData(), perfil: tiled ? (niveis.length > 1 ? 'complete' : 'tiled-no-overviews') : 'striped',
    };
  } catch (error) { close(); throw error; }
}

export function dimensionaRecorte(w: number, h: number) {
  if (![w, h].every(v => Number.isFinite(v) && v > 0)) throw new Error('rasterInvalidWindow');
  const factor = Math.min(1, RECORTE_LADO_MAX / Math.max(w, h), Math.sqrt(RECORTE_MP_MAX * 1e6 / (w * h)));
  return { largura: Math.max(1, Math.floor(w * factor)), altura: Math.max(1, Math.floor(h * factor)), reducao: 1 / factor };
}

export function clipWindow(j: JanelaRaster, width: number, height: number): JanelaRaster {
  if (![j.x, j.y, j.w, j.h].every(Number.isFinite) || j.w <= 0 || j.h <= 0) throw new Error('rasterInvalidWindow');
  const x = Math.max(0, Math.floor(j.x)), y = Math.max(0, Math.floor(j.y));
  const right = Math.min(width, Math.ceil(j.x + j.w)), bottom = Math.min(height, Math.ceil(j.y + j.h));
  if (right <= x || bottom <= y) throw new Error('rasterInvalidWindow');
  return { x, y, w: right - x, h: bottom - y };
}

export async function nivelPara(meta: SessaoRaster, reductionX: number, reductionY: number) {
  let image = await meta.tiff.getImage(0), sx = 1, sy = 1;
  for (const i of meta.niveis) {
    const candidate = await meta.tiff.getImage(i);
    const x = meta.largura / candidate.getWidth(), y = meta.altura / candidate.getHeight();
    if (x <= reductionX && y <= reductionY && x >= sx && y >= sy) { image = candidate; sx = x; sy = y; }
  }
  return { image, sx, sy };
}

export function checkReadBudget(image: GeoTIFFImage, window: number[]) {
  const tw = image.getTileWidth(), th = image.getTileHeight();
  const blockPixels = (Math.ceil(window[2] / tw) - Math.floor(window[0] / tw)) * tw *
    (Math.ceil(window[3] / th) - Math.floor(window[1] / th)) * th;
  const windowPixels = (window[2] - window[0]) * (window[3] - window[1]);
  const bytes = image.getBytesPerPixel();
  if ((blockPixels + windowPixels) * bytes > READ_BUDGET) throw new Error('rasterReadTooLarge');
}

export function medeFaixa(values: ArrayLike<number>, nodata: number | null) {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isFinite(v) && v !== nodata) { min = Math.min(min, v); max = Math.max(max, v); }
  }
  return Number.isFinite(min) ? { min, max: max > min ? max : min + 1 } : { min: 0, max: 255 };
}

/** Bounded radiometric sample; stable colour scaling for both preview and crops. */
export async function prepareDisplay(meta: SessaoRaster) {
  const { image } = await nivelPara(meta, Infinity, Infinity);
  const bits = numbers(tag(image, 'BitsPerSample'));
  const count = Math.min(3, meta.bandas);
  if (bits.length && bits.every(b => b <= 8)) { meta.ranges = Array.from({ length: count }, (_, i) => ({ min: 0, max: 2 ** (bits[i] ?? bits[0]) - 1 })); return; }
  const w = Math.min(256, image.getWidth()), h = Math.min(256, image.getHeight());
  const x = Math.floor((image.getWidth() - w) / 2), y = Math.floor((image.getHeight() - h) / 2);
  const window = [x, y, x + w, y + h];
  checkReadBudget(image, window);
  const data = await image.readRasters({ window, samples: Array.from({ length: count }, (_, i) => i), pool: meta.pool, signal: meta.signal });
  meta.ranges = Array.from({ length: count }, (_, i) => medeFaixa(data[i], meta.semDado));
}

/** Nearest-neighbour sampling at exact source pixel centres avoids overview-edge shifts
 * and blending NoData into valid pixels. Decode only the selected bands/window. */
export async function readRgba(meta: SessaoRaster, j: JanelaRaster, width: number, height: number, signal = meta.signal) {
  try {
    return await readRgbaWindow(meta, j, width, height, signal);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'rasterReadTooLarge' || (width === 1 && height === 1)) throw error;
    // Keep the requested pixel centres and overview, but decode smaller windows.
    // A full crop can exceed the budget even when the TIFF already has overviews.
    const horizontal = width >= height && width > 1;
    const first = Math.floor((horizontal ? width : height) / 2);
    const fraction = first / (horizontal ? width : height);
    const a = horizontal ? { ...j, w: j.w * fraction } : { ...j, h: j.h * fraction };
    const b = horizontal
      ? { ...j, x: j.x + a.w, w: j.w - a.w }
      : { ...j, y: j.y + a.h, h: j.h - a.h };
    const output = new Uint8ClampedArray(width * height * 4);
    for (const [window, offset, length] of [[a, 0, first], [b, first, (horizontal ? width : height) - first]] as const) {
      const partWidth = horizontal ? length : width;
      const partHeight = horizontal ? height : length;
      const pixels = await readRgba(meta, window, partWidth, partHeight, signal);
      for (let row = 0; row < partHeight; row++) {
        output.set(pixels.subarray(row * partWidth * 4, (row + 1) * partWidth * 4),
          ((horizontal ? row : row + offset) * width + (horizontal ? offset : 0)) * 4);
      }
    }
    return output;
  }
}

async function readRgbaWindow(meta: SessaoRaster, j: JanelaRaster, width: number, height: number, signal: AbortSignal) {
  signal.throwIfAborted();
  if (![width, height].every(v => Number.isInteger(v) && v > 0 && v <= RECORTE_LADO_MAX) || width * height > RECORTE_MP_MAX * 1e6 ||
      ![j.x, j.y, j.w, j.h].every(Number.isFinite) || j.w <= 0 || j.h <= 0) throw new Error('rasterInvalidWindow');
  const { image, sx, sy } = await nivelPara(meta, j.w / width, j.h / height);
  const window = [Math.max(0, Math.floor(j.x / sx)), Math.max(0, Math.floor(j.y / sy)),
    Math.min(image.getWidth(), Math.ceil((j.x + j.w) / sx)), Math.min(image.getHeight(), Math.ceil((j.y + j.h) / sy))];
  if (window[2] <= window[0] || window[3] <= window[1]) return new Uint8ClampedArray(width * height * 4);
  checkReadBudget(image, window);
  const output = new Uint8ClampedArray(width * height * 4);
  const photo = numbers(tag(image, 'PhotometricInterpretation'))[0];
  const converted = [3, 5, 6, 8, 9, 10].includes(photo);
  const extras = numbers(tag(image, 'ExtraSamples'));
  const colorBands = photo === 2 ? 3 : 1;
  const alphaIndex = extras.findIndex(v => v === 1 || v === 2);
  const alpha = alphaIndex < 0 ? -1 : image.getSamplesPerPixel() - extras.length + alphaIndex;
  const samples = Array.from({ length: Math.min(colorBands, meta.bandas) }, (_, i) => i);
  if (alpha >= 0 && !samples.includes(alpha)) samples.push(alpha);
  const options = { window, pool: meta.pool, signal, interleave: true as const };
  const data = converted ? await image.readRGB(options) : await image.readRasters({ ...options, samples });
  const stride = converted ? 3 : samples.length;
  // Converted colour spaces still need their original alpha/NoData samples.
  const raw = converted && (alpha >= 0 || meta.semDado !== null)
    ? await image.readRasters({ ...options, samples: Array.from({ length: image.getSamplesPerPixel() }, (_, i) => i) }) : null;
  let mask: { values: ArrayLike<number>; window: number[]; sx: number; sy: number } | undefined;
  let maskImage: GeoTIFFImage | undefined;
  for (const index of meta.masks) {
    const candidate = await meta.tiff.getImage(index);
    const mx = meta.largura / candidate.getWidth(), my = meta.altura / candidate.getHeight();
    if (mx <= j.w / width && my <= j.h / height && (!maskImage || candidate.getWidth() < maskImage.getWidth())) maskImage = candidate;
  }
  if (maskImage) {
    const mx = meta.largura / maskImage.getWidth(), my = meta.altura / maskImage.getHeight();
    const mw = [Math.max(0, Math.floor(j.x / mx)), Math.max(0, Math.floor(j.y / my)),
      Math.min(maskImage.getWidth(), Math.ceil((j.x + j.w) / mx)), Math.min(maskImage.getHeight(), Math.ceil((j.y + j.h) / my))];
    checkReadBudget(maskImage, mw);
    mask = { values: await maskImage.readRasters({ ...options, window: mw, samples: [0] }), window: mw, sx: mx, sy: my };
  }
  const bits = numbers(tag(image, 'BitsPerSample'));
  const rw = window[2] - window[0];
  const n = converted || photo === 2 ? 3 : 1;
  const display = Array.from({ length: 3 }, (_, b) => {
    const channel = n === 1 ? 0 : b;
    const range = converted ? { min: 0, max: 255 } : meta.ranges?.[channel] ?? { min: 0, max: 255 };
    return { channel, min: range.min, factor: 255 / (range.max - range.min) };
  });
  for (let y = 0; y < height; y++) {
    if (y > 0 && y % 128 === 0) { await new Promise(resolve => setTimeout(resolve, 0)); signal.throwIfAborted(); }
    const sourceY = j.y + (y + 0.5) * j.h / height;
    for (let x = 0; x < width; x++) {
      const sourceX = j.x + (x + 0.5) * j.w / width;
      if (sourceX < 0 || sourceY < 0 || sourceX >= meta.largura || sourceY >= meta.altura) continue;
      const ix = Math.min(window[2] - 1, Math.max(window[0], Math.floor(sourceX / sx))) - window[0];
      const iy = Math.min(window[3] - 1, Math.max(window[1], Math.floor(sourceY / sy))) - window[1];
      const offset = (iy * rw + ix) * stride, p = (y * width + x) * 4;
      if (mask) {
        const mx = Math.min(mask.window[2] - 1, Math.max(mask.window[0], Math.floor(sourceX / mask.sx))) - mask.window[0];
        const my = Math.min(mask.window[3] - 1, Math.max(mask.window[1], Math.floor(sourceY / mask.sy))) - mask.window[1];
        if (!mask.values[my * (mask.window[2] - mask.window[0]) + mx]) continue;
      }
      const rawOffset = (iy * rw + ix) * image.getSamplesPerPixel();
      if (raw && meta.semDado !== null) {
        const rawColors = photo === 3 ? 1 : photo === 5 ? 4 : 3;
        let missing = true;
        for (let b = 0; b < rawColors; b++) missing &&= raw[rawOffset + b] === meta.semDado;
        if (missing) continue;
      }
      let valid = true, noData = !converted && meta.semDado !== null;
      for (let b = 0; b < n; b++) { valid &&= Number.isFinite(data[offset + b]); noData &&= data[offset + b] === meta.semDado; }
      if (!valid || noData) continue;
      for (let b = 0; b < 3; b++) {
        const { channel, min, factor } = display[b];
        const v = (data[offset + channel] - min) * factor;
        output[p + b] = photo === 0 ? 255 - v : v;
      }
      output[p + 3] = !converted && alpha >= 0 ? 255 * data[offset + samples.indexOf(alpha)] / (2 ** (bits[alpha] ?? bits[0] ?? 8) - 1) : 255;
      if (raw && alpha >= 0) output[p + 3] = 255 * raw[rawOffset + alpha] / (2 ** (bits[alpha] ?? bits[0] ?? 8) - 1);
      if (!converted && alpha >= 0 && extras[alphaIndex] === 1 && output[p + 3] > 0) {
        for (let b = 0; b < 3; b++) output[p + b] = output[p + b] * 255 / output[p + 3];
      }
    }
  }
  signal.throwIfAborted();
  return output;
}

export type Recorte = { blob: Blob; largura: number; altura: number; geo?: GeoRef; window: JanelaRaster };

export async function geraRecorte(meta: SessaoRaster, nome: string, janela: JanelaRaster): Promise<Recorte> {
  const window = clipWindow(janela, meta.largura, meta.altura);
  const size = dimensionaRecorte(window.w, window.h);
  const pixels = await readRgba(meta, window, size.largura, size.altura);
  const canvas = document.createElement('canvas');
  canvas.width = size.largura; canvas.height = size.altura;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('rasterCanvasFailed');
  context.putImageData(new ImageData(pixels, size.largura, size.altura), 0, 0);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('rasterCanvasFailed');
  const geo = geoReference(nome, meta.largura, meta.altura, meta);
  return { blob, largura: size.largura, altura: size.altura, window,
    geo: geo ? { ...geo, window, cropWidth: size.largura, cropHeight: size.altura } : undefined };
}
