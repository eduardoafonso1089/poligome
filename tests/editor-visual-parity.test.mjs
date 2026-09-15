/**
 * Visual parity with the pre-refactor editor.
 *
 * The class names and the grid geometry below are a contract between three
 * places: the chrome that renders them, the stylesheet that positions them, and
 * the Playwright audits that click them. Breaking any one of the three in
 * isolation is the failure this file is here to catch, so the markup side is
 * asserted by rendering and the layout side by reading the rule itself.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { render, handlers, countClass, attributeValues } from "./helpers/render.mjs";
import { CHROME_HANDLER_NAMES, chromeProps, assets, labels, polygon } from "./helpers/editor-fixtures.mjs";
import { cssRule, sourceOf } from "./helpers/source.mjs";
import { PreRefactorTopbar, PreRefactorToolbar, PreRefactorStatus } from "../app/editor/presentation/pre-refactor-chrome.tsx";
import { EditorManagementPanels } from "../app/editor/panels/editor-management-panels.tsx";
import { getCopy } from "../app/lib/i18n.ts";

const STYLESHEET = "app/editor/presentation/pre-refactor-canonical.module.css";
const chromeHandlers = handlers(CHROME_HANDLER_NAMES);
const chrome = (Component, overrides) => render(Component, { ...chromeProps(overrides), ...chromeHandlers });

test("desktop chrome restores the pre-refactor topbar, file menu, toolbar and status composition", () => {
  const topbar = chrome(PreRefactorTopbar);
  for (const landmark of ["topbar", "topbar-main", "menubar"]) {
    assert.equal(countClass(topbar, landmark), 1, `missing landmark: ${landmark}`);
  }
  assert.equal(countClass(chrome(PreRefactorToolbar), "tools"), 1);
  assert.equal(countClass(chrome(PreRefactorStatus), "status"), 1);
});

test("the file menu keeps its own popover container", () => {
  // The menu is opened by state the server render never sets, so the container
  // is what can be checked here; run-editor-interaction-audit.mjs opens it.
  assert.match(sourceOf("app/editor/presentation/pre-refactor-chrome.tsx"), /className="project-pop menu-pop"/);
});

test("the toolbar keeps the icon vocabulary of the pre-refactor editor", () => {
  // lucide renders each icon as an SVG with its own class, so the names survive
  // into the markup and a silently swapped icon fails here.
  const icons = attributeValues(chrome(PreRefactorToolbar), "class").join(" ");
  for (const icon of ["mouse-pointer", "pentagon", "scissors", "magnet", "undo", "redo", "wand-sparkles"]) {
    assert.ok(icons.includes(`lucide-${icon}`), `missing toolbar icon: ${icon}`);
  }
});

test("canonical workspace preserves the old three-column desktop dimensions and mobile drawers", () => {
  const stylesheet = sourceOf(STYLESHEET);
  assert.match(stylesheet, /grid-column: 1/);
  assert.match(stylesheet, /grid-column: 3/);
  assert.match(stylesheet, /@media \(max-width: 860px\)/);
  assert.match(stylesheet, /width: min\(310px, 86vw\)/);
  // Off-canvas in both directions: the left drawer slides out left, the right one right.
  assert.match(stylesheet, /translateX\(-105%\)/);
  assert.match(stylesheet, /translateX\(105%\)/);
});

test("the stage keeps a stable scroll geometry", () => {
  assert.match(cssRule(STYLESHEET, ".stageScroll"), /overflow: auto !important/);
});

const panels = (overrides = {}) => render(EditorManagementPanels, {
  assets: assets(),
  currentAssetId: "img",
  annotations: [polygon()],
  annotationCountByAsset: new Map([["img", 1]]),
  annotationCountByLabel: new Map([["class-a", 1]]),
  activeAssetAnnotations: [polygon()],
  labels: labels(),
  activeLabelId: "class-a",
  selection: { selected: null, multiSelected: [], anchorId: null },
  hiddenAnnotationIds: new Set(),
  hiddenLabelIds: new Set(),
  copy: getCopy("pt"),
  loading: false,
  ...handlers([
    "onImportImages", "onImportAnnotations", "onSelectAsset", "onMoveAsset", "onDeleteAsset",
    "onDeleteAssets", "onSelectAnnotation", "onMoveAnnotation", "onDeleteAnnotations",
    "onClearAnnotations", "onToggleAnnotationVisibility", "onToggleLabelVisibility",
    "onSelectAllAnnotations", "onClearAnnotationSelection", "onActiveLabelChange",
    "onBatchReclassify", "onCreateLabel", "onRenameLabel", "onRecolorLabel", "onDeleteLabel",
  ]),
  ...overrides,
});

test("mobile drawers remain driven by explicit React state", () => {
  const markup = panels();
  // Both drawers exist in the markup at all times and are closed by default:
  // a drawer that only appeared once opened could not animate.
  assert.deepEqual(attributeValues(markup, "data-panel"), ["images", "right"]);
  assert.deepEqual(attributeValues(markup, "data-open"), ["false", "false"]);
  assert.deepEqual(attributeValues(markup, "data-mobile-toggle"), ["images", "right"]);
});

test("the drawers can also be opened from outside the panels", () => {
  // The topbar buttons live in another component, so they ask through an event
  // the panels listen for in an effect.
  const source = sourceOf("app/editor/panels/editor-management-panels.tsx");
  assert.match(source, /poligome:open-images/);
  assert.match(source, /poligome:open-right/);
});
