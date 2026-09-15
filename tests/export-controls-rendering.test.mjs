/**
 * Component layer: the export menu.
 *
 * The export builders themselves are covered by canonical-export-files,
 * yolo-export and georeference-export, and byte-compared against main by
 * scripts/check-export-parity.mjs. What is checked here is the menu in front of
 * them: which formats are offered, and when each one is allowed to be clicked.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { render, buttons, attribute, text } from "./helpers/render.mjs";
import { assets, labels, polygon } from "./helpers/editor-fixtures.mjs";
import { ExportControls } from "../app/editor/export/export-controls.tsx";
import { getCopy } from "../app/lib/i18n.ts";

const controls = (overrides = {}) => render(ExportControls, {
  assets: assets(),
  labels: labels(),
  annotations: [polygon()],
  language: "pt",
  onMessage: () => undefined,
  ...overrides,
});

const entries = (markup) => buttons(markup).map((button) => ({
  title: attribute(button, "title") ?? "",
  disabled: /\sdisabled\b/.test(button),
}));

test("every supported format is offered, in one menu", () => {
  const body = text(controls());
  for (const format of ["COCO JSON", "YOLO ZIP", "GeoJSON", "Poligome"]) {
    assert.ok(body.includes(format), `missing export format: ${format}`);
  }
  assert.ok(buttons(controls()).every((button) => attribute(button, "role") === "menuitem"));
});

test("each entry is described in the active language", () => {
  const copy = getCopy("pt");
  assert.ok(text(controls()).includes(copy.cocoDesc));
  assert.ok(text(controls({ language: "en" })).includes(getCopy("en").cocoDesc));
  assert.ok(!text(controls({ language: "en" })).includes(copy.cocoDesc));
});

test("a project with no images can export nothing", () => {
  assert.ok(entries(controls({ assets: [] })).every((entry) => entry.disabled));
});

test("GeoJSON alone requires an annotation to export", () => {
  // An empty COCO file is a legitimate dataset skeleton; an empty FeatureCollection
  // is not something anyone asked for.
  const empty = entries(controls({ annotations: [] }));
  const geojson = empty.find((entry) => entry.title.includes("GeoJSON"));
  assert.equal(geojson?.disabled, true);
  assert.ok(empty.filter((entry) => !entry.title.includes("GeoJSON")).every((entry) => !entry.disabled));
});

test("the whole menu can be disabled from outside", () => {
  assert.ok(entries(controls({ disabled: true })).every((entry) => entry.disabled));
});
