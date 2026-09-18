import assert from "node:assert/strict";
import test from "node:test";
import { buildCocoArchive } from "../app/editor/export/export-files.ts";

const options = {
  train: 50,
  val: 50,
  test: 0,
  includeTest: false,
  strategy: "random",
};

test("COCO ZIP writes complete independent split documents", async () => {
  const assets = [
    { id: "train-image", name: "train.png", src: "", width: 200, height: 100 },
    { id: "val-image", name: "val.png", src: "", width: 300, height: 150 },
  ];
  const labels = [{ id: "object", name: "Object", color: "#fff", key: "" }];
  const annotations = [
    { id: "box", asset: "train-image", label: "object", type: "box", x: 10, y: 20, width: 40, height: 30 },
    {
      id: "polygon",
      asset: "val-image",
      label: "object",
      type: "polygon",
      holes: [],
      vertices: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 20, y: 0 }, { id: "c", x: 20, y: 10 }],
    },
  ];

  const zip = await buildCocoArchive(assets, labels, annotations, options, () => 0.5);
  const train = JSON.parse(await zip.file("annotations/instances_train.json").async("string"));
  const val = JSON.parse(await zip.file("annotations/instances_val.json").async("string"));

  assert.deepEqual(Object.keys(train).sort(), ["annotations", "categories", "images", "info"]);
  assert.deepEqual(train.images, [{ id: 1, file_name: "train.png", width: 200, height: 100 }]);
  assert.equal(train.annotations[0].image_id, 1);
  assert.deepEqual(train.annotations[0].bbox, [10, 20, 40, 30]);
  assert.equal(train.annotations[0].area, 1200);
  assert.equal(train.annotations[0].iscrowd, 0);
  assert.deepEqual(val.images, [{ id: 1, file_name: "val.png", width: 300, height: 150 }]);
  assert.equal(val.annotations[0].image_id, 1);
  assert.deepEqual(val.annotations[0].segmentation, [[0, 0, 20, 0, 20, 10]]);
});

test("COCO ZIP contains references and metadata but no image entries", async () => {
  const assets = [{
    id: "image",
    name: "private.tif",
    src: "data:image/tiff;base64,secret-bytes",
    width: 20,
    height: 10,
  }];
  const labels = [{ id: "object", name: "Object", color: "#fff", key: "" }];

  const zip = await buildCocoArchive(assets, labels, [], { ...options, train: 100, val: 0 }, () => 0.5);
  const entries = Object.keys(zip.files);
  const manifest = await zip.file("poligome-manifest.json").async("string");

  assert.equal(entries.some((path) => /(^|\/)images\//.test(path)), false);
  assert.doesNotMatch(manifest, /secret-bytes|data:image/);
  assert.match(manifest, /private\.tif/);
});

test("COCO ZIP can keep the complete dataset in one document without split folders", async () => {
  const assets = [
    { id: "first", name: "first.png", src: "", width: 100, height: 50 },
    { id: "second", name: "second.png", src: "", width: 80, height: 40 },
  ];
  const labels = [{ id: "object", name: "Object", color: "#fff", key: "" }];
  const annotations = [
    { id: "box", asset: "first", label: "object", type: "box", x: 10, y: 5, width: 20, height: 10 },
  ];

  const zip = await buildCocoArchive(assets, labels, annotations, { ...options, splitDataset: false });
  const entries = Object.keys(zip.files);
  const document = JSON.parse(await zip.file("annotations/instances.json").async("string"));

  assert.deepEqual(document.images.map((image) => image.file_name), ["first.png", "second.png"]);
  assert.equal(document.annotations.length, 1);
  assert.equal(entries.some((entry) => /instances_(train|val|test)\.json$/.test(entry)), false);
  assert.equal(entries.some((entry) => /(^|\/)images\//.test(entry)), false);
});
