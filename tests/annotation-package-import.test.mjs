import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { inspectAnnotationFile } from "../app/editor/import/annotation-package-import.ts";
import { matchImageReference } from "../app/editor/import/image-reference-match.ts";

const assets = [
  { id: "north", name: "plots/north/Field One.JPG", src: "", width: 100, height: 50 },
  { id: "south", name: "Field Two.png", src: "", width: 100, height: 50 },
];

test("image matching normalizes path separators and case", () => {
  const result = matchImageReference("./plots\\north\\field one.jpg", assets);
  assert.equal(result.asset?.id, "north");
});

test("image matching falls back to a unique basename", () => {
  const result = matchImageReference("external/dataset/FIELD TWO.PNG", assets);
  assert.equal(result.asset?.id, "south");
});

test("image matching can use a unique stem when YOLO omits the extension", () => {
  const result = matchImageReference("labels/train/field two", assets, { allowStem: true });
  assert.equal(result.asset?.id, "south");
});

test("image matching reports missing and ambiguous names without guessing", () => {
  assert.deepEqual(matchImageReference("missing.png", assets), {
    issue: { reference: "missing.png", reason: "missing" },
  });

  const duplicateAssets = [
    { id: "a", name: "folder-a/repeated.png", src: "", width: 10, height: 10 },
    { id: "b", name: "folder-b/repeated.png", src: "", width: 10, height: 10 },
  ];
  assert.deepEqual(matchImageReference("repeated.png", duplicateAssets), {
    issue: { reference: "repeated.png", reason: "ambiguous" },
  });
});

async function asZipFile(zip, name = "annotations.zip") {
  return new File([await zip.generateAsync({ type: "uint8array" })], name, { type: "application/zip" });
}

test("COCO ZIP merges split documents and reports each unmatched image once", async () => {
  const zip = new JSZip();
  zip.file("annotations/instances_train.json", JSON.stringify({
    images: [{ id: 1, file_name: "Field One.JPG", width: 100, height: 50 }],
    categories: [{ id: 1, name: "Plant" }],
    annotations: [{ id: 1, image_id: 1, category_id: 1, bbox: [10, 10, 20, 10] }],
  }));
  zip.file("annotations/instances_val.json", JSON.stringify({
    images: [{ id: 1, file_name: "absent.png", width: 100, height: 50 }],
    categories: [{ id: 1, name: "Plant" }],
    annotations: [
      { id: 1, image_id: 1, category_id: 1, bbox: [0, 0, 5, 5] },
      { id: 2, image_id: 1, category_id: 1, bbox: [5, 5, 5, 5] },
    ],
  }));

  const result = await inspectAnnotationFile(await asZipFile(zip), assets);

  assert.equal(result.format, "coco");
  assert.deepEqual(result.roots, ["annotations/instances_train.json", "annotations/instances_val.json"]);
  assert.equal(result.document.images?.length, 2);
  assert.equal(result.document.annotations?.length, 3);
  assert.deepEqual(result.issues, [{ reference: "absent.png", reason: "missing" }]);
});

test("standalone COCO JSON remains supported", async () => {
  const file = new File([JSON.stringify({
    images: [{ id: 4, file_name: "Field Two.png", width: 100, height: 50 }],
    categories: [{ id: 8, name: "Plant" }],
    annotations: [{ id: 9, image_id: 4, category_id: 8, bbox: [0, 0, 10, 10] }],
  })], "annotations.json", { type: "application/json" });

  const result = await inspectAnnotationFile(file, assets);

  assert.equal(result.format, "coco");
  assert.equal(result.document.annotations?.length, 1);
  assert.deepEqual(result.issues, []);
});
