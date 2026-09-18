import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { cocoGeometryTypes } from "../app/editor/import/coco-import.ts";
import { inspectAnnotationFile } from "../app/editor/import/annotation-package-import.ts";

const assets = [{ id: "photo", name: "photo.jpg", src: "", width: 200, height: 100 }];

async function asZipFile(zip, name = "dataset.zip") {
  return new File([await zip.generateAsync({ type: "uint8array" })], name, { type: "application/zip" });
}

function addRoot(zip, root, row) {
  zip.file(`${root}data.yaml`, [
    "path: .",
    "train: train.txt",
    "val: val.txt",
    "names:",
    "  0: Plant",
    "",
  ].join("\n"));
  zip.file(`${root}train.txt`, "images/train/photo.jpg\n");
  zip.file(`${root}val.txt`, "");
  zip.file(`${root}labels/train/photo.txt`, `${row}\n`);
}

test("imports a standard YOLO detection ZIP without a Poligome manifest", async () => {
  const zip = new JSZip();
  addRoot(zip, "", "0 0.5 0.5 0.4 0.2");

  const result = await inspectAnnotationFile(await asZipFile(zip), assets);

  assert.equal(result.format, "yolo");
  assert.deepEqual(result.roots, [""]);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.document.categories, [{ id: 1, name: "Plant" }]);
  assert.deepEqual(result.document.annotations?.[0].bbox, [60, 40, 80, 20]);
});

test("detects separate bbox and polygon YOLO roots", async () => {
  const zip = new JSZip();
  addRoot(zip, "bbox/", "0 0.5 0.5 0.4 0.2");
  addRoot(zip, "polygon/", "0 0.1 0.1 0.9 0.1 0.9 0.9");

  const result = await inspectAnnotationFile(await asZipFile(zip, "both.zip"), assets);

  assert.deepEqual(result.roots, ["bbox", "polygon"]);
  assert.deepEqual(result.document.annotations?.map(cocoGeometryTypes), [["box"], ["polygon"]]);
});

test("YOLO ZIP warns once for an image that is not loaded", async () => {
  const zip = new JSZip();
  addRoot(zip, "bbox/", "0 0.5 0.5 0.4 0.2");
  addRoot(zip, "polygon/", "0 0.1 0.1 0.9 0.1 0.9 0.9");

  const result = await inspectAnnotationFile(await asZipFile(zip), []);

  assert.deepEqual(result.issues, [{ reference: "images/train/photo.jpg", reason: "missing" }]);
  assert.equal(result.document.annotations?.length, 0);
});

test("infers image references from labels when YAML points to an image directory", async () => {
  const zip = new JSZip();
  zip.file("data.yaml", [
    "path: .",
    "train: images/train",
    "val: images/val",
    "names: [Plant]",
    "",
  ].join("\n"));
  zip.file("labels/train/photo.txt", "0 0.5 0.5 0.4 0.2\n");

  const result = await inspectAnnotationFile(await asZipFile(zip), assets);

  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.document.annotations?.[0].bbox, [60, 40, 80, 20]);
});
