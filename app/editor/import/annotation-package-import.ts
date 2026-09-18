import JSZip from "jszip";
import type { Asset } from "../../lib/types";
import type { CocoDocumentInput } from "./coco-document-import";
import { matchImageReference, type ImageMatchIssue } from "./image-reference-match";
import { parseYoloLabelFiles, parseYoloPackage, type YoloLabelFile } from "./yolo-package-import";

export type AnnotationPackageFormat = "coco" | "yolo" | "mixed";

export type AnnotationPackageInspection = {
  format: AnnotationPackageFormat;
  roots: string[];
  document: CocoDocumentInput;
  issues: ImageMatchIssue[];
};

type CocoAnnotation = NonNullable<CocoDocumentInput["annotations"]>[number];

function isCocoAnnotation(value: unknown): value is CocoAnnotation {
  if (!value || typeof value !== "object") return false;
  const annotation = value as CocoAnnotation;
  return Array.isArray(annotation.bbox) || Array.isArray(annotation.segmentation) || Array.isArray(annotation.keypoints);
}

/**
 * The COCO a dataset actually ships, not only the complete document: the
 * `images` and `categories` arrays are what a tool writes when it exports the
 * whole dataset, and a per-image file or a results array carries neither. The
 * annotations are the part that always exists, so they are what detection
 * requires; `completeCocoDocument` fills the rest in.
 */
function cocoDocumentFrom(value: unknown): CocoDocumentInput | null {
  if (Array.isArray(value)) {
    const annotations = value.filter(isCocoAnnotation);
    return annotations.length ? { annotations } : null;
  }
  if (!value || typeof value !== "object") return null;
  const document = value as CocoDocumentInput;
  if (!Array.isArray(document.annotations)) return null;
  const images = Array.isArray(document.images) ? document.images : undefined;
  if (!images && !document.annotations.some(isCocoAnnotation)) return null;
  return {
    ...(images ? { images } : {}),
    ...(Array.isArray(document.categories) ? { categories: document.categories } : {}),
    annotations: document.annotations,
  };
}

/**
 * Supply what the document leaves out, the way the YOLO side does:
 *
 * - No `images`: the file itself names the image, so a per-image JSON pairs by
 *   its own stem with a loaded image, and every annotation belongs to it.
 * - No `categories`: each class id becomes a class named after the id, which
 *   keeps the annotations instead of dropping their class.
 *
 * A reference that matches is stored under the loaded image's own name, because
 * the planner downstream matches by name rather than by stem.
 */
function completeCocoDocument(document: CocoDocumentInput, source: string, assets: Asset[]): CocoDocumentInput {
  const annotations = document.annotations ?? [];
  const categories = document.categories?.length
    ? document.categories
    : [...new Set(annotations.flatMap((annotation) => typeof annotation.category_id === "number" ? [annotation.category_id] : []))]
      .map((id) => ({ id, name: String(id) }));

  if (document.images?.length) return { ...document, categories };

  const reference = normalizePath(source).replace(/\.json$/i, "");
  const match = matchImageReference(reference, assets, { allowStem: true });
  const imageId = 1;
  return {
    images: [{ id: imageId, file_name: "asset" in match ? match.asset.name : reference }],
    categories,
    annotations: annotations.map((annotation) => ({ ...annotation, image_id: imageId })),
  };
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

const LOOSE_LABEL = /\.(txt|names)$/i;

function issueKey(issue: ImageMatchIssue) {
  return `${issue.reason}:${normalizePath(issue.reference).toLocaleLowerCase()}`;
}

/**
 * One file or a whole selection: a package ZIP, a COCO document, or the loose
 * label files of a `labels/` folder — in any combination, in one import. Every
 * part is read on its own and the results are merged into a single document, so
 * the review modal reports one set of matched, missing and ambiguous images.
 */
export async function inspectAnnotationFiles(files: File[], assets: Asset[]): Promise<AnnotationPackageInspection> {
  const parts: AnnotationPackageInspection[] = [];
  const looseLabels: YoloLabelFile[] = [];
  const failures: unknown[] = [];

  for (const file of files) {
    if (LOOSE_LABEL.test(file.name)) {
      looseLabels.push({ path: file.name, text: await file.text() });
      continue;
    }
    // One unreadable file among many must not lose the rest of the selection;
    // its error is only raised when nothing at all could be read.
    try {
      parts.push(await inspectAnnotationFile(file, assets));
    } catch (error) {
      failures.push(error);
    }
  }

  if (looseLabels.length) {
    const parsed = parseYoloLabelFiles(looseLabels, assets);
    if (parsed) parts.push({ format: "yolo", ...parsed });
  }

  if (!parts.length) throw failures[0] ?? new Error("annotationPackageUnsupported");
  if (parts.length === 1) return parts[0];

  const formats = new Set(parts.map((part) => part.format));
  const issues = new Map(parts.flatMap((part) => part.issues).map((issue) => [issueKey(issue), issue]));
  return {
    format: formats.size === 1 ? [...formats][0] : "mixed",
    roots: parts.flatMap((part) => part.roots),
    document: mergeCocoDocuments(parts.map((part) => part.document)),
    issues: [...issues.values()],
  };
}

export async function inspectAnnotationFile(file: File, assets: Asset[]): Promise<AnnotationPackageInspection> {
  if (LOOSE_LABEL.test(file.name)) {
    const parsed = parseYoloLabelFiles([{ path: file.name, text: await file.text() }], assets);
    if (!parsed) throw new Error("annotationPackageUnsupported");
    return { format: "yolo", ...parsed };
  }

  if (/\.json$/i.test(file.name) || file.type === "application/json") {
    const parsed = cocoDocumentFrom(JSON.parse(await file.text()) as unknown);
    if (!parsed) throw new Error("annotationPackageUnsupported");
    const document = completeCocoDocument(parsed, file.name, assets);
    return { format: "coco", roots: [file.name], document, issues: imageIssues(document, assets) };
  }

  // Anything that is not a readable archive is reported as an unsupported
  // package, rather than leaking JSZip's own wording into the interface.
  const zip = await JSZip.loadAsync(await file.arrayBuffer()).catch(() => { throw new Error("annotationPackageUnsupported"); });
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (entries.some(unsafeArchivePath)) throw new Error("annotationPackageUnsafePath");
  const cocoEntries: Array<{ path: string; document: CocoDocumentInput }> = [];
  for (const entry of entries.filter((candidate) => /\.json$/i.test(candidate.name) && !/poligome-manifest\.json$/i.test(candidate.name))) {
    try {
      const path = normalizePath(entry.name);
      const parsed = cocoDocumentFrom(JSON.parse(await entry.async("string")) as unknown);
      // Each document is completed against its own path, so a folder of
      // per-image files pairs each one with the image it is named after.
      if (parsed) cocoEntries.push({ path, document: completeCocoDocument(parsed, path, assets) });
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
