/**
 * Unit layer: local image import and the relink of a project whose images are
 * gone.
 *
 * Relinking is the one place where a wrong guess silently attaches a set of
 * annotations to the wrong picture, so every branch of the pairing rule is
 * covered here: basename matching, dimension checks, ambiguous groups, extra
 * files and the tiled-raster path.
 *
 * Both functions talk to the browser (`URL.createObjectURL`, `new Image`), so
 * the stubs below stand in for it. The stub resolves each blob URL back to the
 * file it was made from, which lets one test hand over several files with
 * different dimensions at once.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { installFileReader, tiledTiffFile } from "./helpers/raster-fixtures.mjs";
import { sourceOf } from "./helpers/source.mjs";
import { loadLocalImageAssets, relinkMissingAssets } from "../app/editor/session/image-assets.ts";

function installBrowserStubs() {
  const original = {
    Image: globalThis.Image,
    createObjectURL: URL.createObjectURL,
    revokeObjectURL: URL.revokeObjectURL,
  };
  const fileByUrl = new Map();
  const revoked = [];
  let next = 0;

  URL.createObjectURL = (file) => {
    const url = `blob:image-assets-${++next}`;
    fileByUrl.set(url, file);
    return url;
  };
  URL.revokeObjectURL = (url) => revoked.push(url);
  globalThis.Image = class {
    naturalWidth = 0;
    naturalHeight = 0;
    onload = null;
    onerror = null;
    set src(url) {
      const pixels = fileByUrl.get(url)?.pixels;
      queueMicrotask(() => {
        // No pixels means the bytes are not a decodable image.
        if (!pixels) return void this.onerror?.();
        this.naturalWidth = pixels.width;
        this.naturalHeight = pixels.height;
        this.onload?.();
      });
    }
  };

  // geotiff reads a File through FileReader, which Node does not have either.
  const restoreFileReader = installFileReader();

  return {
    revoked,
    restore() {
      restoreFileReader();
      globalThis.Image = original.Image;
      URL.createObjectURL = original.createObjectURL;
      URL.revokeObjectURL = original.revokeObjectURL;
    },
  };
}

/** A file the stubbed `Image` can decode, unless `pixels` is omitted. */
function imageFile(name, pixels, type = "image/jpeg") {
  const file = new File(["pixels"], name, { type });
  if (pixels) file.pixels = pixels;
  return file;
}

const missingAsset = (overrides = {}) => ({
  id: "image-stable",
  name: "photo.jpg",
  src: "",
  local: true,
  missing: true,
  width: 640,
  height: 480,
  ...overrides,
});

/** Runs `body` with the browser stubs installed, and always uninstalls them. */
async function withBrowser(body) {
  const browser = installBrowserStubs();
  try {
    return await body(browser);
  } finally {
    browser.restore();
  }
}

test("importing local images reads the real dimensions of each file", async () => {
  await withBrowser(async () => {
    let counter = 0;
    const result = await loadLocalImageAssets(
      [imageFile("a.jpg", { width: 640, height: 480 }), imageFile("b.png", { width: 100, height: 200 }, "image/png")],
      (prefix) => `${prefix}-${++counter}`,
    );

    assert.deepEqual(result.assets.map((asset) => [asset.id, asset.name, asset.width, asset.height]), [
      ["image-1", "a.jpg", 640, 480],
      ["image-2", "b.png", 100, 200],
    ]);
    assert.ok(result.assets.every((asset) => asset.local && asset.src.startsWith("blob:")));
    assert.equal(result.objectUrls.length, 2);
    assert.deepEqual(result.rejected, []);
  });
});

test("a file that is not an image is rejected before any object URL is made", async () => {
  await withBrowser(async ({ revoked }) => {
    const notAnImage = new File(["{}"], "notes.json", { type: "application/json" });
    const result = await loadLocalImageAssets([notAnImage], (prefix) => prefix);

    assert.deepEqual(result.assets, []);
    assert.deepEqual(result.rejected, [notAnImage]);
    assert.deepEqual(revoked, [], "nothing was allocated, so nothing needs revoking");
  });
});

test("a TIFF is rejected here because it belongs to the tiled raster importer", async () => {
  await withBrowser(async () => {
    const tiff = imageFile("scene.tif", { width: 50000, height: 30000 }, "image/tiff");
    const result = await loadLocalImageAssets([tiff], (prefix) => prefix);

    assert.deepEqual(result.assets, []);
    assert.deepEqual(result.rejected, [tiff]);
  });
});

test("an undecodable image is rejected and its object URL is released", async () => {
  await withBrowser(async ({ revoked }) => {
    const corrupt = imageFile("broken.jpg", null);
    const result = await loadLocalImageAssets([corrupt], (prefix) => prefix);

    assert.deepEqual(result.assets, []);
    assert.deepEqual(result.rejected, [corrupt]);
    assert.equal(revoked.length, 1, "a rejected import must not leak a blob URL");
    assert.deepEqual(result.objectUrls, []);
  });
});

test("relinking keeps the asset id, so the annotations stay attached", async () => {
  await withBrowser(async () => {
    const result = await relinkMissingAssets(
      [missingAsset({ name: "Photo.JPG" })],
      [imageFile("photo.jpg", { width: 640, height: 480 })],
    );

    assert.deepEqual(result.restoredIds, ["image-stable"]);
    assert.equal(result.assets[0].id, "image-stable");
    assert.equal(result.assets[0].missing, false);
    assert.equal(result.assets[0].local, true);
    assert.equal(result.objectUrls.length, 1);
    assert.deepEqual(result.rejected, []);
  });
});

test("the basename is matched without its folders, so a re-picked file still fits", async () => {
  await withBrowser(async () => {
    const result = await relinkMissingAssets(
      [missingAsset({ name: "trip/2024/ photo.JPG " })],
      [imageFile("C:\\photos\\Photo.jpg", { width: 640, height: 480 })],
    );

    assert.deepEqual(result.restoredIds, ["image-stable"]);
  });
});

test("a same-named image of the wrong size is refused rather than guessed", async () => {
  await withBrowser(async ({ revoked }) => {
    const wrongSize = imageFile("photo.jpg", { width: 320, height: 240 });
    const result = await relinkMissingAssets([missingAsset()], [wrongSize]);

    assert.deepEqual(result.restoredIds, []);
    assert.equal(result.assets[0].missing, true);
    assert.deepEqual(result.rejected, [wrongSize]);
    assert.equal(revoked.length, 1, "the refused candidate must not leak a blob URL");
    assert.deepEqual(result.objectUrls, []);
  });
});

test("an undecodable candidate is refused and leaves the asset missing", async () => {
  await withBrowser(async ({ revoked }) => {
    const corrupt = imageFile("photo.jpg", null);
    const result = await relinkMissingAssets([missingAsset()], [corrupt]);

    assert.deepEqual(result.restoredIds, []);
    assert.equal(result.assets[0].missing, true);
    assert.deepEqual(result.rejected, [corrupt]);
    assert.equal(revoked.length, 1, "a refused candidate must not leak a blob URL");
  });
});

test("an asset whose dimensions were never recorded accepts the file it is given", async () => {
  await withBrowser(async () => {
    const unknown = missingAsset({ width: 0, height: undefined });
    const result = await relinkMissingAssets([unknown], [imageFile("photo.jpg", { width: 800, height: 600 })]);

    assert.deepEqual(result.restoredIds, ["image-stable"]);
    assert.equal(result.assets[0].width, 800);
    assert.equal(result.assets[0].height, 600);
  });
});

test("an image that is still present is never replaced", async () => {
  await withBrowser(async () => {
    const present = { ...missingAsset(), missing: false, src: "blob:existing" };
    const file = imageFile("photo.jpg", { width: 640, height: 480 });
    const result = await relinkMissingAssets([present], [file]);

    assert.deepEqual(result.restoredIds, []);
    assert.equal(result.assets[0].src, "blob:existing");
    assert.deepEqual(result.rejected, [file], "a file with no missing target is reported back");
  });
});

test("two missing images of the same name are paired with two files, in order", async () => {
  await withBrowser(async () => {
    const assets = [
      missingAsset({ id: "first", width: 640, height: 480 }),
      missingAsset({ id: "second", width: 100, height: 100 }),
    ];
    const files = [
      imageFile("photo.jpg", { width: 640, height: 480 }),
      imageFile("photo.jpg", { width: 100, height: 100 }),
    ];
    const result = await relinkMissingAssets(assets, files);

    assert.deepEqual(result.restoredIds, ["first", "second"]);
    assert.ok(result.assets.every((asset) => asset.missing === false));
    assert.deepEqual(result.rejected, []);
  });
});

test("an ambiguous group restores nothing instead of attaching the wrong annotations", async () => {
  await withBrowser(async () => {
    const assets = [missingAsset({ id: "first" }), missingAsset({ id: "second" })];
    const onlyOne = imageFile("photo.jpg", { width: 640, height: 480 });
    const result = await relinkMissingAssets(assets, [onlyOne]);

    assert.deepEqual(result.restoredIds, []);
    assert.ok(result.assets.every((asset) => asset.missing === true));
    assert.deepEqual(result.rejected, [onlyOne]);
  });
});

test("a file with no missing counterpart is handed back as rejected", async () => {
  await withBrowser(async () => {
    const stranger = imageFile("other.jpg", { width: 640, height: 480 });
    const result = await relinkMissingAssets([missingAsset()], [stranger]);

    assert.deepEqual(result.restoredIds, []);
    assert.deepEqual(result.rejected, [stranger]);
  });
});

test("a tiled raster is not relinked from an ordinary file", async () => {
  await withBrowser(async () => {
    const tiled = missingAsset({
      name: "scene.tif",
      width: 50000,
      height: 30000,
      raster: { kind: "cog", mode: "tiled", sourceType: "local" },
    });
    const notARaster = imageFile("scene.tif", null, "image/tiff");
    const result = await relinkMissingAssets([tiled], [notARaster]);

    assert.deepEqual(result.restoredIds, []);
    assert.equal(result.assets[0].missing, true);
    assert.deepEqual(result.rejected, [notARaster]);
  });
});

const missingTiled = (overrides = {}) => missingAsset({
  id: "raster-stable",
  name: "scene.tif",
  width: 48,
  height: 32,
  raster: { kind: "cog", mode: "tiled", sourceType: "local", reference: {} },
  ...overrides,
});

test("a tiled raster is relinked through the raster reader, not the image decoder", async () => {
  await withBrowser(async () => {
    const result = await relinkMissingAssets([missingTiled()], [tiledTiffFile({ width: 48, height: 32, name: "scene.tif" })]);

    assert.deepEqual(result.restoredIds, ["raster-stable"]);
    const [asset] = result.assets;
    assert.equal(asset.id, "raster-stable");
    assert.equal(asset.name, "scene.tif", "the project name wins over the file name");
    assert.equal(asset.missing, false);
    assert.equal(asset.raster.mode, "tiled");
    assert.ok(asset.runtimeRasterSource, "the tile reader needs the file handle back");
    assert.equal(result.objectUrls.length, 1);
  });
});

test("a tiled raster of the wrong size is refused like any other candidate", async () => {
  await withBrowser(async () => {
    const wrongSize = tiledTiffFile({ width: 64, height: 64, name: "scene.tif" });
    const result = await relinkMissingAssets([missingTiled()], [wrongSize]);

    assert.deepEqual(result.restoredIds, []);
    assert.equal(result.assets[0].missing, true);
    assert.deepEqual(result.rejected, [wrongSize]);
  });
});

test("relinking one image of a project leaves the others untouched", async () => {
  await withBrowser(async () => {
    const assets = [
      missingAsset({ id: "kept", name: "keep.jpg", missing: false, src: "blob:kept" }),
      missingAsset({ id: "restored", name: "photo.jpg" }),
      missingAsset({ id: "still-missing", name: "gone.jpg" }),
    ];
    const result = await relinkMissingAssets(assets, [imageFile("photo.jpg", { width: 640, height: 480 })]);

    assert.deepEqual(result.assets.map((asset) => asset.missing), [false, false, true]);
    assert.deepEqual(result.restoredIds, ["restored"]);
    assert.equal(result.assets[0].src, "blob:kept");
  });
});

test("the workbench only offers a relink while an image is actually missing", () => {
  // The guard lives in an event handler of a client component that needs a real
  // browser to mount, so it is asserted where it is written. Everything the
  // handler then does is covered by the tests above.
  const workbench = sourceOf("app/editor/workbench/canonical-editor-workbench.tsx");

  assert.match(workbench, /relinkMissingAssets/, "the workbench must use the shared relink");
  assert.match(workbench, /if \(!files\.length \|\| !missingImageCount\) return;/, "relinking must be refused when nothing is missing");
  assert.match(workbench, /asset\?\.missing && <button[\s\S]{0,60}relinkInputRef/, "the button must appear only for a missing image");
});
