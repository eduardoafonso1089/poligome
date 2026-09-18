import test from "node:test";
import assert from "node:assert/strict";
import { render, countClass, text } from "./helpers/render.mjs";
import { getCopy } from "../app/lib/i18n.ts";
import { defaultYoloExportOptions } from "../app/editor/export/export-files.ts";
import * as exportControls from "../app/editor/export/export-controls.tsx";

const Dialog = exportControls.ExportOptionsDialog ?? (() => null);
const ChoiceDialog = exportControls.ExportChoiceDialog ?? (() => null);

test("export starts with dataset structure and YOLO annotation choices", () => {
  const markup = render(ChoiceDialog, {
    format: "yolo",
    options: defaultYoloExportOptions,
    copy: getCopy("pt"),
    busy: false,
    onChange() {},
    onClose() {},
    onSingle() {},
    onSplit() {},
  });
  assert.equal(countClass(markup, "modal-backdrop"), 1);
  assert.match(markup, /role="dialog"/);
  assert.match(text(markup), /Conjunto único/);
  assert.match(text(markup), /Dividir dataset/);
  assert.match(text(markup), /Somente caixas/);
  assert.doesNotMatch(text(markup), /Treino|Validação|Balanceada/);
});

test("export configuration is a localized modal instead of inline menu content", () => {
  const markup = render(Dialog, {
    format: "yolo",
    options: defaultYoloExportOptions,
    copy: getCopy("pt"),
    busy: false,
    onChange() {},
    onClose() {},
    onExport() {},
  });
  assert.equal(countClass(markup, "modal-backdrop"), 1);
  assert.match(markup, /role="dialog"/);
  assert.match(text(markup), /Configurar exportação YOLO/);
  assert.match(text(markup), /Treino|Validação|Balanceada/);
  assert.doesNotMatch(text(markup), /Somente caixas|Caixas e polígonos/);
  assert.doesNotMatch(text(markup), /Annotations|Include test split|Distribution/);
});

test("pointer interaction inside the portaled modal does not close its parent menu", () => {
  const element = Dialog({
    format: "yolo",
    options: defaultYoloExportOptions,
    copy: getCopy("pt"),
    busy: false,
    onChange() {},
    onClose() {},
    onExport() {},
  });
  let stopped = false;
  assert.equal(typeof element.props.onPointerDown, "function");
  element.props.onPointerDown({ stopPropagation() { stopped = true; } });
  assert.equal(stopped, true);
});

test("export is enabled only when active split proportions total 100", () => {
  const isValid = exportControls.validExportRatios ?? (() => false);
  assert.equal(isValid({ ...defaultYoloExportOptions, train: 80, val: 20 }), true);
  assert.equal(isValid({ ...defaultYoloExportOptions, train: 80, val: 30 }), false);
  assert.equal(isValid({ ...defaultYoloExportOptions, includeTest: true, train: 70, val: 20, test: 10 }), true);
});

test("all platform languages provide export dialog copy", () => {
  for (const language of ["pt", "en", "fr", "es"]) {
    const copy = getCopy(language);
    assert.equal(typeof copy.exportSettingsTitle, "string", `${language} title`);
    assert.equal(typeof copy.exportImagesExcluded, "string", `${language} privacy copy`);
    assert.equal(typeof copy.exportInvalidRatios, "string", `${language} ratio validation`);
    assert.equal(typeof copy.exportSingleDataset, "string", `${language} single dataset copy`);
    assert.equal(typeof copy.exportSplitDataset, "string", `${language} split dataset copy`);
  }
});
