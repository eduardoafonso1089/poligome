/**
 * Component layer: what the editor chrome actually renders.
 *
 * Replaces the source-text assertions in editor-interface-structure,
 * project-lifecycle-parity, project-save-mode-ui, editor-preferences,
 * mobile-toolbar-deduplication, canonical-workbench-i18n and default-stroke.
 *
 * Those pinned formatting — one of them required an entire arrow function to sit
 * on a single line, so running a formatter failed CI. These assert on the
 * rendered controls instead, which is what a user and the Playwright audits meet.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { render, handlers, attributeValues, countAttribute, countClass, buttons, attribute, text } from "./helpers/render.mjs";
import { CHROME_HANDLER_NAMES, chromeProps } from "./helpers/editor-fixtures.mjs";
import { PreRefactorTopbar, PreRefactorToolbar, PreRefactorStatus } from "../app/editor/presentation/pre-refactor-chrome.tsx";
import { getCopy } from "../app/lib/i18n.ts";

const chromeHandlers = handlers(CHROME_HANDLER_NAMES);
const toolbar = (overrides) => render(PreRefactorToolbar, { ...chromeProps(overrides), ...chromeHandlers });
const topbar = (overrides) => render(PreRefactorTopbar, { ...chromeProps(overrides), ...chromeHandlers });
const status = (overrides) => render(PreRefactorStatus, { ...chromeProps(overrides), ...chromeHandlers });

const titlesOf = (markup) => attributeValues(markup, "title");

test("the toolbar renders the canonical tool set with its shortcut hints", () => {
  const markup = toolbar();
  const copy = getCopy("pt");
  for (const [label, hint] of [[copy.select, "V"], [copy.pan, "H"], [copy.box, "B"], [copy.polygon, "P"], [copy.freehand, "F"], [copy.line, "L"], [copy.point, "K"]]) {
    assert.ok(titlesOf(markup).includes(label), `missing tool: ${label}`);
    assert.ok(markup.includes(`<small>${hint}</small>`), `missing shortcut hint: ${hint}`);
  }
});

const pressedTitles = (markup) => buttons(markup)
  .filter((button) => attribute(button, "aria-pressed") === "true")
  .map((button) => attribute(button, "title"));

test("exactly one drawing tool is marked pressed at a time", () => {
  const copy = getCopy("pt");
  // Toggles such as snapping also use aria-pressed, so the assertion is scoped
  // to the mutually exclusive drawing tools.
  const tools = [copy.select, copy.pan, copy.box, copy.polygon, copy.freehand, copy.line, copy.point];
  const pressedTools = (markup) => pressedTitles(markup).filter((title) => tools.includes(title));

  assert.deepEqual(pressedTools(toolbar({ tool: "box" })), [copy.box]);
  assert.deepEqual(pressedTools(toolbar({ tool: "polygon" })), [copy.polygon]);
  assert.deepEqual(pressedTools(toolbar({ tool: "select" })), [copy.select]);
});

test("the snap toggle reports its own state, independent of the tool", () => {
  const copy = getCopy("pt");
  const on = pressedTitles(toolbar({ snapEnabled: true })).some((title) => title.startsWith(copy.snapOn));
  const off = pressedTitles(toolbar({ snapEnabled: false })).some((title) => title.startsWith(copy.snapOff));
  assert.ok(on, "snap on should be pressed");
  assert.ok(!off, "snap off must not be pressed");
});

test("a vector tool takes precedence over the drawing tool for the active state", () => {
  const copy = getCopy("pt");
  const pressed = pressedTitles(toolbar({ tool: "select", vectorTool: "split" }));
  assert.ok(pressed.includes(copy.split), `split not active: ${pressed.join(", ")}`);
  assert.ok(!pressed.includes(copy.select), "select must not stay active under a vector tool");
});

const isDisabled = (markup, title) => {
  const button = buttons(markup).find((candidate) => attribute(candidate, "title") === title);
  assert.ok(button, `no control titled ${title}`);
  return /\sdisabled\b/.test(button);
};

test("capability flags drive the disabled state of the edit tools", () => {
  const copy = getCopy("pt");
  const disabled = isDisabled;

  assert.ok(disabled(toolbar({ canSimplify: false }), copy.simplify));
  assert.ok(!disabled(toolbar({ canSimplify: true }), copy.simplify));
  assert.ok(disabled(toolbar({ canDuplicate: false }), copy.duplicate));
  assert.ok(!disabled(toolbar({ canDuplicate: true }), copy.duplicate));
  assert.ok(disabled(toolbar({ canEditPolygon: false }), copy.split));
  assert.ok(!disabled(toolbar({ canEditPolygon: true }), copy.split));
  assert.ok(disabled(toolbar({ canUndo: false }), copy.undo));
  assert.ok(!disabled(toolbar({ canUndo: true }), copy.undo));
});

test("every tool is disabled while no usable image is loaded", () => {
  const copy = getCopy("pt");
  const markup = toolbar({ hasAsset: false });
  for (const label of [copy.select, copy.pan, copy.box, copy.polygon, copy.point]) {
    assert.ok(isDisabled(markup, label), `${label} should be disabled without an image`);
  }
});

test("multi-selection is a touch-only toolbar action and never duplicated", () => {
  const copy = getCopy("pt");
  const desktop = toolbar({ touchMode: false });
  const touch = toolbar({ touchMode: true });
  assert.equal(countAttribute(desktop, "title", copy.multipleSelection), 0);
  assert.equal(countAttribute(touch, "title", copy.multipleSelection), 1, "exactly one multi-select control on touch");
});

test("the polygon union control is absent, as PR #14 decided", () => {
  const copy = getCopy("pt");
  // Kept as an explicit test so that restoring it is a deliberate act, not a slip.
  assert.equal(countAttribute(toolbar({ canMerge: true }), "title", copy.merge), 0);
});

test("the stroke control reflects and bounds the current width", () => {
  const markup = toolbar({ strokePx: 4 });
  assert.match(markup, /type="range"/);
  assert.equal(attributeValues(markup, "min")[0], "1");
  assert.equal(attributeValues(markup, "max")[0], "10");
  assert.equal(attributeValues(markup, "value")[0], "4");
  assert.match(markup, /<output>4px<\/output>/);
});

test("the zoom readout rounds to whole percent", () => {
  assert.match(toolbar({ zoom: 92.4 }), /<span>92%<\/span>/);
  assert.match(toolbar({ zoom: 137.6 }), /<span>138%<\/span>/);
});

test("draft controls appear only for tools that have a draft to finish", () => {
  const copy = getCopy("pt");
  assert.equal(countClass(toolbar({ tool: "select" }), "drawing-actions"), 1);
  assert.ok(!toolbar({ tool: "select" }).includes(copy.finishDrawing));
  assert.ok(toolbar({ tool: "polygon" }).includes(copy.finishDrawing));
  assert.ok(toolbar({ tool: "line" }).includes(copy.finishDrawing));
});

test("the empty-project overlay offers exactly the three ways in", () => {
  const copy = getCopy("pt");
  const markup = toolbar({ hasAssets: false });
  assert.ok(markup.includes(copy.importImages));
  assert.ok(markup.includes(copy.openProject));
  assert.ok(markup.includes(copy.tryDemo));
  assert.ok(!toolbar({ hasAssets: true }).includes(copy.emptyProjectTitle));
});

test("the topbar shows the project name and its unsaved state", () => {
  const clean = topbar({ projectName: "Meu projeto", dirty: false });
  const dirty = topbar({ projectName: "Meu projeto", dirty: true });
  assert.ok(text(clean).includes("Meu projeto"));
  assert.ok(text(dirty).includes(getCopy("pt").saving));
  assert.ok(text(clean).includes(getCopy("pt").saved));
});

test("the interface is translated by the language prop alone", () => {
  for (const language of ["pt", "en", "fr", "es"]) {
    const copy = getCopy(language);
    const markup = toolbar({ language });
    assert.ok(titlesOf(markup).includes(copy.select), `${language}: select tool not translated`);
    assert.ok(titlesOf(markup).includes(copy.undo), `${language}: undo not translated`);
  }
});

test("no copy leaks between languages in the rendered chrome", () => {
  const ptOnly = getCopy("pt").fitImage;
  const enOnly = getCopy("en").fitImage;
  assert.notEqual(ptOnly, enOnly);
  assert.ok(titlesOf(toolbar({ language: "en" })).includes(enOnly));
  assert.ok(!titlesOf(toolbar({ language: "en" })).includes(ptOnly));
});

test("the status bar reports the message it is given", () => {
  assert.ok(text(status({ statusMessage: "7 anotações nesta imagem" })).includes("7 anotações nesta imagem"));
});

test("icon-only controls carry an accessible name", () => {
  // A control with no text of its own is unreachable by screen reader and by the
  // audits unless it is named. Buttons that render their own label are exempt.
  for (const [name, markup] of [["toolbar", toolbar()], ["topbar", topbar()], ["status", status()]]) {
    const unnamed = buttons(markup).filter((button) =>
      !attribute(button, "aria-label") && !attribute(button, "title"));
    const iconOnly = unnamed.filter((button) => {
      const rest = markup.slice(markup.indexOf(button) + button.length);
      const inner = rest.slice(0, rest.indexOf("</button>"));
      return text(inner) === "";
    });
    assert.deepEqual(iconOnly, [], `${name}: icon-only control without a name`);
  }
});

test("structural landmarks the stylesheet and the audits depend on are present", () => {
  assert.equal(countClass(toolbar(), "tools"), 1);
  assert.equal(countClass(topbar(), "topbar"), 1);
});
