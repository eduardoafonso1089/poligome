import assert from "node:assert/strict";
import test from "node:test";
import {
  buildQualitySummary,
  setAnnotationReviewScore,
  setAssetReviewScore,
  setLabelReviewScore,
} from "../app/editor/review/quality-review-model.ts";

const assets = [
  { id: "a1", name: "one.png", src: "one", width: 100, height: 100 },
  { id: "a2", name: "two.png", src: "two", width: 200, height: 100 },
];
const labels = [
  { id: "weed", name: "Weed", color: "#0f0", key: "1" },
  { id: "crop", name: "Crop", color: "#00f", key: "2" },
  { id: "empty", name: "Empty", color: "#f00", key: "3" },
];
const annotations = [
  { id: "b", asset: "a1", label: "weed", type: "box", x: 0, y: 0, width: 10, height: 20 },
  { id: "p", asset: "a1", label: "crop", type: "polygon", vertices: [
    { id: "v1", x: 0, y: 0 }, { id: "v2", x: 10, y: 0 }, { id: "v3", x: 10, y: 10 }, { id: "v4", x: 0, y: 10 },
  ], holes: [[
    { id: "h1", x: 2, y: 2 }, { id: "h2", x: 4, y: 2 }, { id: "h3", x: 4, y: 4 }, { id: "h4", x: 2, y: 4 },
  ]] },
  { id: "pt", asset: "a2", label: "weed", type: "point", x: 5, y: 5 },
];

test("quality summary uses source-image pixel geometry", () => {
  const summary = buildQualitySummary(assets, labels, annotations);
  assert.deepEqual(summary.perImage.map(({ item, count }) => [item.id, count]), [["a1", 2], ["a2", 1]]);
  assert.equal(summary.minPerImage, 1);
  assert.equal(summary.maxPerImage, 2);
  assert.equal(summary.maxCount, 2);
  assert.deepEqual(summary.counts.map(({ label, count }) => [label.id, count]), [["weed", 2], ["crop", 1], ["empty", 0]]);
  assert.equal(summary.areas.get("weed"), 200);
  assert.equal(summary.areas.get("crop"), 96);
  assert.equal(summary.areas.get("empty"), 0);
  assert.deepEqual(summary.emptyLabelIds, ["empty"]);
  assert.deepEqual(summary.emptyAssetIds, []);
});

test("review score updates are immutable and constrained to 1..5", () => {
  const reviewedAssets = setAssetReviewScore(assets, "a1", 5);
  const reviewedLabels = setLabelReviewScore(labels, "crop", 3);
  const reviewedAnnotations = setAnnotationReviewScore(annotations, "b", 1);
  assert.notEqual(reviewedAssets, assets);
  assert.equal(reviewedAssets[0].reviewScore, 5);
  assert.equal(assets[0].reviewScore, undefined);
  assert.equal(reviewedLabels[1].reviewScore, 3);
  assert.equal(reviewedAnnotations[0].reviewScore, 1);
  assert.throws(() => setAssetReviewScore(assets, "a1", 0), /1 and 5/);
  assert.throws(() => setLabelReviewScore(labels, "crop", 6), /1 and 5/);
});

test("review update returns original collection when the target does not exist", () => {
  assert.equal(setAssetReviewScore(assets, "missing", 4), assets);
  assert.equal(setLabelReviewScore(labels, "missing", 4), labels);
  assert.equal(setAnnotationReviewScore(annotations, "missing", 4), annotations);
});
