import assert from "node:assert/strict";
import test from "node:test";
import { buildYoloArchive } from "../app/editor/export/export-files.ts";

const labels = [{ id: "object", name: "Object", color: "#ffffff", key: "" }];

const randomOptions = {
  mode: "bbox",
  train: 100,
  val: 0,
  test: 0,
  includeTest: false,
  strategy: "random",
};

test("YOLO labels preserve the image stem and split lists preserve its extension", async () => {
  const assets = [{ id: "image", name: "field sample.JPG", src: "", width: 100, height: 50 }];
  const annotations = [{
    id: "box",
    asset: "image",
    label: "object",
    type: "box",
    x: 10,
    y: 5,
    width: 20,
    height: 10,
  }];

  const zip = await buildYoloArchive(assets, labels, annotations, randomOptions, () => 0.5);

  assert.ok(zip.file("labels/train/field sample.txt"));
  assert.equal(await zip.file("train.txt").async("string"), "images/train/field sample.JPG\n");
  assert.equal(await zip.file("val.txt").async("string"), "");
  assert.equal(
    await zip.file("labels/train/field sample.txt").async("string"),
    "0 0.200000 0.200000 0.200000 0.200000",
  );
  assert.match(await zip.file("data.yaml").async("string"), /train: train\.txt\nval: val\.txt/);
});

test("YOLO both mode writes independent bbox and polygon datasets without images", async () => {
  const assets = [{ id: "image", name: "image.png", src: "", width: 100, height: 100 }];
  const annotations = [
    { id: "box", asset: "image", label: "object", type: "box", x: 10, y: 10, width: 20, height: 20 },
    {
      id: "polygon",
      asset: "image",
      label: "object",
      type: "polygon",
      holes: [],
      vertices: [{ id: "a", x: 1, y: 1 }, { id: "b", x: 3, y: 1 }, { id: "c", x: 3, y: 3 }],
    },
  ];

  const zip = await buildYoloArchive(assets, labels, annotations, { ...randomOptions, mode: "both" }, () => 0.5);
  const entries = Object.keys(zip.files);

  assert.ok(entries.includes("bbox/labels/train/image.txt"));
  assert.ok(entries.includes("polygon/labels/train/image.txt"));
  assert.equal((await zip.file("bbox/labels/train/image.txt").async("string")).trim().split(/\s+/).length, 5);
  assert.ok((await zip.file("polygon/labels/train/image.txt").async("string")).trim().split(/\s+/).length >= 7);
  assert.ok(entries.includes("bbox/poligome-manifest.json"));
  assert.ok(entries.includes("polygon/poligome-manifest.json"));
  assert.equal(entries.some((entry) => /(^|\/)images\//.test(entry)), false);
});

test("YOLO export rejects duplicate label paths instead of renaming images", async () => {
  const assets = [
    { id: "image-a", name: "same.png", src: "", width: 100, height: 100 },
    { id: "image-b", name: "same.jpg", src: "", width: 100, height: 100 },
  ];

  await assert.rejects(
    () => buildYoloArchive(assets, labels, [], randomOptions, () => 0.5),
    /yoloDuplicateLabelPath/,
  );
});

test("YOLO package references every split image but omits empty label files", async () => {
  const assets = [
    { id: "annotated", name: "annotated.png", src: "data:image/png;base64,secret", width: 100, height: 100 },
    { id: "empty", name: "empty.png", src: "blob:secret", width: 100, height: 100 },
  ];
  const annotations = [{ id: "box", asset: "annotated", label: "object", type: "box", x: 0, y: 0, width: 10, height: 10 }];

  const zip = await buildYoloArchive(assets, labels, annotations, randomOptions, () => 0.5);
  const entries = Object.keys(zip.files);
  const manifest = await zip.file("poligome-manifest.json").async("string");

  assert.equal(await zip.file("train.txt").async("string"), "images/train/annotated.png\nimages/train/empty.png\n");
  assert.ok(zip.file("labels/train/annotated.txt"));
  assert.equal(zip.file("labels/train/empty.txt"), null);
  assert.equal(entries.some((entry) => /(^|\/)images\//.test(entry)), false);
  assert.doesNotMatch(manifest, /data:image|blob:secret|secret/);
});
