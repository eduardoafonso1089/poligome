import { chromium } from "playwright";
import fs from "node:fs/promises";
import { openDemoDataset } from "./demo-audit-helpers.mjs";

const BASE = process.env.AUDIT_BASE_URL ?? "http://127.0.0.1:4174";
await fs.mkdir("interaction-audit", { recursive: true });
const failures = [];
const report = [];

function record(name, ok, detail = "") {
  report.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} [image-reorder] ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(`${name}: ${detail}`);
}

async function check(name, fn) {
  try { record(name, true, (await fn()) ?? ""); }
  catch (error) { record(name, false, error instanceof Error ? error.message : String(error)); }
}

async function imageNames(page) {
  return page.locator('.asset-list > .asset-row .asset-main').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('title') ?? ''));
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));

try {
  await openDemoDataset(page, BASE);

  await check("drag handle moves an image to an arbitrary list position", async () => {
    const before = await imageNames(page);
    if (before.length < 3) throw new Error(`expected >=3 images, got ${before.length}`);
    const rows = page.locator('.asset-list > .asset-row');
    const source = rows.nth(0).locator('.reorder-handle');
    const target = rows.nth(2);
    await source.dragTo(target, { targetPosition: { x: 20, y: 42 } });
    await page.waitForTimeout(120);
    const after = await imageNames(page);
    if (after.at(-1) !== before[0]) throw new Error(`${before.join(' | ')} -> ${after.join(' | ')}`);
    if (after[0] !== before[1] || after[1] !== before[2]) throw new Error(`unexpected relative order: ${after.join(' | ')}`);
    return `${before[0]} moved from #1 to #${after.length}`;
  });

  await check("drag operation updates the visible sequence numbers", async () => {
    const numbers = await page.locator('.asset-list > .asset-row .thumb span').allInnerTexts();
    const expected = numbers.map((_, index) => String(index + 1).padStart(2, '0'));
    if (numbers.join(',') !== expected.join(',')) throw new Error(`${numbers.join(',')} != ${expected.join(',')}`);
    return numbers.join(' · ');
  });

  await check("reordered canonical sequence drives image status and navigation", async () => {
    const status = (await page.locator('.status > div span').innerText()).replace(/\s+/g, ' ').trim();
    if (!/3\s*\/\s*3/.test(status)) throw new Error(`active image did not move with its id: ${status}`);
    const order = await imageNames(page);
    const previous = page.locator('.status > div > button').first();
    await previous.click();
    await page.waitForTimeout(80);
    const activeTitle = await page.locator('.asset-list > .asset-row.active .asset-main').getAttribute('title');
    if (activeTitle !== order[1]) throw new Error(`previous selected ${activeTitle}; expected ${order[1]}`);
    return `3/3 -> previous = ${activeTitle}`;
  });

  await check("reorder handle keeps keyboard ArrowUp/ArrowDown accessibility", async () => {
    const before = await imageNames(page);
    const movedName = before.at(-1);
    const handle = page.locator('.asset-list > .asset-row').last().locator('.reorder-handle');
    await handle.focus();
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(80);
    const after = await imageNames(page);
    if (after.at(-2) !== movedName) throw new Error(`${before.join(' | ')} -> ${after.join(' | ')}`);
    return `${movedName} moved one position up`;
  });

  record("No page errors", pageErrors.length === 0, pageErrors.join(" | "));
  await page.screenshot({ path: "interaction-audit/image-reorder.png", fullPage: false });
} finally {
  await context.close();
  await browser.close();
}

await fs.writeFile("interaction-audit/image-reorder-report.json", JSON.stringify(report, null, 2));
if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
