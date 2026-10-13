/**
 * O que do projeto pode ensinar o SAM, decidido no navegador e reconferido no
 * conector.
 *
 * Só máscara aprovada entra no treino. "Aprovada" aqui é uma regra explícita,
 * porque o editor não tem um botão de aprovar:
 *
 * - polígono desenhado ou aceito pela pessoa (inclui o resultado do SAM que ela
 *   salvou) → `manual`;
 * - predição automática que a pessoa editou → `corrected_prediction`;
 * - predição automática intacta, mas com nota de revisão 4 ou 5 →
 *   `reviewed_prediction`;
 * - predição automática intacta e sem revisão → fora: o modelo aprenderia os
 *   próprios erros;
 * - nota de revisão 1 ou 2 na anotação ou na imagem → fora;
 * - caixa, linha e ponto → fora: não são máscaras.
 *
 * O conector recusa de novo qualquer origem fora das três aceitas.
 */

import type { Asset, Label } from "./types";
import type { EditorAnnotation, PolygonAnnotation } from "../editor/models/annotation-model";
import { annotationPixelArea } from "../editor/review/quality-review-model";
import { isUntouchedPrediction } from "./runtime-annotations";

export type AdaptiveOrigin = "manual" | "corrected_prediction" | "reviewed_prediction";
export type AdaptiveExclusion = "not_a_mask" | "unverified_prediction" | "rejected_by_review" | "image_rejected" | "too_small" | "image_missing";

export type AnnotationVerdict =
  | { usable: true; origin: AdaptiveOrigin }
  | { usable: false; reason: AdaptiveExclusion };

/** Abaixo disto o conector também descarta: não há borda para aprender. */
export const MIN_MASK_AREA_PX = 16;

export function classifyAnnotation(annotation: EditorAnnotation, asset?: Asset): AnnotationVerdict {
  if (asset?.missing || !asset?.src) return { usable: false, reason: "image_missing" };
  if (typeof asset.reviewScore === "number" && asset.reviewScore <= 2) return { usable: false, reason: "image_rejected" };
  if (annotation.type !== "polygon") return { usable: false, reason: "not_a_mask" };
  if (typeof annotation.reviewScore === "number" && annotation.reviewScore <= 2) return { usable: false, reason: "rejected_by_review" };
  if (annotationPixelArea(annotation) < MIN_MASK_AREA_PX) return { usable: false, reason: "too_small" };
  if (annotation.prediction) {
    if (!isUntouchedPrediction(annotation)) return { usable: true, origin: "corrected_prediction" };
    if (typeof annotation.reviewScore === "number" && annotation.reviewScore >= 4) return { usable: true, origin: "reviewed_prediction" };
    return { usable: false, reason: "unverified_prediction" };
  }
  return { usable: true, origin: "manual" };
}

const GENERIC_PREFIXES = new Set([
  "img", "image", "imagem", "imagen", "dsc", "dscn", "dscf", "pxl", "photo", "foto", "picture", "pic",
  "screenshot", "captura", "scan", "frame", "untitled", "file", "arquivo", "sem titulo",
]);

/**
 * Origem provável de uma imagem pelo nome do arquivo: `paciente07_corte_012.png`
 * e `paciente07_corte_013.png` são o mesmo exame; `video3-frame-0041.jpg` e
 * `video3-frame-0042.jpg`, o mesmo vídeo.
 *
 * Tira o número final e as palavras de sequência; se sobra só um prefixo
 * genérico de câmera (`IMG_1234`, `DSC0042`), não agrupa, porque fotos soltas do
 * celular são independentes e agrupá-las travaria qualquer projeto.
 */
export function sequenceGroup(name: string): string | null {
  const base = name.replace(/\\/g, "/").split("/").pop()!.replace(/\.[a-z0-9]{2,5}$/i, "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (!/\d+$/.test(base)) return null;
  const prefix = base
    .replace(/\d+$/, "")
    // Só palavras inteiras: letras soltas ("f5", "s18") juntavam nomes sem relação.
    .replace(/[\s._-]*(frame|frames|slice|slices|corte|cortes|fatia|seq|sequence|sequencia|img|image)?[\s._-]*$/i, "")
    .replace(/[\s._-]+$/, "");
  if (prefix.length < 3 || GENERIC_PREFIXES.has(prefix)) return null;
  return `name:${prefix}`;
}

/** FNV-1a de 64 bits em duas metades: estável, síncrono e sem dependências. */
export function stableHash(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0xcbf29ce4;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ code, 0x01000193 ^ 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

export function itemKeyFor(assetId: string): string {
  return `a${stableHash(assetId)}`;
}

export type AdaptiveInstance = {
  annotation: PolygonAnnotation;
  origin: AdaptiveOrigin;
  labelName: string;
};

export type AdaptiveItemPlan = {
  key: string;
  asset: Asset;
  group: string | null;
  instances: AdaptiveInstance[];
  fingerprint: string;
};

export type AdaptiveDatasetPlan = {
  items: AdaptiveItemPlan[];
  /** Instâncias aproveitadas por origem. */
  byOrigin: Record<AdaptiveOrigin, number>;
  /** Anotações deixadas de fora, por motivo. */
  excluded: Record<AdaptiveExclusion, number>;
  usableInstances: number;
};

export type AdaptivePlanOptions = { groupSequences: boolean };

/** Bumped when the payload format changes, so every item is sent again. */
const PAYLOAD_VERSION = 1;

export function planAdaptiveDataset(
  assets: readonly Asset[],
  labels: readonly Label[],
  annotations: readonly EditorAnnotation[],
  options: AdaptivePlanOptions,
): AdaptiveDatasetPlan {
  const byAsset = new Map(assets.map((asset) => [asset.id, asset]));
  const labelNames = new Map(labels.map((label) => [label.id, label.name]));
  const byOrigin: Record<AdaptiveOrigin, number> = { manual: 0, corrected_prediction: 0, reviewed_prediction: 0 };
  const excluded: Record<AdaptiveExclusion, number> = {
    not_a_mask: 0, unverified_prediction: 0, rejected_by_review: 0, image_rejected: 0, too_small: 0, image_missing: 0,
  };
  const instancesByAsset = new Map<string, AdaptiveInstance[]>();
  for (const annotation of annotations) {
    const asset = byAsset.get(annotation.asset);
    if (!asset) continue;
    // Raster em mosaico (COG) não cabe numa imagem só: fica fora desta versão.
    if (asset.raster) { excluded.image_missing += 1; continue; }
    const verdict = classifyAnnotation(annotation, asset);
    if (!verdict.usable) { excluded[verdict.reason] += 1; continue; }
    byOrigin[verdict.origin] += 1;
    const list = instancesByAsset.get(asset.id) ?? [];
    list.push({ annotation: annotation as PolygonAnnotation, origin: verdict.origin, labelName: labelNames.get(annotation.label) ?? annotation.label });
    instancesByAsset.set(asset.id, list);
  }
  const items: AdaptiveItemPlan[] = [];
  for (const asset of assets) {
    const instances = instancesByAsset.get(asset.id);
    if (!instances?.length) continue;
    const group = options.groupSequences ? sequenceGroup(asset.name) : null;
    const fingerprint = stableHash(JSON.stringify([
      PAYLOAD_VERSION, asset.id, asset.name, asset.width, asset.height, asset.byteSize ?? null, group,
      instances.map(({ annotation, origin, labelName }) => [
        annotation.id, annotation.label, labelName, origin,
        annotation.vertices.map((vertex) => [vertex.x, vertex.y]),
        annotation.holes.map((hole) => hole.map((vertex) => [vertex.x, vertex.y])),
      ]),
    ]));
    items.push({ key: itemKeyFor(asset.id), asset, group, instances, fingerprint });
  }
  return {
    items,
    byOrigin,
    excluded,
    usableInstances: items.reduce((sum, item) => sum + item.instances.length, 0),
  };
}

/** Polígonos no espaço da imagem enviada, que pode ser uma cópia reduzida. */
export function buildItemPayload(
  item: AdaptiveItemPlan,
  image: { url: string; sentWidth: number; sentHeight: number; sourceWidth: number; sourceHeight: number },
) {
  const scaleX = image.sentWidth / image.sourceWidth;
  const scaleY = image.sentHeight / image.sourceHeight;
  const flat = (vertices: ReadonlyArray<{ x: number; y: number }>) =>
    vertices.flatMap((vertex) => [Math.round(vertex.x * scaleX * 100) / 100, Math.round(vertex.y * scaleY * 100) / 100]);
  return {
    image: image.url,
    width: image.sentWidth,
    height: image.sentHeight,
    name: item.asset.name,
    group: item.group,
    fingerprint: item.fingerprint,
    instances: item.instances.map(({ annotation, origin, labelName }) => ({
      id: annotation.id,
      label: annotation.label,
      label_name: labelName,
      origin,
      polygons: [flat(annotation.vertices)],
      holes: annotation.holes.map(flat),
    })),
  };
}

/** O que precisa subir, o que mudou e o que sumiu do projeto desde o último envio. */
export function diffAgainstConnector(plan: AdaptiveDatasetPlan, remote: Record<string, string>) {
  const wanted = new Map(plan.items.map((item) => [item.key, item]));
  const upload = plan.items.filter((item) => remote[item.key] !== item.fingerprint);
  const remove = Object.keys(remote).filter((key) => !wanted.has(key));
  return { upload, remove, unchanged: plan.items.length - upload.length };
}

export function newAdaptiveProjectId(): string {
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  return `p-${random.toLowerCase()}`;
}
