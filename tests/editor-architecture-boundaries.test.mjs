import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const read = (path) => fs.readFile(new URL(`../${path}`, import.meta.url), "utf8");

const forbiddenPresentationImports = [
  "useEditorState",
  "useCanvasInteractions",
  "useDrawingInteractions",
  "useAdvancedVectorInteractions",
  "editor-session-io",
  "vector-operations",
];

test("/annotate remains a thin composition route after visual parity restoration", async () => {
  const source = await read("app/annotate/page.tsx");
  assert.match(source, /CanonicalEditorWorkbench/);
  assert.ok(source.split("\n").length < 30, "route must not become the pre-refactor monolith again");
  for (const token of ["useState", "useEffect", "useEditorState", "EditorCanvas", "setAssets(", "createEditorDemo"]) {
    assert.ok(!source.includes(token), `/annotate must not own editor logic: ${token}`);
  }
});

test("canonical workbench still composes the refactored subsystems", async () => {
  const source = await read("app/editor/workbench/canonical-editor-workbench.tsx");
  for (const token of [
    "useEditorState",
    "useCanvasInteractions",
    "useDrawingInteractions",
    "useAdvancedVectorInteractions",
    "useEditorViewport",
    "useTouchNavigation",
    "EditorCanvas",
    "EditorManagementPanels",
    "PreRefactorTopbar",
    "PreRefactorToolbar",
  ]) assert.ok(source.includes(token), `workbench lost canonical subsystem: ${token}`);
});

test("restored presentation does not take ownership of canonical editor state", async () => {
  const sources = await Promise.all([
    read("app/editor/presentation/pre-refactor-chrome.tsx"),
    read("app/editor/panels/editor-management-panels.tsx"),
  ]);
  for (const source of sources) {
    for (const token of forbiddenPresentationImports) {
      assert.ok(!source.includes(token), `presentation crossed canonical boundary: ${token}`);
    }
  }
  const panels = sources[1];
  assert.match(panels, /onMoveAsset:/, "image ordering must remain callback-driven from presentation");
  assert.ok(!panels.includes("setAssets("), "presentation must not own the canonical asset collection");
});

test("state and panel models remain framework-independent", async () => {
  const sources = await Promise.all([
    read("app/editor/state/editor-state.ts"),
    read("app/editor/panels/panel-model.ts"),
  ]);
  for (const source of sources) {
    for (const token of ["from \"react\"", "window.", "document.", "HTMLElement", "SVGSVGElement"]) {
      assert.ok(!source.includes(token), `model contains UI/runtime dependency: ${token}`);
    }
  }
});

test("project IO remains isolated behind the session boundary", async () => {
  const source = await read("app/editor/session/editor-session-io.ts");
  assert.match(source, /openPoligomeProjectV4/);
  assert.match(source, /savePoligomeProjectV4/);
  assert.match(source, /createCanonicalDemoProject/);
  for (const token of ["react", "EditorCanvas", "PreRefactorTopbar", "EditorManagementPanels"]) {
    assert.ok(!source.includes(token), `session IO leaked into UI: ${token}`);
  }
});
