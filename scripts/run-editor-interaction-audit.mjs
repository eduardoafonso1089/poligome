import fs from "node:fs/promises";

const sourceUrl = new URL("./editor-interaction-audit.mjs", import.meta.url);
const runtimeUrl = new URL("./.editor-interaction-audit-runtime.mjs", import.meta.url);
let source = await fs.readFile(sourceUrl, "utf8");

const demoPattern = /async function demo\(page\) \{[\s\S]*?\n\}\n(?=\nasync function desktop)/;
if (!demoPattern.test(source)) throw new Error("Interaction audit Demo helper changed; update the runner instead of silently weakening the check.");
source = `import { openDemoDataset } from "./demo-audit-helpers.mjs";\n${source}`;
source = source.replace(demoPattern, `async function demo(page) {\n  await openDemoDataset(page, BASE);\n}\n`);

const oldAssertion = `await (await button(page,/Centralizar e ajustar|Fit/i)).click(); if(!/92%/.test(await page.locator('.zoom span').innerText())) throw new Error("fit != 92%");`;
const newAssertion = `const fitSvg = page.locator('.stage svg').first(); const dimensions = await fitSvg.evaluate((el) => ({ width: el.viewBox.baseVal.width, height: el.viewBox.baseVal.height })); const viewport = await scroll.evaluate((el) => ({ width: el.clientWidth, height: el.clientHeight })); const heightAtHundred = Math.max(1, viewport.width) * dimensions.height / Math.max(1, dimensions.width); const expectedFit = Math.max(10, Math.min(100, Math.floor(Math.min(100, viewport.height / Math.max(1, heightAtHundred) * 100) * 0.96))); await (await button(page,/Centralizar e ajustar|Fit/i)).click(); const actualFit = Number((await page.locator('.zoom span').innerText()).replace('%','')); if(actualFit !== expectedFit) throw new Error(\`fit \${actualFit}% != historical \${expectedFit}%\`);`;
if (!source.includes(oldAssertion)) throw new Error("Interaction audit fit assertion changed; update the runner instead of silently weakening the check.");
source = source.replace(oldAssertion, newAssertion);

const oldDelete = `const del=page.locator('.drawing-actions').getByRole('button',{name:/Excluir|Delete/i}).last(); if(await del.isDisabled()) throw new Error("selection not retained");`;
const newDelete = `const del=page.getByRole('button',{name:/Excluir forma inteira|Delete entire shape/i}).first(); if(await del.isDisabled()) throw new Error("selection not retained");`;
if (!source.includes(oldDelete)) throw new Error("Mobile delete audit changed; update the runner instead of silently weakening the check.");
source = source.replace(oldDelete, newDelete);

const oldPan = `await check("mobile","Pan control toggles",async()=>{ const pan=page.locator('.drawing-actions').getByRole('button',{name:/Mover canvas|Pan/i}).first(); await pan.waitFor({state:'visible'}); await pan.tap(); const toolbar=page.getByRole('button',{name:/Mover canvas \\(H\\)|Pan/i}).first(); if(await toolbar.getAttribute('aria-pressed')!=="true") throw new Error("Pan inactive"); await pan.tap(); });`;
const newPan = `await check("mobile","Pan control toggles",async()=>{ const pan=page.getByRole('button',{name:/Mover canvas \\(H\\)|Pan/i}).first(); await pan.waitFor({state:'visible'}); await pan.tap(); if(await pan.getAttribute('aria-pressed')!=="true") throw new Error("Pan inactive"); await pan.tap(); });`;
if (!source.includes(oldPan)) throw new Error("Mobile pan audit changed; update the runner instead of silently weakening the check.");
source = source.replace(oldPan, newPan);

await fs.writeFile(runtimeUrl, source);
try {
  await import(`${runtimeUrl.href}?run=${Date.now()}`);
} finally {
  await fs.rm(runtimeUrl, { force: true });
}
