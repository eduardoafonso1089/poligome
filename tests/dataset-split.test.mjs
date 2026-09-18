import assert from "node:assert/strict";
import test from "node:test";
import { buildAnnotationPackageManifest } from "../app/editor/export/annotation-package-manifest.ts";
import { assignDatasetSplits, splitAssets } from "../app/editor/export/dataset-split.ts";

function assets(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `image-${index + 1}`,
    name: `image-${index + 1}.png`,
    src: "",
    width: 100,
    height: 100,
  }));
}

function annotationsWithCounts(items, counts) {
  return counts.flatMap((count, assetIndex) => Array.from({ length: count }, (_, annotationIndex) => ({
    id: `annotation-${assetIndex}-${annotationIndex}`,
    asset: items[assetIndex].id,
    label: "object",
    type: "box",
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  })));
}

test("random split uses largest remainders for an optional test set", () => {
  const items = assets(10);
  const assignment = assignDatasetSplits(items, [], {
    train: 70,
    val: 20,
    test: 10,
    includeTest: true,
    strategy: "random",
  }, () => 0.25);

  const result = splitAssets(assignment, items);
  assert.deepEqual({
    train: result.train?.length,
    val: result.val?.length,
    test: result.test?.length,
  }, { train: 7, val: 2, test: 1 });
});

test("random split assigns every image exactly once", () => {
  const items = assets(10);
  let calls = 0;
  const assignment = assignDatasetSplits(items, [], {
    train: 70,
    val: 20,
    test: 10,
    includeTest: true,
    strategy: "random",
  }, () => calls++ % 2 ? 0.99 : 0);

  assert.equal(assignment.size, items.length);
  assert.deepEqual([...assignment.keys()].sort(), items.map((item) => item.id).sort());
});

test("balanced split targets the requested instance proportions", () => {
  const items = assets(4);
  const annotations = annotationsWithCounts(items, [8, 6, 2, 0]);
  const assignment = assignDatasetSplits(items, annotations, {
    train: 50,
    val: 50,
    test: 0,
    includeTest: false,
    strategy: "balanced",
  });

  const instanceCounts = { train: 0, val: 0 };
  for (const annotation of annotations) instanceCounts[assignment.get(annotation.asset)] += 1;
  assert.deepEqual(instanceCounts, { train: 8, val: 8 });
  assert.deepEqual({
    train: splitAssets(assignment, items).train?.length,
    val: splitAssets(assignment, items).val?.length,
  }, { train: 2, val: 2 });
});

test("annotation package manifest contains references but no image source", () => {
  const items = [{
    id: "image-1",
    name: "field.png",
    src: "data:image/png;base64,secret-bytes",
    width: 640,
    height: 480,
  }];
  const assignment = new Map([["image-1", "train"]]);

  const manifest = buildAnnotationPackageManifest(items, assignment, "yolo", "bbox");

  assert.deepEqual(manifest.images, [{
    asset_id: "image-1",
    file_name: "field.png",
    width: 640,
    height: 480,
    split: "train",
  }]);
  assert.doesNotMatch(JSON.stringify(manifest), /secret-bytes|data:image|"src"/);
});
