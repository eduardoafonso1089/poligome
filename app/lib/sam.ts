import { contours } from "d3-contour";
import { fill } from "./i18n";
import type { Copy } from "./i18n";
import type { Asset, SamBoxPrompt, SamMaskPrediction, SamPrompt } from "./types";

type SamResponse = Record<string, unknown>;

export type SamPredictionResult = {
  predictions: SamMaskPrediction[];
  modelId: string | null;
  reusedEmbedding: boolean;
};

type SamRequest = {
  endpoint: string;
  asset: Asset;
  copy: Copy;
  modelId?: string;
  prompts?: SamPrompt[];
  box?: SamBoxPrompt | null;
  text?: string;
  threshold?: number;
  multimaskOutput?: boolean;
  clientId?: string;
  requestSeq?: number;
  signal?: AbortSignal;
};

function readDataUrl(blob: Blob, copy: Copy, signal?: AbortSignal) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    const cleanup = () => signal?.removeEventListener("abort", abort);
    const abort = () => reader.abort();
    if (signal?.aborted) { reject(new DOMException("Cancelado", "AbortError")); return; }
    signal?.addEventListener("abort", abort, { once: true });
    reader.onload = () => { cleanup(); resolve(String(reader.result)); };
    reader.onerror = () => { cleanup(); reject(new Error(copy.errSamReadImage)); };
    reader.onabort = () => { cleanup(); reject(new DOMException("Cancelado", "AbortError")); };
    reader.readAsDataURL(blob);
  });
}

/**
 * SAM receives the whole image embedded in the request body, and that happens on every point
 * the user clicks. A COG crop at the 12 MP limit becomes 34 MB of base64 per call — measured.
 * The model resizes the input to 1024 px anyway, so sending more than that is pure waste of
 * network time.
 */
const SAM_LADO_MAX = 1600;

export type ImagemParaSam = {
  url: string;
  larguraEnvio: number;
  alturaEnvio: number;
  larguraOrigem: number;
  alturaOrigem: number;
};

function carregaImagem(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const imagem = new Image();
    imagem.crossOrigin = "anonymous";
    imagem.onload = () => resolve(imagem);
    imagem.onerror = () => reject(new Error("falha ao carregar a imagem"));
    imagem.src = src;
  });
}

function validDimension(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

async function fetchAsDataUrl(asset: Asset, copy: Copy, signal?: AbortSignal) {
  let response: Response;
  try {
    response = await fetch(asset.src, { signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(copy.errSamPrepareImage);
  }
  if (!response.ok) throw new Error(copy.errSamPrepareImage);
  return readDataUrl(await response.blob(), copy, signal);
}

export async function assetAsDataUrl(asset: Asset, copy: Copy, signal?: AbortSignal): Promise<ImagemParaSam> {
  if (signal?.aborted) throw new DOMException("Cancelado", "AbortError");
  let imagemCarregada: HTMLImageElement | null = null;
  let larguraOrigem = validDimension(asset.width) ? asset.width : 0;
  let alturaOrigem = validDimension(asset.height) ? asset.height : 0;

  if (!larguraOrigem || !alturaOrigem) {
    imagemCarregada = await carregaImagem(asset.src);
    larguraOrigem = imagemCarregada.naturalWidth;
    alturaOrigem = imagemCarregada.naturalHeight;
  }

  const fator = Math.min(1, SAM_LADO_MAX / Math.max(larguraOrigem, alturaOrigem));

  if (fator >= 1) {
    if (asset.src.startsWith("data:")) {
      return {
        url: asset.src,
        larguraEnvio: larguraOrigem,
        alturaEnvio: alturaOrigem,
        larguraOrigem,
        alturaOrigem,
      };
    }
    return {
      url: await fetchAsDataUrl(asset, copy, signal),
      larguraEnvio: larguraOrigem,
      alturaEnvio: alturaOrigem,
      larguraOrigem,
      alturaOrigem,
    };
  }

  try {
    const imagem = imagemCarregada ?? await carregaImagem(asset.src);
    const alvoLargura = Math.max(1, Math.round(larguraOrigem * fator));
    const alvoAltura = Math.max(1, Math.round(alturaOrigem * fator));
    const tela = document.createElement("canvas");
    tela.width = alvoLargura;
    tela.height = alvoAltura;
    const contexto = tela.getContext("2d");
    if (!contexto) throw new Error("sem contexto 2D");
    contexto.drawImage(imagem, 0, 0, alvoLargura, alvoAltura);
    return {
      url: tela.toDataURL("image/jpeg", 0.9),
      larguraEnvio: alvoLargura,
      alturaEnvio: alvoAltura,
      larguraOrigem,
      alturaOrigem,
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return {
      url: await fetchAsDataUrl(asset, copy, signal),
      larguraEnvio: larguraOrigem,
      alturaEnvio: alturaOrigem,
      larguraOrigem,
      alturaOrigem,
    };
  }
}

function pointPolygon(value: unknown): number[] | null {
  if (!Array.isArray(value) || !value.length) return null;
  if (value.every((coordinate) => Number.isFinite(Number(coordinate)))) {
    const polygon = value.map(Number);
    return polygon.length >= 6 && polygon.length % 2 === 0 ? polygon : null;
  }
  if (value.every((point) => Array.isArray(point) && point.length >= 2 && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])))) {
    return value.flatMap((point) => [Number(point[0]), Number(point[1])]);
  }
  if (value.every((point) => point && typeof point === "object" && Number.isFinite(Number((point as { x?: unknown }).x)) && Number.isFinite(Number((point as { y?: unknown }).y)))) {
    return value.flatMap((point) => [Number((point as { x: unknown }).x), Number((point as { y: unknown }).y)]);
  }
  return null;
}

function polygonCollection(value: unknown): number[][] {
  const direct = pointPolygon(value);
  if (direct) return [direct];
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const polygon = pointPolygon(candidate);
    return polygon ? [polygon] : polygonCollection(candidate);
  });
}

function polygonArea(points: number[]) {
  let area = 0;
  for (let index = 0; index + 3 < points.length; index += 2) {
    area += points[index] * points[index + 3] - points[index + 2] * points[index + 1];
  }
  if (points.length >= 6) {
    area += points.at(-2)! * points[1] - points[0] * points.at(-1)!;
  }
  return Math.abs(area) / 2;
}

function simplify(points: number[], tolerance = 2.2) {
  if (points.length <= 12) return points;
  const result: number[] = [];
  for (let index = 0; index < points.length; index += 2) {
    const previousX = result.at(-2);
    const previousY = result.at(-1);
    if (previousX === undefined || previousY === undefined || Math.hypot(points[index] - previousX, points[index + 1] - previousY) >= tolerance) {
      result.push(points[index], points[index + 1]);
    }
  }
  return result.length >= 6 ? result : points;
}

function matrixToPolygons(mask: unknown[][]) {
  const height = mask.length;
  const width = Array.isArray(mask[0]) ? mask[0].length : 0;
  if (!width || !height || !mask.every((row) => Array.isArray(row) && row.length === width)) return [];
  const values = mask.flatMap((row) => row.map((value) => Number(value) > 0.5 ? 1 : 0));
  const geometry = contours().size([width, height]).thresholds([0.5])(values)[0];
  if (!geometry?.coordinates.length) return [];
  const rings = geometry.coordinates.map((polygon) => polygon[0]).filter(Boolean);
  return rings
    .map((ring) => ring.flatMap(([x, y]) => [x, y]))
    .filter((ring) => ring.length >= 6)
    .sort((a, b) => polygonArea(b) - polygonArea(a));
}

/**
 * The connector answers in the coordinates of the image we uploaded, which may be a downscaled
 * copy. Annotations live in source-raster pixels, so every contour comes back through here.
 */
function mapPolygonToSource(
  points: number[],
  responseWidth: number,
  responseHeight: number,
  sourceWidth: number,
  sourceHeight: number,
) {
  const xs = points.filter((_, index) => index % 2 === 0);
  const ys = points.filter((_, index) => index % 2 === 1);
  const normalized = Math.max(...xs) <= 1.5 && Math.max(...ys) <= 1.5;
  const mapped = points.map((coordinate, index) => {
    const isY = index % 2 === 1;
    const responseSize = isY ? responseHeight : responseWidth;
    const sourceSize = isY ? sourceHeight : sourceWidth;
    const value = normalized ? coordinate * sourceSize : coordinate / responseSize * sourceSize;
    return Math.max(0, Math.min(sourceSize, value));
  });
  return simplify(mapped);
}

function finiteScore(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const score = Number(value);
  return Number.isFinite(score) ? score : null;
}

function mapBboxToSource(
  value: unknown,
  responseWidth: number,
  responseHeight: number,
  sourceWidth: number,
  sourceHeight: number,
): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4 || !value.every((coordinate) => Number.isFinite(Number(coordinate)))) return null;
  const box = value.map(Number);
  const normalized = Math.max(...box) <= 1.5;
  const scaled = box.map((coordinate, index) => {
    const isY = index % 2 === 1;
    const responseSize = isY ? responseHeight : responseWidth;
    const sourceSize = isY ? sourceHeight : sourceWidth;
    return normalized ? coordinate * sourceSize : coordinate / responseSize * sourceSize;
  });
  return scaled as [number, number, number, number];
}

function predictionFrom(
  value: unknown,
  responseWidth: number,
  responseHeight: number,
  sourceWidth: number,
  sourceHeight: number,
): SamMaskPrediction | null {
  if (!value || typeof value !== "object") return null;
  const prediction = value as SamResponse;
  const polygons = polygonCollection(prediction.polygons ?? prediction.polygon ?? prediction.contours ?? prediction.contour);
  const mask = prediction.mask;
  if (!polygons.length && Array.isArray(mask) && Array.isArray(mask[0])) {
    const matrix = mask as unknown[][];
    const maskWidth = (matrix[0] as unknown[]).length;
    const maskHeight = matrix.length;
    return buildPrediction(
      matrixToPolygons(matrix),
      prediction,
      maskWidth,
      maskHeight,
      sourceWidth,
      sourceHeight,
    );
  }
  return buildPrediction(polygons, prediction, responseWidth, responseHeight, sourceWidth, sourceHeight);
}

function buildPrediction(
  polygons: number[][],
  prediction: SamResponse,
  responseWidth: number,
  responseHeight: number,
  sourceWidth: number,
  sourceHeight: number,
): SamMaskPrediction | null {
  const mapped = polygons
    .filter((polygon) => polygon.length >= 6)
    .map((polygon) => mapPolygonToSource(polygon, responseWidth, responseHeight, sourceWidth, sourceHeight));
  if (!mapped.length) return null;
  return {
    polygons: mapped,
    score: finiteScore(prediction.score),
    bbox: mapBboxToSource(prediction.bbox ?? prediction.box, responseWidth, responseHeight, sourceWidth, sourceHeight),
  };
}

function parseResponse(
  body: SamResponse,
  sentWidth: number,
  sentHeight: number,
  sourceWidth: number,
  sourceHeight: number,
  copy: Copy,
): SamPredictionResult {
  const data = (body.data && typeof body.data === "object" ? body.data : body) as SamResponse;
  const declaredWidth = Number(data.width);
  const declaredHeight = Number(data.height);
  const responseWidth = Number.isFinite(declaredWidth) && declaredWidth > 0 ? declaredWidth : sentWidth;
  const responseHeight = Number.isFinite(declaredHeight) && declaredHeight > 0 ? declaredHeight : sentHeight;
  const rawPredictions = Array.isArray(data.predictions) ? data.predictions : [data];
  let predictions = rawPredictions
    .map((prediction) => predictionFrom(prediction, responseWidth, responseHeight, sourceWidth, sourceHeight))
    .filter((prediction): prediction is SamMaskPrediction => prediction !== null);

  if (!predictions.length && Array.isArray(data.masks)) {
    predictions = data.masks.flatMap((mask, index) => {
      const prediction = predictionFrom(
        { mask, score: Array.isArray(data.scores) ? data.scores[index] : undefined },
        responseWidth,
        responseHeight,
        sourceWidth,
        sourceHeight,
      );
      return prediction ? [prediction] : [];
    });
  }
  if (!predictions.length) throw new Error(copy.errSamNoPolygon);
  return {
    predictions,
    modelId: typeof data.model_id === "string" ? data.model_id : null,
    reusedEmbedding: data.reused_embedding === true,
  };
}

function scaleBox(box: SamBoxPrompt, sourceWidth: number, sourceHeight: number, sentWidth: number, sentHeight: number) {
  const x0 = box.x / sourceWidth * sentWidth;
  const y0 = box.y / sourceHeight * sentHeight;
  const x1 = (box.x + box.w) / sourceWidth * sentWidth;
  const y1 = (box.y + box.h) / sourceHeight * sentHeight;
  return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
}

export async function requestSamPredictions({
  endpoint,
  asset,
  copy,
  modelId,
  prompts = [],
  box,
  text,
  threshold,
  multimaskOutput = true,
  clientId,
  requestSeq,
  signal,
}: SamRequest): Promise<SamPredictionResult> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timeout = window.setTimeout(abort, 180_000);
  try {
    const {
      url: image,
      larguraEnvio,
      alturaEnvio,
      larguraOrigem,
      alturaOrigem,
    } = await assetAsDataUrl(asset, copy, controller.signal);
    const pointCoords = prompts.map((prompt) => [
      prompt.x / larguraOrigem * larguraEnvio,
      prompt.y / alturaOrigem * alturaEnvio,
    ]);
    const pointLabels = prompts.map((prompt) => prompt.label);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image,
        model_id: modelId,
        point_coords: pointCoords,
        point_labels: pointLabels,
        points: pointCoords.map(([x, y], index) => ({ x, y, label: pointLabels[index] })),
        box: box ? scaleBox(box, larguraOrigem, alturaOrigem, larguraEnvio, alturaEnvio) : null,
        box_label: box?.label ?? 1,
        text: text?.trim() || null,
        threshold: threshold ?? null,
        multimask_output: multimaskOutput,
        client_id: clientId ?? null,
        request_seq: requestSeq ?? null,
        return_format: "polygons",
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => null) as { detail?: unknown } | null;
      // O conector escreve o detalhe para quem está anotando ("o modelo ainda está
      // carregando"), então ele vem primeiro e o código fica de contexto. Colado
      // atrás da frase pronta saía "…HTTP 503.: o modelo ainda está carregando".
      const detail = typeof errorBody?.detail === "string" ? errorBody.detail.trim() : "";
      throw new Error(detail
        ? `${detail} (HTTP ${response.status})`
        : fill(copy.errSamHttp, { status: response.status }));
    }
    return parseResponse(
      await response.json() as SamResponse,
      larguraEnvio,
      alturaEnvio,
      larguraOrigem,
      alturaOrigem,
      copy,
    );
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(signal?.aborted ? copy.errSamCanceled : copy.errSamTimeout);
    }
    if (error instanceof TypeError) {
      throw new Error(copy.errSamUnreachable);
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

export async function requestSamMask(request: Omit<SamRequest, "multimaskOutput">) {
  const result = await requestSamPredictions({ ...request, multimaskOutput: false });
  return result.predictions[0]?.polygons[0] ?? [];
}
