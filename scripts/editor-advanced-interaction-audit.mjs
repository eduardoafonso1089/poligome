import { chromium } from "playwright";
import fs from "node:fs/promises";

const BASE = process.env.AUDIT_BASE_URL ?? "http://127.0.0.1:4174";
const report = [];
const failures = [];
await fs.mkdir("interaction-audit", { recursive: true });

function record(name, ok, detail = "") {
  report.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} [advanced] ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(`${name}: ${detail}`);
}

async function check(name, fn) {
  try {
    const detail = await fn();
    record(name, true, typeof detail === "string" ? detail : "");
  } catch (error) {
    record(name, false, error instanceof Error ? error.message : String(error));
  }
}

async function button(page, pattern, { allowDisabled = false } = {}) {
  const target = page.getByRole("button", { name: pattern }).first();
  await target.waitFor({ state: "visible", timeout: 8000 });
  if (!allowDisabled && await target.isDisabled()) {
    throw new Error(`disabled: ${await target.getAttribute("aria-label") ?? await target.innerText()}`);
  }
  return target;
}

async function loadDemo(page) {
  await page.goto(`${BASE}/annotate/?demo=1`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForFunction(() => document.querySelectorAll("[data-annotation-id]").length >= 7, null, { timeout: 30000 });
  const guide = page.locator(".pre-refactor-demo-card");
  if (await guide.isVisible().catch(() => false)) {
    await (await button(page, /Caixa \(B\)|Box \(B\)/i)).click();
    await page.waitForTimeout(80);
  }
}

async function canvas(page) {
  const svg = page.locator(".stage svg").first();
  await svg.waitFor({ state: "visible" });
  const box = await svg.boundingBox();
  if (!box) throw new Error("canvas SVG has no bounds");
  return { svg, box };
}

function screenPoint(box, fx, fy) {
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

async function selectAnnotation(page, id) {
  await (await button(page, /Selecionar e mover \(V\)|Select/i)).click();
  const node = page.locator(`[data-annotation-id="${id}"]`).first();
  await node.waitFor({ state: "visible" });
  await node.click({ force: true });
  return node;
}

async function annotationCount(page) {
  return page.locator("[data-annotation-id]").count();
}

async function polygonBBox(page, id) {
  return page.locator(`[data-annotation-id="${id}"] path`).first().evaluate((element) => {
    const box = element.getBBox();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  });
}

async function polygonPath(page, id) {
  return page.locator(`[data-annotation-id="${id}"] path`).first().getAttribute("d");
}

async function drawPolygon(page, points) {
  await (await button(page, /Polígono por pontos \(P\)|Polygon/i)).click();
  const beforeIds = await page.locator("[data-annotation-id]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-annotation-id")));
  const { box } = await canvas(page);
  for (const [x, y] of points) await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(60);
  const afterIds = await page.locator("[data-annotation-id]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-annotation-id")));
  const created = afterIds.find((id) => id && !beforeIds.includes(id));
  if (!created) throw new Error("polygon was not created");
  return created;
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));

try {
  await check("drawing over an existing polygon reaches the active drawing tool", async () => {
    await loadDemo(page);
    const before = await annotationCount(page);
    await (await button(page, /Ponto-chave \(K\)|Point/i)).click();
    const { box } = await canvas(page);
    const p = screenPoint(box, .20, .35);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(70);
    const after = await annotationCount(page);
    if (after !== before + 1) throw new Error(`point tool was intercepted by existing annotation: ${before} -> ${after}`);
  });

  await check("Simplify changes real polygon geometry", async () => {
    await loadDemo(page);
    const id = await drawPolygon(page, [[.40,.55],[.46,.55],[.52,.55],[.52,.68],[.46,.68],[.40,.68]]);
    await selectAnnotation(page, id);
    const before = await polygonPath(page, id);
    await (await button(page, /Simplificar polígono|Simplify/i)).click();
    await page.waitForTimeout(60);
    const after = await polygonPath(page, id);
    if (!before || !after || before === after) throw new Error("simplify did not alter the rendered polygon path");
    const beforeSegments = (before.match(/ L /g) ?? []).length;
    const afterSegments = (after.match(/ L /g) ?? []).length;
    if (afterSegments >= beforeSegments) throw new Error(`segments did not decrease: ${beforeSegments} -> ${afterSegments}`);
    return `${beforeSegments} -> ${afterSegments} segments`;
  });

  await check("Merge unions two overlapping selected polygons", async () => {
    await loadDemo(page);
    const first = await drawPolygon(page, [[.40,.56],[.54,.56],[.54,.72],[.40,.72]]);
    await drawPolygon(page, [[.48,.62],[.62,.62],[.62,.78],[.48,.78]]);
    const before = await annotationCount(page);
    await (await button(page, /Selecionar e mover \(V\)|Select/i)).click();
    const multi = await button(page, /Selecionar várias|Select multiple/i);
    await multi.click();
    await page.locator(`[data-annotation-id="${first}"]`).click({ force: true });
    const merge = await button(page, /Unir polígonos selecionados|Merge/i);
    await merge.click();
    await page.waitForTimeout(80);
    const after = await annotationCount(page);
    if (after !== before - 1) throw new Error(`merge count ${before} -> ${after}`);
    return `${before} -> ${after}`;
  });

  await check("Hole creates an interior ring in the selected polygon", async () => {
    await loadDemo(page);
    await selectAnnotation(page, "demo-a1");
    const before = await polygonPath(page, "demo-a1");
    await (await button(page, /Adicionar buraco/i)).click();
    const { box } = await canvas(page);
    for (const [x, y] of [[.18,.30],[.25,.30],[.25,.40],[.18,.40]]) {
      const p = screenPoint(box, x, y);
      await page.mouse.click(p.x, p.y);
    }
    const finish = await button(page, /^Concluir$|^Finish$/i, { allowDisabled: true });
    if (await finish.isDisabled()) throw new Error("Finish stayed disabled after four interior hole points");
    await finish.click();
    await page.waitForTimeout(80);
    const after = await polygonPath(page, "demo-a1");
    if (!before || !after || after === before) throw new Error("polygon path did not change");
    const rings = (after.match(/M /g) ?? []).length;
    if (rings < 2) throw new Error(`expected outer + hole ring, got ${rings}`);
    return `${rings} SVG rings`;
  });

  await check("Split replaces one polygon with two polygons", async () => {
    await loadDemo(page);
    await selectAnnotation(page, "demo-a2");
    const before = await annotationCount(page);
    await (await button(page, /Cortar polígono com linha|Split/i)).click();
    const { box } = await canvas(page);
    const start = screenPoint(box, .31, .25);
    const end = screenPoint(box, .62, .25);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    const after = await annotationCount(page);
    if (after !== before + 1) throw new Error(`split count ${before} -> ${after}`);
    return `${before} -> ${after}`;
  });

  await check("Transform scales/rotates instead of merely translating", async () => {
    await loadDemo(page);
    await selectAnnotation(page, "demo-a1");
    const before = await polygonBBox(page, "demo-a1");
    await (await button(page, /Rotacionar e redimensionar \(T\)|Transform/i)).click();
    const { box } = await canvas(page);
    const start = screenPoint(box, .24, .33);
    const end = screenPoint(box, .31, .25);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    const after = await polygonBBox(page, "demo-a1");
    const changedSize = Math.abs(after.width - before.width) > 1 || Math.abs(after.height - before.height) > 1;
    if (!changedSize) throw new Error(`shape size unchanged (${before.width.toFixed(1)}x${before.height.toFixed(1)} -> ${after.width.toFixed(1)}x${after.height.toFixed(1)}); gesture was likely intercepted as a move`);
    return `${before.width.toFixed(0)}x${before.height.toFixed(0)} -> ${after.width.toFixed(0)}x${after.height.toFixed(0)}`;
  });

  await check("Reshape adds area when trace starts and ends inside", async () => {
    await loadDemo(page);
    await selectAnnotation(page, "demo-a1");
    const before = await polygonBBox(page, "demo-a1");
    await (await button(page, /Remodelar borda à mão livre \(R\)|Reshape/i)).click();
    const { box } = await canvas(page);
    const points = [[.29,.31],[.36,.30],[.39,.34],[.37,.39],[.29,.39]].map(([x,y]) => screenPoint(box,x,y));
    await page.mouse.move(points[0].x, points[0].y);
    await page.mouse.down();
    for (const p of points.slice(1)) await page.mouse.move(p.x, p.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    const after = await polygonBBox(page, "demo-a1");
    if (after.width <= before.width + 1) throw new Error(`reshape did not expand the polygon: width ${before.width.toFixed(1)} -> ${after.width.toFixed(1)}`);
    return `width ${before.width.toFixed(0)} -> ${after.width.toFixed(0)}`;
  });

  await check("Box resize handle changes dimensions", async () => {
    await loadDemo(page);
    await selectAnnotation(page, "demo-a4");
    const group = page.locator('[data-annotation-id="demo-a4"]').first();
    const rect = group.locator("rect").first();
    const before = await rect.evaluate((el) => ({ width: Number(el.getAttribute("width")), height: Number(el.getAttribute("height")) }));
    const handle = group.locator(".box-resize-handle.se").first();
    await handle.waitFor({ state: "visible" });
    const hb = await handle.boundingBox();
    if (!hb) throw new Error("resize handle has no bounds");
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2 + 36, hb.y + hb.height / 2 + 24, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(80);
    const after = await rect.evaluate((el) => ({ width: Number(el.getAttribute("width")), height: Number(el.getAttribute("height")) }));
    if (after.width <= before.width || after.height <= before.height) throw new Error(`box size ${before.width}x${before.height} -> ${after.width}x${after.height}`);
    return `${before.width}x${before.height} -> ${after.width.toFixed(0)}x${after.height.toFixed(0)}`;
  });

  await check("Box rotation handle changes rotation", async () => {
    await loadDemo(page);
    await selectAnnotation(page, "demo-a4");
    const group = page.locator('[data-annotation-id="demo-a4"]').first();
    const transformed = group.locator("g").first();
    const before = await transformed.getAttribute("transform");
    const handle = group.locator(".box-rotation-handle").first();
    await handle.waitFor({ state: "visible" });
    const hb = await handle.boundingBox();
    if (!hb) throw new Error("rotation handle has no bounds");
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2 + 55, hb.y + hb.height / 2 + 28, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(80);
    const after = await transformed.getAttribute("transform");
    if (!before || !after || before === after) throw new Error(`rotation transform unchanged: ${before}`);
    return `${before} -> ${after}`;
  });

  await check("Delete toolbar removes a freshly selected shape", async () => {
    await loadDemo(page);
    await drawPolygon(page, [[.70,.55],[.78,.55],[.78,.65],[.70,.65]]);
    const before = await annotationCount(page);
    const deleteTool = page.locator(".tools").getByRole("button", { name: /^Excluir forma inteira$|^Delete shape$/i }).first();
    await deleteTool.waitFor({ state: "visible", timeout: 8000 });
    if (await deleteTool.isDisabled()) throw new Error("toolbar delete is disabled despite an active selection");
    await deleteTool.click();
    await page.waitForTimeout(60);
    const after = await annotationCount(page);
    if (after !== before - 1) throw new Error(`delete count ${before} -> ${after}`);
    return `${before} -> ${after}`;
  });

  await check("Line thickness control changes rendered stroke", async () => {
    await loadDemo(page);
    const input = page.getByRole("slider", { name: /Espessura das linhas|Line thickness/i }).first();
    await input.waitFor({ state: "visible" });
    await input.focus();
    await input.press("Home");
    for (let value = 1; value < 8; value += 1) await input.press("ArrowRight");
    await page.waitForTimeout(80);
    const output = await page.locator(".stroke-control output").innerText();
    if (!/8px/.test(output)) throw new Error(`unexpected output ${output}`);
    return output;
  });

  await check("Shortcuts help opens", async () => {
    await loadDemo(page);
    await (await button(page, /^Atalhos$|^Shortcuts$/i)).click();
    const dialog = page.getByRole("dialog").last();
    await dialog.waitFor({ state: "visible", timeout: 5000 });
    const text = await dialog.innerText();
    if (!/B|P|F|K|S/.test(text)) throw new Error("shortcut dialog did not expose tool keys");
  });

  record("No page errors", pageErrors.length === 0, pageErrors.join(" | "));
  await page.screenshot({ path: "interaction-audit/advanced.png", fullPage: false });
} finally {
  await context.close();
  await browser.close();
}

await fs.writeFile("interaction-audit/advanced-report.json", JSON.stringify(report, null, 2));
console.log(`\n${report.filter((item) => item.ok).length}/${report.length} advanced checks passed`);
if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
