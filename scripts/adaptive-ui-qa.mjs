/** Browser regressions against the real AI hub and CSS. No model or GPU required.
 * All scores are fixed backend fixtures, never empirical model measurements.
 * Run: node scripts/adaptive-ui-qa.mjs (requires Playwright Chromium installed).
 */
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const fixture = JSON.parse(await readFile(resolve(root, "tests/fixtures/adaptive-backend.json"), "utf8"));
const out = resolve(root, "outputs/adaptive-ui-qa");
await mkdir(out, { recursive: true });
const server = await createServer({ configFile: false, root, plugins: [react()], server: { host: "127.0.0.1", port: 3015, strictPort: true } });
await server.listen();
let browser;
const results = [];

async function scenario(name, options, check) {
  const page = await browser.newPage({ viewport: { width: options.width ?? 1366, height: 900 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const state = { remote: null, active: null, run: options.run ? structuredClone(fixture.run) : null, requests: [], offline: options.offline, family: options.family ?? "sam2" };
  if (state.run && options.outcome) state.run.comparison.decision.outcome = options.outcome;
  if (state.run && options.learningCurve) { state.run.status = "evaluating"; state.run.stage = "learning_curve"; }
  const status = () => ({ api_version: 1, available: true, model: { model_id: state.family === "sam3" ? "sam3-concepts" : "sam2.1-hiera-tiny", family: state.family, device: "cpu", supported: true }, active: state.active, training: state.run && ["training", "evaluating"].includes(state.run.status) ? { project_id: "p-ui-project-00001", run_id: state.run.run_id, status: state.run.status, progress: {} } : null });
  const run = () => ({ ...state.run, project_id: "p-ui-project-00001" });
  await page.route(/http:\/\/127\.0\.0\.1:(7860|7862)\/adaptive\//, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    state.requests.push({ method, path });
    if (state.offline) return route.abort("connectionrefused");
    if (state.remote === null) state.remote = options.synced ? await page.evaluate(() => Object.fromEntries(window.adaptiveUiQa.plan.items.map(item => [item.key, item.fingerprint]))) : {};
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/adaptive/status") return json(status());
    if (path.includes("/projects/p-ui-project-00002/")) {
      if (path.endsWith("/items")) return json({ items: {} });
      if (path.endsWith("/runs")) return json({ runs: [], history: [] });
      return json({ detail: { code: "run_not_found", message: "No run in the new project" } }, 404);
    }
    if (path.endsWith("/items") && method === "GET") return json({ items: state.remote });
    if (path.endsWith("/candidates") && method === "GET") return json({ items: {} });
    if (/\/candidates\/[^/]+$/.test(path)) return json({ key: path.split("/").at(-1) });
    if (path.endsWith("/suggestions")) {
      const key = await page.evaluate(() => window.adaptiveUiQa.candidates[0].key);
      return json({ method: "sam2_embedding", suggestions: [{ key, rank: 1, novelty: 2.4, reason: "novel" }], annotated: 1, candidates: 1 });
    }
    if (/\/items\/[^/]+$/.test(path)) {
      const key = path.split("/").at(-1);
      if (method === "DELETE") delete state.remote[key];
      else state.remote[key] = request.postDataJSON().fingerprint;
      return json({ key });
    }
    if (path.endsWith("/assess")) return json(options.emptyReport && Object.keys(state.remote).length === 0 ? { ...fixture.readiness, can_train: false, state: "collecting" } : fixture.readiness);
    if (path.endsWith("/runs") && method === "GET") return json({ runs: state.run ? [{ ...run(), outcome: state.run.comparison?.decision.outcome, mean_delta: 0.05 }] : [], history: [] });
    if (path.endsWith("/runs") && method === "POST") {
      state.run = { ...structuredClone(fixture.run), status: "training", stage: "training", comparison: undefined, progress: { phase: "training", epoch: 1, max_epochs: 3, done: 1, total: 12 } };
      return json(run());
    }
    if (path.endsWith("/cancel")) { state.run.status = "cancelled"; return json({ cancelled: true }); }
    if (path.endsWith("/activate")) {
      state.active = { project_id: "p-ui-project-00001", run_id: state.run.run_id, base_model_id: status().model.model_id, applied: true };
      state.run.activation = "active";
      return json(status());
    }
    if (path === "/adaptive/deactivate" || path.endsWith("/rollback")) {
      state.active = null; if (state.run) state.run.activation = "inactive"; return json(status());
    }
    if (path.endsWith("/reject")) { state.run.activation = "rejected"; return json({ rejected: true }); }
    if (/\/examples\//.test(path)) return route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR0sAAAAASUVORK5CYII=", "base64") });
    if (/\/runs\/[^/]+$/.test(path)) return json(run());
    return json({ detail: { code: "unexpected_route", message: `${method} ${path}` } }, 404);
  });
  try {
    await page.goto("http://127.0.0.1:3015/tests/browser/adaptive-ui.html", { waitUntil: "networkidle" });
    await check(page, state);
    assert.deepEqual(errors, [], "uncaught browser errors");
    await page.screenshot({ path: resolve(out, `${name}.png`), fullPage: true });
    if (await page.locator(".adaptive-comparison").count()) {
      await page.locator(".adaptive-comparison").scrollIntoViewIfNeeded();
      await page.screenshot({ path: resolve(out, `${name}-comparison.png`) });
    }
    results.push({ name, passed: true, requests: state.requests.length });
    console.log(`PASS ${name}`);
  } catch (error) {
    await page.screenshot({ path: resolve(out, `${name}-failed.png`), fullPage: true });
    results.push({ name, passed: false, error: error.message, browserErrors: errors });
    console.error(`FAIL ${name}: ${error.message}`);
  } finally { await page.close(); }
}

try {
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  await scenario("offline-retry", { offline: true }, async (p, s) => {
    await p.getByText("The local connector did not answer.", { exact: false }).waitFor();
    s.offline = false;
    await p.getByRole("button", { name: "Try again", exact: true }).click();
    await p.getByRole("button", { name: "Send and analyze", exact: true }).waitFor();
  });
  await scenario("synchronize-train-cancel", {}, async p => {
    const train = p.getByRole("button", { name: "Start training round", exact: true });
    assert.equal(await train.isDisabled(), true);
    await p.getByRole("button", { name: "Send and analyze", exact: true }).click();
    await train.waitFor(); await p.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === 'Start training round')?.disabled);
    await train.click();
    await p.getByRole("button", { name: "Cancel", exact: true }).click();
    await p.getByText("Cancelled", { exact: true }).first().waitFor();
  });
  await scenario("dirty-data-blocks-training", { synced: true }, async p => {
    const train = p.getByRole("button", { name: "Start training round", exact: true });
    await p.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === 'Start training round')?.disabled);
    await p.evaluate(() => window.adaptiveUiQa.changeAnnotation());
    assert.equal(await train.isDisabled(), true);
    await p.getByRole("button", { name: "Send and analyze", exact: true }).click();
    await p.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === 'Start training round')?.disabled);
  });
  await scenario("delete-last-mask-synchronizes", { synced: true, emptyReport: true }, async (p, s) => {
    await p.getByText("Readiness indicators", { exact: true }).waitFor();
    await p.evaluate(() => window.adaptiveUiQa.removeAnnotations());
    const send = p.getByRole("button", { name: "Send and analyze", exact: true });
    assert.equal(await send.isDisabled(), false);
    await send.click();
    await p.getByText("Collecting data", { exact: true }).waitFor();
    assert.equal(Object.keys(s.remote).length, 0);
    assert(s.requests.some(r => r.method === "DELETE"));
  });
  await scenario("project-and-connector-isolation", { synced: true, run: true }, async (p, s) => {
    await p.locator(".adaptive-verdict").waitFor();
    await p.evaluate(() => window.adaptiveUiQa.setProject({ ...window.adaptiveUiQa.project, id: "p-ui-project-00002" }));
    await p.waitForTimeout(200);
    assert.equal(await p.locator(".adaptive-verdict").count(), 0, "previous project comparison leaked");
    s.remote = {}; s.run = null;
    await p.evaluate(() => window.adaptiveUiQa.setEndpoint("http://127.0.0.1:7862/predict"));
    await p.getByRole("button", { name: "Send and analyze", exact: true }).waitFor();
    assert.equal(await p.getByRole("button", { name: "Start training round", exact: true }).isDisabled(), true);
  });
  await scenario("activate-deactivate-reopen", { synced: true, run: true }, async p => {
    await p.locator(".adaptive-verdict").waitFor();
    await p.getByRole("button", { name: "Activate adapter", exact: true }).click();
    await p.locator(".adaptive-active").getByText(/In use: adapter/).waitFor();
    await p.getByRole("button", { name: "Deactivate", exact: true }).click();
    await p.locator(".adaptive-active").getByText("In use: original model", { exact: true }).waitFor();
    await p.keyboard.press("Escape");
    await p.locator("#qa-reopen").click();
    await p.getByText("Readiness indicators", { exact: true }).waitFor();
    assert.equal(await p.getByRole("button", { name: "Start training round", exact: true }).isDisabled(), false);
  });
  await scenario("sam3-decoder-only", { synced: true, family: "sam3" }, async p => {
    await p.getByText(/Text search does not change/).first().waitFor();
    await p.locator(".adaptive-settings summary").click();
    assert.equal(await p.locator('.adaptive-settings option[value="encoder_decoder"]').getAttribute("disabled"), "");
  });
  await scenario("suggestion-opens-the-requested-image", { synced: true }, async p => {
    await p.evaluate(() => window.addEventListener("poligome:select-asset", event => { window.qaSelectedAsset = event.detail.assetId; }));
    await p.getByRole("button", { name: /Suggest images/ }).click();
    await p.locator(".adaptive-suggestions button").first().click();
    await p.waitForFunction(() => window.qaSelectedAsset === "ui-image-2");
  });
  await scenario("activation-during-learning-curve-can-be-rolled-back", { synced: true, run: true, learningCurve: true }, async p => {
    await p.getByRole("button", { name: "Activate adapter", exact: true }).click();
    await p.locator(".adaptive-active").getByText(/In use: adapter/).waitFor();
    await p.getByRole("button", { name: "Roll back", exact: true }).click();
    await p.locator(".adaptive-active").getByText("In use: original model", { exact: true }).waitFor();
  });
  await scenario("loaded-model-change-resets-strategy-and-blocks-incompatible-adapter", { synced: true, run: true }, async (p, s) => {
    await p.getByRole("button", { name: "Activate adapter", exact: true }).waitFor();
    await p.locator(".adaptive-settings summary").click();
    await p.locator(".adaptive-settings select").selectOption("encoder_decoder");
    s.family = "sam3";
    await p.evaluate(() => window.adaptiveUiQa.setModel("sam3-concepts"));
    await p.getByText(/To use this adapter, load its base model/).waitFor();
    assert.equal(await p.getByRole("button", { name: "Activate adapter", exact: true }).isDisabled(), true);
    await p.locator(".adaptive-settings summary").click();
    assert.equal(await p.locator(".adaptive-settings select").inputValue(), "auto");
    assert.equal(await p.locator('.adaptive-settings option[value="encoder_decoder"]').getAttribute("disabled"), "");
  });
  await scenario("weak-candidate-consent-is-bound-to-the-selected-round", { synced: true, run: true, outcome: "not_improved" }, async (p, s) => {
    const consent = p.getByRole("checkbox", { name: /I reviewed the results/ });
    await consent.check();
    s.run = { ...s.run, run_id: "run-20261013t235959z-bbb222", created_at: "2026-10-13T23:59:59Z" };
    await p.locator(".adaptive-link").click();
    await p.locator(".adaptive-history tbody button").first().click();
    await p.waitForFunction(() => !document.querySelector('.adaptive-confirm input')?.checked);
    assert.equal(await p.getByRole("button", { name: "Activate anyway", exact: true }).isDisabled(), true);
  });
  for (const outcome of ["not_improved", "insufficient_evidence"]) {
    await scenario(`user-choice-${outcome}`, { synced: true, run: true, outcome }, async (p, s) => {
      const activate = p.getByRole("button", { name: "Activate anyway", exact: true });
      await activate.waitFor();
      assert.equal(await activate.isDisabled(), true);
      assert.equal(s.active, null, "activation must never be automatic");
      await p.getByRole("checkbox", { name: /I reviewed the results/ }).check();
      await activate.click();
      await p.locator(".adaptive-active").getByText(/In use: adapter/).waitFor();
      assert(s.requests.some(r => r.path.endsWith("/activate")));
    });
  }
  for (const language of ["pt", "en", "fr", "es"]) {
    for (const width of [390, 1366]) await scenario(`layout-${language}-${width}`, { synced: true, run: true, width }, async p => {
      await p.evaluate(lang => window.adaptiveUiQa.setLanguage(lang), language);
      await p.locator(".adaptive-verdict").waitFor();
      const overflow = await p.evaluate(() => ({ document: document.documentElement.scrollWidth > innerWidth + 1, panel: [...document.querySelectorAll('.adaptive-panel, .sam-dialog')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.className) }));
      assert.equal(overflow.document, false, "horizontal page overflow");
      assert.deepEqual(overflow.panel, [], "horizontal panel overflow");
      const body = await p.locator(".adaptive-panel").innerText();
      assert.doesNotMatch(body, /\{(?:n|low|high|groups|delta|message)\}/, "unfilled translation placeholder");
    });
  }
} finally {
  await writeFile(resolve(out, "results.json"), JSON.stringify({ fixtureOnly: true, results }, null, 2));
  await browser?.close(); await server.close();
}
if (results.some(r => !r.passed)) process.exitCode = 1;
