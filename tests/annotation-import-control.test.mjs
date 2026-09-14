import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the image-panel COCO action opens the canonical annotation importer", async () => {
  const [panels, workbench, importer] = await Promise.all([
    readFile(new URL("../app/editor/panels/editor-management-panels.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/editor/workbench/canonical-editor-workbench.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/editor/import/coco-import-control.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(panels, /onImportAnnotations\?: \(\) => void/);
  assert.match(panels, /className="import coco-import-action"[^>]*onClick=\{props\.onImportAnnotations\}/);
  assert.match(panels, /title=\{copy\.selectAllImages\}/);
  assert.match(panels, /setSelectedImageIds\(new Set\(assets\.map/);
  assert.match(workbench, /annotationImportRef = useRef<CocoImportHandle>\(null\)/);
  assert.match(workbench, /showTrigger=\{false\}/);
  assert.match(workbench, /onImportAnnotations=\{\(\) => annotationImportRef\.current\?\.open\(\)\}/);
  assert.match(importer, /useImperativeHandle\(ref, \(\) => \(\{ open: \(\) => inputRef\.current\?\.click\(\) \}\), \[\]\)/);
  assert.match(importer, /function afterNextPaint\(\)/);
  assert.match(importer, /importSelectionRef = useRef/);
  assert.match(importer, /selectionTouchedRef = useRef\(false\)/);
  assert.match(importer, /function currentImportSelection\(currentPending: PendingCoco\)/);
  assert.match(importer, /updateImportSelection\(plan\.geometryTypes, plan\.candidates\.map\(\(candidate\) => candidate\.index\), false\)/);
  assert.match(importer, /candidates\.find\(\(candidate\) => candidate\.index === index\)\?\.geometries\.some\(\(item\) => nextGeometryTypes\.includes\(item\)\)/);
  assert.match(importer, /const chunkSize = selectedGeometryTypes\.includes\("polygon"\) \? 25 : 500/);
  assert.match(importer, /updateImportSelection\(plan\.geometryTypes, plan\.candidates\.map/);
  assert.match(importer, /flushSync\(\(\) => \{\s*setImporting\(true\);\s*close\(\);/);
  assert.match(importer, /importedAnnotations\.push\(\.\.\.chunkResult\.annotations\);\s*unmatched \+= chunkResult\.unmatched;/);
  assert.match(importer, /disabled=\{importing \|\| !canImport\} onClick=\{\(\) => void importSelected\(\)\}>OK<\/button>/);
  // The import can always be dismissed/aborted, even while a load is in progress.
  assert.match(importer, /function requestClose\(\)\s*\{\s*cancelledRef\.current = true;\s*close\(\);/);
  assert.match(importer, /if \(cancelledRef\.current\) break;/);
  assert.match(importer, /onClick=\{requestClose\}/);
});
