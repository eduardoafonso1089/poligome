import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { launchAuditBrowser } from './audit-browser.mjs';
import { getAiCopy } from '../app/lib/ai-copy.ts';
import { getSamCopy } from '../app/lib/sam-copy.ts';
import { getInstallationCopy } from '../app/lib/installation-copy.ts';
import { INSTALL_PLATFORMS } from '../app/lib/installation-commands.ts';

const BASE = process.env.AUDIT_BASE_URL ?? 'http://127.0.0.1:4174';
const browser = await launchAuditBrowser();
const results = [];
const json = (route, body) => route.fulfill({status:200, contentType:'application/json', headers:{'Access-Control-Allow-Origin':'*'}, body:JSON.stringify(body)});

async function verifyCommands(page, root, width) {
  const blocks = root.locator('.command-copy:visible');
  assert.ok(await blocks.count() > 0);
  for (let index = 0; index < await blocks.count(); index++) {
    const block = blocks.nth(index);
    const code = block.locator('code').first();
    const button = block.getByRole('button');
    await button.scrollIntoViewIfNeeded();
    const bounds = await button.boundingBox();
    assert.ok(bounds.height >= 40, `copy button is too small: ${bounds.height}`);
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, 'copy button overflows viewport');
    const expected = await code.textContent();
    await button.click();
    assert.equal(await page.evaluate(() => window.__copiedCommand), expected, 'clipboard differs from command');
    assert.ok((await button.getAttribute('aria-label'))?.length);
  }
  assert.ok(await root.evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'guide scrolls horizontally');
}

async function audit(language, width) {
  const ai = getAiCopy(language), sam = getSamCopy(language), guide = getInstallationCopy(language);
  const context = await browser.newContext({viewport:{width, height:width < 600 ? 844 : 1000}});
  await context.addInitScript(lang => {
    localStorage.setItem('poligome-language', lang);
    Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{writeText:async value => {window.__copiedCommand=value;}}});
  }, language);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('http://127.0.0.1:7860/**', route => {
    if(route.request().method()==='OPTIONS') return json(route, {});
    const path = new URL(route.request().url()).pathname;
    if(path==='/health') return json(route,{service:'Poligome SAM local',api_version:2,status:'ready',model_id:'sam2.1-hiera-small',capabilities:['point','box'],host:'Windows',app_dir:'fixture'});
    if(path==='/models') return json(route,{models:[{model_id:'sam2.1-hiera-small',installed:true},{model_id:'sam2.1-hiera-tiny',installed:false}]});
    if(path==='/byom/models') return json(route,{models:[]});
    return json(route,{});
  });
  await context.route('http://127.0.0.1:7861/**', route => route.abort('connectionrefused'));
  try {
    await page.goto(`${BASE}/annotate/`, {waitUntil:'networkidle'});
    await page.locator('.ai-button').click();
    const dialog = page.getByRole('dialog', {name:ai.hubTitle,exact:true});
    await dialog.locator('.sam-model-list button').filter({hasText:/^SAM 3/}).click();
    assert.ok((await dialog.innerText()).includes(guide.samGatedTitle));
    assert.equal(await dialog.locator('a[href="https://huggingface.co/facebook/sam3"]').first().getAttribute('href'),'https://huggingface.co/facebook/sam3');
    await dialog.locator('.sam-model-list button').filter({hasText:/^SAM 2.1 Hiera Tiny/}).click();
    const samGuide=dialog.locator('.sam-install-panel.install-guide');
    assert.ok(await samGuide.locator('.sam-device-choice small').evaluate(node=>parseFloat(getComputedStyle(node).fontSize)>=13),'CPU instruction is too small');
    assert.ok(await samGuide.evaluate(node=>Boolean(node.querySelector('.sam-device-choice').compareDocumentPosition(node.querySelector('.sam-steps')) & Node.DOCUMENT_POSITION_FOLLOWING)),'CPU choice must come before command copying');
    for(const os of [sam.osUnix,sam.osWsl,guide.windows]){
      await dialog.getByRole('tab',{name:os,exact:true}).click();
      await verifyCommands(page,samGuide,width);
    }
    await dialog.getByRole('checkbox',{name:new RegExp(`^${sam.cpuTitle}`)}).check();
    assert.ok((await samGuide.locator('code').allTextContents()).some(code=>code.includes("$env:POLIGOME_DEVICE='cpu'")));
    await page.screenshot({path:`interaction-audit/installation-sam-${language}-${width}.png`,fullPage:true});
    await dialog.getByRole('tab',{name:new RegExp(`^${ai.tabAutomatic}`)}).click();
    await dialog.getByRole('button',{name:new RegExp(ai.autoAddModel)}).click();
    await dialog.getByRole('button',{name:guide.customPath,exact:true}).click();
    for(const platform of INSTALL_PLATFORMS) {
      await dialog.getByRole('button',{name:guide[platform],exact:true}).click();
      await verifyCommands(page, dialog.locator('.byom-setup-guide'), width);
    }
    await dialog.getByRole('button',{name:guide.examplesPath,exact:true}).click();
    assert.equal(await dialog.locator('a[download][href="/byom/Dockerfile"]').count(),0);
    await dialog.getByRole('button',{name:guide.existingPath,exact:true}).click();
    await dialog.getByRole('textbox',{name:sam.byomFieldId,exact:true}).fill('byom-user-model');
    await dialog.getByRole('textbox',{name:sam.byomFieldName,exact:true}).fill('User model');
    const fields = dialog.locator('.byom-import');
    assert.ok(await fields.evaluate(node=>node.scrollWidth<=node.clientWidth+1));
    await dialog.getByRole('button',{name:guide.customPath,exact:true}).click();
    await dialog.getByRole('button',{name:guide.existingPath,exact:true}).click();
    assert.equal(await dialog.getByRole('textbox',{name:sam.byomFieldId,exact:true}).inputValue(),'byom-user-model');
    await dialog.locator('.sam-model-list button').filter({hasText:ai.autoNativeOffline}).click();
    for(const platform of INSTALL_PLATFORMS) {
      await dialog.getByRole('button',{name:guide[platform],exact:true}).click();
      await verifyCommands(page, dialog.locator('.runtime-install-guide'), width);
      const install = await dialog.locator('.runtime-install-guide code').allTextContents();
      assert.equal(install.some(code=>code.includes('--index-url https://download.pytorch.org/whl/cpu')),platform!=='macos');
    }
    await page.evaluate(()=>{
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('clipboard denied');}}});
      document.execCommand=()=>false;
    });
    await dialog.locator('.runtime-install-guide .command-copy:visible').first().getByRole('button').click();
    await dialog.getByText(guide.copyFallback,{exact:true}).waitFor({state:'visible'});
    assert.deepEqual(errors,[]);
    results.push({language,width,ok:true});
    console.log(`PASS [installation UI] ${language} ${width}px`);
    await page.screenshot({path:`interaction-audit/installation-${language}-${width}.png`,fullPage:true});
  } catch(error) {
    results.push({language,width,ok:false,detail:String(error)});
    console.error(`FAIL [installation UI] ${language} ${width}px: ${error}`);
    await page.screenshot({path:`interaction-audit/installation-failure-${language}-${width}.png`,fullPage:true});
  } finally {await context.close();}
}

await fs.mkdir('interaction-audit',{recursive:true});
try {for(const language of ['pt','en','fr','es']) for(const width of [1440,360]) await audit(language,width);}
finally {await fs.writeFile('interaction-audit/installation-ui-audit.json',JSON.stringify({type:'mocked API installation UI',results},null,2));await browser.close();}
if(results.some(result=>!result.ok))process.exitCode=1;
