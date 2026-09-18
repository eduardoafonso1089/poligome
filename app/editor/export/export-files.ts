import JSZip from "jszip";
import type { Asset, Label } from "../../lib/types";
import { rasterTransform, transformPoint } from "../../lib/georeference";
import { toWgs84 } from "../../lib/projections";
import type { EditorAnnotation } from "../models/annotation-model";
import { annotationToCoco, annotationToGeoJsonGeometry, annotationToYolo, buildExportIndexes } from "./annotation-export";
import { buildAnnotationPackageManifest } from "./annotation-package-manifest";
import { assignDatasetSplits, splitAssets, type DatasetSplitAssignment, type ExportSplitOptions } from "./dataset-split";

export type { ExportSplitOptions } from "./dataset-split";

function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  window.setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 1500);
}

export function buildCocoDocument(assets: Asset[], labels: Label[], annotations: EditorAnnotation[]) {
  const indexes = buildExportIndexes(assets, labels);
  return {
    info: { description: "Poligome dataset", version: "1.0" },
    images: assets.map((asset, index) => ({
      id: index + 1,
      file_name: asset.name,
      width: asset.width ?? 0,
      height: asset.height ?? 0,
      ...(asset.geo ? { georeference: asset.geo } : {}),
    })),
    categories: labels.map((label, index) => ({ id: index + 1, name: label.name, supercategory: "object" })),
    annotations: annotations.map((annotation, index) => annotationToCoco(annotation, index, assets, labels, indexes)),
  };
}

export function exportEditorCoco(assets: Asset[], labels: Label[], annotations: EditorAnnotation[]) {
  const document = buildCocoDocument(assets, labels, annotations);
  downloadBlob("poligome-coco.json", new Blob([JSON.stringify(document, null, 2)], { type: "application/json;charset=utf-8" }));
  return document;
}

export async function buildCocoArchive(
  assets: Asset[],
  labels: Label[],
  annotations: EditorAnnotation[],
  options: ExportSplitOptions,
  random: () => number = Math.random,
) {
  const zip = new JSZip();
  if (options.splitDataset === false) {
    zip.file("annotations/instances.json", JSON.stringify(buildCocoDocument(assets, labels, annotations), null, 2));
    zip.file("poligome-manifest.json", JSON.stringify(buildAnnotationPackageManifest(assets, null, "coco", "mixed"), null, 2));
    zip.file("README.txt", "COCO annotation package exported by Poligome. Images are intentionally not included; use the file_name fields to pair them separately.\n");
    return zip;
  }
  const assignment = assignDatasetSplits(assets, annotations, options, random);
  const splits = splitAssets(assignment, assets);
  const splitNames = options.includeTest ? ["train", "val", "test"] as const : ["train", "val"] as const;
  for (const split of splitNames) {
    const splitItems = splits[split] ?? [];
    const ids = new Set(splitItems.map((asset) => asset.id));
    zip.file(`annotations/instances_${split}.json`, JSON.stringify(buildCocoDocument(splitItems, labels, annotations.filter((annotation) => ids.has(annotation.asset))), null, 2));
  }
  zip.file("poligome-manifest.json", JSON.stringify(buildAnnotationPackageManifest(assets, assignment, "coco", "mixed"), null, 2));
  zip.file("README.txt", "COCO annotation package exported by Poligome. Images are intentionally not included; use the file_name fields to pair them separately.\n");
  return zip;
}

export async function exportEditorCocoZip(assets: Asset[], labels: Label[], annotations: EditorAnnotation[], options: ExportSplitOptions) {
  const zip = await buildCocoArchive(assets, labels, annotations, options);
  const archive = await zip.generateAsync({ type: "blob" });
  downloadBlob("poligome-coco.zip", archive);
  return archive;
}

export type YoloExportOptions = ExportSplitOptions & { mode: "bbox" | "polygon" | "both" };

export const defaultYoloExportOptions: YoloExportOptions = {
  mode: "bbox", train: 80, val: 20, test: 0, includeTest: false, strategy: "random",
};

export function splitExportAssets(assets: Asset[], annotations: EditorAnnotation[], options: ExportSplitOptions) {
  return splitAssets(assignDatasetSplits(assets, annotations, options), assets);
}

function yoloReadme(readme: string, mode: "bbox" | "polygon") {
  return `${readme}\nThis archive intentionally contains annotations only; Poligome does not export images.\nYOLO mode: ${mode}. Supply the matching images separately.\n`;
}

function imageFileName(name: string, fallback: string) {
  const fileName = name.split(/[\\/]/).pop()?.trim().replace(/[\u0000-\u001f]/g, "");
  return fileName && fileName !== "." && fileName !== ".." ? fileName : fallback;
}

function imageStem(name: string, fallback: string) {
  const fileName = imageFileName(name, fallback);
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

function writeYoloDataset(
  zip: JSZip,
  root: string,
  assets: Asset[],
  labels: Label[],
  annotations: EditorAnnotation[],
  assignment: DatasetSplitAssignment,
  options: ExportSplitOptions,
  mode: "bbox" | "polygon",
  readme: string,
) {
  const { categoryIndexById } = buildExportIndexes(assets, labels);
  const splitDataset = options.splitDataset !== false;
  const splits = splitAssets(assignment, assets);
  const splitNames = options.includeTest ? ["train", "val", "test"] as const : ["train", "val"] as const;
  const groups = splitDataset
    ? splitNames.map((split) => ({ items: splits[split] ?? [], labelDirectory: `${split}/`, listPath: `${split}.txt`, imageDirectory: `${split}/` }))
    : [{ items: assets, labelDirectory: "", listPath: "images.txt", imageDirectory: "" }];
  for (const group of groups) {
    const labelPaths = new Set<string>();
    const imageReferences: string[] = [];
    for (const asset of group.items) {
      const imageIndex = assets.indexOf(asset);
      const fileName = imageFileName(asset.name, `image-${imageIndex + 1}`);
      const stem = imageStem(fileName, `image-${imageIndex + 1}`);
      const labelPath = `${root}labels/${group.labelDirectory}${stem}.txt`;
      const collisionKey = labelPath.toLocaleLowerCase();
      if (labelPaths.has(collisionKey)) throw new Error("yoloDuplicateLabelPath");
      labelPaths.add(collisionKey);
      imageReferences.push(`images/${group.imageDirectory}${fileName}`);
      const rows = annotations.filter((annotation) => annotation.asset === asset.id && (mode === "bbox" ? annotation.type === "box" : annotation.type === "polygon"))
        .map((annotation) => annotationToYolo(annotation, labels, asset, categoryIndexById)).filter((row): row is string => !!row);
      if (rows.length) zip.file(labelPath, rows.join("\n"));
    }
    zip.file(`${root}${group.listPath}`, imageReferences.length ? `${imageReferences.join("\n")}\n` : "");
  }
  zip.file(`${root}classes.txt`, labels.map((label) => label.name).join("\n"));
  const splitConfig = splitDataset
    ? `train: train.txt\nval: val.txt\n${options.includeTest ? "test: test.txt\n" : ""}`
    : "train: images.txt\n";
  zip.file(`${root}data.yaml`, `path: .\n${splitConfig}nc: ${labels.length}\nnames:\n${labels.map((label, index) => `  ${index}: ${JSON.stringify(label.name)}`).join("\n")}\n`);
  zip.file(`${root}poligome-manifest.json`, JSON.stringify(buildAnnotationPackageManifest(assets, splitDataset ? assignment : null, "yolo", mode), null, 2));
  zip.file(`${root}README.txt`, yoloReadme(readme, mode));
}

export async function buildYoloArchive(
  assets: Asset[],
  labels: Label[],
  annotations: EditorAnnotation[],
  options: YoloExportOptions = defaultYoloExportOptions,
  random: () => number = Math.random,
) {
  const zip = new JSZip();
  const assignment = assignDatasetSplits(assets, annotations, options, random);
  if (options.mode === "both") {
    writeYoloDataset(zip, "bbox/", assets, labels, annotations, assignment, options, "bbox", "Exported by Poligome");
    writeYoloDataset(zip, "polygon/", assets, labels, annotations, assignment, options, "polygon", "Exported by Poligome");
  } else writeYoloDataset(zip, "", assets, labels, annotations, assignment, options, options.mode, "Exported by Poligome");
  return zip;
}

export async function exportEditorYoloZip(assets: Asset[], labels: Label[], annotations: EditorAnnotation[], readme = "Exported by Poligome", options: YoloExportOptions = defaultYoloExportOptions) {
  const zip = await buildYoloArchive(assets, labels, annotations, options);
  for (const path of Object.keys(zip.files).filter((path) => path.endsWith("README.txt"))) {
    const mode = path.startsWith("polygon/") || options.mode === "polygon" ? "polygon" : "bbox";
    zip.file(path, yoloReadme(readme, mode));
  }
  const archive = await zip.generateAsync({ type: "blob" });
  downloadBlob("poligome-yolo.zip", archive);
  return archive;
}

function signedArea(ring: number[][]) {
  let area = 0;
  for (let index = 0; index + 1 < ring.length; index += 1) area += ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1];
  return area / 2;
}

function orientPolygon(coordinates: number[][][]) {
  coordinates.forEach((ring, index) => {
    const area = signedArea(ring);
    if ((index === 0 && area < 0) || (index > 0 && area > 0)) ring.reverse();
  });
}

function finitePair(value: readonly number[]) {
  return value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]);
}

export function buildGeoJson(assets: Asset[], labels: Label[], annotations: EditorAnnotation[]) {
  const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
  const labelMap = new Map(labels.map((label) => [label.id, label]));
  const projections = new Map<string, ReturnType<typeof toWgs84>>();
  const transforms = new Map<string, ReturnType<typeof rasterTransform>>();

  const features = annotations.map((annotation) => {
    const asset = assetMap.get(annotation.asset);
    if (!asset?.geo) throw new Error("rasterMissingReference");
    const width = Number(asset.width);
    const height = Number(asset.height);
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) throw new Error("rasterInvalidReference");
    const geo = asset.geo;
    if (!projections.has(geo.crs)) projections.set(geo.crs, toWgs84(geo.crs));
    let transform = transforms.get(asset.id);
    if (!transform) {
      transform = rasterTransform(geo);
      transforms.set(asset.id, transform);
    }
    const project = (x: number, y: number): [number, number] => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("rasterInvalidCoordinates");
      const native = transformPoint(
        transform,
        geo.window.x + x / width * geo.window.w,
        geo.window.y + y / height * geo.window.h,
      );
      if (!finitePair(native)) throw new Error("rasterInvalidCoordinates");
      const projected = projections.get(geo.crs)!(native);
      if (!finitePair(projected)) throw new Error("rasterInvalidCoordinates");
      return [projected[0], projected[1]];
    };
    const geometry = annotationToGeoJsonGeometry(annotation, project) as { type: string; coordinates: unknown };
    if (geometry.type === "Polygon") orientPolygon(geometry.coordinates as number[][][]);
    const label = labelMap.get(annotation.label);
    return {
      type: "Feature",
      geometry,
      // Breaking change: these were Portuguese (classe, cor, forma, rotacao,
      // recorte, origem) up to and including the 1.0 export. Documented in
      // docs/RASTER_WORKFLOW.md; QGIS styles keyed on the old names need updating.
      properties: {
        id: annotation.id,
        class: label?.name ?? annotation.label,
        class_id: annotation.label,
        color: label?.color ?? null,
        shape: annotation.type,
        rotation: annotation.type === "box" ? annotation.rotation ?? 0 : undefined,
        source_image: asset.name,
        source_raster: geo.source,
        crs: geo.crs,
      },
    };
  });

  return { type: "FeatureCollection", features } as const;
}

export function exportEditorGeoJson(assets: Asset[], labels: Label[], annotations: EditorAnnotation[]) {
  const document = buildGeoJson(assets, labels, annotations);
  downloadBlob("poligome-annotations.geojson", new Blob([JSON.stringify(document, null, 2)], { type: "application/geo+json;charset=utf-8" }));
  return document;
}
