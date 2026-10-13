/** Real editor with controlled predictions: validates effort lifecycle, not SAM quality. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright";
const out = resolve("outputs/annotation-effort-ui-qa");
await mkdir(out, { recursive: true });
const server = await createServer({ configFile: false, root: resolve(import.meta.dirname, ".."), plugins: [react()], server: { host: "127.0.0.1", port: 3017, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const result = { fixtureOnly: true, passed: false };
const base = "http://127.0.0.1:7860";
async function records() {
  return page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith("poligome-annotation-effort:v1:")))).records);
}
async function pixel(x, y) {
  const position = await page.locator('.stage svg[preserveAspectRatio=none]').evaluate((svg, p) => {
    const point = svg.createSVGPoint(); point.x = p.x; point.y = p.y;
    const mapped = point.matrixTransform(svg.getScreenCTM()); return { x: mapped.x, y: mapped.y };
  }, { x, y });
  await page.mouse.click(position.x, position.y);
}
try {
  await page.route(base + "/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let body = {};
    if (path === '/health') body = { service: 'Poligome SAM local', api_version: 2, status: 'ready', model_id: 'sam3-concepts', family: 'sam3', device: 'cpu', capabilities: ['point', 'box'] };
    if (path === '/models') body = { models: [] };
    if (path === '/byom/models') body = { models: [] };
    if (path === '/adaptive/status') body = { available: true, model: { model_id: 'sam3-concepts', family: 'sam3', supported: true, device: 'cpu' }, active: null };
    if (path.endsWith('/runs')) body = { runs: [], history: [] };
    if (path.endsWith('/items')) body = { items: {} };
    if (path === '/predict') body = { width: 256, height: 256, model_id: 'sam3-concepts', device: 'cpu', model_fingerprint: 'a'.repeat(64), adapter: null, reused_embedding: false,
      predictions: [{ polygon: [20, 40, 90, 40, 90, 100, 20, 100] }, { polygon: [140, 140, 210, 140, 210, 200, 140, 200] }] };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.addInitScript(endpoint => { localStorage.setItem('poligome-language', 'en'); localStorage.setItem('poligome-sam-endpoint', endpoint); }, base + '/predict');
  await page.goto('http://127.0.0.1:3017/tests/browser/annotation-effort-ui.html', { waitUntil: 'networkidle', timeout: 60_000 });
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 256; c.getContext('2d').fillRect(0, 0, 256, 256); return c.toDataURL().split(',')[1]; });
  await page.locator('input[accept="image/png,image/jpeg,image/webp,image/bmp,image/gif"]').setInputFiles({ name: 'effort-fixture.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('poligome:open-sam')));
  await page.getByRole('tab', { name: /Adaptive AI/ }).click();
  await page.getByRole('checkbox', { name: 'Measure effort in this project' }).check();
  await page.locator('.sam-catalog-modal > header button').click();
  await page.getByRole('button', { name: 'Segment with SAM (S)', exact: true }).click();
  await pixel(50, 70);
  await page.locator('.sam-actions .accept').click();
  await page.getByRole('button', { name: 'Select and move (V)', exact: true }).click();
  assert.equal((await records())[0].annotationIds.length, 2);
  // Accept selects the whole batch; clear that selection before deleting one.
  await pixel(230, 50);
  await pixel(50, 70);
  await page.getByRole('button', { name: 'Delete entire shape', exact: true }).click();
  await page.waitForFunction(() => {
    const key = Object.keys(localStorage).find(k => k.startsWith('poligome-annotation-effort:v1:'));
    return JSON.parse(localStorage.getItem(key)).records[0].annotationIds.length === 1;
  });
  assert.equal((await records())[0].annotationIds.length, 1, 'deleted proposal cannot count as reviewed');
  await page.getByRole('button', { name: 'Finish review', exact: true }).click();
  let record = (await records())[0];
  assert.equal(record.outcome, 'reviewed'); assert.equal(record.corrections, 1);
  const svg = page.locator('.stage svg[preserveAspectRatio=none]');
  const position = await svg.evaluate(svg => { const p = svg.createSVGPoint(); p.x = 170; p.y = 170; const s = p.matrixTransform(svg.getScreenCTM()); return { x: s.x, y: s.y }; });
  await page.mouse.move(position.x, position.y); await page.mouse.down();
  await page.mouse.move(position.x + 8, position.y + 5, { steps: 12 }); await page.mouse.up();
  await page.getByRole('button', { name: 'Finish review', exact: true }).waitFor();
  assert.equal((await records())[0].outcome, 'in_progress', 'editing after completion reopens the existing record');
  await page.getByRole('button', { name: 'Pause measurement', exact: true }).click();
  await page.getByRole('button', { name: 'Resume measurement', exact: true }).click();
  await page.getByRole('button', { name: 'Finish review', exact: true }).click();
  record = (await records())[0];
  assert.equal(record.corrections, 2); assert.equal(record.outcome, 'reviewed');
  assert.equal((await records()).length, 1, 're-review updates the record without duplicating masks');
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal((await records())[0].outcome, 'reviewed', 'local history survives reload');
  assert.deepEqual(errors, []);
  result.passed = true;
  console.log('PASS partial deletion, re-review, pause/resume and reload persistence');
} catch (error) {
  result.error = error.message; result.browserErrors = errors; process.exitCode = 1;
  console.error(error); await page.screenshot({ path: resolve(out, 'failed.png') });
} finally {
  await writeFile(resolve(out, 'results.json'), JSON.stringify(result, null, 2));
  await browser.close(); await server.close();
}
