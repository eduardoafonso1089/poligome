/**
 * The project lifecycle: new, open, rename, duplicate.
 *
 * This file is the one the review singled out: it required an entire arrow
 * function to sit on a single line, so running a formatter over the workbench
 * failed CI for a reason that had nothing to do with behaviour. Every assertion
 * here now goes through helpers/source.mjs, which collapses whitespace, and the
 * parts that render are asserted on the markup instead.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { region, sourceOf } from "./helpers/source.mjs";

// The rendered side of the lifecycle — the project name in the topbar and its
// saved/unsaved state — is covered by tests/chrome-rendering.test.mjs. What is
// left here is the state logic itself, which no server render can drive.
const WORKBENCH = "app/editor/workbench/canonical-editor-workbench.tsx";
const CHROME = "app/editor/presentation/pre-refactor-chrome.tsx";
const workbench = sourceOf(WORKBENCH);

test("renaming the project marks the session unsaved", () => {
  // The rename is a state update inside the workbench, so it cannot be driven
  // by a server render; what matters is that both effects happen together.
  const rename = region(WORKBENCH, "onRenameProject:", "}");
  assert.match(rename, /setProjectName\(name\)/);
  assert.match(rename, /setSessionDirty\(true\)/);
  assert.match(sourceOf(CHROME), /props\.onRenameProject\(next\)/);
  assert.match(sourceOf(CHROME), /className="project-name-input"/);
});

test("unsaved work is never replaced without asking", () => {
  assert.match(workbench, /window\.confirm\(copy\.replaceUnsavedWithNewProject\)/);
  assert.match(workbench, /window\.confirm\(copy\.replaceUnsavedProject\)/);
});

test("a new project resets the session to an empty state", () => {
  assert.match(workbench, /function resetProjectState\(\)/);
  const reset = region(WORKBENCH, "function resetProjectState()", "function ");
  assert.match(reset, /editor\.replaceAnnotations\(\[\], true\)/);
  assert.match(workbench, /setMessage\(copy\.newProjectReady\)/);
});

test("polygon duplicate gets a new annotation id and fresh vertex ids", () => {
  // Reusing a vertex id would make the copy and the original share handles: the
  // canonical model addresses vertices by id, not by index.
  const duplicate = region(WORKBENCH, "function duplicatePolygon", "function ");
  assert.match(duplicate, /const id = makeId\("copy"\)/);
  assert.match(duplicate, /id: `\$\{id\}:outer:v\$\{index\}`/);
  assert.match(duplicate, /id: `\$\{id\}:hole-\$\{holeIndex\}:v\$\{vertexIndex\}`/);
  assert.match(workbench, /const duplicates = selectedPolygons\.map\(duplicatePolygon\)/);
  // Added, never replacing: the originals stay selected-free but present.
  assert.match(workbench, /type: "replace-annotations-batch", removeIds: \[\], annotations: duplicates/);
});

test("duplicating is offered by the vector toolbar", () => {
  const toolbar = sourceOf("app/editor/vector/vector-toolbar.tsx");
  assert.match(toolbar, /copy\.duplicate/);
  assert.match(toolbar, /onDuplicate/);
});
