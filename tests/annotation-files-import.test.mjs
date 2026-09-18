import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { inspectAnnotationFile, inspectAnnotationFiles } from "../app/editor/import/annotation-package-import.ts";
import { planCocoDocument } from "../app/editor/import/coco-document-import.ts";

const assets = [
  { id: "street", name: "rua.jpg", src: "", width: 640, height: 480 },
  { id: "park", name: "parque.png", src: "", width: 200, height: 100 },
];

// The rows a YOLO dataset carries: class index plus a normalized box.
const ROWS = [
  "45 0.479492 0.688771 0.955609 0.5955",
  "45 0.736516 0.247188 0.498875 0.476417",
  "50 0.637063 0.732938 0.494125 0.510583",
  "49 0.646836 0.132552 0.118047 0.0969375",
].join("\n");

function textFile(name, text) {
  return new File([text], name, { type: "text/plain" });
}

async function zipFile(zip, name = "dataset.zip") {
  return new File([await zip.generateAsync({ type: "uint8array" })], name, { type: "application/zip" });
}

test("a dataset of images and labels imports without data.yaml", async () => {
  const zip = new JSZip();
  zip.file("images/rua.jpg", "bytes");
  zip.file("labels/rua.txt", `${ROWS}\n`);

  const result = await inspectAnnotationFile(await zipFile(zip), assets);

  assert.equal(result.format, "yolo");
  assert.deepEqual(result.issues, []);
  // No names anywhere, so each class index becomes a class of its own.
  assert.deepEqual(result.document.categories, [{ id: 1, name: "45" }, { id: 2, name: "50" }, { id: 3, name: "49" }]);
  assert.equal(result.document.annotations?.length, 4);
  // 0.479492 - 0.955609 / 2 = 0.0016875 of 640; 0.688771 - 0.5955 / 2 = 0.391021 of 480.
  assert.deepEqual(result.document.annotations?.[0].bbox?.map((value) => Number(value.toFixed(3))), [1.08, 187.69, 611.59, 285.84]);
  // Every row survives the planner, which is what reaches the editor.
  assert.equal(planCocoDocument(result.document, assets).candidates.length, 4);
});

test("classes.txt names the classes when the dataset carries one", async () => {
  const zip = new JSZip();
  zip.file("classes.txt", "pessoa\ncarro\nplaca\n");
  zip.file("labels/rua.txt", "0 0.5 0.5 0.4 0.2\n2 0.25 0.25 0.1 0.1\n");

  const result = await inspectAnnotationFile(await zipFile(zip), assets);

  assert.deepEqual(result.document.categories, [{ id: 1, name: "pessoa" }, { id: 2, name: "carro" }, { id: 3, name: "placa" }]);
  assert.deepEqual(result.document.annotations?.map((annotation) => annotation.category_id), [1, 3]);
});

test("split lists and the README are not read as label rows", async () => {
  const zip = new JSZip();
  zip.file("train.txt", "images/rua.jpg\n");
  zip.file("README.txt", "Exported by Poligome\n");
  zip.file("labels/rua.txt", "0 0.5 0.5 0.4 0.2\n");

  const result = await inspectAnnotationFile(await zipFile(zip), assets);

  assert.deepEqual(result.issues, []);
  assert.equal(result.document.annotations?.length, 1);
});

test("loose label files import on their own, one or many at a time", async () => {
  const one = await inspectAnnotationFiles([textFile("rua.txt", `${ROWS}\n`)], assets);
  assert.equal(one.format, "yolo");
  assert.equal(one.document.annotations?.length, 4);

  const many = await inspectAnnotationFiles([
    textFile("rua.txt", "0 0.5 0.5 0.4 0.2\n"),
    textFile("parque.txt", "1 0.5 0.5 0.5 0.5\n"),
  ], assets);

  assert.deepEqual(many.issues, []);
  assert.equal(many.document.images?.length, 2);
  assert.deepEqual(many.document.images?.map((image) => image.file_name), ["rua.jpg", "parque.png"]);
  assert.deepEqual(many.document.annotations?.[1].bbox, [50, 25, 100, 50]);
  assert.equal(planCocoDocument(many.document, assets).candidates.length, 2);
});

test("classes.txt selected alongside the labels names their classes", async () => {
  const result = await inspectAnnotationFiles([
    textFile("classes.txt", "pessoa\ncarro\n"),
    textFile("rua.txt", "1 0.5 0.5 0.4 0.2\n"),
  ], assets);

  assert.deepEqual(result.document.categories, [{ id: 1, name: "pessoa" }, { id: 2, name: "carro" }]);
  assert.deepEqual(result.document.annotations?.map((annotation) => annotation.category_id), [2]);
});

test("several COCO documents import together", async () => {
  const document = (name, categoryName) => textFile(`${name}.json`, JSON.stringify({
    images: [{ id: 1, file_name: name, width: 640, height: 480 }],
    categories: [{ id: 1, name: categoryName }],
    annotations: [{ id: 1, image_id: 1, category_id: 1, bbox: [10, 20, 30, 40] }],
  }));

  const result = await inspectAnnotationFiles([
    new File([await document("rua.jpg", "pessoa").text()], "rua.json", { type: "application/json" }),
    new File([await document("parque.png", "carro").text()], "parque.json", { type: "application/json" }),
  ], assets);

  assert.equal(result.format, "coco");
  assert.deepEqual(result.document.categories?.map((category) => category.name), ["pessoa", "carro"]);
  assert.equal(planCocoDocument(result.document, assets).candidates.length, 2);
});

test("a COCO document and YOLO labels import in the same selection", async () => {
  const coco = new File([JSON.stringify({
    images: [{ id: 1, file_name: "rua.jpg", width: 640, height: 480 }],
    categories: [{ id: 1, name: "pessoa" }],
    annotations: [{ id: 1, image_id: 1, category_id: 1, bbox: [10, 20, 30, 40] }],
  })], "anotacoes.json", { type: "application/json" });

  const result = await inspectAnnotationFiles([coco, textFile("parque.txt", "0 0.5 0.5 0.5 0.5\n")], assets);

  assert.equal(result.format, "mixed");
  assert.equal(result.document.annotations?.length, 2);
  assert.equal(planCocoDocument(result.document, assets).candidates.length, 2);
});

test("an unreadable file does not discard the rest of the selection", async () => {
  const result = await inspectAnnotationFiles([
    new File(["{ not json"], "broken.json", { type: "application/json" }),
    textFile("rua.txt", "0 0.5 0.5 0.4 0.2\n"),
  ], assets);

  assert.equal(result.format, "yolo");
  assert.equal(result.document.annotations?.length, 1);
});

test("a selection with nothing readable reports why", async () => {
  await assert.rejects(
    inspectAnnotationFiles([new File(["nada"], "leiame.md")], assets),
    /annotationPackageUnsupported/,
  );
});

test("a label row for an image that is not loaded is reported once", async () => {
  const result = await inspectAnnotationFiles([textFile("ausente.txt", "0 0.5 0.5 0.4 0.2\n")], assets);

  assert.deepEqual(result.issues, [{ reference: "ausente", reason: "missing" }]);
  assert.equal(result.document.annotations?.length, 0);
});

test("a COCO document without categories keeps its classes, named after the class id", async () => {
  const result = await inspectAnnotationFiles([textFile("anotacoes.json", JSON.stringify({
    images: [{ id: 1, file_name: "rua.jpg", width: 640, height: 480 }],
    annotations: [
      { id: 1, image_id: 1, category_id: 7, bbox: [10, 20, 30, 40] },
      { id: 2, image_id: 1, category_id: 12, bbox: [50, 60, 30, 40] },
    ],
  }))], assets);

  assert.equal(result.format, "coco");
  assert.deepEqual(result.document.categories, [{ id: 7, name: "7" }, { id: 12, name: "12" }]);
  assert.equal(planCocoDocument(result.document, assets).candidates.length, 2);
});

test("a COCO file per image pairs with the image it is named after", async () => {
  const perImage = (categoryName) => JSON.stringify({
    categories: [{ id: 7, name: categoryName }],
    annotations: [{ id: 1, category_id: 7, bbox: [10, 20, 30, 40] }],
  });

  const result = await inspectAnnotationFiles([
    textFile("rua.json", perImage("carro")),
    textFile("parque.json", perImage("arvore")),
  ], assets);

  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.document.images?.map((image) => image.file_name), ["rua.jpg", "parque.png"]);
  assert.equal(planCocoDocument(result.document, assets).candidates.length, 2);
});

test("a bare COCO results array imports under the image its file names", async () => {
  const result = await inspectAnnotationFiles([textFile("rua.json", JSON.stringify([
    { image_id: 1, category_id: 7, bbox: [10, 20, 30, 40], score: 0.9 },
    { image_id: 1, category_id: 7, bbox: [50, 60, 30, 40], score: 0.8 },
  ]))], assets);

  assert.equal(result.format, "coco");
  assert.deepEqual(result.document.images?.map((image) => image.file_name), ["rua.jpg"]);
  assert.deepEqual(result.document.categories, [{ id: 7, name: "7" }]);
  assert.equal(planCocoDocument(result.document, assets).candidates.length, 2);
});

test("a ZIP of per-image COCO files pairs each one with its image", async () => {
  const zip = new JSZip();
  zip.file("images/rua.jpg", "bytes");
  zip.file("annotations/rua.json", JSON.stringify({ annotations: [{ id: 1, category_id: 7, bbox: [10, 20, 30, 40] }] }));
  zip.file("annotations/parque.json", JSON.stringify({ annotations: [{ id: 1, category_id: 7, bbox: [1, 2, 3, 4] }] }));

  const result = await inspectAnnotationFile(await zipFile(zip, "coco.zip"), assets);

  assert.equal(result.format, "coco");
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.document.images?.map((image) => image.file_name), ["rua.jpg", "parque.png"]);
  assert.equal(planCocoDocument(result.document, assets).candidates.length, 2);
});

test("a COCO file named after no loaded image is reported, not guessed", async () => {
  const result = await inspectAnnotationFiles([textFile("ausente.json", JSON.stringify({
    annotations: [{ id: 1, category_id: 7, bbox: [10, 20, 30, 40] }],
  }))], assets);

  assert.deepEqual(result.issues, [{ reference: "ausente", reason: "missing" }]);
  assert.equal(planCocoDocument(result.document, assets).candidates.length, 0);
});

test("JSON that is not annotations at all is still rejected", async () => {
  await assert.rejects(
    inspectAnnotationFiles([textFile("config.json", JSON.stringify({ name: "poligome", version: 4 }))], assets),
    /annotationPackageUnsupported/,
  );
});
