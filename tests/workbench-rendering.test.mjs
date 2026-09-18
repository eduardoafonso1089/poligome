/**
 * Composition layer: the whole editor, rendered.
 *
 * canonical-editor-workbench.tsx is the file the review found most locked down
 * by the suite — ten tests used to assert things about its text. It renders
 * fine on the server, so the composition it produces can simply be looked at:
 * every part present once, the empty project it starts from, and the inputs it
 * owns on behalf of the panels.
 *
 * Only the first render is available here, and effects never run. Anything that
 * needs a click or a second render is covered by the audits under scripts/.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { render, attributeValues, countClass, text } from "./helpers/render.mjs";
import { getCopy } from "../app/lib/i18n.ts";
import { CanonicalEditorWorkbench } from "../app/editor/workbench/canonical-editor-workbench.tsx";

const markup = render(CanonicalEditorWorkbench);
const copy = getCopy("pt");

test("the editor is one shell composing topbar, panels, toolbar and stage", () => {
  for (const landmark of ["shell", "topbar", "workspace", "tools", "stage"]) {
    assert.equal(countClass(markup, landmark), 1, `${landmark} should appear exactly once`);
  }
  assert.equal(countClass(markup, "canonical-management-panels"), 1, "the panels must not be rendered twice");
});

test("quality and review are rendered through the management tabs, not a hidden duplicate panel", () => {
  assert.equal(countClass(markup, "reviewPanel"), 0);
});

test("the shell is announced with the product name and the current project", () => {
  const main = markup.match(/<main[^>]*>/)?.[0] ?? "";
  assert.match(main, /aria-label="[^"]*Poligome[^"]*"/);
  assert.ok(main.includes(copy.newProject), "the accessible name carries the project name");
});

test("the workbench owns one hidden input per kind of file the editor accepts", () => {
  const inputs = [...markup.matchAll(/<input[^>]*type="file"[^>]*>/g)].map((match) => match[0]);
  const accepts = inputs.map((input) => input.match(/accept="([^"]*)"/)?.[1]);

  assert.deepEqual(accepts, [
    ".plgm,application/vnd.poligome.project+zip",
    "image/png,image/jpeg,image/webp,image/bmp,image/gif",
    "image/*,.tif,.tiff",
    "application/json,application/zip,text/plain,.json,.zip,.txt,.names",
  ]);
  assert.ok(inputs.every((input) => input.includes("hidden")), "file inputs are opened by buttons, never shown");
  // Images, rasters and annotations all arrive in batches. A project file does
  // not: opening one replaces the session, so there is nothing to batch.
  assert.deepEqual(inputs.map((input) => input.includes("multiple")), [false, true, true, true]);
});

test("a new project starts empty, with the way in offered on the stage", () => {
  assert.equal(countClass(markup, "pre-refactor-empty-overlay"), 1);
  assert.equal(attributeValues(markup, "data-annotation-id").length, 0, "nothing is drawn yet");
  assert.match(text(markup), /0 de 0/, "the progress readout starts at zero");
});

test("editing controls are disabled while there is no image", () => {
  assert.ok(countClass(markup, "disabled") > 0);
  const stroke = markup.match(/<input[^>]*type="range"[^>]*>/)?.[0] ?? "";
  assert.match(stroke, /disabled/);
});

test("the editor renders in the default language, with no other locale leaking in", () => {
  const body = text(markup);
  assert.ok(body.includes(copy.newProject));
  assert.ok(!body.includes(getCopy("en").newProject), "English copy must not appear in a Portuguese render");
  assert.ok(!body.includes(getCopy("fr").images), "French copy must not appear in a Portuguese render");
});

test("both mobile drawers are mounted and closed", () => {
  assert.deepEqual(attributeValues(markup, "data-panel"), ["images", "right"]);
  assert.deepEqual(attributeValues(markup, "data-open"), ["false", "false"]);
});
