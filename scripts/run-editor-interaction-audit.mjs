import fs from "node:fs/promises";

const sourceUrl = new URL("./editor-interaction-audit.mjs", import.meta.url);
const runtimeUrl = new URL("./.editor-interaction-audit-runtime.mjs", import.meta.url);
let source = await fs.readFile(sourceUrl, "utf8");
const oldAssertion = `await (await button(page,/Centralizar e ajustar|Fit/i)).click(); if(!/92%/.test(await page.locator('.zoom span').innerText())) throw new Error("fit != 92%");`;
const newAssertion = `const fitSvg = page.locator('.stage svg').first(); const dimensions = await fitSvg.evaluate((el) => ({ width: el.viewBox.baseVal.width, height: el.viewBox.baseVal.height })); const viewport = await scroll.evaluate((el) => ({ width: el.clientWidth, height: el.clientHeight })); const heightAtHundred = Math.max(1, viewport.width) * dimensions.height / Math.max(1, dimensions.width); const expectedFit = Math.max(10, Math.min(100, Math.floor(Math.min(100, viewport.height / Math.max(1, heightAtHundred) * 100) * 0.96))); await (await button(page,/Centralizar e ajustar|Fit/i)).click(); const actualFit = Number((await page.locator('.zoom span').innerText()).replace('%','')); if(actualFit !== expectedFit) throw new Error(\`fit \${actualFit}% != historical \${expectedFit}%\`);`;
if (!source.includes(oldAssertion)) throw new Error("Interaction audit fit assertion changed; update the runner instead of silently weakening the check.");
source = source.replace(oldAssertion, newAssertion);
await fs.writeFile(runtimeUrl, source);
try {
  await import(`${runtimeUrl.href}?run=${Date.now()}`);
} finally {
  await fs.rm(runtimeUrl, { force: true });
}
