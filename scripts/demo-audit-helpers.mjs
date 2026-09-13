export async function openDemoDataset(page, base) {
  await page.goto(`${base}/annotate/?demo=1`, { waitUntil: "networkidle", timeout: 90000 });
  const tutorial = page.locator(".demo-tutorial-card").first();
  await tutorial.waitFor({ state: "visible", timeout: 30000 });
  const close = tutorial.getByRole("button", { name: /Fechar|Close|Fermer|Cerrar/i }).first();
  await close.click({ force: true });
  await page.waitForFunction(() => document.querySelectorAll("[data-annotation-id]").length >= 7, null, { timeout: 30000 });
}

export async function startGuidedDemo(page, base) {
  await page.goto(`${base}/annotate/`, { waitUntil: "networkidle", timeout: 90000 });
  const demo = page.getByRole("button", { name: /Experimentar Demo|Try Demo|Essayer la démo|Probar demo|Demo/i }).last();
  await demo.waitFor({ state: "visible", timeout: 10000 });
  await demo.click({ force: true });
  const tutorial = page.locator(".demo-tutorial-card").first();
  await tutorial.waitFor({ state: "visible", timeout: 30000 });
  return tutorial;
}
