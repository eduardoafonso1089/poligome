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

const YAML_NAMES = new Set(["data.yaml", "data.yml", "dataset.yaml", "dataset.yml"]);

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

export async function parseYoloPackage(zip: JSZip, assets: Asset[]): Promise<ParsedYoloPackage | null> {
  const files = Object.values(zip.files).filter((entry) => !entry.dir);
  const filesByPath = new Map(files.map((entry) => [normalizePath(entry.name).toLocaleLowerCase(), entry]));
  const yamlEntries = files.filter((entry) => YAML_NAMES.has(pathName(entry.name)));
  if (!yamlEntries.length) return null;

  const roots: string[] = [];
  const images: NonNullable<CocoDocumentInput["images"]> = [];
  const categories: NonNullable<CocoDocumentInput["categories"]> = [];
  const annotations: NonNullable<CocoDocumentInput["annotations"]> = [];
  const categoryByName = new Map<string, number>();
  const issues = new Map<string, ImageMatchIssue>();

  for (const yamlEntry of yamlEntries) {
    const root = dirname(yamlEntry.name);
    roots.push(root.replace(/\/$/, ""));
    const config = parseYaml(await yamlEntry.async("string")) as YoloYaml;
    const localClasses = new Map<number, number>();
    for (const [classIndex, rawName] of classNames(config.names)) {
      const name = rawName.trim() || `#${classIndex}`;
      const nameKey = name.toLocaleLowerCase();
      let categoryId = categoryByName.get(nameKey);
      if (!categoryId) {
        categoryId = categories.length + 1;
        categoryByName.set(nameKey, categoryId);
        categories.push({ id: categoryId, name });
      }
      localClasses.set(classIndex, categoryId);
    }
    if (!localClasses.size) throw new Error("yoloMissingClasses");

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
      const match = matchImageReference(reference, assets, { allowStem: true });
      if ("issue" in match) {
        issues.set(issueKey(match.issue), match.issue);
        continue;
      }
      const width = Number(match.asset.width);
      const height = Number(match.asset.height);
      if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
        const issue = { reference, reason: "invalid" as const };
        issues.set(issueKey(issue), issue);
        continue;
      }
      const imageId = images.length + 1;
      images.push({ id: imageId, file_name: reference, width, height });
      const labelPath = labelPathForImage(root, reference);
      const labelEntry = filesByPath.get(labelPath.toLocaleLowerCase());
      if (!labelEntry) continue;
      const rows = (await labelEntry.async("string")).split(/\r?\n/);
      for (let lineIndex = 0; lineIndex < rows.length; lineIndex += 1) {
        const row = rows[lineIndex].trim();
        if (!row) continue;
        const values = row.split(/\s+/).map(Number);
        const classIndex = values[0];
        const coordinates = values.slice(1);
        const categoryId = Number.isInteger(classIndex) ? localClasses.get(classIndex) : undefined;
        const validCoordinates = coordinates.every((value) => Number.isFinite(value) && value >= 0 && value <= 1);
        if (!categoryId || !validCoordinates) {
          const issue = { reference: `${labelPath}:${lineIndex + 1}`, reason: "invalid" as const };
          issues.set(issueKey(issue), issue);
          continue;
        }
        if (values.length === 5) {
          const [centerX, centerY, boxWidth, boxHeight] = coordinates;
          annotations.push({
            image_id: imageId,
            category_id: categoryId,
            bbox: [(centerX - boxWidth / 2) * width, (centerY - boxHeight / 2) * height, boxWidth * width, boxHeight * height],
          });
          continue;
        }
        if (values.length >= 7 && values.length % 2 === 1) {
          const points = coordinates.map((value, index) => value * (index % 2 === 0 ? width : height));
          annotations.push({ image_id: imageId, category_id: categoryId, segmentation: [points], area: polygonArea(points) } as NonNullable<CocoDocumentInput["annotations"]>[number]);
          continue;
        }
        const issue = { reference: `${labelPath}:${lineIndex + 1}`, reason: "invalid" as const };
        issues.set(issueKey(issue), issue);
      }
    }
  }

  return { roots, document: { images, categories, annotations }, issues: [...issues.values()] };
}
