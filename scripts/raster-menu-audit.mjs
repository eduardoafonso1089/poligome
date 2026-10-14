// The File menu's GeoTIFF/COG entries.
//
// For a month they were in the DOM but hidden by a CSS rule meant to keep the
// menu "export only", so a GeoTIFF could not be opened at all even though the
// README promises it. This checks they are visible and that the address dialog
// explains each failure in words a person can act on.
import assert from "node:assert/strict";
import { launchAuditBrowser } from "./audit-browser.mjs";
import { openDemoDataset } from "./demo-audit-helpers.mjs";

const BASE = process.env.AUDIT_BASE_URL ?? "http://127.0.0.1:4174";
const browser = await launchAuditBrowser();
let failed = 0;

async function check(name, width, run) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await openDemoDataset(page, BASE);
    await run(page, context);
    assert.deepEqual(errors, []);
    console.log(`PASS [raster] ${name} @${width}`);
  } catch (error) {
    failed++;
    console.error(`FAIL [raster] ${name} @${width}: ${error.message.split("\n")[0]}`);
  } finally {
    await context.close();
  }
}

const openAddressDialog = async (page) => {
  await page.getByRole("button", { name: "Arquivo" }).click();
  await page.getByRole("menuitem", { name: /Abrir COG por endereço/ }).click();
  return page.getByRole("dialog", { name: "Abrir COG por endereço" });
};
const submit = async (dialog, address) => {
  await dialog.getByRole("textbox").fill(address);
  await dialog.getByRole("button", { name: "Abrir", exact: true }).click();
  await dialog.getByRole("alert").waitFor();
  return dialog.getByRole("alert").innerText();
};

for (const width of [1280, 390]) {
  await check("File menu shows the three GeoTIFF/COG entries", width, async (page) => {
    await page.getByRole("button", { name: "Arquivo" }).click();
    for (const name of [/Recortar uma área/, /Abrir inteiro em blocos/, /Abrir COG por endereço/]) {
      const box = await page.getByRole("menuitem", { name }).boundingBox();
      assert.ok(box && box.width > 100 && box.height > 20, `${name} is visible`);
    }
  });

  await check("crop and tiled entries open a file chooser", width, async (page) => {
    for (const name of [/Recortar uma área/, /Abrir inteiro em blocos/]) {
      await page.getByRole("button", { name: "Arquivo" }).click();
      const chooser = page.waitForEvent("filechooser", { timeout: 5000 });
      await page.getByRole("menuitem", { name }).click();
      assert.ok(await chooser);
    }
  });

  await check("address dialog explains invalid, unreachable and HTTP errors", width, async (page, context) => {
    await context.route("https://cors.invalid/**", (route) => route.abort("failed"));
    await context.route("https://bucket.invalid/**", (route) => route.fulfill({ status: 404, headers: { "Access-Control-Allow-Origin": "*" }, body: "" }));
    const dialog = await openAddressDialog(page);
    assert.match(await submit(dialog, "ftp://example.com/a.tif"), /Endereço inválido/);
    assert.match(await submit(dialog, "https://cors.invalid/a.tif"), /CORS/);
    assert.match(await submit(dialog, "https://bucket.invalid/a.tif"), /HTTP 404/);
  });

  await check("address dialog closes with Escape and Cancel", width, async (page) => {
    let dialog = await openAddressDialog(page);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    dialog = await openAddressDialog(page);
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await dialog.waitFor({ state: "detached" });
  });
}

await browser.close();
if (failed) {
  console.error(`${failed} raster menu check(s) failed`);
  process.exit(1);
}
console.log("raster menu audit passed");
