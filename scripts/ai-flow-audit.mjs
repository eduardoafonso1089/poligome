import assert from "node:assert/strict";

async function retry(check) {
  const deadline = Date.now() + 6000;
  let failure;
  do {
    try { return await check(); } catch (error) { failure = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw failure;
}
function expect(value) {
  return {
    toBe: (expected) => assert.equal(value, expected),
    toEqual: (expected) => assert.deepEqual(value, expected),
    toBeGreaterThan: (expected) => assert.ok(value > expected),
    toBeGreaterThanOrEqual: (expected) => assert.ok(value >= expected),
    toBeVisible: () => retry(async () => assert.equal(await value.isVisible(), true)),
    toBeHidden: () => retry(async () => assert.equal(await value.isVisible(), false)),
    toBeDisabled: () => retry(async () => assert.equal(await value.isDisabled(), true)),
    toBeEnabled: () => retry(async () => assert.equal(await value.isEnabled(), true)),
    toHaveValue: (expected) => retry(async () => assert.equal(await value.inputValue(), expected)),
    toHaveCount: (expected) => retry(async () => assert.equal(await value.count(), expected)),
    toContainText: (expected) => retry(async () => assert.ok((await value.innerText()).includes(expected))),
  };
}
expect.poll = (read) => ({ toBe: (expected) => retry(async () => assert.equal(await read(), expected)) });
import fs from "node:fs/promises";
import { launchAuditBrowser } from "./audit-browser.mjs";
import { openDemoDataset } from "./demo-audit-helpers.mjs";

const BASE = process.env.AUDIT_BASE_URL ?? "http://127.0.0.1:4174";
const browser = await launchAuditBrowser();
const results = [];
await fs.mkdir("interaction-audit", { recursive: true });
const manifest = { protocol:"1.0",id:"qa",name:"QA Runtime",version:"1",produces:["box"],accepts:[],stateful:false,tiling:"runtime",maxEdge:1024,params:[{key:"threshold",label:"Limiar QA",type:"number",min:0,max:1,step:.1,default:.5}] };
const container = {model_id:"byom-qa",name:"QA Contêiner",endpoint:"http://127.0.0.1:8080",ready:true,notes:"Synthetic QA fixture"};
const frame = (annotations, partial=false) => `data:${JSON.stringify({type:"result",annotations,partial})}\r\n\r\n`;
const annotation = {kind:"box",box:{x:100,y:100,width:80,height:70},label:"QA resultado"};
const json = (route, body, status=200) => route.fulfill({status,contentType:"application/json",headers:{"Access-Control-Allow-Origin":"*"},body:JSON.stringify(body)});

async function fixture(options={}) {
  const state={loaded:"sam2.1-hiera-small",containers:options.containers ?? [],runtime:options.runtime ?? true,mode:"normal",byomMode:"normal",calls:0,loads:0,samCalls:0,samReplies:0,registerFail:false,...options};
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  const page=await context.newPage();const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await context.route("http://127.0.0.1:7860/**", async route=>{
    const request=route.request(), path=new URL(request.url()).pathname;
    if(request.method()==="OPTIONS")return json(route,{});
    if(state.connectorOffline)return route.abort("connectionrefused");
    if(path==="/health")return json(route,{service:"Poligome SAM local",api_version:2,status:"ready",model_id:state.loaded,family:"sam2",device:"cpu",capabilities:state.capabilities??["point","box"]});
    if(path==="/predict") {
      state.samCalls++;state.lastSam=request.postDataJSON();
      if(state.samSlow)await new Promise(resolve=>setTimeout(resolve,700));
      state.samReplies++;
      try {
        if(state.samError)return await json(route,{detail:"Falha QA SAM"},503);
        return await json(route,{width:1200,height:780,polygons:[[100,100,200,100,200,200,100,200]]});
      } catch { /* A canceled browser request may have closed its route. */ }
      return;
    }
    if(path==="/models")return json(route,{models:[{model_id:"sam2.1-hiera-small",family:"sam2",installed:true},{model_id:"sam2.1-hiera-tiny",family:"sam2",installed:true}]});
    if(path==="/byom/models")return json(route,{models:state.containers});
    if(path==="/load") {state.loads++;if(state.loadFail)return json(route,{detail:"checkpoint QA indisponível"},400);state.loaded=request.postDataJSON().model_id;return json(route,{switching:true})}
    if(path==="/byom/register") {if(state.registerFail)return json(route,{detail:"Porta QA ocupada"},400);return json(route,{})}
    if(path==="/byom/annotate") {
      const input=request.postDataJSON();
      if(state.byomMode==="error")return json(route,{detail:"Falha QA no contêiner"},503);
      if(state.byomMode==="missing")return json(route,{});
      return json(route,{coco:{images:[{id:1,file_name:input.file_name,width:1200,height:780}],categories:[{id:1,name:"QA BYOM"}],annotations:state.byomMode==="empty"?[]:[{id:1,image_id:1,category_id:1,bbox:[100,100,80,70]}]}});
    }
    return json(route,{});
  });
  await context.route("http://127.0.0.1:7861/**",async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    if(request.method()==="OPTIONS")return json(route,{});
    if(!state.runtime)return route.abort("connectionrefused");
    if(path==="/health")return json(route,{service:"poligome-runtime",protocol:"1.0",status:"ready",images:0});
    if(path==="/describe")return json(route,state.badManifest?{}:manifest);
    if(path.startsWith("/images/"))return json(route,{id:decodeURIComponent(path.slice(8)),width:1200,height:780});
    if(path==="/infer") {
      state.calls++;state.lastInfer=request.postDataJSON();
      if(state.mode==="http")return json(route,{error:{code:"internal",message:"Falha HTTP QA"}},500);
      const partial=frame([annotation],true);
      const body=state.mode==="error"?partial+'data:{"type":"error","error":{"code":"internal","message":"Falha SSE QA"}}\r\n\r\n'
        :state.mode==="truncated"?partial:state.mode==="empty"?frame([]):partial+frame([annotation]);
      if(state.mode==="slow")await new Promise(resolve=>setTimeout(resolve,2500));
      try { return await route.fulfill({status:200,contentType:"text/event-stream",headers:{"Access-Control-Allow-Origin":"*"},body}); } catch { return; }
    }
    return json(route,{});
  });
  if(options.demo===false)await page.goto(`${BASE}/annotate/`,{waitUntil:"networkidle"});else await openDemoDataset(page,BASE);
  await expect(page.getByRole("button",{name:/Modelos de IA:/})).toBeVisible();
  return {context,page,state,errors};
}
async function check(name, options, run) {
  let f;
  try {f=await fixture(options);await run(f);expect(f.errors).toEqual([]);results.push({name,ok:true});console.log(`PASS [AI] ${name}`)}
  catch(error){results.push({name,ok:false,detail:String(error)});console.error(`FAIL [AI] ${name}: ${error}`);if(f)await f.page.screenshot({path:`interaction-audit/ai-failure-${results.length}.png`})}
  finally {await f?.context.close()}
}
const count=page=>page.locator(".stage [data-annotation-id]").count();
const hub=async page=>{await page.getByRole("button",{name:/Modelos de IA:/}).click();return page.getByRole("dialog",{name:"Modelos de IA",exact:true})};
const close=dialog=>dialog.getByRole("button",{name:"Fechar",exact:true}).first().click();
async function preannotate(page,{byom=false,all=false,region=false}={}) {
  await page.getByRole("button",{name:"Pré-anotar",exact:true}).click();
  const dialog=page.getByRole("dialog",{name:"Pré-anotar",exact:true});
  await dialog.getByRole("radio",{name:byom?/QA Contêiner/:/QA Runtime/}).check();
  if(all)await dialog.locator(".pa-scopes label").filter({hasText:/^Todas/}).click();
  if(region)await dialog.locator(".pa-scopes label").filter({hasText:/Região/}).click();
  await dialog.getByRole("button",{name:"Pré-anotar",exact:true}).click();
}
const done=page=>page.locator(".ai-run-card.done");
try {
  await check("empty project disables preannotation",{demo:false},async({page})=>{await expect(page.getByRole("button",{name:"Pré-anotar",exact:true})).toBeDisabled();await close(await hub(page))});
  await check("BYOM import fields fit mobile viewport without horizontal scrolling",{},async({page})=>{
    for(const width of [360,390]){
      await page.setViewportSize({width,height:844});const d=await hub(page);await d.getByRole("tab",{name:/Automático/}).click();await d.getByRole("button",{name:/Adicionar meu modelo/}).click();
      for(const field of ["Identificador","Nome"]){const bounds=await d.getByRole("textbox",{name:field,exact:true}).boundingBox();assert.ok(bounds&&bounds.x>=0&&bounds.x+bounds.width<=width);}
      const bounds=await d.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width);await close(d);
    }
  });
  await check("offline hub, tabs and no-model installation path",{runtime:false,connectorOffline:true},async({page})=>{
    const d=await hub(page);await d.getByRole("tab",{name:/Conexões/}).click();await expect(d.getByText("Desligado",{exact:true})).toHaveCount(2);await close(d);
    await page.getByRole("button",{name:"Pré-anotar",exact:true}).click();await page.getByRole("dialog").getByRole("button",{name:/Ver como instalar/}).click();await expect(page.getByRole("dialog",{name:"Modelos de IA"})).toBeVisible();
  });
  await check("remote and malformed endpoints have accessible errors",{},async({page})=>{
    const d=await hub(page);await d.getByRole("tab",{name:/Conexões/}).click();const fields=d.getByRole("textbox",{name:/^Endereço/});
    await fields.nth(0).fill("https://example.com");await fields.nth(1).fill("abc");await expect(d.getByRole("alert")).toHaveCount(2);await expect(d.getByRole("button",{name:"Verificar",exact:true}).nth(0)).toBeDisabled();await expect(d.getByRole("button",{name:"Verificar",exact:true}).nth(1)).toBeDisabled();
    await fields.nth(1).press("Escape");await expect(fields.nth(1)).toHaveValue("http://127.0.0.1:7861");
  });
  await check("all ten SAM cards and three operating systems are accessible",{},async({page})=>{
    const d=await hub(page);const cards=d.locator(".sam-model-list button");
    // Use the catalog's semantic buttons; the list also contains the guide entry.
    const models=d.getByRole("button").filter({hasText:/^SAM 2\.1 Hiera|^MedSAM2|^SAM 3 —/});
    expect(await models.count()).toBe(10);
    for(let i=0;i<10;i++){await models.nth(i).click();await expect(d.locator(".sam-model-hero h3")).toBeVisible()}
    await d.getByRole("button",{name:/SAM 2.1 Hiera Tiny/}).click();
    for(const os of ["Linux ou macOS","Windows (WSL2)","Windows"]){await d.getByRole("tab",{name:os,exact:true}).click();await expect(d.getByRole("link",{name:/Baixar poligome-sam/}).first()).toBeVisible()}
    await d.getByRole("tab",{name:"Linux ou macOS",exact:true}).click();await d.getByRole("checkbox",{name:/Usar só CPU/}).check();await expect(d.locator("code").filter({hasText:/POLIGOME_DEVICE=cpu/}).first()).toBeVisible();void cards;
  });
  await check("already loaded SAM closes on Verify without reload",{},async({page,state})=>{const d=await hub(page);await d.getByRole("button",{name:/^(Usar este modelo|Carregar este modelo|Verificar e usar)$/}).click();await expect(d).toBeHidden();expect(state.loads).toBe(0)});
  await check("SAM model switch succeeds",{},async({page,state})=>{const d=await hub(page);await d.getByRole("button",{name:/SAM 2.1 Hiera Tiny/}).click();await d.getByRole("button",{name:/^(Usar este modelo|Carregar este modelo|Verificar e usar)$/}).click();await expect(d).toBeHidden();expect(state.loaded).toBe("sam2.1-hiera-tiny")});
  await check("failed switch keeps previous SAM connected",{loadFail:true},async({page})=>{const d=await hub(page);await d.getByRole("button",{name:/SAM 2.1 Hiera Tiny/}).click();await d.getByRole("button",{name:/^(Usar este modelo|Carregar este modelo|Verificar e usar)$/}).click();await expect(d.getByText(/checkpoint QA indisponível/).first()).toBeVisible();await expect(page.getByRole("button",{name:/Modelos de IA:.*sam2.1-hiera-small/})).toBeVisible()});
  const activateSam=async page=>{await page.getByRole("button",{name:"Segmentar com SAM (S)",exact:true}).click();await expect(page.locator(".sam-controls").getByRole("button",{name:"Caixa",exact:true})).toBeVisible()};
  const samPoint=async(page,dx=0)=>{const b=await page.locator(".stage svg").first().boundingBox();assert.ok(b);await page.mouse.click(b.x+b.width*.45+dx,b.y+b.height*.45)};
  const saveSam=page=>page.locator(".sam-controls").getByRole("button",{name:/Salvar e editar/});
  await check("SAM equivalent base URL preserves ready connection and routes inference to predict",{},async({page,state})=>{
    const d=await hub(page);await d.getByRole("tab",{name:/Conexões/}).click();
    const card=d.locator(".ai-conn-card").first();await expect(card.getByText("Conectado",{exact:true})).toBeVisible();
    const address=card.getByRole("textbox",{name:/^Endereço/});await address.fill("http://127.0.0.1:7860");await address.press("Enter");
    await expect(address).toHaveValue("http://127.0.0.1:7860/predict");await expect(card.getByText("Conectado",{exact:true})).toBeVisible();
    await close(d);await activateSam(page);await samPoint(page);await expect(saveSam(page)).toBeEnabled();expect(state.samCalls).toBe(1);
  });
  await check("SAM point proposal saves explicitly and Undo preserves manual work",{},async({page,state})=>{
    const before=await count(page);await activateSam(page);await samPoint(page);await expect(saveSam(page)).toBeEnabled();expect(state.lastSam.point_labels).toEqual([1]);expect(await count(page)).toBe(before);
    await saveSam(page).click();await expect.poll(()=>count(page)).toBe(before+1);await page.getByRole("button",{name:"Desfazer",exact:true}).click();await expect.poll(()=>count(page)).toBe(before);
  });
  await check("SAM negative point refines accumulated prompts",{},async({page,state})=>{await activateSam(page);await samPoint(page);await expect(saveSam(page)).toBeEnabled();await page.locator(".sam-controls").getByRole("button",{name:"Excluir",exact:true}).click();await samPoint(page,35);await expect(saveSam(page)).toBeEnabled();expect(state.lastSam.point_labels).toEqual([1,0])});
  await check("SAM box prompt sends a bounded region",{},async({page,state})=>{await activateSam(page);await page.locator(".sam-controls").getByRole("button",{name:"Caixa",exact:true}).click();const b=await page.locator(".stage svg").first().boundingBox();assert.ok(b);await page.mouse.move(b.x+b.width*.35,b.y+b.height*.35);await page.mouse.down();await page.mouse.move(b.x+b.width*.55,b.y+b.height*.55,{steps:5});await page.mouse.up();await expect(saveSam(page)).toBeEnabled();expect(state.lastSam.box.length).toBe(4)});
  await check("SAM text capability sends query and threshold",{capabilities:["point","box","text"]},async({page,state})=>{await activateSam(page);await page.locator(".sam-controls").getByRole("button",{name:"Texto",exact:true}).click();await page.getByRole("textbox",{name:"Conceito para segmentar"}).fill("todos os telhados");await page.locator(".sam-controls").getByRole("button",{name:"Segmentar",exact:true}).click();await expect(saveSam(page)).toBeEnabled();expect(state.lastSam.text).toBe("todos os telhados");expect(state.lastSam.multimask_output).toBe(true);expect(state.lastSam.threshold).toBe(.5)});
  await check("SAM restart discards late predictions",{samSlow:true},async({page,state})=>{const before=await count(page);await activateSam(page);await samPoint(page);await expect.poll(()=>state.samCalls).toBe(1);await page.locator(".sam-controls").getByRole("button",{name:"Reiniciar",exact:true}).click();await expect.poll(()=>state.samReplies).toBe(1);await page.waitForTimeout(100);await expect(saveSam(page)).toBeDisabled();expect(await count(page)).toBe(before)});
  for(const slow of [false,true])await check(`SAM image switch clears ${slow?"pending":"ready"} proposals`,{samSlow:slow},async({page,state})=>{await activateSam(page);await samPoint(page);if(slow)await expect.poll(()=>state.samCalls).toBe(1);else await expect(saveSam(page)).toBeEnabled();await page.getByRole("button",{name:"Próxima imagem",exact:true}).click();if(slow){await expect.poll(()=>state.samReplies).toBe(1);await page.waitForTimeout(100)}await expect(saveSam(page)).toBeDisabled();await expect(page.locator(".sam-mask-preview")).toHaveCount(0)});
  await check("SAM failure explains the error without saving annotations",{samError:true},async({page})=>{const before=await count(page);await activateSam(page);await samPoint(page);await expect(page.locator("main")).toContainText("Falha QA SAM");await expect(saveSam(page)).toBeDisabled();expect(await count(page)).toBe(before)});
  await check("BYOM invalid port explains the port",{},async({page})=>{const d=await hub(page);await d.getByRole("tab",{name:/Conexões/}).click();await d.getByRole("button",{name:"Adicionar",exact:true}).click();await d.getByRole("textbox",{name:"Identificador"}).fill("byom-qa");await d.getByRole("spinbutton",{name:"Porta"}).fill("0");await expect(d.getByRole("alert")).toContainText("1 e 65535");await expect(d.getByRole("button",{name:"Importar",exact:true})).toBeDisabled()});
  await check("BYOM registration failure preserves fields and SAM connection",{registerFail:true},async({page})=>{const d=await hub(page);await d.getByRole("tab",{name:/Conexões/}).click();await d.getByRole("button",{name:"Adicionar",exact:true}).click();await d.getByRole("textbox",{name:"Identificador"}).fill("byom-qa");await d.getByRole("textbox",{name:"Nome",exact:true}).fill("QA nome");await d.getByRole("button",{name:"Importar",exact:true}).click();await expect(d.getByRole("alert")).toContainText("Porta QA ocupada");await expect(d.getByRole("textbox",{name:"Nome",exact:true})).toHaveValue("QA nome");await expect(page.getByRole("button",{name:/Modelos de IA:.*sam2.1-hiera-small/})).toBeVisible()});
  await check("invalid runtime manifest is not ready",{badManifest:true},async({page})=>{await page.getByRole("button",{name:"Pré-anotar",exact:true}).click();await expect(page.getByRole("dialog").getByText(/Nenhum modelo/)).toBeVisible()});
  await check("native result settles drafts, Undo removes only generated work",{},async({page})=>{const before=await count(page);await preannotate(page);await expect(done(page)).toBeVisible();expect(await count(page)).toBe(before+1);await done(page).getByRole("button",{name:/Desfazer/}).click();await expect.poll(()=>count(page)).toBe(before)});
  await check("native empty result preserves manual annotations",{mode:"empty"},async({page})=>{const before=await count(page);await preannotate(page);await expect(done(page)).toBeVisible();expect(await count(page)).toBe(before)});
  await check("native rerun and empty result replace predictions while Undo restores the previous result",{},async({page,state})=>{
    const before=await count(page);await preannotate(page);await expect(done(page)).toBeVisible();expect(await count(page)).toBe(before+1);
    await done(page).getByRole("button",{name:/Manter/}).click();await preannotate(page);await expect(done(page)).toBeVisible();expect(await count(page)).toBe(before+1);
    await done(page).getByRole("button",{name:/Manter/}).click();state.mode="empty";await preannotate(page);await expect(done(page)).toBeVisible();expect(await count(page)).toBe(before);
    await done(page).getByRole("button",{name:/Desfazer/}).click();await expect.poll(()=>count(page)).toBe(before+1);
  });
  for(const mode of ["http","error","truncated"])await check(`native ${mode} cleans partial drafts`,{mode},async({page})=>{const before=await count(page);await preannotate(page);await expect(page.getByRole("button",{name:"Pré-anotar",exact:true})).toBeEnabled();await expect(page.locator("main")).toContainText(mode==="truncated"?"resultado final":mode==="http"?"Falha HTTP QA":"Falha SSE QA");await expect.poll(()=>count(page)).toBe(before);await expect(page.getByRole("button",{name:"Pré-anotar",exact:true})).toBeEnabled()});
  await check("native region requires a selected box and preserves it",{},async({page,state})=>{await page.getByRole("button",{name:"Veículo #4",exact:true}).click();const before=await count(page);await preannotate(page,{region:true});await expect(done(page)).toBeVisible();expect(state.lastInfer.region?.width).toBeGreaterThan(0);expect(await count(page)).toBeGreaterThanOrEqual(before)});
  await check("runtime recheck does not reset user parameters",{},async({page,state})=>{await page.getByRole("button",{name:"Pré-anotar",exact:true}).click();const d=page.getByRole("dialog");await d.getByRole("slider",{name:"Limiar QA"}).press("End");await page.evaluate(()=>window.dispatchEvent(new Event("focus")));await expect(d.getByRole("slider",{name:"Limiar QA"})).toHaveValue("1");await d.getByRole("button",{name:"Pré-anotar",exact:true}).click();await expect(done(page)).toBeVisible();expect(state.lastInfer.params.threshold).toBe(1)});
  await check("native batch covers all three images",{},async({page,state})=>{await preannotate(page,{all:true});await expect(done(page)).toBeVisible();expect(state.calls).toBe(3);await expect(done(page)).toContainText("3 imagens")});
  await check("native cancel returns controls without adding late results",{mode:"slow"},async({page})=>{const before=await count(page);await preannotate(page);await page.locator(".ai-run-card:not(.done)").getByRole("button",{name:/Cancelar/}).click();await expect(done(page)).toBeVisible();expect(await count(page)).toBe(before);await expect(page.getByRole("button",{name:"Pré-anotar",exact:true})).toBeEnabled()});
  await check("BYOM cannot select region; rerun empty replaces old predictions and Undo restores them",{containers:[container]},async({page,state})=>{
    const before=await count(page);await page.getByRole("button",{name:"Pré-anotar",exact:true}).click();const d=page.getByRole("dialog");await d.getByRole("radio",{name:/QA Contêiner/}).check();await expect(d.getByRole("radio",{name:/Região/})).toBeDisabled();await d.getByRole("button",{name:"Pré-anotar",exact:true}).click();await expect(done(page)).toBeVisible();expect(await count(page)).toBe(before+1);
    await done(page).getByRole("button",{name:/Manter/}).click();state.byomMode="empty";await preannotate(page,{byom:true});await expect(done(page)).toBeVisible();expect(await count(page)).toBe(before);await done(page).getByRole("button",{name:/Desfazer/}).click();await expect.poll(()=>count(page)).toBe(before+1);
  });
  for(const mode of ["error","missing"])await check(`BYOM ${mode} does not modify manual annotations`,{containers:[container],byomMode:mode},async({page})=>{const before=await count(page);await preannotate(page,{byom:true});await expect(page.getByRole("button",{name:"Pré-anotar",exact:true})).toBeEnabled();expect(await count(page)).toBe(before)});
  await check("stopped container is disabled",{runtime:false,containers:[{...container,ready:false}]},async({page})=>{await page.getByRole("button",{name:"Pré-anotar",exact:true}).click();const d=page.getByRole("dialog");await expect(d.getByRole("radio",{name:/QA Contêiner/})).toBeDisabled();await expect(d.getByRole("button",{name:"Pré-anotar",exact:true})).toBeDisabled()});
} finally {await fs.writeFile("interaction-audit/ai-flow-audit.json",JSON.stringify({type:"mocked API UI integration",results},null,2));await browser.close()}
if(results.some(result=>!result.ok))process.exitCode=1;
