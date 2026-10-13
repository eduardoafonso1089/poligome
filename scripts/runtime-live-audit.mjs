// The editor in a real browser against the real poligome-runtime server.
//
// The fixture audit (ai-flow-audit.mjs) answers every request itself, in one
// frame. This one starts the actual runtime transport with a deterministic QA
// adapter, so tiling, the merge across tiles, real SSE chunking and mask RLE
// all run for real. It found the merge dropping every mask on a tile seam.
//
//   POLIGOME_RUNTIME_DIR=../poligome-runtime \
//   POLIGOME_RUNTIME_PYTHON=/path/to/venv/bin/python \   # numpy + pillow
//   AUDIT_BASE_URL=http://127.0.0.1:4174 node scripts/runtime-live-audit.mjs
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { launchAuditBrowser } from "./audit-browser.mjs";
import { openDemoDataset } from "./demo-audit-helpers.mjs";

import { fileURLToPath } from "node:url";

const ADAPTER = fileURLToPath(new URL("./runtime-live/qa_runtime.py", import.meta.url));
const PYTHON = process.env.POLIGOME_RUNTIME_PYTHON ?? "python3";
const BASE = process.env.AUDIT_BASE_URL ?? "http://127.0.0.1:4174";
if (!process.env.POLIGOME_RUNTIME_DIR) {
  console.log("SKIP runtime-live-audit: set POLIGOME_RUNTIME_DIR to a poligome-runtime clone");
  process.exit(0);
}
const RUNTIME_ARGS = (process.env.QA_ARGS ?? "--kinds box,mask").split(" ");

async function startRuntime(extra = []) {
  const child = spawn(PYTHON, [ADAPTER, "--port", "7861", ...RUNTIME_ARGS, ...extra], { stdio: ["ignore", "ignore", "pipe"] });
  let log = "";
  child.stderr.on("data", (chunk) => { log += chunk; });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch("http://127.0.0.1:7861/health")).ok) return { child, log: () => log }; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("runtime did not start");
}

await fs.mkdir("interaction-audit", { recursive: true });
const browser = await launchAuditBrowser();
const results = [];
async function check(name, { viewport = { width: 1440, height: 900 }, runtimeArgs = [] } = {}, run) {
  const runtime = await startRuntime(runtimeArgs);
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
  try {
    await openDemoDataset(page, BASE);
    await run({ page, runtime });
    assert.deepEqual(errors.filter((e) => !/Failed to load resource/.test(e)), []);
    results.push({ name, ok: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`FAIL ${name}: ${error.message}\n  errors: ${errors.join(" | ")}`);
    await page.screenshot({ path: `interaction-audit/runtime-live-failure-${results.length}.png`, fullPage: false }).catch(() => undefined);
  } finally {
    await context.close();
    runtime.child.kill();
    await new Promise((r) => setTimeout(r, 200));
  }
}

const shapes = (page) => page.evaluate(() => {
  const out = {};
  for (const el of document.querySelectorAll(".stage [data-annotation-id]")) {
    const shape = el.matches("rect,polygon,path,circle,polyline") ? el : el.querySelector("rect,polygon,path,polyline,circle");
    const tag = shape?.tagName ?? el.tagName;
    out[tag] = (out[tag] ?? 0) + 1;
  }
  return out;
});
const total = (s) => Object.values(s).reduce((a, b) => a + b, 0);
const done = (page) => page.locator(".ai-run-card.done");

async function openPreannotate(page) {
  await page.getByRole("button", { name: "Pré-anotar", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Pré-anotar", exact: true });
  await dialog.getByRole("radio", { name: /QA Blobs/ }).check({ timeout: 15000 });
  return dialog;
}

await check("real runtime: sweep adds boxes AND mask polygons, results card settles", {}, async ({ page }) => {
  const before = await shapes(page);
  const dialog = await openPreannotate(page);
  await dialog.getByRole("button", { name: "Pré-anotar", exact: true }).click();
  await done(page).waitFor({ timeout: 60000 });
  const after = await shapes(page);
  const card = await done(page).innerText();
  console.log("   before", JSON.stringify(before), "after", JSON.stringify(after), "| card:", card.replace(/\s+/g, " ").slice(0, 160));
  const addedPolygons = (after.polygon ?? 0) + (after.path ?? 0) - (before.polygon ?? 0) - (before.path ?? 0);
  const addedRects = (after.rect ?? 0) - (before.rect ?? 0);
  assert.ok(addedRects > 0, "boxes added");
  assert.ok(addedPolygons > 0, `mask polygons added (got ${addedPolygons}) — masks must survive the tile merge`);
});

await check("real runtime: Undo removes exactly what the run added", {}, async ({ page }) => {
  const before = total(await shapes(page));
  const dialog = await openPreannotate(page);
  await dialog.getByRole("button", { name: "Pré-anotar", exact: true }).click();
  await done(page).waitFor({ timeout: 60000 });
  assert.ok(total(await shapes(page)) > before);
  await done(page).getByRole("button", { name: /Desfazer/ }).click();
  await page.waitForFunction((n) => document.querySelectorAll(".stage [data-annotation-id]").length === n, before, { timeout: 10000 });
});

await check("real runtime: params from the manifest render and reach the model", {}, async ({ page }) => {
  const dialog = await openPreannotate(page);
  await dialog.getByRole("slider", { name: "Limiar" }).waitFor();
  await dialog.getByRole("checkbox", { name: "Inverter" }).waitFor();
  await dialog.getByRole("combobox", { name: "Classe" }).selectOption("fundo");
  await dialog.getByRole("slider", { name: "Limiar" }).press("Home");
  await dialog.getByRole("button", { name: "Pré-anotar", exact: true }).click();
  await done(page).waitFor({ timeout: 60000 });
  // threshold 0 finds nothing on a real photo: the run must end cleanly, saying so.
  console.log("   card:", (await done(page).innerText()).replace(/\s+/g, " ").slice(0, 160));
});

await check("real runtime: slow sweep shows progress and Cancel stops it without leftovers", { runtimeArgs: ["--slow", "0.6"] }, async ({ page }) => {
  const before = total(await shapes(page));
  const dialog = await openPreannotate(page);
  await dialog.getByRole("button", { name: "Pré-anotar", exact: true }).click();
  const running = page.locator(".ai-run-card:not(.done)");
  await running.waitFor({ timeout: 10000 });
  await page.waitForTimeout(900);
  console.log("   running card:", (await running.innerText()).replace(/\s+/g, " ").slice(0, 160));
  await running.getByRole("button", { name: /Cancelar/ }).click();
  await done(page).waitFor({ timeout: 10000 });
  await page.waitForTimeout(1500);
  assert.equal(total(await shapes(page)), before, "no drafts left after cancel");
  assert.ok(await page.getByRole("button", { name: "Pré-anotar", exact: true }).isEnabled());
});

await check("real runtime: model crash mid-run explains itself and leaves no drafts", { runtimeArgs: ["--fail-after", "2"] }, async ({ page }) => {
  const before = total(await shapes(page));
  const dialog = await openPreannotate(page);
  await dialog.getByRole("button", { name: "Pré-anotar", exact: true }).click();
  await page.waitForFunction(() => /falhou|erro|Erro|failure/i.test(document.querySelector("main")?.innerText ?? ""), null, { timeout: 30000 });
  await page.waitForTimeout(500);
  const text = await page.locator("main").innerText();
  const line = text.split("\n").find((l) => /QA adapter failure|falhou|erro/i.test(l));
  console.log("   message:", line);
  assert.equal(total(await shapes(page)), before, "drafts removed after crash");
});

await check("real runtime: runtime killed during a run is reported, controls return", { runtimeArgs: ["--slow", "1.0"] }, async ({ page, runtime }) => {
  const before = total(await shapes(page));
  const dialog = await openPreannotate(page);
  await dialog.getByRole("button", { name: "Pré-anotar", exact: true }).click();
  await page.locator(".ai-run-card:not(.done)").waitFor({ timeout: 10000 });
  await page.waitForTimeout(1300);
  runtime.child.kill("SIGKILL");
  await page.getByRole("button", { name: "Pré-anotar", exact: true }).waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector(".ai-run-card:not(.done)") || document.querySelector(".ai-run-card.done"), null, { timeout: 15000 });
  await page.waitForTimeout(800);
  const text = (await page.locator("main").innerText()).split("\n").filter((l) => /runtime|conex|resultado|falh|Failed|fetch/i.test(l)).slice(0, 3);
  console.log("   message:", JSON.stringify(text));
  assert.equal(total(await shapes(page)), before, "no partial drafts kept");
  assert.ok(await page.getByRole("button", { name: "Pré-anotar", exact: true }).isEnabled());
});

for (const width of [390, 360]) {
  await check(`real runtime: pre-annotate dialog with params fits a ${width}px phone`, { viewport: { width, height: 844 } }, async ({ page }) => {
    const dialog = await openPreannotate(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const box = await dialog.boundingBox();
    const run = await dialog.getByRole("button", { name: "Pré-anotar", exact: true }).boundingBox();
    assert.ok(overflow <= 0, `page scrolls sideways by ${overflow}px`);
    assert.ok(box.x >= 0 && box.x + box.width <= width + 0.5, `dialog ${JSON.stringify(box)}`);
    assert.ok(run && run.y + run.height <= 844, `run button reachable: ${JSON.stringify(run)}`);
    for (const name of ["Limiar"]) {
      const slider = await dialog.getByRole("slider", { name }).boundingBox();
      assert.ok(slider.x >= 0 && slider.x + slider.width <= width, `${name} slider inside`);
    }
  });
}

await check("real runtime: Connections shows the runtime as connected with its model", {}, async ({ page }) => {
  await page.getByRole("button", { name: /Modelos de IA:/ }).click();
  const hub = page.getByRole("dialog", { name: "Modelos de IA", exact: true });
  await hub.getByRole("tab", { name: /Conexões/ }).click();
  await page.waitForTimeout(1500);
  const text = (await hub.innerText()).replace(/\s+/g, " ");
  console.log("   connections:", text.slice(text.indexOf("Runtime") - 10, text.indexOf("Runtime") + 220));
  assert.match(text, /QA Blobs/);
});

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} real-runtime checks passed`);
process.exit(failed.length ? 1 : 0);
