import { launchAuditBrowser } from "./audit-browser.mjs";
import fs from "node:fs/promises";

const BASE = process.env.AUDIT_BASE_URL ?? "http://127.0.0.1:4174";
const report = [];
const failures = [];
await fs.mkdir("interaction-audit", { recursive: true });

function record(name, ok, detail = "") {
  report.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} [mobile-full] ${name}${detail ? ` — ${detail}` : ""}`);
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
async function canvas(page) {
  const svg = page.locator(".stage svg").first();
  await svg.waitFor({ state: "visible", timeout: 8000 });
  const box = await svg.boundingBox();
  if (!box) throw new Error("canvas SVG has no bounds");
  return { svg, box };
}
function point(box, fx, fy) { return { x: box.x + box.width * fx, y: box.y + box.height * fy }; }
async function count(page) { return page.locator("[data-annotation-id]").count(); }

async function loadDemo(page) {
  await page.goto(`${BASE}/annotate/?demo=1`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForFunction(() => document.querySelectorAll("[data-annotation-id]").length >= 7, null, { timeout: 30000 });
  const guide = page.locator(".pre-refactor-demo-card");
  if (await guide.isVisible().catch(() => false)) {
    await (await button(page, /Caixa \(B\)|Box \(B\)/i)).tap();
    await page.waitForTimeout(60);
  }
}

async function select(page, id) {
  await (await button(page, /Selecionar e mover \(V\)|Select/i)).tap();
  const item = page.locator(`[data-annotation-id="${id}"]`).first();
  await item.waitFor({ state: "visible" });
  await item.tap({ force: true });
  await page.waitForTimeout(50);
}

function touchPoint(p) {
  return { x: p.x, y: p.y, radiusX: 2, radiusY: 2, force: .6 };
}
async function nativeTouchTrace(cdp, points) {
  if (points.length < 2) throw new Error("touch trace needs at least two points");
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touchPoint(points[0])] });
  for (const p of points.slice(1)) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [touchPoint(p)] });
    await new Promise((resolve) => setTimeout(resolve, 8));
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
async function nativeTouchDrag(cdp, from, to, steps = 8) {
  const points = Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps;
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
  });
  await nativeTouchTrace(cdp, points);
}

const browser = await launchAuditBrowser();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));

try {
  await check("Box draws with native touch drag", async () => {
    await loadDemo(page);
    await (await button(page, /Caixa \(B\)|Box \(B\)/i)).tap();
    const before = await count(page);
    const { box } = await canvas(page);
    await nativeTouchDrag(cdp, point(box, .55, .55), point(box, .72, .70));
    await page.waitForTimeout(80);
    const after = await count(page);
    if (after !== before + 1) throw new Error(`${before} -> ${after}`);
  });

  await check("Point creates with real touchscreen tap", async () => {
    await loadDemo(page);
    await (await button(page, /Ponto-chave \(K\)|Point/i)).tap();
    const before = await count(page);
    const { box } = await canvas(page);
    const p = point(box, .82, .60);
    await page.touchscreen.tap(p.x, p.y);
    await page.waitForTimeout(70);
    const after = await count(page);
    if (after !== before + 1) throw new Error(`${before} -> ${after}`);
  });

  await check("Freehand draws with native touch trace", async () => {
    await loadDemo(page);
    await (await button(page, /mão livre \(F\)|Freehand/i)).tap();
    const before = await count(page);
    const { box } = await canvas(page);
    await nativeTouchDrag(cdp, point(box, .68, .68), point(box, .78, .78), 14);
    await page.waitForTimeout(80);
    const after = await count(page);
    if (after !== before + 1) throw new Error(`${before} -> ${after}`);
  });

  await check("Hole accepts mobile taps and Finish", async () => {
    await loadDemo(page);
    await select(page, "demo-a1");
    const path = page.locator('[data-annotation-id="demo-a1"] path').first();
    const before = await path.getAttribute("d");
    await (await button(page, /Adicionar buraco/i)).tap();
    const { box } = await canvas(page);
    for (const [x, y] of [[.18,.30],[.25,.30],[.25,.40],[.18,.40]]) {
      const p = point(box, x, y);
      await page.touchscreen.tap(p.x, p.y);
    }
    const finish = await button(page, /^Concluir$|^Finish$/i);
    await finish.tap();
    await page.waitForTimeout(80);
    const after = await path.getAttribute("d");
    if (!before || !after || after === before || (after.match(/M /g) ?? []).length < 2) throw new Error("hole ring not committed");
  });

  await check("Split executes from native touch drag", async () => {
    await loadDemo(page);
    await select(page, "demo-a2");
    const before = await count(page);
    await (await button(page, /Cortar polígono com linha|Split/i)).tap();
    const { box } = await canvas(page);
    await nativeTouchDrag(cdp, point(box, .31, .25), point(box, .62, .25), 10);
    await page.waitForTimeout(100);
    const after = await count(page);
    if (after !== before + 1) throw new Error(`${before} -> ${after}`);
  });

  await check("Transform executes from native touch drag", async () => {
    await loadDemo(page);
    await select(page, "demo-a1");
    const path = page.locator('[data-annotation-id="demo-a1"] path').first();
    const before = await path.getAttribute("d");
    await (await button(page, /Rotacionar e redimensionar \(T\)|Transform/i)).tap();
    const { box } = await canvas(page);
    await nativeTouchDrag(cdp, point(box, .24, .33), point(box, .31, .25), 8);
    await page.waitForTimeout(90);
    const after = await path.getAttribute("d");
    if (!before || !after || after === before) throw new Error("polygon path unchanged");
  });

  await check("Reshape executes from native touch trace", async () => {
    await loadDemo(page);
    await select(page, "demo-a1");
    const path = page.locator('[data-annotation-id="demo-a1"] path').first();
    const before = await path.getAttribute("d");
    await (await button(page, /Remodelar borda à mão livre \(R\)|Reshape/i)).tap();
    const { box } = await canvas(page);
    const points = [[.29,.31],[.36,.30],[.39,.34],[.37,.39],[.29,.39]].map(([x,y]) => point(box,x,y));
    await nativeTouchTrace(cdp, points);
    await page.waitForTimeout(100);
    const after = await path.getAttribute("d");
    if (!before || !after || after === before) throw new Error("polygon path unchanged");
  });

  await check("Toolbar Delete removes selected shape on mobile", async () => {
    await loadDemo(page);
    await select(page, "demo-a1");
    const before = await count(page);
    const deleteTool = page.locator(".tools").getByRole("button", { name: /^Excluir forma inteira$|^Delete shape$/i }).first();
    await deleteTool.tap();
    await page.waitForTimeout(70);
    const after = await count(page);
    if (after !== before - 1) throw new Error(`${before} -> ${after}`);
  });

  await check("Previous/next image navigation works on mobile", async () => {
    await loadDemo(page);
    const status = page.locator(".status > div span");
    if (!/1\s*\/\s*3/.test(await status.innerText())) throw new Error("did not start on image 1");
    const next = page.locator(".status > div button").nth(1);
    await next.tap();
    await page.waitForTimeout(80);
    if (!/2\s*\/\s*3/.test(await status.innerText())) throw new Error(`next: ${await status.innerText()}`);
    const previous = page.locator(".status > div button").nth(0);
    await previous.tap();
    await page.waitForTimeout(80);
    if (!/1\s*\/\s*3/.test(await status.innerText())) throw new Error(`previous: ${await status.innerText()}`);
  });

  await check("Clear annotations action removes all annotations", async () => {
    await loadDemo(page);
    // The clear-all button lives in the annotations panel (right drawer on mobile).
    await page.locator('.topbar button.mobile').last().tap();
    const clear = page.locator('[data-panel="right"]').getByRole("button", { name: /Remover anotações carregadas|Clear.*annotations|Remove.*annotations/i }).first();
    await clear.waitFor({ state: "visible", timeout: 8000 });
    page.once("dialog", (dialog) => dialog.accept());
    await clear.tap();
    await page.waitForTimeout(100);
    if (await count(page) !== 0) throw new Error(`remaining=${await count(page)}`);
  });

  record("No page errors", pageErrors.length === 0, pageErrors.join(" | "));
  await page.screenshot({ path: "interaction-audit/mobile-full.png", fullPage: false });
} finally {
  await context.close();
  await browser.close();
}

await fs.writeFile("interaction-audit/mobile-full-report.json", JSON.stringify(report, null, 2));
console.log(`\n${report.filter((item) => item.ok).length}/${report.length} mobile-full checks passed`);
if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
