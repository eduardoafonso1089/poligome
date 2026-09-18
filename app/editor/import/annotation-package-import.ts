import JSZip from "jszip";
import type { Asset } from "../../lib/types";
import type { CocoDocumentInput } from "./coco-document-import";
import { matchImageReference, type ImageMatchIssue } from "./image-reference-match";
import { parseYoloPackage } from "./yolo-package-import";

export type AnnotationPackageInspection = {
  format: "coco" | "yolo";
  roots: string[];
  document: CocoDocumentInput;
  issues: ImageMatchIssue[];
};

function isCocoDocument(value: unknown): value is CocoDocumentInput {
  if (!value || typeof value !== "object") return false;
  const document = value as CocoDocumentInput;
  return Array.isArray(document.images) && Array.isArray(document.categories) && Array.isArray(document.annotations);
}

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/\/{2,}/g, "/");
}

function unsafeArchivePath(entry: { name: string; unsafeOriginalName?: string }) {
  const original = entry.unsafeOriginalName ?? entry.name;
  const normalized = original.replace(/\\/g, "/");
  return /(^|\/)\.\.(\/|$)/.test(normalized) || /^\//.test(normalized) || /^[a-z]:\//i.test(normalized);
}

function mergeCocoDocuments(documents: CocoDocumentInput[]) {
  const merged: Required<Pick<CocoDocumentInput, "images" | "categories" | "annotations">> = {
    images: [],
    categories: [],
    annotations: [],
  };
  const categoryByName = new Map<string, number>();

  for (const document of documents) {
    const imageIds = new Map<number, number>();
    const categoryIds = new Map<number, number>();
    for (const image of document.images ?? []) {
      if (typeof image.id !== "number") continue;
      const nextId = merged.images.length + 1;
      imageIds.set(image.id, nextId);
      merged.images.push({ ...image, id: nextId });
    }
    for (const category of document.categories ?? []) {
      if (typeof category.id !== "number") continue;
      const name = category.name?.trim() || `#${category.id}`;
      const key = name.toLocaleLowerCase();
      let nextId = categoryByName.get(key);
      if (!nextId) {
        nextId = merged.categories.length + 1;
        categoryByName.set(key, nextId);
        merged.categories.push({ ...category, id: nextId, name });
      }
      categoryIds.set(category.id, nextId);
    }
    for (const annotation of document.annotations ?? []) {
      if (typeof annotation.image_id !== "number") continue;
      const imageId = imageIds.get(annotation.image_id);
      if (!imageId) continue;
      const categoryId = typeof annotation.category_id === "number" ? categoryIds.get(annotation.category_id) : undefined;
      merged.annotations.push({ ...annotation, image_id: imageId, category_id: categoryId });
    }
  }
  return merged;
}

function imageIssues(document: CocoDocumentInput, assets: Asset[]) {
  const issues = new Map<string, ImageMatchIssue>();
  for (const image of document.images ?? []) {
    if (typeof image.file_name !== "string") continue;
    const result = matchImageReference(image.file_name, assets);
    if ("issue" in result) issues.set(`${result.issue.reason}:${normalizePath(result.issue.reference).toLocaleLowerCase()}`, result.issue);
  }
  return [...issues.values()];
}

export async function inspectAnnotationFile(file: File, assets: Asset[]): Promise<AnnotationPackageInspection> {
  if (/\.json$/i.test(file.name) || file.type === "application/json") {
    const document = JSON.parse(await file.text()) as unknown;
    if (!isCocoDocument(document)) throw new Error("annotationPackageUnsupported");
    return { format: "coco", roots: [file.name], document, issues: imageIssues(document, assets) };
  }

  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (entries.some(unsafeArchivePath)) throw new Error("annotationPackageUnsafePath");
  const cocoEntries: Array<{ path: string; document: CocoDocumentInput }> = [];
  for (const entry of entries.filter((candidate) => /\.json$/i.test(candidate.name) && !/poligome-manifest\.json$/i.test(candidate.name))) {
    try {
      const document = JSON.parse(await entry.async("string")) as unknown;
      if (isCocoDocument(document)) cocoEntries.push({ path: normalizePath(entry.name), document });
    } catch {
      // A ZIP may contain unrelated JSON; format detection ignores it.
    }
  }
  if (cocoEntries.length) {
    const document = mergeCocoDocuments(cocoEntries.map((entry) => entry.document));
    return { format: "coco", roots: cocoEntries.map((entry) => entry.path), document, issues: imageIssues(document, assets) };
  }

  const yolo = await parseYoloPackage(zip, assets);
  if (yolo) return { format: "yolo", ...yolo };
  throw new Error("annotationPackageUnsupported");
}
