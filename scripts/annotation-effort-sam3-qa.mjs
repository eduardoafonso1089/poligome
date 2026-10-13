/** Optional actual-editor + real SAM3 workflow check, not a human speed study.
 * --base http://127.0.0.1:PORT --image image.png --x 222 --y 121
 * --adapter trained.plora --out resultados-adaptive/sam3-local/effort-browser
 * Use an isolated connector: the check activates/deactivates the supplied LoRA.
 */
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright";

const { values } = parseArgs({ options: Object.fromEntries(["base", "image", "x", "y", "adapter", "out"].map(k => [k, { type: "string" }])) });
for (const k of ["base", "image", "x", "y", "adapter", "out"]) assert(values[k], `--${k} required`);
const base = values.base.replace(/\/$/, "");
const out = resolve(values.out);
await mkdir(out, { recursive: true });
const server = await createServer({ configFile: false, root: resolve(import.meta.dirname, ".."), plugins: [react()], server: { host: "127.0.0.1", port: 3016, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
page.setDefaultTimeout(30_000);
const errors = [];
page.on("pageerror", error => errors.push(error.message));
page.on("requestfailed", request => console.log("Request failed", request.url(), request.failure()?.errorText));
page.on("console", message => { if (message.type() === "error") console.log("Browser console", message.text()); });
const report = { kind: "automated real-model functional test; timings are not human productivity measurements", tests: {} };
async function post(path, data, binary = false) {
  const response = await page.request.post(base + path, { data, timeout: 120_000, ...(binary ? { headers: { "Content-Type": "application/octet-stream" } } : {}) });
  assert(response.ok(), `${path}: ${await response.text()}`);
  return response.json();
}
async function journal() {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find(k => k.startsWith("poligome-annotation-effort:v1:"));
    return { key, value: JSON.parse(localStorage.getItem(key)) };
  });
}
async function hub() {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("poligome:open-sam")));
  await page.getByRole("tab", { name: /Adaptive AI/ }).click();
  await page.locator(".annotation-effort-panel").waitFor();
}
async function annotate(correction = false) {
  await page.getByRole("button", { name: "Segment with SAM (S)", exact: true }).click();
  const point = await page.locator(".stage svg[preserveAspectRatio=none]").evaluate((svg, p) => {
    const point = svg.createSVGPoint(); point.x = p.x; point.y = p.y;
    const screen = point.matrixTransform(svg.getScreenCTM());
    return { x: screen.x, y: screen.y };
  }, { x: Number(values.x), y: Number(values.y) });
  const predicted = page.waitForResponse(response => response.url() === base + "/predict" && response.request().method() === "POST", { timeout: 190_000 });
  await page.mouse.click(point.x, point.y);
  const response = await predicted;
  assert(response.ok(), await response.text());
  const prediction = await response.json();
  console.log("Real prediction received", prediction.adapter, prediction.reused_embedding);
  await page.locator(".sam-actions .accept").click();
  await page.getByRole("button", { name: "Select and move (V)", exact: true }).click();
  if (correction) {
    await page.mouse.move(point.x, point.y); await page.mouse.down();
    await page.mouse.move(point.x + 8, point.y + 5, { steps: 12 }); await page.mouse.up();
  }
  await page.getByRole("button", { name: "Finish review", exact: true }).click();
  return prediction;
}
try {
  const health = await (await page.request.get(base + "/health")).json();
  assert.equal(health.status, "ready"); assert.equal(health.model_id, "sam3-concepts");
  await post("/adaptive/deactivate", {});
  await page.addInitScript(endpoint => { localStorage.setItem("poligome-language", "en"); localStorage.setItem("poligome-sam-endpoint", endpoint); }, base + "/predict");
  await page.goto("http://127.0.0.1:3016/tests/browser/annotation-effort-ui.html", { waitUntil: "networkidle" });
  await page.locator('input[accept="image/png,image/jpeg,image/webp,image/bmp,image/gif"]').setInputFiles(resolve(values.image));
  await hub();
  await page.getByRole("checkbox", { name: "Measure effort in this project" }).check();
  const project = (await journal()).key.slice("poligome-annotation-effort:v1:".length);
  await page.locator(".sam-catalog-modal > header button").click();
  const original = await annotate(true);
  assert.equal(original.adapter, null);
  const record = (await journal()).value.records[0];
  assert.equal(record.outcome, "reviewed"); assert.equal(record.clicks, 1);
  assert.equal(record.corrections, 1, "12 drag frames are one correction gesture");
  assert.equal(record.source.modelId, "sam3-concepts"); assert.equal(record.source.device, "cpu");
  assert.equal(record.source.adapter, null); assert(record.source.fingerprint);
  assert(record.waitMs > 0); assert(record.workMs > 0);
  report.tests.original_and_correction = { passed: true, record };
  console.log("PASS original attribution, clocks and correction gesture");
  const imported = await post(`/adaptive/projects/${project}/adapters/import`, await readFile(resolve(values.adapter)), true);
  await post(`/adaptive/projects/${project}/runs/${imported.run_id}/activate`, { override: true });
  const adapted = await annotate();
  assert.equal(adapted.adapter.run_id, imported.run_id);
  const saved = (await journal()).value;
  assert.equal(saved.records.length, 2);
  const adaptedRecord = saved.records[1];
  assert.equal(adaptedRecord.outcome, "reviewed"); assert.equal(adaptedRecord.source.adapter.runId, imported.run_id);
  assert.equal(adaptedRecord.source.fingerprint, record.source.fingerprint);
  assert.equal(adaptedRecord.coldRequests, 1, "activation invalidates cached embedding");
  report.tests.adapter_attribution = { passed: true, record: adaptedRecord };
  console.log("PASS real trained adapter attribution and cache invalidation");
  await hub();
  const panel = page.locator(".annotation-effort-panel");
  await panel.getByText("Original SAM", { exact: true }).waitFor();
  await panel.locator("tbody tr").nth(1).waitFor();
  assert.equal(await panel.locator("tbody tr").count(), 2);
  const downloaded = page.waitForEvent("download");
  await panel.getByRole("button", { name: "Export measurements CSV" }).click();
  const download = await downloaded; await download.saveAs(resolve(out, "functional-effort.csv"));
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(out, "measured-effort.png") });
  report.tests.panel_and_csv = { passed: true };
  assert.deepEqual(errors, []);
  report.passed = true;
} catch (error) {
  report.passed = false; report.error = error.message; report.browserErrors = errors;
  await writeFile(resolve(out, "failed-page.txt"), await page.locator("body").innerText());
  await page.screenshot({ path: resolve(out, "failed.png") });
  console.error(error); process.exitCode = 1;
} finally {
  await writeFile(resolve(out, "results.json"), JSON.stringify(report, null, 2));
  await post("/adaptive/deactivate", {}).catch(() => {});
  await browser.close(); await server.close();
}
