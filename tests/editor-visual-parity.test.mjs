import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const chrome = await readFile(new URL("../app/editor/presentation/pre-refactor-chrome.tsx", import.meta.url), "utf8");
const exactCss = await readFile(new URL("../app/editor/presentation/pre-refactor-canonical.module.css", import.meta.url), "utf8");
const panels = await readFile(new URL("../app/editor/panels/editor-management-panels.tsx", import.meta.url), "utf8");

test("desktop chrome restores the pre-refactor topbar, file menu, toolbar and status composition", () => {
  assert.match(chrome, /className="topbar"/);
  assert.match(chrome, /className="topbar-main"/);
  assert.match(chrome, /className="menubar"/);
  assert.match(chrome, /className="project-pop menu-pop"/);
  assert.match(chrome, /className="tools"/);
  assert.match(chrome, /className="status"/);
  assert.match(chrome, /WandSparkles/);
  assert.match(chrome, /MousePointer2/);
  assert.match(chrome, /Pentagon/);
  assert.match(chrome, /Scissors/);
  assert.match(chrome, /Magnet/);
  assert.match(chrome, /Undo2/);
  assert.match(chrome, /Redo2/);
});

test("canonical workspace preserves the old three-column desktop dimensions and mobile drawers", () => {
  assert.match(exactCss, /grid-column:\s*1/);
  assert.match(exactCss, /grid-column:\s*3/);
  assert.match(exactCss, /@media \(max-width: 860px\)/);
  assert.match(exactCss, /width:\s*min\(310px, 86vw\)/);
  assert.match(exactCss, /translateX\(-105%\)/);
  assert.match(exactCss, /translateX\(105%\)/);
});

test("mobile drawers remain driven by explicit React state", () => {
  assert.match(panels, /data-panel="images" data-open=\{leftOpen/);
  assert.match(panels, /data-panel="right" data-open=\{rightOpen/);
  assert.match(panels, /data-mobile-toggle="images"/);
  assert.match(panels, /data-mobile-toggle="right"/);
  assert.match(panels, /poligome:open-images/);
  assert.match(panels, /poligome:open-right/);
});
