/**
 * The COCO import path, from the panel button to the imported annotations.
 *
 * The importer runs against animation frames and a worker, so its progressive
 * behaviour belongs to the audits; what is asserted here is the contract
 * between the three files involved and the decisions the importer takes on the
 * way — chunking, selection, and the ability to abort mid-import.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { region, sourceOf } from "./helpers/source.mjs";

const IMPORTER = "app/editor/import/coco-import-control.tsx";
const panels = sourceOf("app/editor/panels/editor-management-panels.tsx");
const workbench = sourceOf("app/editor/workbench/canonical-editor-workbench.tsx");
const importer = sourceOf(IMPORTER);

test("the image-panel COCO action opens the canonical annotation importer", () => {
  assert.match(panels, /onImportAnnotations\?: \(\) => void/);
  assert.match(panels, /className="import coco-import-action"/);
  assert.match(panels, /onClick=\{props\.onImportAnnotations\}/);
  // One importer instance, owned by the workbench, opened through a handle: the
  // panel must not own a second file input of its own.
  assert.match(workbench, /annotationImportRef = useRef<CocoImportHandle>\(null\)/);
  assert.match(workbench, /showTrigger=\{false\}/);
  assert.match(workbench, /onImportAnnotations=\{\(\) => annotationImportRef\.current\?\.open\(\)\}/);
  assert.match(importer, /useImperativeHandle\(ref, \(\) => \(\{ open: \(\) => inputRef\.current\?\.click\(\) \}\), \[\]\)/);
});

test("the panel can select every image at once before importing", () => {
  assert.match(panels, /title=\{copy\.selectAllImages\}/);
  assert.match(panels, /setSelectedImageIds\(new Set\(assets\.map/);
});

test("the import keeps its own selection, so a repaint cannot reset it", () => {
  assert.match(importer, /importSelectionRef = useRef/);
  assert.match(importer, /selectionTouchedRef = useRef\(false\)/);
  assert.match(importer, /function currentImportSelection\(currentPending: PendingCoco\)/);
  // Everything is preselected until the user touches the selection themselves.
  assert.match(importer, /updateImportSelection\(plan\.geometryTypes, plan\.candidates\.map\(\(candidate\) => candidate\.index\), false\)/);
  assert.match(importer, /candidates\.find\(\(candidate\) => candidate\.index === index\)\?\.geometries\.some\(\(item\) => nextGeometryTypes\.includes\(item\)\)/);
});

test("polygon-heavy documents are imported in smaller chunks", () => {
  // A polygon costs far more to convert than a box, so the chunk that keeps the
  // browser responsive is five times smaller.
  assert.match(importer, /const chunkSize = selectedGeometryTypes\.includes\("polygon"\) \? 100 : 500/);
  assert.match(importer, /importedAnnotations\.push\(\.\.\.chunkResult\.annotations\); unmatched \+= chunkResult\.unmatched;/);
  assert.match(importer, /function afterNextPaint\(\)/);
});

test("the dialog commits the import in one paint and can always be dismissed", () => {
  assert.match(importer, /flushSync\(\(\) => \{ setImporting\(true\); close\(\);/);
  assert.match(importer, /disabled=\{importing \|\| !canImport\} onClick=\{\(\) => void importSelected\(\)\}>OK<\/button>/);
  // Aborting is checked between chunks, so a long import stops at the next one.
  assert.match(region(IMPORTER, "function requestClose()"), /cancelledRef\.current = true; close\(\);/);
  assert.match(importer, /if \(cancelledRef\.current\) break;/);
  assert.match(importer, /onClick=\{requestClose\}/);
});
