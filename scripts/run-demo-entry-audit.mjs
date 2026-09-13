import fs from "node:fs/promises";

const sourceUrl = new URL("./demo-entry-audit.mjs", import.meta.url);
const runtimeUrl = new URL("./.demo-entry-audit-runtime.mjs", import.meta.url);
let source = await fs.readFile(sourceUrl, "utf8");

const oldPress = `async function press(page, locator, touch) {\n  await locator.scrollIntoViewIfNeeded().catch(() => undefined);\n  if (touch) await locator.tap(); else await locator.click();\n}`;
const newPress = `async function press(page, locator, touch) {\n  await locator.scrollIntoViewIfNeeded().catch(() => undefined);\n  if (touch) {\n    await locator.tap();\n    // React commits the tool first and clears the tutorial tool prompt in a follow-up effect.\n    // Wait one short UI frame so the audit observes the same state a person sees after the tap.\n    await page.waitForTimeout(120);\n  } else {\n    await locator.click();\n  }\n}`;

if (!source.includes(oldPress)) {
  throw new Error("Demo audit press helper changed; update this runner instead of silently weakening synchronization.");
}
source = source.replace(oldPress, newPress);
await fs.writeFile(runtimeUrl, source);
try {
  await import(`${runtimeUrl.href}?run=${Date.now()}`);
} finally {
  await fs.rm(runtimeUrl, { force: true });
}
