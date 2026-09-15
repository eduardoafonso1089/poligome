import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { exportEditorYoloZip } from "../app/editor/export/export-files.ts";

test("exports a complete canonical YOLO dataset with paired, collision-safe files", async () => {
  let downloaded;
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;

  URL.createObjectURL = (blob) => {
    downloaded = blob;
    return "blob:poligome-test";
  };
  URL.revokeObjectURL = () => {};
  globalThis.document = {
    createElement: () => ({ style: {}, click() {}, remove() {} }),
    body: { appendChild() {} },
  };
  globalThis.window = { setTimeout: (callback) => { callback(); return 1; } };

  try {
    const image = "data:image/png;base64,iVBORw0KGgo=";
    const assets = [
      { id: "image-a", name: "same.png", src: image, width: 100, height: 100 },
      { id: "image-b", name: "same.png", src: image, width: 100, height: 100 },
    ];
    const labels = [{ id: "object", name: "Object", color: "#ffffff", key: "" }];
    const annotations = [{
      id: "box-a",
      asset: "image-a",
      label: "object",
      type: "box",
      x: 10,
      y: 10,
      width: 20,
      height: 20,
    }, {
      id: "box-b",
      asset: "image-b",
      label: "object",
      type: "box",
      x: 40,
      y: 43.5,
      width: 20,
      height: 13,
      rotation: Math.PI / 2,
    }];

    await exportEditorYoloZip(assets, labels, annotations, "Test export");
    assert.ok(downloaded instanceof Blob);

    const zip = await JSZip.loadAsync(await downloaded.arrayBuffer());
    const entries = Object.keys(zip.files);
    assert.ok(entries.includes("images/train/0001-same.png"));
    assert.ok(entries.includes("labels/train/0001-same.txt"));
    assert.ok(entries.includes("images/val/0002-same.png"));
    assert.ok(entries.includes("labels/val/0002-same.txt"));
    assert.equal(
      await zip.file("labels/train/0001-same.txt").async("string"),
      "0 0.200000 0.200000 0.200000 0.200000",
    );
    assert.equal(
      await zip.file("labels/val/0002-same.txt").async("string"),
      "0 0.500000 0.500000 0.130000 0.200000",
    );
    assert.match(await zip.file("data.yaml").async("string"), /train: images\/train\nval: images\/val/);
  } finally {
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});
