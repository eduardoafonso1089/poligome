import assert from "node:assert/strict";
import test from "node:test";
import { render } from "./helpers/render.mjs";
import { summarizeImageIssues } from "../app/editor/import/annotation-import-summary.ts";
import { CocoImportControl } from "../app/editor/import/coco-import-control.tsx";
import { getCopy } from "../app/lib/i18n.ts";

test("annotation picker accepts standalone COCO JSON and annotation ZIPs", () => {
  const markup = render(CocoImportControl, {
    assets: [{ id: "image", name: "image.png", src: "", width: 10, height: 10 }],
    labels: [],
    annotations: [],
    makeId: (prefix) => `${prefix}-1`,
    language: "pt",
    showTrigger: false,
    onImported: () => undefined,
  });

  assert.match(markup, /accept="application\/json,application\/zip,\.json,\.zip"/);
});

test("image issue summary separates missing, ambiguous, and invalid references", () => {
  const summary = summarizeImageIssues([
    { reference: "missing.png", reason: "missing" },
    { reference: "duplicate.png", reason: "ambiguous" },
    { reference: "labels/train/bad.txt:2", reason: "invalid" },
  ]);

  assert.deepEqual(summary, {
    total: 3,
    missing: ["missing.png"],
    ambiguous: ["duplicate.png"],
    invalid: ["labels/train/bad.txt:2"],
  });
});

test("all platform languages describe package detection and image match warnings", () => {
  const keys = [
    "annotationPackageFormat",
    "matchedImages",
    "imagesWithoutMatch",
    "ambiguousImages",
    "invalidEntries",
    "partialImport",
    "noMatchingImages",
  ];
  for (const language of ["pt", "en", "fr", "es"]) {
    const copy = getCopy(language);
    for (const key of keys) assert.equal(typeof copy[key], "string", `${language}.${key}`);
  }
});
