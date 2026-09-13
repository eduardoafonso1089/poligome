import { chromium } from "playwright";
import fs from "node:fs/promises";

const BASE = process.env.AUDIT_BASE_URL ?? "http://127.0.0.1:4174";
await fs.mkdir("interaction-audit", { recursive: true });
const results = [];
const failures = [];

async function run(browser, scope, contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(`${BASE}/annotate/`, { waitUntil: "networkidle", timeout: 90000 });
    const demo = page.getByRole("button", { name: /Experimentar Demo|Try Demo|Demo/i }).last();
    await demo.waitFor({ state: "visible", timeout: 10000 });
    if (contextOptions.hasTouch) await demo.tap(); else await demo.click();
    await page.waitForFunction(() => document.querySelectorAll("[data-annotation-id]").length > 0, null, { timeout: 30000 });
    const status = await page.locator(".status > div span").innerText();
    const project = await page.locator(".project-name").innerText().catch(() => "");
    const ok = /1\s*\/\s*3/.test(status) && /^Demo\b/i.test(project.trim());
    const detail = `${project.trim()} · ${status}`;
    results.push({ scope, ok, detail, errors });
    console.log(`${ok && !errors.length ? "PASS" : "FAIL"} [${scope}] Demo button loads project — ${detail}`);
    if (!ok) failures.push(`[${scope}] Demo button did not load expected project: ${detail}`);
    if (errors.length) failures.push(`[${scope}] page errors: ${errors.join(" | ")}`);
    await page.screenshot({ path: `interaction-audit/demo-entry-${scope}.png`, fullPage: false });
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch({ headless: true });
try {
  await run(browser, "desktop", { viewport: { width: 1440, height: 900 } });
  await run(browser, "mobile", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
} finally {
  await browser.close();
}

await fs.writeFile("interaction-audit/demo-entry-report.json", JSON.stringify(results, null, 2));
if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
