import type { Asset, Label } from "../../lib/types";
import type { EditorAnnotation } from "../models/annotation-model";
import {
  cocoAnnotationToEditor,
  cocoGeometryTypes,
  type CocoAnnotationInput,
  type CocoCategoryInput,
  type CocoGeometry,
} from "./coco-import";

export type CocoImageInput = { id?: number; file_name?: string; width?: number; height?: number };
export type CocoDocumentInput = {
  images?: CocoImageInput[];
  categories?: CocoCategoryInput[];
  annotations?: Array<CocoAnnotationInput & { image_id?: number; category_id?: number }>;
};
export type CocoImportCandidate = {
  index: number;
  imageName: string;
  labelName: string;
  geometries: CocoGeometry[];
  imageId: number;
  categoryId?: number;
};
export type CocoDocumentPlan = {
  candidates: CocoImportCandidate[];
  unmatched: number;
  geometryTypes: CocoGeometry[];
};
export type CocoDocumentImportOptions = {
  selectedAnnotationIndexes?: Iterable<number>;
  geometryTypes?: Iterable<CocoGeometry>;
  unlabeledName?: string;
};
export type CocoDocumentPlanOptions = { unlabeledName?: string };
export type CocoDocumentImportResult = { labels: Label[]; annotations: EditorAnnotation[]; imported: number; unmatched: number };

const IMPORT_COLORS = ["#6c8cff", "#d987ff", "#26c6b6", "#ff8a65", "#ffd166", "#7ee081", "#59b0f6", "#f26d9d"];
const ALL_GEOMETRIES: CocoGeometry[] = ["box", "point", "polygon"];

function baseName(name: string) {
  return name.split(/[\\/]/).pop()?.trim().toLocaleLowerCase() ?? "";
}

function names(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && !!item.trim()).map((item) => item.trim()) : [];
}

function documentParts(document: CocoDocumentInput) {
  return {
    images: Array.isArray(document.images) ? document.images : [],
    categories: Array.isArray(document.categories) ? document.categories : [],
    annotations: Array.isArray(document.annotations) ? document.annotations : [],
  };
}

function matchedImages(images: CocoImageInput[], assets: Asset[]) {
  const assetsByName = new Map(assets.map((asset) => [baseName(asset.name), asset]));
  return new Map(images.flatMap((image) => {
    if (typeof image.id !== "number" || typeof image.file_name !== "string") return [];
    const asset = assetsByName.get(baseName(image.file_name));
    return asset ? [[image.id, { image, asset }] as const] : [];
  }));
}

export function planCocoDocument(document: CocoDocumentInput, assets: Asset[], options: CocoDocumentPlanOptions = {}): CocoDocumentPlan {
  const { images, categories, annotations } = documentParts(document);
  const imageById = matchedImages(images, assets);
  const categoryById = new Map(categories.flatMap((category) => typeof category.id === "number" ? [[category.id, category] as const] : []));
  const candidates: CocoImportCandidate[] = [];
  const geometryTypes = new Set<CocoGeometry>();
  let unmatched = 0;

  annotations.forEach((annotation, index) => {
    if (typeof annotation.image_id !== "number") { unmatched += 1; return; }
    const imageEntry = imageById.get(annotation.image_id);
    if (!imageEntry) { unmatched += 1; return; }
    const geometries = cocoGeometryTypes(annotation);
    if (!geometries.length) { unmatched += 1; return; }
    geometries.forEach((geometry) => geometryTypes.add(geometry));
    const category = typeof annotation.category_id === "number" ? categoryById.get(annotation.category_id) : undefined;
    candidates.push({
      index,
      imageId: annotation.image_id,
      categoryId: typeof annotation.category_id === "number" ? annotation.category_id : undefined,
      imageName: imageEntry.image.file_name ?? imageEntry.asset.name,
      labelName: category?.name?.trim() || (typeof annotation.category_id === "number" ? `#${annotation.category_id}` : options.unlabeledName ?? "Unlabeled"),
      geometries,
    });
  });

  return {
    candidates,
    unmatched,
    geometryTypes: ALL_GEOMETRIES.filter((geometry) => geometryTypes.has(geometry)),
  };
}

export function importCocoDocument(
  document: CocoDocumentInput,
  assets: Asset[],
  currentLabels: Label[],
  makeId: (prefix: string) => string,
  options: CocoDocumentImportOptions = {},
): CocoDocumentImportResult {
  const { images, categories, annotations: sourceAnnotations } = documentParts(document);
  const labels = [...currentLabels];
  const annotations: EditorAnnotation[] = [];
  let unmatched = 0;

  const imageById = matchedImages(images, assets);
  const categoryById = new Map(categories.flatMap((category) => typeof category.id === "number" ? [[category.id, category] as const] : []));
  const labelByCategory = new Map<number, Label>();
  const selectedIndexes = options.selectedAnnotationIndexes ? new Set(options.selectedAnnotationIndexes) : null;
  const allowedGeometryTypes = new Set(options.geometryTypes ?? ALL_GEOMETRIES);
  const unlabeledName = options.unlabeledName?.trim() || currentLabels.find((label) => label.id === "unlabeled")?.name || "Unlabeled";

  const ensureLabel = (name: string, preferredPrefix = "label") => {
    const normalized = name.trim() || unlabeledName;
    const existing = labels.find((label) => label.name.toLocaleLowerCase() === normalized.toLocaleLowerCase());
    if (existing) return existing;
    const created: Label = { id: makeId(preferredPrefix), name: normalized, color: IMPORT_COLORS[labels.length % IMPORT_COLORS.length], key: "" };
    labels.push(created);
    return created;
  };

  sourceAnnotations.forEach((input, index) => {
    if (selectedIndexes && !selectedIndexes.has(index)) return;
    if (typeof input.image_id !== "number") { unmatched += 1; return; }
    const imageEntry = imageById.get(input.image_id);
    if (!imageEntry) { unmatched += 1; return; }

    const availableGeometryTypes = cocoGeometryTypes(input);
    const geometryTypes = new Set(availableGeometryTypes.filter((geometry) => allowedGeometryTypes.has(geometry)));
    if (!geometryTypes.size) return;

    const category = typeof input.category_id === "number" ? categoryById.get(input.category_id) : undefined;
    let label: Label;
    if (typeof input.category_id === "number") {
      label = labelByCategory.get(input.category_id) ?? ensureLabel(category?.name?.trim() || `#${input.category_id}`);
      labelByCategory.set(input.category_id, label);
    } else {
      label = ensureLabel(unlabeledName);
    }

    const sourceWidth = Number(imageEntry.image.width ?? imageEntry.asset.width);
    const sourceHeight = Number(imageEntry.image.height ?? imageEntry.asset.height);
    const targetWidth = Number(imageEntry.asset.width);
    const targetHeight = Number(imageEntry.asset.height);
    if (![sourceWidth, sourceHeight, targetWidth, targetHeight].every((value) => Number.isFinite(value) && value > 0)) {
      unmatched += 1;
      return;
    }

    const keypointNames = names(category?.keypoints);
    const converted = cocoAnnotationToEditor(input, {
      assetId: imageEntry.asset.id,
      sourceWidth,
      sourceHeight,
      targetWidth,
      targetHeight,
      labelId: label.id,
      geometryTypes,
      annotationId: () => makeId("annotation"),
      categoryKeypointNames: keypointNames,
      pointLabelId: (name) => ensureLabel(name, "keypoint").id,
    });
    annotations.push(...converted);
    if (!converted.length) unmatched += 1;
  });

  return { labels, annotations, imported: annotations.length, unmatched };
}
