import { chromium } from "playwright";
import fs from "node:fs/promises";

const BASE = process.env.AUDIT_BASE_URL ?? "http://127.0.0.1:4174";
await fs.mkdir("interaction-audit", { recursive: true });
const report = [];
const failures = [];

function record(width, name, ok, detail = "") {
  report.push({ width, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} [mobile-${width}] ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(`[${width}] ${name}: ${detail}`);
}

async function audit(browser, width) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto(`${BASE}/annotate/?demo=1`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForFunction(() => document.querySelectorAll("[data-annotation-id]").length > 0, null, { timeout: 30000 });

  const box = page.getByRole("button", { name: /Caixa \(B\)|Box \(B\)/i }).first();
  await box.waitFor({ state: "visible" });
  await box.tap();
  await page.waitForTimeout(100);

  const controls = page.locator(".editor-controls").first();
  const tools = page.locator(".tools").first();
  const actions = page.locator(".drawing-actions").first();
  await controls.waitFor({ state: "visible" });
  await tools.waitFor({ state: "visible" });
  await actions.waitFor({ state: "visible" });

  const geometry = await page.evaluate(() => {
    const controls = document.querySelector(".editor-controls");
    const tools = document.querySelector(".tools");
    const actions = document.querySelector(".drawing-actions");
    if (!(controls instanceof HTMLElement) || !(tools instanceof HTMLElement) || !(actions instanceof HTMLElement)) return null;
    const c = controls.getBoundingClientRect();
    const t = tools.getBoundingClientRect();
    const a = actions.getBoundingClientRect();
    const style = getComputedStyle(controls);
    return {
      controls: { x: c.x, y: c.y, width: c.width, height: c.height },
      tools: { x: t.x, y: t.y, width: t.width, height: t.height },
      actions: { x: a.x, y: a.y, width: a.width, height: a.height },
      overflowX: style.overflowX,
      scrollWidth: controls.scrollWidth,
      clientWidth: controls.clientWidth,
      scrollHeight: controls.scrollHeight,
      clientHeight: controls.clientHeight,
    };
  });

  if (!geometry) {
    record(width, "toolbar geometry available", false, "missing toolbar nodes");
  } else {
    const sameRow = Math.abs(geometry.tools.y - geometry.actions.y) <= 2;
    record(width, "tools and touch actions share one row", sameRow, `tools y=${geometry.tools.y.toFixed(1)}, actions y=${geometry.actions.y.toFixed(1)}`);

    const noSecondLine = geometry.controls.height <= 54 && geometry.scrollHeight <= geometry.clientHeight + 2;
    record(width, "toolbar does not create a second line", noSecondLine, `height=${geometry.controls.height.toFixed(1)}, scrollHeight=${geometry.scrollHeight}, clientHeight=${geometry.clientHeight}`);

    const horizontallyScrollable = geometry.overflowX === "auto" && geometry.scrollWidth > geometry.clientWidth + 20;
    record(width, "toolbar is horizontally scrollable", horizontallyScrollable, `overflow-x=${geometry.overflowX}, ${geometry.clientWidth}/${geometry.scrollWidth}px`);

    const moved = await controls.evaluate((element) => {
      const node = element;
      node.scrollLeft = Math.max(0, node.scrollWidth - node.clientWidth);
      return node.scrollLeft;
    });
    record(width, "horizontal scrollbar can reach trailing tools", moved > 0, `scrollLeft=${Math.round(moved)}`);
  }

  await page.screenshot({ path: `interaction-audit/mobile-toolbar-${width}.png`, fullPage: false });
  await context.close();
}

const browser = await chromium.launch({ headless: true });
try {
  await audit(browser, 390);
  await audit(browser, 360);
} finally {
  await browser.close();
}

await fs.writeFile("interaction-audit/mobile-toolbar-report.json", JSON.stringify(report, null, 2));
if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
