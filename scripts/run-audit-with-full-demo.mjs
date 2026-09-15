import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const sourceName = process.argv[2];
if (!sourceName) throw new Error("Usage: node scripts/run-audit-with-full-demo.mjs <audit-script.mjs>");

const sourcePath = path.resolve("scripts", sourceName);
const runtimePath = path.resolve("scripts", `.runtime-${sourceName}`);
let source = await fs.readFile(sourcePath, "utf8");

// The older interaction audits own a local loadDemo(page) helper. Guided-Demo parity now
// intentionally starts with a clean canvas, so legacy tool audits need the completed Demo
// dataset instead. Replace only that top-level helper and fail loudly if its shape changes.
const loadDemoPattern = /async function loadDemo\(page\) \{[\s\S]*?^\}\r?\n/m;
if (!loadDemoPattern.test(source)) throw new Error(`${sourceName}: loadDemo helper not found; update this runner instead of silently weakening the audit.`);

source = `import { openDemoDataset } from "./demo-audit-helpers.mjs";\n${source}`;
source = source.replace(loadDemoPattern, `async function loadDemo(page) {\n  await openDemoDataset(page, BASE);\n}\n`);

// Merge was intentionally removed from the UI. The mobile command audit has already
// retired that scenario. The advanced audit still contains its legacy Merge case, so
// strip only that case at runtime while preserving every other interaction check.
if (sourceName === "editor-advanced-interaction-audit.mjs") {
  const obsoleteMergePattern = /\s*await check\("Merge unions two overlapping selected polygons"[\s\S]*?(?=\s*await check\("Hole creates an interior ring in the selected polygon")/;
  if (!obsoleteMergePattern.test(source)) throw new Error("Advanced Merge audit changed; update this runner instead of silently weakening the audit.");
  source = source.replace(obsoleteMergePattern, "\n\n  ");
}

await fs.writeFile(runtimePath, source);
try {
  await import(`${pathToFileURL(runtimePath).href}?run=${Date.now()}`);
} finally {
  await fs.rm(runtimePath, { force: true });
}
