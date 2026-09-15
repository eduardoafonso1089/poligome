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

// Merge was intentionally removed from the UI. Keep every other interaction audit, but
// retire the two legacy Merge scenarios so CI validates the current interaction contract.
const obsoleteMergeAudits = {
  "mobile-command-interaction-audit.mjs": {
    pattern: /\n  await check\("Merge unions two selected polygons on mobile", async \(\) => \{[\s\S]*?\n  \}\);\r?\n(?=\n  await check\("Box resize handle works with touch")/,
    label: "Mobile Merge audit",
  },
  "editor-advanced-interaction-audit.mjs": {
    pattern: /\n  await check\("Merge unions two overlapping selected polygons", async \(\) => \{[\s\S]*?\n  \}\);\r?\n(?=\n  await check\("Hole creates an interior ring in the selected polygon")/,
    label: "Advanced Merge audit",
  },
};
const obsoleteMergeAudit = obsoleteMergeAudits[sourceName];
if (obsoleteMergeAudit) {
  if (!obsoleteMergeAudit.pattern.test(source)) throw new Error(`${obsoleteMergeAudit.label} changed; update this runner instead of silently weakening the audit.`);
  source = source.replace(obsoleteMergeAudit.pattern, "\n");
}

await fs.writeFile(runtimePath, source);
try {
  await import(`${pathToFileURL(runtimePath).href}?run=${Date.now()}`);
} finally {
  await fs.rm(runtimePath, { force: true });
}
