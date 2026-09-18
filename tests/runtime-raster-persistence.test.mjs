import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { openPoligomeProjectV4, savePoligomeProjectV4 } from "../app/lib/project.ts";
import { getCopy } from "../app/lib/i18n.ts";

function installDownloadCapture() {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  let saved;
  URL.createObjectURL = (blob) => { saved = blob; return "blob:project"; };
  URL.revokeObjectURL = () => {};
  globalThis.document = { createElement: () => ({ style: {}, click() {}, remove() {} }), body: { appendChild() {} } };
  globalThis.window = { setTimeout: (callback) => { callback(); return 1; } };
  return {
    saved: () => saved,
    restore() {
      globalThis.document = originalDocument;
      globalThis.window = originalWindow;
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    },
  };
}

test("runtime raster bytes are not written to new project files", async () => {
  const capture = installDownloadCapture();
  const bytes = new Uint8Array([73, 73, 42, 0, 1, 2, 3, 4]);
  const asset = {
    id: "cog",
    name: "orthomosaic.tif",
    src: "blob:cog",
    local: true,
    width: 50000,
    height: 30000,
    raster: { kind: "cog", mode: "tiled", sourceType: "local" },
    runtimeRasterSource: new File([bytes], "orthomosaic.tif", { type: "image/tiff" }),
  };
  try {
    await savePoligomeProjectV4("COG", [asset], [{ id: "u", name: "U", color: "#aaa", key: "" }], [], getCopy("en"));
    const zip = await JSZip.loadAsync(await capture.saved().arrayBuffer());
    const manifest = JSON.parse(await zip.file("project.json").async("string"));
    assert.deepEqual(Object.keys(zip.files), ["project.json"]);
    assert.equal(manifest.assets[0].missing, true);
    assert.equal("runtimeRasterSource" in manifest.assets[0], false);
    assert.equal("bundled_path" in manifest.assets[0], false);
  } finally {
    capture.restore();
  }
});

test("legacy projects with bundled raster bytes remain readable", async () => {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = () => "blob:legacy-raster";
  URL.revokeObjectURL = () => {};
  const bytes = new Uint8Array([73, 73, 42, 0, 1, 2, 3, 4]);
  const zip = new JSZip();
  zip.file("images/0001-orthomosaic.tif", bytes);
  zip.file("project.json", JSON.stringify({
    format: "poligome-project",
    version: 4,
    coordinate_space: "image-pixels",
    project_name: "Legacy",
    saved_at: "2026-01-01T00:00:00.000Z",
    assets: [{
      id: "cog",
      name: "orthomosaic.tif",
      width: 50000,
      height: 30000,
      bundled_path: "images/0001-orthomosaic.tif",
      raster: { kind: "cog", mode: "tiled", sourceType: "local" },
    }],
    labels: [{ id: "u", name: "U", color: "#aaa", key: "" }],
    annotations: [],
  }));
  try {
    const loaded = await openPoligomeProjectV4(await zip.generateAsync({ type: "uint8array" }), getCopy("en"));
    assert.equal(loaded.missingImages, 0);
    assert.equal(loaded.assets[0].src, "blob:legacy-raster");
    assert.ok(loaded.assets[0].runtimeRasterSource instanceof File);
    assert.deepEqual([...new Uint8Array(await loaded.assets[0].runtimeRasterSource.arrayBuffer())], [...bytes]);
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});
