import { chromium } from "playwright";
import fs from "node:fs/promises";
import { openDemoDataset } from "./demo-audit-helpers.mjs";

const BASE = process.env.AUDIT_BASE_URL ?? "http://127.0.0.1:4174";
await fs.mkdir("interaction-audit", { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await context.newPage();
try {
  await openDemoDataset(page, BASE);
  await page.waitForTimeout(250);
  const state = await page.evaluate(() => {
    const svg = document.querySelector(".stage svg");
    const canvasWrapper = svg?.parentElement;
    const stage = document.querySelector(".stage");
    const controls = document.querySelector(".editor-controls");
    if (!(svg instanceof SVGSVGElement)) return { missing: true };
    const style = getComputedStyle(svg);
    const rect = svg.getBoundingClientRect();
    const wrapperStyle = canvasWrapper ? getComputedStyle(canvasWrapper) : null;
    const wrapperRect = canvasWrapper?.getBoundingClientRect();
    const stageRect = stage?.getBoundingClientRect();
    return {
      missing: false,
      annotations: document.querySelectorAll("[data-annotation-id]").length,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      display: style.display,
      visibility: style.visibility,
      opacity: style.opacity,
      pointerEvents: style.pointerEvents,
      wrapper: wrapperRect ? { x: wrapperRect.x, y: wrapperRect.y, width: wrapperRect.width, height: wrapperRect.height, display: wrapperStyle?.display, visibility: wrapperStyle?.visibility } : null,
      stage: stageRect ? { x: stageRect.x, y: stageRect.y, width: stageRect.width, height: stageRect.height } : null,
      controlsScrollLeft: controls instanceof HTMLElement ? controls.scrollLeft : null,
      staleLegacyCard: Boolean(document.querySelector(".pre-refactor-demo-card")),
      guidedCard: Boolean(document.querySelector('.demo-tutorial-card[data-demo-tutorial-step]')),
      legacyTargetCount: document.querySelectorAll(".demo-tutorial-tool-target").length,
    };
  });
  console.log(JSON.stringify(state, null, 2));
  await fs.writeFile("interaction-audit/mobile-restored-demo-state.json", JSON.stringify(state, null, 2));
  await page.screenshot({ path: "interaction-audit/mobile-restored-demo-state.png", fullPage: false });
  if (state.missing) throw new Error("Editor SVG missing after leaving guided Demo");
  if (state.annotations < 7) throw new Error(`Expected restored annotations, got ${state.annotations}`);
  if (!state.rect || state.rect.width <= 0 || state.rect.height <= 0 || state.display === "none" || state.visibility === "hidden") {
    throw new Error(`Editor SVG hidden after leaving guided Demo: ${JSON.stringify(state)}`);
  }
} finally {
  await context.close();
  await browser.close();
}
