import JSZip from "jszip";
import type { Asset, Label } from "../../lib/types";
import { rasterTransform, transformPoint } from "../../lib/georeference";
import { toWgs84 } from "../../lib/projections";
import type { EditorAnnotation } from "../models/annotation-model";
import { annotationToCoco, annotationToGeoJsonGeometry, annotationToYolo, buildExportIndexes } from "./annotation-export";

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

function safeBaseName(name: string, fallback: string) {
  const clean = name.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "_");
  return clean || fallback;
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

export async function exportEditorYoloZip(assets: Asset[], labels: Label[], annotations: EditorAnnotation[], readme = "Exported by Poligome") {
  const zip = new JSZip();
  const trainCount = assets.length > 1 ? Math.min(assets.length - 1, Math.max(1, Math.round(assets.length * .8))) : assets.length;
  // Grouped once instead of filtering the whole annotation list per image.
  const { categoryIndexById } = buildExportIndexes(assets, labels);
  const annotationsByAsset = new Map<string, EditorAnnotation[]>();
  for (const annotation of annotations) {
    const bucket = annotationsByAsset.get(annotation.asset);
    if (bucket) bucket.push(annotation);
    else annotationsByAsset.set(annotation.asset, [annotation]);
  }

  for (const [imageIndex, asset] of assets.entries()) {
    if (!asset.src || asset.missing) throw new Error(`Image unavailable for YOLO export: ${asset.name}`);
    const split = imageIndex < trainCount ? "train" : "val";
    const base = `${String(imageIndex + 1).padStart(4, "0")}-${safeBaseName(asset.name, `image_${imageIndex + 1}`)}`;
    const extension = asset.name.match(/\.[a-zA-Z0-9]+$/)?.[0].toLowerCase() ?? ".png";
    const rows = (annotationsByAsset.get(asset.id) ?? [])
      .map((annotation) => annotationToYolo(annotation, labels, asset, categoryIndexById))
      .filter((row): row is string => !!row);
    const response = await fetch(asset.src);
    if (!response.ok) throw new Error(`Could not read image for YOLO export: ${asset.name}`);
    zip.file(`images/${split}/${base}${extension}`, await response.arrayBuffer());
    zip.file(`labels/${split}/${base}.txt`, rows.join("\n"));
  }

  if (assets.some((asset) => asset.geo)) {
    zip.file("georeferences.json", JSON.stringify(assets.filter((asset) => asset.geo).map((asset) => ({ image: asset.name, georeference: asset.geo })), null, 2));
  }
  zip.file("classes.txt", labels.map((label) => label.name).join("\n"));
  const validationPath = assets.length > 1 ? "images/val" : "images/train";
  zip.file("data.yaml", `path: .\ntrain: images/train\nval: ${validationPath}\nnc: ${labels.length}\nnames:\n${labels.map((label, index) => `  ${index}: ${JSON.stringify(label.name)}`).join("\n")}\n`);
  zip.file("README.txt", `${readme}\n`);
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
