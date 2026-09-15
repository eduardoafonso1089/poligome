/**
 * Invariants about the shape of the repository itself.
 *
 * Replaces tests/dormant-module-policy.test.mjs and
 * tests/application-parity-docs.test.mjs, which asserted that prose in the
 * README and the architecture doc contained particular sentences. Those locked
 * the wording, not the thing the wording described — the doc could go stale
 * anywhere the regex did not look, and it did.
 *
 * What actually needs protecting is checked directly: the modules exist and
 * still load.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const repo = (path) => new URL(`../${path}`, import.meta.url);
const exists = async (path) => access(repo(path)).then(() => true, () => false);

/**
 * SAM is integrated from its own branch. Its modules and connector assets look
 * orphaned to any dead-code sweep, so the decision to keep them is recorded as
 * a test rather than as a sentence someone has to notice.
 */
const DORMANT_BY_DECISION = [
  "app/lib/sam.ts",
  "app/editor/models/model-output.ts",
  "public/poligome-sam-local.py",
  "public/poligome-sam-windows.bat",
  "public/poligome-sam-macos-linux.sh",
];

test("modules kept for the SAM branch are still present", async () => {
  for (const path of DORMANT_BY_DECISION) {
    assert.ok(await exists(path), `${path} is dormant by decision and must not be swept as dead code`);
  }
});

test("the dormant SAM modules still load", async () => {
  // Presence is not enough: a module that no longer parses is as good as gone.
  const sam = await import("../app/lib/sam.ts");
  assert.equal(typeof sam.requestSamMask, "function");
  const output = await import("../app/editor/models/model-output.ts");
  assert.equal(typeof output.requestSamAnnotation, "function");
});

test("the polygon union path is still wired, even without a toolbar button", async () => {
  // PR #14 removed the button on purpose and PR #15 kept the wiring as the
  // reference for restoring it. If someone deletes the implementation, that is
  // a different decision and should fail here first.
  const geometry = await import("../app/editor/geometry/vector-operations.ts");
  assert.equal(typeof geometry.unionPolygonAnnotations, "function");
  const toolbar = await readFile(repo("app/editor/vector/vector-toolbar.tsx"), "utf8");
  assert.match(toolbar, /onMerge/);
});

test("the canonical route is a composition and nothing else", async () => {
  const page = await readFile(repo("app/annotate/page.tsx"), "utf8");
  assert.match(page, /CanonicalEditorWorkbench/);
  // The lint rules in eslint.config.mjs enforce what it may import; this only
  // guards the size, which no rule expresses well.
  assert.ok(page.split("\n").length < 30, "the route must not grow into a monolith again");
});

test("every documented export format still has a builder", async () => {
  const exporters = await import("../app/editor/export/export-files.ts");
  for (const name of ["buildCocoDocument", "buildGeoJson", "exportEditorCoco", "exportEditorYoloZip", "exportEditorGeoJson"]) {
    assert.equal(typeof exporters[name], "function", `missing exporter: ${name}`);
  }
  const project = await import("../app/lib/project.ts");
  assert.equal(typeof project.savePoligomeProjectV4, "function");
  assert.equal(typeof project.openPoligomeProjectV4, "function");
});

test("the GeoJSON property contract is documented", async () => {
  // The export renames Portuguese keys to English; the table is the only place a
  // downstream consumer can look it up, so its absence is a regression.
  const doc = await readFile(repo("docs/RASTER_WORKFLOW.md"), "utf8");
  for (const property of ["class", "class_id", "color", "shape", "rotation", "source_image", "source_raster", "crs"]) {
    assert.match(doc, new RegExp(`\`${property}\``), `GeoJSON property ${property} is undocumented`);
  }
});
