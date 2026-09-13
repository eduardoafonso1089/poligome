import { chromium } from "playwright";
import fs from "node:fs/promises";

const BASE = process.env.AUDIT_BASE_URL ?? "http://127.0.0.1:4174";
const report = [];
const failures = [];
await fs.mkdir("interaction-audit", { recursive: true });

function record(name, ok, detail = "") {
  report.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} [mobile-command] ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(`${name}: ${detail}`);
}
async function check(name, fn) {
  try { record(name, true, (await fn()) ?? ""); }
  catch (error) { record(name, false, error instanceof Error ? error.message : String(error)); }
}
async function button(page, pattern, scope = page) {
  const target = scope.getByRole("button", { name: pattern }).first();
  await target.waitFor({ state: "visible", timeout: 8000 });
  if (await target.isDisabled()) throw new Error(`disabled: ${await target.getAttribute("aria-label") ?? await target.innerText()}`);
  return target;
}
async function loadDemo(page) {
  await page.goto(`${BASE}/annotate/?demo=1`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForFunction(() => document.querySelectorAll("[data-annotation-id]").length >= 7, null, { timeout: 30000 });
  const guide = page.locator(".pre-refactor-demo-card");
  if (await guide.isVisible().catch(() => false)) {
    await (await button(page, /Caixa \(B\)|Box \(B\)/i)).tap();
    await page.waitForTimeout(60);
  }
}
async function canvas(page) {
  const svg = page.locator(".stage svg").first();
  await svg.waitFor({ state: "visible", timeout: 8000 });
  const box = await svg.boundingBox();
  if (!box) throw new Error("canvas SVG has no bounds");
  return { svg, box };
}
function p(box, fx, fy) { return { x: box.x + box.width * fx, y: box.y + box.height * fy }; }
function touchPoint(point) { return { x: point.x, y: point.y, radiusX: 2, radiusY: 2, force: .6 }; }
async function touchTrace(cdp, points) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touchPoint(points[0])] });
  for (const point of points.slice(1)) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [touchPoint(point)] });
    await new Promise((resolve) => setTimeout(resolve, 8));
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
async function touchDrag(cdp, from, to, steps = 8) {
  await touchTrace(cdp, Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
  }));
}
async function select(page, id) {
  await (await button(page, /Selecionar e mover \(V\)|Select/i)).tap();
  await page.locator(`[data-annotation-id="${id}"]`).first().tap({ force: true });
  await page.waitForTimeout(60);
}
async function count(page) { return page.locator("[data-annotation-id]").count(); }
async function drawPolygon(page, points) {
  const beforeIds = await page.locator("[data-annotation-id]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-annotation-id")));
  await (await button(page, /Polígono por pontos \(P\)|Polygon/i)).tap();
  const { box } = await canvas(page);
  for (const [x, y] of points) {
    const point = p(box, x, y);
    await page.touchscreen.tap(point.x, point.y);
  }
  await (await button(page, /^Concluir$|^Finish$/i)).tap();
  await page.waitForTimeout(70);
  const afterIds = await page.locator("[data-annotation-id]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-annotation-id")));
  const id = afterIds.find((item) => item && !beforeIds.includes(item));
  if (!id) throw new Error("polygon not created");
  return id;
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));

try {
  await check("Select moves an annotation with a touch drag", async () => {
    await loadDemo(page);
    await select(page, "demo-a1");
    const path = page.locator('[data-annotation-id="demo-a1"] path').first();
    const before = await path.getAttribute("d");
    const bounds = await path.boundingBox();
    if (!bounds) throw new Error("selected polygon has no bounds");
    const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    await touchDrag(cdp, center, { x: center.x + 22, y: center.y + 16 }, 8);
    await page.waitForTimeout(80);
    const after = await path.getAttribute("d");
    if (!before || !after || after === before) throw new Error("polygon did not move");
  });

  await check("Undo and Redo work from the mobile toolbar", async () => {
    await loadDemo(page);
    await (await button(page, /Ponto-chave \(K\)|Point/i)).tap();
    const before = await count(page);
    const { box } = await canvas(page);
    const target = p(box, .83, .62);
    await page.touchscreen.tap(target.x, target.y);
    await page.waitForTimeout(60);
    if (await count(page) !== before + 1) throw new Error("point was not created");
    await (await button(page, /^Desfazer$|^Undo$/i)).tap();
    await page.waitForTimeout(60);
    if (await count(page) !== before) throw new Error("undo failed");
    await (await button(page, /^Refazer$|^Redo$/i)).tap();
    await page.waitForTimeout(60);
    if (await count(page) !== before + 1) throw new Error("redo failed");
  });

  await check("Zoom controls and Fit update the mobile viewport", async () => {
    await loadDemo(page);
    const zoomText = page.locator(".zoom span").first();
    const readZoom = async () => Number((await zoomText.innerText()).replace(/[^0-9.]/g, ""));
    const before = await readZoom();
    const zoomButtons = page.locator(".zoom button");
    await zoomButtons.nth(1).tap();
    await page.waitForTimeout(50);
    const increased = await readZoom();
    if (!(increased > before)) throw new Error(`${before} -> ${increased}`);
    await zoomButtons.nth(0).tap();
    await page.waitForTimeout(50);
    const decreased = await readZoom();
    if (!(decreased < increased)) throw new Error(`${increased} -> ${decreased}`);
    await (await button(page, /Ajustar imagem|Fit image|Fit/i)).tap();
    await page.waitForTimeout(50);
    const fitted = await readZoom();
    if (!Number.isFinite(fitted) || fitted <= 0) throw new Error(`fit=${fitted}`);
    return `${before}% -> ${increased}% -> ${decreased}% -> fit ${fitted}%`;
  });

  await check("Pan moves a zoomed canvas with a native touch drag", async () => {
    await loadDemo(page);
    const zoomButtons = page.locator(".zoom button");
    for (let i = 0; i < 5; i += 1) await zoomButtons.nth(1).tap();
    await (await button(page, /Mover canvas \(H\)|Pan/i)).tap();
    const stage = page.locator(".stage > section").first();
    const before = await stage.evaluate((node) => ({ left: node.scrollLeft, top: node.scrollTop }));
    const { box } = await canvas(page);
    await touchDrag(cdp, p(box, .60, .60), p(box, .42, .42), 10);
    await page.waitForTimeout(80);
    const after = await stage.evaluate((node) => ({ left: node.scrollLeft, top: node.scrollTop }));
    if (after.left === before.left && after.top === before.top) throw new Error(`scroll unchanged at ${before.left},${before.top}`);
    return `${Math.round(before.left)},${Math.round(before.top)} -> ${Math.round(after.left)},${Math.round(after.top)}`;
  });

  await check("Coordinate guides toggle on mobile", async () => {
    await loadDemo(page);
    const guide = await button(page, /Guias de coordenadas X\/Y|Coordinate guides/i);
    await guide.tap();
    if (await guide.getAttribute("aria-pressed") !== "true") throw new Error("guide did not activate");
  });

  await check("Snap toggles on mobile", async () => {
    await loadDemo(page);
    const snap = await button(page, /snap/i);
    const before = await snap.getAttribute("aria-pressed");
    await snap.tap();
    const after = await snap.getAttribute("aria-pressed");
    if (before === after) throw new Error(`aria-pressed stayed ${after}`);
  });

  await check("Simplify changes polygon geometry on mobile", async () => {
    await loadDemo(page);
    const id = await drawPolygon(page, [[.55,.55],[.60,.55],[.65,.55],[.65,.68],[.60,.68],[.55,.68]]);
    await select(page, id);
    const path = page.locator(`[data-annotation-id="${id}"] path`).first();
    const before = await path.getAttribute("d");
    await (await button(page, /Simplificar polígono|Simplify/i)).tap();
    await page.waitForTimeout(70);
    const after = await path.getAttribute("d");
    if (!before || !after || before === after) throw new Error("path unchanged");
  });

  await check("Duplicate creates a second polygon on mobile", async () => {
    await loadDemo(page);
    await select(page, "demo-a1");
    const before = await count(page);
    await (await button(page, /Duplicar polígono|Duplicate/i)).tap();
    await page.waitForTimeout(70);
    const after = await count(page);
    if (after !== before + 1) throw new Error(`${before} -> ${after}`);
  });

  await check("Merge unions two mobile-selected overlapping polygons", async () => {
    await loadDemo(page);
    const first = await drawPolygon(page, [[.55,.58],[.68,.58],[.68,.72],[.55,.72]]);
    await drawPolygon(page, [[.62,.63],[.75,.63],[.75,.77],[.62,.77]]);
    const before = await count(page);
    await (await button(page, /Selecionar e mover \(V\)|Select/i)).tap();
    const multi = await button(page, /Selecionar várias|Select multiple/i);
    await multi.tap();
    await page.locator(`[data-annotation-id="${first}"]`).tap({ force: true });
    await (await button(page, /Unir polígonos selecionados|Merge/i)).tap();
    await page.waitForTimeout(90);
    const after = await count(page);
    if (after !== before - 1) throw new Error(`${before} -> ${after}`);
  });

  await check("Box resize handle works with touch", async () => {
    await loadDemo(page);
    await select(page, "demo-a4");
    const group = page.locator('[data-annotation-id="demo-a4"]').first();
    const rect = group.locator("rect").first();
    const before = await rect.evaluate((node) => Number(node.getAttribute("width")));
    const handle = group.locator(".box-resize-handle.se").first();
    await handle.waitFor({ state: "visible", timeout: 8000 });
    const hb = await handle.boundingBox();
    if (!hb) throw new Error("resize handle has no bounds");
    const start = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };
    await touchDrag(cdp, start, { x: start.x + 28, y: start.y + 20 }, 8);
    await page.waitForTimeout(80);
    const after = await rect.evaluate((node) => Number(node.getAttribute("width")));
    if (!(after > before)) throw new Error(`${before} -> ${after}`);
  });

  await check("Box rotation handle works with touch", async () => {
    await loadDemo(page);
    await select(page, "demo-a4");
    const group = page.locator('[data-annotation-id="demo-a4"]').first();
    const transformed = group.locator("g").first();
    const before = await transformed.getAttribute("transform");
    const handle = group.locator(".box-rotation-handle").first();
    await handle.waitFor({ state: "visible", timeout: 8000 });
    const hb = await handle.boundingBox();
    if (!hb) throw new Error("rotation handle has no bounds");
    const start = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };
    await touchDrag(cdp, start, { x: start.x + 45, y: start.y + 24 }, 8);
    await page.waitForTimeout(80);
    const after = await transformed.getAttribute("transform");
    if (!before || !after || before === after) throw new Error(`transform unchanged: ${before}`);
  });

  await check("Shortcuts dialog opens on mobile", async () => {
    await loadDemo(page);
    await (await button(page, /^Atalhos$|^Shortcuts$/i)).tap();
    await page.getByRole("dialog").last().waitFor({ state: "visible", timeout: 8000 });
  });

  record("No page errors", pageErrors.length === 0, pageErrors.join(" | "));
  await page.screenshot({ path: "interaction-audit/mobile-command.png", fullPage: false });
} finally {
  await context.close();
  await browser.close();
}

await fs.writeFile("interaction-audit/mobile-command-report.json", JSON.stringify(report, null, 2));
console.log(`\n${report.filter((item) => item.ok).length}/${report.length} mobile-command checks passed`);
if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
