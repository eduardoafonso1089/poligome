import { launchAuditBrowser } from "./audit-browser.mjs";
import fs from "node:fs/promises";

const BASE = process.env.AUDIT_BASE_URL ?? "http://127.0.0.1:4174";
const report = [];
const failures = [];
await fs.mkdir("interaction-audit", { recursive: true });

function result(scope, name, ok, detail = "") {
  report.push({ scope, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${scope}] ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(`[${scope}] ${name}: ${detail}`);
}
async function check(scope, name, fn) {
  try { result(scope, name, true, (await fn()) ?? ""); }
  catch (error) { result(scope, name, false, error instanceof Error ? error.message : String(error)); }
}
async function button(page, pattern) {
  const target = page.getByRole("button", { name: pattern }).first();
  await target.waitFor({ state: "visible", timeout: 8000 });
  if (await target.isDisabled()) throw new Error(`disabled: ${await target.getAttribute("aria-label") ?? await target.innerText()}`);
  return target;
}
async function canvas(page) {
  const svg = page.locator(".stage svg").first();
  await svg.waitFor({ state: "visible" });
  const box = await svg.boundingBox();
  if (!box) throw new Error("canvas SVG without bounds");
  return { svg, box };
}
async function count(page) { return page.locator("[data-annotation-id]").count(); }
async function demo(page) {
  await page.goto(`${BASE}/annotate/?demo=1`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForFunction(() => document.querySelectorAll("[data-annotation-id]").length > 0, null, { timeout: 30000 });
  const guide = page.locator(".pre-refactor-demo-card");
  if (await guide.count()) {
    const boxTool = await button(page, /Caixa \(B\)|Box \(B\)/i);
    await boxTool.click();
    await page.waitForTimeout(100);
    if (await guide.isVisible().catch(() => false)) throw new Error("Demo guide still blocks editor after Box selection");
  }
}

async function desktop(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await check("desktop", "Demo loads and exposes 3 images", async () => {
    await demo(page);
    const status = await page.locator(".status > div span").innerText();
    if (!/1\s*\/\s*3/.test(status)) throw new Error(status);
    return status;
  });

  await check("desktop", "COCO export is visible in the File menu", async () => {
    await (await button(page, /^Arquivo$|^File$/i)).click();
    const coco = page.getByRole("menuitem", { name: /COCO ZIP/i });
    await coco.waitFor({ state: "visible", timeout: 8000 });
    await page.keyboard.press("Escape");
  });

  await check("desktop", "Box", async () => {
    await (await button(page, /Caixa \(B\)|Box \(B\)/i)).click();
    const before = await count(page); const { box } = await canvas(page);
    await page.mouse.move(box.x + box.width*.60, box.y + box.height*.54); await page.mouse.down();
    await page.mouse.move(box.x + box.width*.72, box.y + box.height*.68, { steps: 5 }); await page.mouse.up();
    const after = await count(page); if (after !== before + 1) throw new Error(`${before} -> ${after}`);
  });

  await check("desktop", "Polygon + Enter", async () => {
    await (await button(page, /Polígono por pontos \(P\)|Polygon/i)).click();
    const before = await count(page); const { box } = await canvas(page);
    for (const [x,y] of [[.53,.18],[.65,.18],[.66,.31],[.54,.32]]) await page.mouse.click(box.x+box.width*x, box.y+box.height*y);
    const finish = await button(page, /^Concluir$|^Finish$/i);
    if (await finish.isDisabled()) throw new Error("Finish disabled");
    await page.keyboard.press("Enter");
    const after = await count(page); if (after !== before + 1) throw new Error(`${before} -> ${after}`);
  });

  await check("desktop", "Polygon closes at first point", async () => {
    await (await button(page, /Polígono por pontos \(P\)|Polygon/i)).click();
    const before = await count(page); const { box } = await canvas(page);
    const first = [box.x+box.width*.35, box.y+box.height*.18];
    for (const p of [first,[box.x+box.width*.45,box.y+box.height*.18],[box.x+box.width*.46,box.y+box.height*.30],[box.x+box.width*.35,box.y+box.height*.30],first]) await page.mouse.click(p[0],p[1]);
    await page.waitForTimeout(80); const after = await count(page);
    if (after !== before + 1) throw new Error(`${before} -> ${after}`);
  });

  await check("desktop", "Line + Finish", async () => {
    await (await button(page, /Linha \/ polilinha \(L\)|Line/i)).click();
    const before = await count(page); const { box } = await canvas(page);
    for (const [x,y] of [[.16,.78],[.28,.72],[.40,.76]]) await page.mouse.click(box.x+box.width*x,box.y+box.height*y);
    await (await button(page, /^Concluir$|^Finish$/i)).click();
    const after = await count(page); if (after !== before + 1) throw new Error(`${before} -> ${after}`);
  });

  await check("desktop", "Remove last point + Cancel", async () => {
    await (await button(page, /Polígono por pontos \(P\)|Polygon/i)).click(); const { box } = await canvas(page);
    for (const [x,y] of [[.12,.14],[.20,.14],[.20,.24]]) await page.mouse.click(box.x+box.width*x,box.y+box.height*y);
    await (await button(page, /último ponto|last point/i)).click();
    const finish = page.getByRole("button", { name: /^Concluir$|^Finish$/i }).first();
    if (!await finish.isDisabled()) throw new Error("Finish should disable after removing third point");
    await (await button(page, /^Cancelar$|^Cancel$/i)).click();
  });

  await check("desktop", "Freehand", async () => {
    await (await button(page, /mão livre \(F\)|Freehand/i)).click(); const before = await count(page); const { box } = await canvas(page);
    await page.mouse.move(box.x+box.width*.72,box.y+box.height*.72); await page.mouse.down();
    for (const [x,y] of [[.80,.72],[.80,.82],[.70,.82],[.67,.75],[.72,.72]]) await page.mouse.move(box.x+box.width*x,box.y+box.height*y,{steps:2});
    await page.mouse.up(); const after = await count(page); if (after !== before+1) throw new Error(`${before} -> ${after}`);
  });

  await check("desktop", "Point", async () => {
    await (await button(page, /Ponto-chave \(K\)|Point/i)).click(); const before=await count(page); const {box}=await canvas(page);
    await page.mouse.click(box.x+box.width*.84,box.y+box.height*.58); const after=await count(page); if(after!==before+1) throw new Error(`${before} -> ${after}`);
  });

  await check("desktop", "Undo + Redo", async () => {
    const before=await count(page); await (await button(page,/^Desfazer$|^Undo$/i)).click(); const undone=await count(page);
    if(undone!==before-1) throw new Error(`undo ${before}->${undone}`); await (await button(page,/^Refazer$|^Redo$/i)).click();
    if(await count(page)!==before) throw new Error("redo did not restore");
  });

  await check("desktop", "Multiple selection is additive", async () => {
    await (await button(page,/Selecionar e mover \(V\)|Select/i)).click();
    await page.locator('[data-annotation-id="demo-a1"]').click({force:true});
    await page.locator('[data-annotation-id="demo-a2"]').click({force:true, modifiers:['ControlOrMeta']});
    await page.waitForTimeout(80);
    const active = await page.locator('.instance-row.active').count(); if(active!==2) throw new Error(`additive Ctrl/Cmd+click expected 2 selected, got ${active}`);
  });

  await check("desktop", "Snap", async () => {
    const snap=await button(page,/Encaixe|Snap/i); const a=await snap.getAttribute("aria-pressed"); await snap.click(); const b=await snap.getAttribute("aria-pressed"); if(a===b) throw new Error("state unchanged"); await snap.click();
  });

  await check("desktop", "Coordinate guide", async () => {
    const guide=await button(page,/Guias de coordenadas/i); await guide.click(); const {box}=await canvas(page); await page.mouse.move(box.x+box.width*.45,box.y+box.height*.45); await page.waitForTimeout(80);
    if(!await page.locator('.coordinate-guide').count()) throw new Error("guide missing"); await guide.click();
  });

  await check("desktop", "Pan + Zoom + Fit", async () => {
    const zoomIn=await button(page,/Aumentar zoom|Zoom in/i); for(let i=0;i<4;i++) await zoomIn.click(); await (await button(page,/Mover canvas \(H\)|Pan/i)).click();
    const scroll=page.locator('.stage > section').first(); await scroll.evaluate(el=>{el.scrollLeft=100;el.scrollTop=70}); const before=await scroll.evaluate(el=>[el.scrollLeft,el.scrollTop]);
    const {box}=await canvas(page); await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5); await page.mouse.down(); await page.mouse.move(box.x+box.width*.4,box.y+box.height*.4,{steps:4}); await page.mouse.up();
    const after=await scroll.evaluate(el=>[el.scrollLeft,el.scrollTop]); if(before[0]===after[0]&&before[1]===after[1]) throw new Error("pan unchanged");
    await (await button(page,/Centralizar e ajustar|Fit/i)).click(); if(!/92%/.test(await page.locator('.zoom span').innerText())) throw new Error("fit != 92%");
  });

  await check("desktop", "SAM modal", async () => {
    await (await button(page,/Segmentar com SAM \(S\)|SAM/i)).click(); const dialog=page.getByRole('dialog',{name:/Segment Anything|SAM/i}).first(); await dialog.waitFor({state:'visible'}); await dialog.getByRole('button',{name:/Fechar|Close/i}).first().click();
  });

  await check("desktop", "Advanced polygon tools enabled + Duplicate works", async () => {
    await (await button(page,/Selecionar e mover \(V\)|Select/i)).click(); await page.locator('[data-annotation-id="demo-a1"]').click({force:true});
    for(const pattern of [/Simplificar|Simplify/i,/Duplicar|Duplicate/i,/Adicionar buraco|hole/i,/Cortar polígono|Split/i,/Rotacionar e redimensionar|Transform/i,/Remodelar borda|Reshape/i]) {
      const b=await button(page,pattern); if(await b.isDisabled()) throw new Error(`disabled ${pattern}`);
    }
    const before=await count(page); await (await button(page,/Duplicar|Duplicate/i)).click(); if(await count(page)!==before+1) throw new Error("duplicate failed");
  });

  await page.screenshot({path:"interaction-audit/desktop.png"});
  result("desktop","No page errors",pageErrors.length===0,pageErrors.join(" | "));
  await context.close();
}

async function mobile(browser) {
  const context = await browser.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true });
  const page = await context.newPage(); const pageErrors=[]; page.on("pageerror",e=>pageErrors.push(e.message));

  await check("mobile","Demo loads and becomes editable", async()=>{ await demo(page); if(await page.locator('.pre-refactor-demo-card').isVisible().catch(()=>false)) throw new Error("guide blocks editor"); });

  await check("mobile","Polygon Finish button",async()=>{
    await (await button(page,/Polígono por pontos \(P\)|Polygon/i)).tap(); const before=await count(page); const {box}=await canvas(page);
    for(const [x,y] of [[.56,.52],[.70,.52],[.70,.67],[.56,.67]]) await page.touchscreen.tap(box.x+box.width*x,box.y+box.height*y);
    const finish=await button(page,/^Concluir$|^Finish$/i); if(await finish.isDisabled()) throw new Error("Finish disabled"); await finish.tap(); if(await count(page)!==before+1) throw new Error("polygon not committed");
  });

  await check("mobile","Polygon closes on first point",async()=>{
    await (await button(page,/Polígono por pontos \(P\)|Polygon/i)).tap(); const before=await count(page); const {box}=await canvas(page); const first=[box.x+box.width*.32,box.y+box.height*.48];
    for(const p of [first,[box.x+box.width*.44,box.y+box.height*.48],[box.x+box.width*.44,box.y+box.height*.60],[box.x+box.width*.32,box.y+box.height*.60],first]) await page.touchscreen.tap(p[0],p[1]);
    await page.waitForTimeout(80); if(await count(page)!==before+1) throw new Error("tap-first closure failed");
  });

  await check("mobile","Line Finish + remove last + cancel",async()=>{
    await (await button(page,/Linha \/ polilinha \(L\)|Line/i)).tap(); const {box}=await canvas(page);
    await page.touchscreen.tap(box.x+box.width*.18,box.y+box.height*.70); await page.touchscreen.tap(box.x+box.width*.30,box.y+box.height*.65);
    const finish=await button(page,/^Concluir$|^Finish$/i); if(await finish.isDisabled()) throw new Error("line Finish disabled"); await (await button(page,/último ponto|last point/i)).tap(); if(!await finish.isDisabled()) throw new Error("remove point failed");
    await page.touchscreen.tap(box.x+box.width*.30,box.y+box.height*.65); await finish.tap();
    await (await button(page,/Linha \/ polilinha \(L\)|Line/i)).tap(); await page.touchscreen.tap(box.x+box.width*.2,box.y+box.height*.75); await (await button(page,/^Cancelar$|^Cancel$/i)).tap();
  });

  await check("mobile","Multiple selection mode",async()=>{
    await (await button(page,/Selecionar e mover \(V\)|Select/i)).tap(); const multi=await button(page,/Selecionar várias|Select multiple/i); await multi.tap(); if(await multi.getAttribute('aria-pressed')!=="true") throw new Error("mode inactive");
    await page.locator('[data-annotation-id="demo-a1"]').tap({force:true}); await page.locator('[data-annotation-id="demo-a2"]').tap({force:true}); const del=page.locator('.drawing-actions').getByRole('button',{name:/Excluir|Delete/i}).last(); if(await del.isDisabled()) throw new Error("selection not retained");
  });

  await check("mobile","Pan control toggles",async()=>{ const pan=page.locator('.drawing-actions').getByRole('button',{name:/Mover canvas|Pan/i}).first(); await pan.waitFor({state:'visible'}); await pan.tap(); const toolbar=page.getByRole('button',{name:/Mover canvas \(H\)|Pan/i}).first(); if(await toolbar.getAttribute('aria-pressed')!=="true") throw new Error("Pan inactive"); await pan.tap(); });

  await check("mobile","SAM modal",async()=>{ await (await button(page,/Segmentar com SAM \(S\)|SAM/i)).tap(); const dialog=page.getByRole('dialog',{name:/Segment Anything|SAM/i}).first(); await dialog.waitFor({state:'visible'}); await dialog.getByRole('button',{name:/Fechar|Close/i}).first().tap(); });

  await page.screenshot({path:"interaction-audit/mobile.png"}); result("mobile","No page errors",pageErrors.length===0,pageErrors.join(" | ")); await context.close();
}

const browser = await launchAuditBrowser();
try { await desktop(browser); await mobile(browser); } finally { await browser.close(); }
await fs.writeFile("interaction-audit/report.json",JSON.stringify(report,null,2));
console.log(`\n${report.filter(x=>x.ok).length}/${report.length} checks passed`);
if(failures.length){ console.error(failures.map(x=>`- ${x}`).join("\n")); process.exit(1); }
