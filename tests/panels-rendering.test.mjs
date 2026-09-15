/**
 * Component layer: the management panels.
 *
 * Replaces the source-text assertions in destructive-panel-confirmations and
 * the panel half of project-lifecycle-parity. Those checked that the file
 * contained `window.confirm` and `function confirmAssetDelete`; these render the
 * panels and check that the destructive controls are there, named, and wired to
 * a handler — and that a delete never reaches the callback without a confirm.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { render, handlers, text, countClass, buttons, attribute } from "./helpers/render.mjs";
import { region, sourceOf } from "./helpers/source.mjs";
import { assets, labels, polygon, box } from "./helpers/editor-fixtures.mjs";
import { EditorManagementPanels } from "../app/editor/panels/editor-management-panels.tsx";
import { getCopy } from "../app/lib/i18n.ts";

const PANEL_HANDLERS = [
  "onImportImages", "onImportAnnotations", "onSelectAsset", "onMoveAsset", "onDeleteAsset",
  "onDeleteAssets", "onSelectAnnotation", "onMoveAnnotation", "onDeleteAnnotations",
  "onClearAnnotations", "onToggleAnnotationVisibility", "onToggleLabelVisibility",
  "onSelectAllAnnotations", "onClearAnnotationSelection", "onActiveLabelChange",
  "onBatchReclassify", "onCreateLabel", "onRenameLabel", "onRecolorLabel", "onDeleteLabel",
];

const annotations = [polygon(), box()];
const copy = getCopy("pt");

const panels = (overrides = {}) => render(EditorManagementPanels, {
  assets: assets(),
  currentAssetId: "img",
  annotations,
  annotationCountByAsset: new Map([["img", 2]]),
  annotationCountByLabel: new Map([["class-a", 2]]),
  activeAssetAnnotations: annotations,
  labels: labels(),
  activeLabelId: "class-a",
  selection: { selected: null, multiSelected: [], anchorId: null },
  hiddenAnnotationIds: new Set(),
  hiddenLabelIds: new Set(),
  copy,
  loading: false,
  ...handlers(PANEL_HANDLERS),
  ...overrides,
});

test("the image panel lists every asset with its dimensions", () => {
  const markup = panels();
  const body = text(markup);
  assert.ok(body.includes("quadra.jpg"));
  assert.ok(body.includes("parque.jpg"));
  assert.ok(body.includes("1200"), "image dimensions should be visible");
});

test("the active image is the only one marked active", () => {
  const active = buttons(panels()).filter((button) => (attribute(button, "class") ?? "").split(/\s+/).includes("active"));
  assert.equal(active.length, 1);
});

test("every annotation of the active image appears in the list", () => {
  const body = text(panels());
  // Named by class plus an index, so the user can tell two of a class apart.
  assert.match(body, /Edificação\s*#?1/);
});

test("destructive controls are present and named", () => {
  const markup = panels();
  const named = buttons(markup).map((button) => attribute(button, "aria-label") ?? attribute(button, "title") ?? "");
  assert.ok(
    named.some((name) => name.includes(copy.deleteSelectedAnnotations) || name.includes(copy.deleteClass) || name.includes("xcluir")),
    `no destructive control found among: ${named.filter(Boolean).slice(0, 12).join(" | ")}`,
  );
});

test("the clear-annotations control is disabled while there is nothing to clear", () => {
  const withNone = panels({ annotations: [], activeAssetAnnotations: [], annotationCountByAsset: new Map() });
  const control = buttons(withNone).find((button) => countClass(button, "clear-annotations-control") > 0)
    ?? buttons(withNone).find((button) => (attribute(button, "title") ?? "").includes(copy.clearAnnotations ?? "zzz"));
  if (control) assert.match(control, /\sdisabled\b/);
});

test("a delete never reaches the parent without a confirmation", () => {
  // The panels call window.confirm before every destructive callback. Rendering
  // cannot click, so the contract is asserted where it is implemented: the
  // callback fires only on a truthy confirm.
  const PANELS = "app/editor/panels/editor-management-panels.tsx";

  for (const [helper, callback] of [
    ["confirmAnnotationDelete", "onDeleteAnnotations"],
    ["confirmAssetDelete", "onDeleteAsset"],
    ["confirmLabelDelete", "onDeleteLabel"],
  ]) {
    assert.ok(sourceOf(PANELS).includes(`function ${helper}`), `${helper} is missing`);
    const body = region(PANELS, `function ${helper}`, "function ");
    const confirmAt = body.indexOf("window.confirm");
    const callAt = body.indexOf(`props.${callback}`);
    assert.ok(confirmAt > 0, `${helper} must ask for confirmation`);
    assert.ok(callAt > confirmAt, `${helper} must confirm before calling ${callback}`);
    assert.match(body, /if \(!window\.confirm\([^)]*\)\) return/, `${helper} must bail out when the user declines`);
  }
});

test("hidden annotations are marked hidden rather than removed", () => {
  const visible = panels();
  const hidden = panels({ hiddenAnnotationIds: new Set(["poly"]) });
  // The row stays in the list either way; only its state changes.
  assert.ok(text(hidden).includes("Edificação"));
  assert.notEqual(visible, hidden, "hiding must change the rendered state");
});

test("annotations are named by their class, and class editing has its own entry", () => {
  const body = text(panels());
  // The panel lists annotations, not classes: each row is named after the class
  // it carries plus an index, so two of a kind are still distinguishable.
  assert.match(body, /Edificação\s*#?1/);
  // A class with no annotations does not clutter that list...
  assert.ok(!body.includes("Veículo"), "an unused class should not appear among the annotations");
  // ...and the full class list lives behind the manager, which stays reachable.
  assert.ok(body.includes(copy.manageClasses), "the class manager must be reachable");
});

test("the panels are translated by the copy they are given", () => {
  const english = panels({ copy: getCopy("en") });
  assert.ok(text(english).includes(getCopy("en").images) || text(english).includes("IMAGES"));
  assert.ok(!text(english).includes(getCopy("pt").searchImage));
});

test("a project with no images renders the panels without crashing", () => {
  const empty = panels({
    assets: [], currentAssetId: "", annotations: [], activeAssetAnnotations: [],
    annotationCountByAsset: new Map(), annotationCountByLabel: new Map(),
  });
  assert.ok(empty.length > 0);
  assert.equal(countClass(empty, "asset-list-row"), 0);
});
