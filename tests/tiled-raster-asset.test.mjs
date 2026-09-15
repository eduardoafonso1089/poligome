/**
 * Unit layer: building an editor asset from a tiled raster.
 *
 * This is the door every COG walks through, and the only place the decision
 * "open lazily, tile by tile" is taken. The fixtures are real TIFFs read by the
 * real decoder — only the browser APIs around it (FileReader, object URLs) are
 * stubbed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { installFileReader, tiffFile, tiledTiffFile } from "./helpers/raster-fixtures.mjs";
import { createTiledRasterAsset } from "../app/editor/raster/tiled-raster-asset.ts";

const restoreFileReader = installFileReader();
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
let next = 0;
URL.createObjectURL = () => `blob:raster-${++next}`;
URL.revokeObjectURL = () => {};

test.after(() => {
  restoreFileReader();
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
});

const build = (file, options = {}) => createTiledRasterAsset({
  origin: file,
  name: options.name ?? file.name,
  reference: options.reference,
  makeId: options.makeId ?? ((prefix) => `${prefix}-1`),
});

test("a local tiled TIFF becomes a lazily read raster asset", async () => {
  const file = tiledTiffFile({ width: 48, height: 32, name: "scene.tif" });
  const asset = await build(file);

  assert.equal(asset.id, "raster-1");
  assert.equal(asset.name, "scene.tif");
  assert.equal(asset.width, 48);
  assert.equal(asset.height, 32);
  assert.equal(asset.local, true);
  assert.equal(asset.byteSize, file.size);
  assert.ok(asset.src.startsWith("blob:"));
  assert.deepEqual(
    { kind: asset.raster.kind, mode: asset.raster.mode, sourceType: asset.raster.sourceType },
    { kind: "cog", mode: "tiled", sourceType: "local" },
  );
  assert.equal(asset.raster.profile, "tiled-no-overviews", "a single level has no overviews");
  assert.equal(asset.runtimeRasterSource, file, "the tile reader keeps the file handle");
});

test("a striped TIFF is refused instead of being loaded whole", async () => {
  // Striped means the decoder would have to read the entire image to show any of
  // it, which is exactly what the tiled path exists to avoid.
  await assert.rejects(() => build(tiffFile(new Uint8Array([0, 64, 128, 255]))), /rasterTiledRequired/);
});

test("a file that is not a TIFF at all is refused by the signature check", async () => {
  const notATiff = new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], "scene.tif", { type: "image/tiff" });
  await assert.rejects(() => build(notATiff), /rasterInvalidTiff/);
});

test("a raster without its own georeference keeps the one it is given", async () => {
  // X = 0.5*x + 100, Y = -0.5*y + 200: half-metre pixels from a known corner.
  const reference = { transform: [0.5, 0, 100, 0, -0.5, 200], crs: "EPSG:31983" };
  const asset = await build(tiledTiffFile({ width: 48, height: 32 }), { reference });

  assert.equal(asset.geo.crs, "EPSG:31983");
  assert.deepEqual(asset.geo.transform, reference.transform);
  assert.deepEqual([asset.geo.originX, asset.geo.originY], [100, 200]);
  assert.deepEqual([asset.geo.scaleX, asset.geo.scaleY], [0.5, 0.5]);
  assert.deepEqual([asset.geo.sourceWidth, asset.geo.sourceHeight], [48, 32]);
  // The reference travels with the asset so reopening the project can restore it.
  assert.deepEqual(asset.raster.reference, { transform: reference.transform, crs: "EPSG:31983" });
});

test("a raster with no georeference anywhere is still a usable asset", async () => {
  const asset = await build(tiledTiffFile({ width: 16, height: 16 }));

  assert.equal(asset.geo, undefined, "no transform means no invented coordinates");
  assert.equal(asset.raster.reference.crs, undefined);
  assert.equal(asset.width, 16);
});

test("the project name wins over the file name", async () => {
  const asset = await build(tiledTiffFile({ name: "downloaded (1).tif" }), { name: "Quadra 12" });
  assert.equal(asset.name, "Quadra 12");
});
