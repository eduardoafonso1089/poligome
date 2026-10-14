import test from 'node:test';
import assert from 'node:assert/strict';
import { getInstallationCopy } from '../app/lib/installation-copy.ts';
import { getSamCopy } from '../app/lib/sam-copy.ts';
import { getAiCopy } from '../app/lib/ai-copy.ts';
import { INSTALL_PLATFORMS, byomSetupCommands, runtimeSetupCommands, preferredInstallPlatform } from '../app/lib/installation-commands.ts';
import { ByomPanel, ByomSetupGuide } from '../app/components/ByomInstallPanel.tsx';
import { RuntimeInstallPanel } from '../app/components/AiHubPanels.tsx';
import SamSetupModal from '../app/components/SamSetupModal.tsx';
import { fill } from '../app/lib/i18n.ts';
import { render, text, buttons } from './helpers/render.mjs';

const noop = () => {};
const codes = markup => [...markup.matchAll(/<code\b[^>]*>([\s\S]*?)<\/code>/g)].map(match => match[1]);
const tokens = value => [...value.matchAll(/\{([a-z]+)\}/g)].map(match => match[1]).sort();

test('installation translations cover every instruction and keep placeholders in all four languages', () => {
  const source = getInstallationCopy('pt');
  for (const language of ['pt', 'en', 'fr', 'es']) {
    const copy = getInstallationCopy(language);
    assert.deepEqual(Object.keys(copy).sort(), Object.keys(source).sort());
    for (const [key, value] of Object.entries(copy)) {
      assert.ok(value.trim(), `${language}.${key} is empty`);
      assert.deepEqual(tokens(value), tokens(source[key]), `${language}.${key} loses placeholders`);
    }
  }
});

test('BYOM platform follows the connector host rather than the browser operating system', () => {
  for (const [host, platform] of [['Windows', 'windows'], ['WSL2', 'wsl'], ['Linux', 'linux'], ['macOS', 'macos']]) assert.equal(preferredInstallPlatform(host), platform);
});

test('installation instructions name the same preannotation action as the interface in every language', () => {
  for (const language of ['pt', 'en', 'fr', 'es']) {
    const copy = getInstallationCopy(language);
    const action = getAiCopy(language).preAnnotate;
    assert.ok(copy.byomBack.includes(action), `${language}: BYOM uses a different action name`);
    assert.ok(copy.runtimeBack.includes(action), `${language}: Runtime uses a different action name`);
  }
});

test('runtime command blocks use the right Python environment and PyTorch source for each platform', () => {
  for (const platform of INSTALL_PLATFORMS) {
    const commands = runtimeSetupCommands(platform);
    assert.match(commands.run, /--adapter fasterrcnn --device cpu$/);
    assert.match(commands.install, /install -e "\.\[server\]" -e adapters\/fasterrcnn/);
    if (platform === 'windows') {
      assert.match(commands.install, /py -3\.12 -m venv/);
      assert.match(commands.install, /\.venv\\Scripts\\python\.exe -m pip/);
      assert.ok(!commands.install.includes('.venv/bin/'));
    } else assert.match(commands.install, /python3\.12 -m venv/);
    assert.equal(commands.install.includes('--index-url https://download.pytorch.org/whl/cpu'), platform !== 'macos');
  }
});

test('custom BYOM registration uses a different port from both shipped examples',()=>{
  for(const platform of INSTALL_PLATFORMS)assert.match(byomSetupCommands(platform).register,platform==='windows'?/-Port 8082\b/:/--port 8082\b/);
});

for (const language of ['pt', 'en', 'fr', 'es']) for (const platform of INSTALL_PLATFORMS) {
  test(`runtime installation renders the selected ${platform} commands in ${language}`, () => {
    const guide = getInstallationCopy(language);
    const markup = render(RuntimeInstallPanel, { copy: getAiCopy(language), language, platform, onPlatformChange: noop, onRecheck: noop });
    const visible = text(markup);
    assert.ok(visible.includes(guide.runtimeBefore));
    assert.ok(visible.includes(guide.runtimeRunBody));
    assert.ok(visible.includes(guide.runtimeBack));
    assert.match(markup, /<ol\b/);
    assert.ok(buttons(markup).some(button => button.includes(guide.checkConnection)) || markup.includes(guide.checkConnection));
    assert.ok(codes(markup).some(command => command.includes(platform === 'windows' ? '.venv\\Scripts\\python.exe' : '.venv/bin/python')));
    assert.equal(codes(markup).some(command => command.includes('--index-url https://download.pytorch.org/whl/cpu')), platform !== 'macos');
  });

  for (const custom of [false, true]) test(`BYOM ${custom ? 'custom' : 'examples'} guide gives complete ${platform} steps in ${language}`, () => {
    const copy = getInstallationCopy(language);
    const markup = render(ByomSetupGuide, { language, platform, custom, onCheck: noop });
    assert.ok(text(markup).includes(copy.byomBack));
    assert.ok(text(markup).includes(copy.byomCheckBody));
    assert.match(markup, /<ol\b/);
    const command = byomSetupCommands(platform);
    assert.ok(markup.includes(`href="/${command.file}"`));
    if (custom) {
      assert.ok(text(markup).includes(copy.byomFolderBody));
      assert.ok(markup.includes('href="/byom/Dockerfile"'));
      assert.ok(markup.includes('href="/byom/serve.py"'));
    } else {
      assert.ok(!markup.includes('href="/byom/Dockerfile"'));
      assert.ok(codes(markup).some(value => value.includes(`${command.cli} examples`)));
    }
    assert.ok(buttons(markup).filter(button => button.includes(getSamCopy(language).copyCommand)).length >= 4);
    if (platform === 'wsl') for (const block of codes(markup)) assert.ok(!(block.includes('$env:USERPROFILE') && block.includes('bash ')), 'PowerShell and bash must be copied separately');
  });
}

test('new BYOM users start with examples and an actionable connector prerequisite', () => {
  for (const language of ['pt', 'en', 'fr', 'es']) {
    const copy = getInstallationCopy(language);
    const markup = render(ByomPanel, { language, models: [], connected: false, host: null, onRegister: async () => ({ok: true}), onInstallConnector: noop, onCheck: noop });
    assert.ok(text(markup).includes(copy.byomConnectorOffline));
    assert.ok(text(markup).includes(copy.connectorInstall));
    assert.ok(text(markup).includes(copy.byomExamplesBody));
    assert.ok(!markup.includes('placeholder="byom-my-model"'), 'import form must not compete with the first installation steps');
  }
});

function samProps(language, overrides = {}) {
  return { language, tab:'assisted', onTabChange:noop, selectedModelId:'sam2.1-hiera-tiny', loadedModelId:'sam2.1-hiera-small', connectionState:'ready', samActive:true,
    runtimeLabel:'sam2.1-hiera-small',loadError:null,availability:[{model_id:'sam2.1-hiera-tiny',installed:false}],connectorHost:null,endpoint:'http://localhost:7860/predict',byomModels:[],byomBusy:false,
    runtime:{state:'offline',endpoint:'http://localhost:7861',manifest:null,setEndpoint:noop,refresh:noop},onSelectModel:noop,onPreannotate:noop,onRegisterByomModel:async()=>({ok:true}),onRemoveByomModel:noop,onUnselectAll:noop,onEndpointChange:noop,onRecheckConnector:noop,onConnect:noop,onClose:noop,...overrides };
}

for (const language of ['pt','en','fr','es']) {
  test(`SAM setup explains prerequisites and the actual activation action in ${language}`,()=>{
    const copy=getInstallationCopy(language), sc=getSamCopy(language);
    const markup=render(SamSetupModal,samProps(language));
    assert.ok(text(markup).includes(fill(copy.samBeforeUnix,{version:'3.10+'})));
    assert.ok(text(markup).includes(fill(copy.samBack,{action:sc.btnLoad})));
    assert.ok(markup.includes('href="https://www.python.org/downloads/release/python-31210/"'));
  });
  test(`SAM 3 setup shows the approval requirement before the download in ${language}`,()=>{
    const copy=getInstallationCopy(language);
    const markup=render(SamSetupModal,samProps(language,{selectedModelId:'sam3-concepts',availability:[]}));
    assert.ok(text(markup).includes(copy.samGatedTitle));
    assert.ok(markup.includes('href="https://huggingface.co/facebook/sam3"'));
    assert.ok(markup.indexOf(copy.samGatedTitle)<markup.indexOf('href="/poligome-sam-macos-linux.sh"'));
  });
  test(`installed SAM offers activation without repeating installation by default in ${language}`,()=>{
    const copy=getInstallationCopy(language),sc=getSamCopy(language);
    const markup=render(SamSetupModal,samProps(language,{availability:[{model_id:'sam2.1-hiera-tiny',installed:true}]}));
    assert.ok(text(markup).includes(fill(copy.samInstalled,{action:sc.btnLoad})));
    assert.match(markup,/<details class="sam-install-guide-details install-help">/);
    assert.equal((markup.match(/class="sam-install-panel install-guide"/g)||[]).length,1);
  });
}
