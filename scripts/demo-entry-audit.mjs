import { launchAuditBrowser } from "./audit-browser.mjs";
import fs from "node:fs/promises";
import { startGuidedDemo } from "./demo-audit-helpers.mjs";

const BASE = process.env.AUDIT_BASE_URL ?? "http://127.0.0.1:4174";
await fs.mkdir("interaction-audit", { recursive: true });
const results = [];
const failures = [];

function record(scope, name, ok, detail = "") {
  results.push({ scope, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${scope}] ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(`[${scope}] ${name}: ${detail}`);
}

async function check(scope, name, fn) {
  try { record(scope, name, true, (await fn()) ?? ""); }
  catch (error) { record(scope, name, false, error instanceof Error ? error.message : String(error)); }
}

async function toolbarButton(page, pattern) {
  const target = page.getByRole("button", { name: pattern }).first();
  await target.waitFor({ state: "visible", timeout: 10000 });
  await target.scrollIntoViewIfNeeded().catch(() => undefined);
  return target;
}

async function canvas(page) {
  const svg = page.locator(".stage svg").first();
  await svg.waitFor({ state: "visible", timeout: 10000 });
  const box = await svg.boundingBox();
  if (!box) throw new Error("canvas SVG has no bounds");
  return { svg, box };
}

function point(box, fx, fy) {
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

function touchPoint(value) {
  return { x: value.x, y: value.y, radiusX: 2, radiusY: 2, force: .6 };
}

async function touchDrag(cdp, from, to, steps = 10) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touchPoint(from)] });
  for (let index = 1; index <= steps; index += 1) {
    const t = index / steps;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [touchPoint({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t })],
    });
    await new Promise((resolve) => setTimeout(resolve, 8));
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function drag(page, cdp, from, to, touch) {
  if (touch) return touchDrag(cdp, from, to);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

async function press(page, locator, touch) {
  await locator.scrollIntoViewIfNeeded().catch(() => undefined);
  if (touch) await locator.tap(); else await locator.click();
}

async function waitStep(page, step) {
  const card = page.locator(`.demo-tutorial-card[data-demo-tutorial-step="${step}"]`).first();
  await card.waitFor({ state: "visible", timeout: 10000 });
  return card;
}

async function run(browser, scope, contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const errors = [];
  const touch = Boolean(contextOptions.hasTouch);
  page.on("pageerror", (error) => errors.push(error.message));

  try {
    await check(scope, "Demo starts at the exact 1/3 Box prompt with a clean canvas", async () => {
      const tutorial = await startGuidedDemo(page, BASE);
      await waitStep(page, 0);
      const title = await tutorial.locator("h2").innerText();
      const annotations = await page.locator("[data-annotation-id]").count();
      const project = await page.locator(".project-name").innerText();
      if (!/^Demo\b/i.test(project.trim())) throw new Error(`project=${project.trim()}`);
      if (!/Selecione a ferramenta Caixa|Select the Box tool|Boîte|Caja/i.test(title)) throw new Error(`title=${title}`);
      if (annotations !== 0) throw new Error(`expected clean tutorial canvas, annotations=${annotations}`);
      return `${project.trim()} · ${title}`;
    });

    await check(scope, "Step 1 keeps the tutorial open after choosing Box", async () => {
      const boxTool = await toolbarButton(page, /Caixa \(B\)|Box \(B\)/i);
      await press(page, boxTool, touch);
      const card = await waitStep(page, 0);
      const title = await card.locator("h2").innerText();
      if (!/Desenhe uma caixa|Draw a box|Dessinez|Dibuja/i.test(title)) throw new Error(`title=${title}`);
      if (!await page.locator(".demo-tutorial-target").isVisible()) throw new Error("roof target is not visible");
      return title;
    });

    await check(scope, "Step 1 accepts a box on the highlighted roof and advances to success", async () => {
      const { box } = await canvas(page);
      await drag(page, cdp, point(box, .40, .15), point(box, .52, .32), touch);
      const card = await waitStep(page, 1);
      const title = await card.locator("h2").innerText();
      const annotations = await page.locator("[data-annotation-id]").count();
      if (annotations !== 1) throw new Error(`annotations=${annotations}`);
      if (!/Muito bem|Great|Très bien|Muy bien/i.test(title)) throw new Error(`title=${title}`);
      return title;
    });

    await check(scope, "Next reproduces the 2/3 park-box editing task", async () => {
      const card = await waitStep(page, 1);
      await press(page, card.getByRole("button", { name: /Próximo|Next|Suivant|Siguiente/i }), touch);
      const step2 = await waitStep(page, 2);
      const status = await page.locator(".status > div span").innerText();
      const ids = await page.locator("[data-annotation-id]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-annotation-id")));
      const title = await step2.locator("h2").innerText();
      if (!/2\s*\/\s*3/.test(status)) throw new Error(`status=${status}`);
      if (ids.length !== 1 || ids[0] !== "demo-b4") throw new Error(`annotations=${ids.join(",")}`);
      if (!/Selecione a ferramenta de movimentação|Select the move tool|déplacement|movimiento/i.test(title)) throw new Error(`title=${title}`);
      return `${status} · ${title}`;
    });

    await check(scope, "Step 2 remains open after Select and advances only after editing the box", async () => {
      const select = await toolbarButton(page, /Selecionar e mover \(V\)|Select/i);
      await press(page, select, touch);
      const step2 = await waitStep(page, 2);
      const title = await step2.locator("h2").innerText();
      if (!/Edite uma caixa|Edit a box|Modifiez|Edita/i.test(title)) throw new Error(`title=${title}`);
      if (!await page.locator(".demo-tutorial-target").isVisible()) throw new Error("edit target is not visible");

      const handle = page.locator('[data-annotation-id="demo-b4"] .box-resize-handle.se').first();
      await handle.waitFor({ state: "visible", timeout: 10000 });
      const bounds = await handle.boundingBox();
      if (!bounds) throw new Error("resize handle has no bounds");
      const from = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      await drag(page, cdp, from, { x: from.x + 26, y: from.y + 18 }, touch);
      const step3 = await waitStep(page, 3);
      return step3.locator("h2").innerText();
    });

    await check(scope, "Next reproduces the 3/3 local-model task", async () => {
      const card = await waitStep(page, 3);
      await press(page, card.getByRole("button", { name: /Próximo|Next|Suivant|Siguiente/i }), touch);
      const step4 = await waitStep(page, 4);
      const status = await page.locator(".status > div span").innerText();
      const annotations = await page.locator("[data-annotation-id]").count();
      if (!/3\s*\/\s*3/.test(status)) throw new Error(`status=${status}`);
      if (annotations !== 0) throw new Error(`expected clean model task, annotations=${annotations}`);
      if (!await page.locator(".demo-tutorial-model-point").isVisible()) throw new Error("model point is not visible");
      return `${status} · ${await step4.locator("h2").innerText()}`;
    });

    await check(scope, "Step 3 click creates the simulated model polygon", async () => {
      const { box } = await canvas(page);
      const target = point(box, .525, 422 / 650);
      if (touch) await page.touchscreen.tap(target.x, target.y); else await page.mouse.click(target.x, target.y);
      const step5 = await waitStep(page, 5);
      const annotations = await page.locator("[data-annotation-id]").count();
      if (annotations !== 1) throw new Error(`annotations=${annotations}`);
      return step5.locator("h2").innerText();
    });

    await check(scope, "Final action restores the full Demo and opens local-model settings", async () => {
      const card = await waitStep(page, 5);
      await press(page, card.getByRole("button", { name: /Conhecer modelos locais|Explore local models|modèles locaux|modelos locales/i }), touch);
      const sam = page.getByRole("dialog").filter({ hasText: /SAM|Segment Anything/i }).first();
      await sam.waitFor({ state: "visible", timeout: 10000 });
      await page.waitForFunction(() => document.querySelectorAll("[data-annotation-id]").length >= 7, null, { timeout: 10000 });
      const status = await page.locator(".status > div span").innerText();
      if (!/1\s*\/\s*3/.test(status)) throw new Error(`status=${status}`);
      const dedicatedCard = page.locator('.demo-tutorial-card[data-demo-tutorial-step]');
      if (await dedicatedCard.count()) throw new Error("guided tutorial did not close");
      return `${await page.locator("[data-annotation-id]").count()} reference annotations restored`;
    });

    record(scope, "No page errors", errors.length === 0, errors.join(" | "));
    await page.screenshot({ path: `interaction-audit/demo-walkthrough-${scope}.png`, fullPage: false });
  } finally {
    await context.close();
  }
}

const browser = await launchAuditBrowser();
try {
  await run(browser, "desktop", { viewport: { width: 1440, height: 900 } });
  await run(browser, "mobile", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
} finally {
  await browser.close();
}

await fs.writeFile("interaction-audit/demo-entry-report.json", JSON.stringify(results, null, 2));
if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
