import type JSZip from "jszip";
import { parse as parseYaml } from "yaml";
import type { Asset } from "../../lib/types";
import type { CocoDocumentInput } from "./coco-document-import";
import { matchImageReference, type ImageMatchIssue } from "./image-reference-match";

type YoloYaml = {
  names?: unknown;
  train?: unknown;
  val?: unknown;
  test?: unknown;
};

export type ParsedYoloPackage = {
  roots: string[];
  document: CocoDocumentInput;
  issues: ImageMatchIssue[];
};

export type YoloLabelFile = { path: string; text: string };

const YAML_NAMES = new Set(["data.yaml", "data.yml", "dataset.yaml", "dataset.yml"]);
const CLASS_LIST_NAMES = new Set(["classes.txt", "obj.names", "classes.names"]);
// Split lists and the README the exporter writes sit next to the labels and are
// not annotations. Reading them as rows would report every line as invalid.
const NON_LABEL_NAMES = new Set(["train.txt", "val.txt", "valid.txt", "test.txt", "readme.txt", "images.txt"]);

function normalizePath(value: string) {
  return value.trim().replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/\/{2,}/g, "/");
}

function pathName(path: string) {
  return normalizePath(path).split("/").pop()?.toLocaleLowerCase() ?? "";
}

function dirname(path: string) {
  const normalized = normalizePath(path);
  const slash = normalized.lastIndexOf("/");
  return slash < 0 ? "" : `${normalized.slice(0, slash + 1)}`;
}

function imageStem(path: string) {
  const name = normalizePath(path).split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function classNames(value: unknown) {
  if (Array.isArray(value)) return value.map((name, index) => [index, String(name)] as const);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([index, name]) => /^\d+$/.test(index) ? [[Number(index), String(name)] as const] : []);
}

function classListNames(text: string) {
  return text.split(/\r?\n/).map((line) => line.trim())
    .flatMap((name, index) => name ? [[index, name] as const] : []);
}

function stringPaths(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (Array.isArray(value)) return value.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim()] : []);
  return [];
}

function labelPathForImage(root: string, imageReference: string) {
  let relative = normalizePath(imageReference);
  if (root && relative.toLocaleLowerCase().startsWith(root.toLocaleLowerCase())) relative = relative.slice(root.length);
  relative = relative.replace(/^images\//i, "labels/");
  const dot = relative.lastIndexOf(".");
  if (dot > relative.lastIndexOf("/")) relative = relative.slice(0, dot);
  return `${root}${relative}.txt`;
}

/** The image a label file belongs to: YOLO pairs them by directory and stem. */
function imageReferenceForLabel(labelPath: string) {
  return normalizePath(labelPath).replace(/(^|\/)labels\//i, "$1images/").replace(/\.txt$/i, "");
}

/** Everything before the `labels/` segment, so a package can carry several roots. */
function labelRoot(labelPath: string) {
  const normalized = normalizePath(labelPath);
  const match = /(^|\/)labels\//i.exec(normalized);
  return match ? normalized.slice(0, match.index + (match[1] ? 1 : 0)) : dirname(normalized);
}

function issueKey(issue: ImageMatchIssue) {
  return `${issue.reason}:${normalizePath(issue.reference).toLocaleLowerCase()}`;
}

function polygonArea(points: number[]) {
  let area = 0;
  for (let index = 0; index < points.length; index += 2) {
    const next = (index + 2) % points.length;
    area += points[index] * points[next + 1] - points[next] * points[index + 1];
  }
  return Math.abs(area / 2);
}

type YoloContext = {
  images: NonNullable<CocoDocumentInput["images"]>;
  categories: NonNullable<CocoDocumentInput["categories"]>;
  annotations: NonNullable<CocoDocumentInput["annotations"]>;
  categoryByName: Map<string, number>;
  issues: Map<string, ImageMatchIssue>;
};

function createContext(): YoloContext {
  return { images: [], categories: [], annotations: [], categoryByName: new Map(), issues: new Map() };
}

function categoryFor(context: YoloContext, name: string) {
  const key = name.toLocaleLowerCase();
  const existing = context.categoryByName.get(key);
  if (existing) return existing;
  const id = context.categories.length + 1;
  context.categoryByName.set(key, id);
  context.categories.push({ id, name });
  return id;
}

/**
 * Class names declared by the package, mapped onto merged category ids. A
 * package that declares none maps `null`, and each class index then becomes a
 * category named after the index itself: a dataset whose images and labels
 * arrive without `data.yaml` or `classes.txt` still imports, and the classes can
 * be renamed in the editor afterwards.
 */
function declaredClasses(context: YoloContext, entries: ReadonlyArray<readonly [number, string]>) {
  const classes = new Map<number, number>();
  for (const [index, rawName] of entries) classes.set(index, categoryFor(context, rawName.trim() || `#${index}`));
  return classes;
}

function noteIssue(context: YoloContext, reference: string, reason: ImageMatchIssue["reason"]) {
  const issue = { reference, reason };
  context.issues.set(issueKey(issue), issue);
}

function addLabelRows(context: YoloContext, options: {
  text: string;
  labelPath: string;
  imageId: number;
  width: number;
  height: number;
  classes: Map<number, number> | null;
}) {
  const { text, labelPath, imageId, width, height, classes } = options;
  const rows = text.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < rows.length; lineIndex += 1) {
    const row = rows[lineIndex].trim();
    if (!row) continue;
    const values = row.split(/\s+/).map(Number);
    const classIndex = values[0];
    const coordinates = values.slice(1);
    const categoryId = Number.isInteger(classIndex)
      ? classes ? classes.get(classIndex) : categoryFor(context, String(classIndex))
      : undefined;
    const validCoordinates = coordinates.length > 0 && coordinates.every((value) => Number.isFinite(value) && value >= 0 && value <= 1);
    if (!categoryId || !validCoordinates) {
      noteIssue(context, `${labelPath}:${lineIndex + 1}`, "invalid");
      continue;
    }
    if (values.length === 5) {
      const [centerX, centerY, boxWidth, boxHeight] = coordinates;
      context.annotations.push({
        image_id: imageId,
        category_id: categoryId,
        bbox: [(centerX - boxWidth / 2) * width, (centerY - boxHeight / 2) * height, boxWidth * width, boxHeight * height],
      });
      continue;
    }
    if (values.length >= 7 && values.length % 2 === 1) {
      const points = coordinates.map((value, index) => value * (index % 2 === 0 ? width : height));
      context.annotations.push({ image_id: imageId, category_id: categoryId, segmentation: [points], area: polygonArea(points) } as NonNullable<CocoDocumentInput["annotations"]>[number]);
      continue;
    }
    noteIssue(context, `${labelPath}:${lineIndex + 1}`, "invalid");
  }
}

/** Register the loaded image a reference points at, or record why it cannot. */
function addImage(context: YoloContext, reference: string, assets: Asset[]) {
  const match = matchImageReference(reference, assets, { allowStem: true });
  if ("issue" in match) {
    context.issues.set(issueKey(match.issue), match.issue);
    return null;
  }
  const width = Number(match.asset.width);
  const height = Number(match.asset.height);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    noteIssue(context, reference, "invalid");
    return null;
  }
  const id = context.images.length + 1;
  // The loaded image's own name, not the package reference: a label file pairs
  // with an image by stem, and the planner downstream matches by name.
  context.images.push({ id, file_name: match.asset.name, width, height });
  return { id, width, height };
}

function finish(context: YoloContext, roots: string[]): ParsedYoloPackage {
  return {
    roots,
    document: { images: context.images, categories: context.categories, annotations: context.annotations },
    issues: [...context.issues.values()],
  };
}

async function parseYamlRoots(zip: JSZip, assets: Asset[], context: YoloContext, yamlEntries: JSZip.JSZipObject[]) {
  const files = Object.values(zip.files).filter((entry) => !entry.dir);
  const filesByPath = new Map(files.map((entry) => [normalizePath(entry.name).toLocaleLowerCase(), entry]));
  const roots: string[] = [];

  for (const yamlEntry of yamlEntries) {
    const root = dirname(yamlEntry.name);
    roots.push(root.replace(/\/$/, ""));
    const config = parseYaml(await yamlEntry.async("string")) as YoloYaml;
    const classList = filesByPath.get(`${root}classes.txt`.toLocaleLowerCase());
    const declared = classNames(config.names);
    // `classes.txt` is the conventional companion file; it stands in when the
    // YAML carries no names of its own.
    const classes = declaredClasses(context, declared.length || !classList ? declared : classListNames(await classList.async("string")));
    if (!classes.size) throw new Error("yoloMissingClasses");

    const imageReferences: string[] = [];
    for (const split of ["train", "val", "test"] as const) {
      for (const configuredPath of stringPaths(config[split])) {
        const normalizedConfigured = normalizePath(configuredPath);
        if (/\.txt$/i.test(normalizedConfigured)) {
          const listEntry = filesByPath.get(`${root}${normalizedConfigured}`.toLocaleLowerCase());
          if (!listEntry) continue;
          const list = (await listEntry.async("string")).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
          imageReferences.push(...list);
          continue;
        }
        const imageDirectory = `${root}${normalizedConfigured.replace(/\/$/, "")}/`.toLocaleLowerCase();
        const archiveImages = files.filter((entry) => normalizePath(entry.name).toLocaleLowerCase().startsWith(imageDirectory));
        imageReferences.push(...archiveImages.map((entry) => normalizePath(entry.name).slice(root.length)));
        if (!archiveImages.length) {
          const labelDirectory = `${root}${normalizedConfigured.replace(/\/$/, "").replace(/^images\//i, "labels/")}/`.toLocaleLowerCase();
          imageReferences.push(...files.filter((entry) => normalizePath(entry.name).toLocaleLowerCase().startsWith(labelDirectory) && /\.txt$/i.test(entry.name))
            .map((entry) => `${normalizedConfigured.replace(/\/$/, "")}/${imageStem(entry.name)}`));
        }
      }
    }

    for (const reference of Array.from(new Set(imageReferences.map(normalizePath)))) {
      const image = addImage(context, reference, assets);
      if (!image) continue;
      const labelPath = labelPathForImage(root, reference);
      const labelEntry = filesByPath.get(labelPath.toLocaleLowerCase());
      if (!labelEntry) continue;
      addLabelRows(context, {
        text: await labelEntry.async("string"),
        labelPath,
        imageId: image.id,
        width: image.width,
        height: image.height,
        classes,
      });
    }
  }
  return finish(context, roots);
}

/**
 * A dataset laid out as `images/` and `labels/` with no `data.yaml`. This is how
 * most YOLO datasets travel, so the label files themselves are the evidence:
 * one root per `labels/` directory, class names from `classes.txt` when the
 * package carries one.
 */
async function parseConventionalRoots(zip: JSZip, assets: Asset[], context: YoloContext) {
  const files = Object.values(zip.files).filter((entry) => !entry.dir);
  const labelEntries = files.filter((entry) => /\.txt$/i.test(entry.name)
    && !CLASS_LIST_NAMES.has(pathName(entry.name))
    && !NON_LABEL_NAMES.has(pathName(entry.name)));
  if (!labelEntries.length) return null;

  const byRoot = new Map<string, JSZip.JSZipObject[]>();
  for (const entry of labelEntries) {
    const root = labelRoot(entry.name);
    byRoot.set(root, [...(byRoot.get(root) ?? []), entry]);
  }

  const classListEntry = files.find((entry) => CLASS_LIST_NAMES.has(pathName(entry.name)));
  const classes = classListEntry ? declaredClasses(context, classListNames(await classListEntry.async("string"))) : null;
  const imagePaths = files.filter((entry) => !/\.txt$/i.test(entry.name)).map((entry) => normalizePath(entry.name));

  for (const [root, entries] of byRoot) {
    for (const entry of entries) {
      const labelPath = normalizePath(entry.name);
      const reference = imageReferenceForLabel(labelPath);
      // A ZIP that ships its images names them exactly; otherwise the label
      // path carries the stem, which still matches a loaded image.
      const bundled = imagePaths.find((path) => path.toLocaleLowerCase().startsWith(`${reference.toLocaleLowerCase()}.`));
      const image = addImage(context, (bundled ?? reference).slice(root.length), assets);
      if (!image) continue;
      addLabelRows(context, {
        text: await entry.async("string"),
        labelPath,
        imageId: image.id,
        width: image.width,
        height: image.height,
        classes,
      });
    }
  }
  return finish(context, [...byRoot.keys()].map((root) => root.replace(/\/$/, "")));
}

export async function parseYoloPackage(zip: JSZip, assets: Asset[]): Promise<ParsedYoloPackage | null> {
  const files = Object.values(zip.files).filter((entry) => !entry.dir);
  const yamlEntries = files.filter((entry) => YAML_NAMES.has(pathName(entry.name)));
  const context = createContext();
  if (yamlEntries.length) return parseYamlRoots(zip, assets, context, yamlEntries);
  return parseConventionalRoots(zip, assets, context);
}

/**
 * Label files chosen directly, without an archive around them: the user selects
 * the contents of a `labels/` folder, optionally with `classes.txt`. Each label
 * is paired with the loaded image that shares its stem.
 */
export function parseYoloLabelFiles(inputs: YoloLabelFile[], assets: Asset[]): ParsedYoloPackage | null {
  const labels = inputs.filter((input) => !CLASS_LIST_NAMES.has(pathName(input.path)) && !NON_LABEL_NAMES.has(pathName(input.path)));
  if (!labels.length) return null;

  const context = createContext();
  const classList = inputs.find((input) => CLASS_LIST_NAMES.has(pathName(input.path)));
  const classes = classList ? declaredClasses(context, classListNames(classList.text)) : null;

  for (const label of labels) {
    const labelPath = normalizePath(label.path);
    const image = addImage(context, imageReferenceForLabel(labelPath), assets);
    if (!image) continue;
    addLabelRows(context, {
      text: label.text,
      labelPath,
      imageId: image.id,
      width: image.width,
      height: image.height,
      classes,
    });
  }
  return finish(context, labels.map((label) => normalizePath(label.path)));
}
