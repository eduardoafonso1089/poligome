"use client";

import { useState } from "react";
import { Download, Gauge, Plus, RefreshCw } from "lucide-react";
import { fill, type Language } from "../lib/i18n";
import { getSamCopy } from "../lib/sam-copy";
import { getInstallationCopy } from "../lib/installation-copy";
import { byomSetupCommands, preferredInstallPlatform, type InstallPlatform } from "../lib/installation-commands";
import { BYOM_MODEL_ID_PATTERN, type ByomModel } from "../lib/sam-models";
import { CommandCode, InstallationPlatformPicker, terminalInstructions } from "./InstallationGuide";

type Outcome = { ok: true } | { ok: false; detail: string };
type Path = "examples" | "custom" | "existing";

export function ByomSetupGuide({ language, platform, custom, onCheck }: { language: Language; platform: InstallPlatform; custom: boolean; onCheck: () => void }) {
  const copy = getInstallationCopy(language);
  const sc = getSamCopy(language);
  const commands = byomSetupCommands(platform);
  const title = (text: string) => text.replace(/^\d+\.\s*/, "");
  const steps = custom ? [
    { title: copy.byomFolder, body: copy.byomFolderBody, command: commands.prepare },
    { title: title(sc.byomStep2Title), body: "", command: commands.build },
    { title: title(sc.byomStep3Title), body: sc.byomStep3Body, command: commands.register },
    { title: title(sc.byomStep4Title), body: sc.byomStep4Body, command: commands.start },
  ] : [
    { title: copy.byomExamplesRun, body: copy.byomExamplesBody, command: commands.examples },
  ];
  return <section className="byom-setup-guide install-guide">
    <ol className="sam-steps">
      <li><b>{custom ? sc.byomFiles : copy.byomDownload}</b><p>{custom ? copy.byomFilesBody : copy.byomDownloadBody}</p>
        <div className="install-downloads">
          <a className="sam-step-download" href={`/${commands.file}`} download><Download size={15} />{fill(sc.download, { file: commands.file })}</a>
          {custom && <>
            <a className="sam-step-download" href="/byom/Dockerfile" download><Download size={15} />{fill(sc.download, { file: "Dockerfile" })}</a>
            <a className="sam-step-download" href="/byom/serve.py" download><Download size={15} />{fill(sc.download, { file: "serve.py" })}</a>
          </>}
        </div>
      </li>
      <li><b>{copy.terminalTitle}</b><p>{terminalInstructions(copy, platform)}</p><CommandCode text={commands.folder} language={language} title={copy.terminalTitle} />
        {platform === "wsl" && <a className="ai-link" href="https://learn.microsoft.com/windows/wsl/install" target="_blank" rel="noreferrer">{copy.wslHelp}</a>}
      </li>
      {steps.map((step) => <li key={step.title}><b>{step.title}</b>{step.body && <p>{step.body}</p>}<CommandCode text={step.command} language={language} title={step.title} /></li>)}
      <li><b>{sc.byomCheckTitle}</b><p>{copy.byomCheckBody}</p><CommandCode text={commands.list} language={language} title={sc.byomCheckTitle} /></li>
      <li><b>{copy.backTitle}</b><p>{copy.byomBack}</p><button type="button" className="install-check" onClick={onCheck}><RefreshCw size={15} />{copy.checkConnection}</button></li>
    </ol>
    <details className="install-help"><summary>{copy.restart}</summary><p>{copy.byomRestart}</p>
      {platform === "wsl" && <><p>{copy.terminalWsl}</p><CommandCode text={commands.folder} language={language} title={copy.terminalTitle} /></>}
      <CommandCode text={`${platform === "windows" ? String.raw`cd "$env:USERPROFILE\Downloads"` : platform === "wsl" ? "" : "cd ~/Downloads"}${custom ? platform === "windows" ? "\ncd .\\poligome-byom" : "\ncd poligome-byom" : ""}\n${custom ? commands.start : commands.examples}`.trim()} language={language} title={copy.restart} />
    </details>
    <details className="install-help"><summary>{copy.troubleshooting}</summary><p>{copy.byomTrouble}</p>
      <CommandCode text="docker info" language={language} title={sc.byomDockerTitle} />
      <CommandCode text={custom ? commands.logs : commands.exampleLogs} language={language} title={sc.byomCheckTitle} />
    </details>
    {custom && <details className="install-help"><summary>{copy.technicalContract}</summary>
      <p>{sc.byomSagemaker.replaceAll("`", "")}</p>
      <p>{sc.byomInput} <code>{sc.byomInputValue.replaceAll("`", "")}</code></p>
      <p>{sc.byomOutput} {sc.byomOutputValue.replaceAll("`", "")}</p>
      <p>{sc.byomErrors} <code>{sc.byomErrorsValue.replaceAll("`", "")}</code></p>
      <p>{sc.byomMetadataHint}</p>
    </details>}
  </section>;
}

export function ByomPanel({ language, models, onRegister, host, connected, onInstallConnector, onCheck }: {
  language: Language; models: readonly ByomModel[];
  onRegister: (entry: { modelId: string; name: string; port: number; notes?: string }) => Promise<Outcome>;
  host: string | null; connected: boolean; onInstallConnector: () => void; onCheck: () => void;
}) {
  const sc = getSamCopy(language);
  const copy = getInstallationCopy(language);
  const [path, setPath] = useState<Path>("examples");
  const [chosenPlatform, setPlatform] = useState<InstallPlatform | null>(null);
  const platform = chosenPlatform ?? preferredInstallPlatform(host);
  const [draftId, setDraftId] = useState("byom-");
  const [draftName, setDraftName] = useState("");
  const [draftPort, setDraftPort] = useState("8080");
  const [importError, setImportError] = useState("");
  const [importing, setImporting] = useState(false);
  const portNumber = Number(draftPort);
  const validId = BYOM_MODEL_ID_PATTERN.test(draftId.trim().toLowerCase());
  const validPort = Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65535;
  return <div className="byom-panel install-guide">
    <section className="sam-model-hero"><h3>{sc.byomTitle}</h3><p>{sc.byomIntro}</p></section>
    <div className="byom-path-picker" role="group" aria-label={copy.byomChoose}>
      {([["examples", copy.examplesPath], ["custom", copy.customPath], ["existing", copy.existingPath]] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={path === value} className={path === value ? "active" : ""} onClick={() => setPath(value)}>{label}</button>)}
    </div>
    {path !== "existing" && <InstallationPlatformPicker copy={copy} platform={platform} onChange={setPlatform} />}
    <section className="install-prerequisites"><h4>{copy.before}</h4>
      <p>{copy.byomDocker}</p><a className="ai-link" href="https://docs.docker.com/get-started/get-docker/" target="_blank" rel="noreferrer">{copy.dockerLink}</a>
      <p>{connected ? copy.byomConnectorReady : copy.byomConnectorOffline}</p>
      {!connected && <button type="button" className="install-check" onClick={onInstallConnector}>{copy.connectorInstall}</button>}
      {path !== "existing" && platform !== "windows" && <p>{copy.byomPython}</p>}
    </section>
    {path === "existing" ? <section className="byom-registered">
      <h4>{sc.byomImportTitle}</h4><p className="byom-import-hint">{copy.byomExisting}</p>
      <div className="byom-import">
        <label>{sc.byomFieldId}<input value={draftId} onChange={(event) => setDraftId(event.target.value)} placeholder="byom-my-model" spellCheck={false} /></label>
        <label>{sc.byomFieldName}<input value={draftName} onChange={(event) => setDraftName(event.target.value)} placeholder={sc.byomNamePlaceholder} /></label>
        <label>{sc.byomFieldPort}<input type="number" min={1} max={65535} value={draftPort} onChange={(event) => setDraftPort(event.target.value)} /></label>
        <button type="button" className="byom-add" disabled={!connected || !validId || !validPort || importing} onClick={async () => {
          setImportError(""); setImporting(true);
          try {
            const outcome = await onRegister({ modelId: draftId.trim().toLowerCase(), name: draftName.trim(), port: portNumber });
            if (outcome.ok) { setDraftId("byom-"); setDraftName(""); }
            else setImportError(outcome.detail);
          } finally { setImporting(false); }
        }}>{importing ? <Gauge className="spin" size={14} /> : <Plus size={14} />}{importing ? sc.byomImporting : sc.byomImport}</button>
      </div>
      {!validId && draftId.trim() !== "byom-" && <p className="byom-reason" role="alert">{sc.byomIdRule.replaceAll("`", "")}</p>}
      {!validPort && <p className="byom-reason" role="alert">{sc.byomPortRule}</p>}
      {importError && <p className="byom-reason" role="alert">{fill(sc.byomImportFailed, { detail: importError })}</p>}
      <p className="byom-import-hint">{models.length === 0 ? sc.byomNoneRegistered : models.length === 1 ? sc.byomOneRegistered : fill(sc.byomManyRegistered, { n: models.length })}</p>
      <button type="button" className="install-check" onClick={onCheck}><RefreshCw size={15} />{copy.checkConnection}</button>
    </section> : <ByomSetupGuide language={language} platform={platform} custom={path === "custom"} onCheck={onCheck} />}
  </div>;
}
