import { chromium } from "playwright";

const BASE = process.env.AUDIT_BASE_URL ?? "http://127.0.0.1:4174";

async function button(page, pattern) {
  const target = page.getByRole("button", { name: pattern }).first();
  await target.waitFor({ state: "visible", timeout: 8000 });
  return target;
}

async function loadDemo(page) {
  await page.goto(`${BASE}/annotate/?demo=1`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForFunction(() => document.querySelectorAll("[data-annotation-id]").length >= 7, null, { timeout: 30000 });
  const guide = page.locator(".pre-refactor-demo-card");
  if (await guide.isVisible().catch(() => false)) {
    await (await button(page, /Caixa \(B\)|Box \(B\)/i)).click();
    await page.waitForTimeout(60);
  }
}

async function snapshot(page, id = "demo-a1") {
  return page.evaluate((annotationId) => {
    const root = document.querySelector(`[data-annotation-id="${annotationId}"]`);
    const deleteButton = [...document.querySelectorAll("button")].find((node) => (node.getAttribute("aria-label") ?? "").match(/Excluir forma inteira|Delete shape/i));
    return {
      total: document.querySelectorAll("[data-annotation-id]").length,
      exists: Boolean(root),
      path: root?.querySelector("path")?.getAttribute("d") ?? null,
      selectedVertexCount: document.querySelectorAll(".vertex-handle.selected").length,
      vertexHandleCount: root?.querySelectorAll(".vertex-handle").length ?? 0,
      deleteDisabled: deleteButton instanceof HTMLButtonElement ? deleteButton.disabled : null,
      deletePressed: deleteButton?.getAttribute("aria-pressed") ?? null,
    };
  }, id);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

try {
  await loadDemo(page);
  await (await button(page, /Selecionar e mover \(V\)|Select/i)).click();
  await page.locator('[data-annotation-id="demo-a1"]').click({ force: true });
  await page.waitForTimeout(80);
  console.log("SELECTED", JSON.stringify(await snapshot(page)));
  await (await button(page, /Excluir forma inteira|Delete shape/i)).click();
  await page.waitForTimeout(100);
  console.log("AFTER_BUTTON", JSON.stringify(await snapshot(page)));

  await loadDemo(page);
  await (await button(page, /Selecionar e mover \(V\)|Select/i)).click();
  await page.locator('[data-annotation-id="demo-a1"]').click({ force: true });
  await page.waitForTimeout(80);
  console.log("SELECTED_KEY", JSON.stringify(await snapshot(page)));
  await page.keyboard.press("Delete");
  await page.waitForTimeout(100);
  console.log("AFTER_KEY", JSON.stringify(await snapshot(page)));
} finally {
  await context.close();
  await browser.close();
}
