import assert from "node:assert/strict";
import test from "node:test";
import { buildCocoArchive, buildYoloArchive } from "../app/editor/export/export-files.ts";
import { inspectAnnotationFile } from "../app/editor/import/annotation-package-import.ts";
import { importCocoDocument } from "../app/editor/import/coco-document-import.ts";

const assets = [
  { id: "box-image", name: "box image.png", src: "", width: 200, height: 100 },
  { id: "polygon-image", name: "polygon.jpg", src: "", width: 300, height: 150 },
];
const labels = [{ id: "plant", name: "Plant", color: "#00ff00", key: "" }];
const annotations = [
  { id: "box", asset: "box-image", label: "plant", type: "box", x: 20, y: 10, width: 40, height: 30 },
  {
    id: "polygon",
    asset: "polygon-image",
    label: "plant",
    type: "polygon",
    holes: [],
    vertices: [{ id: "a", x: 30, y: 15 }, { id: "b", x: 150, y: 15 }, { id: "c", x: 150, y: 90 }],
  },
];
const splitOptions = { train: 50, val: 50, test: 0, includeTest: false, strategy: "random" };

async function archiveFile(zip, name) {
  return new File([await zip.generateAsync({ type: "uint8array" })], name, { type: "application/zip" });
}

function ids() {
  let value = 0;
  return (prefix) => `${prefix}-${++value}`;
}

for (const [mode, expected] of [["bbox", ["box"]], ["polygon", ["polygon"]], ["both", ["box", "polygon"]]]) {
  test(`round-trips a Poligome YOLO ${mode} ZIP`, async () => {
    const zip = await buildYoloArchive(assets, labels, annotations, { ...splitOptions, mode }, () => 0.5);
    const inspected = await inspectAnnotationFile(await archiveFile(zip, `${mode}.zip`), assets);
    const imported = importCocoDocument(inspected.document, assets, [], ids());

    assert.deepEqual(inspected.issues, []);
    assert.equal(imported.unmatched, 0);
    assert.deepEqual(imported.annotations.map((annotation) => annotation.type).sort(), [...expected].sort());
  });
}

test("round-trips a split COCO ZIP and warns once for an absent image", async () => {
  const zip = await buildCocoArchive(assets, labels, annotations, splitOptions, () => 0.5);
  const inspected = await inspectAnnotationFile(await archiveFile(zip, "coco.zip"), assets.slice(0, 1));
  const imported = importCocoDocument(inspected.document, assets.slice(0, 1), [], ids());

  assert.deepEqual(inspected.issues, [{ reference: "polygon.jpg", reason: "missing" }]);
  assert.equal(imported.imported, 1);
  assert.equal(imported.annotations[0].type, "box");
});
