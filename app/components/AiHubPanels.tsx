"use client";

import { useEffect, useId, useState } from "react";
import { localEndpointError } from "../lib/local-endpoint";
import {
  AlertTriangle, Boxes, Check, Cpu, Gauge, Layers, Pencil, RefreshCw, Server, ShieldCheck, Sparkles, Trash2, ScanSearch,
} from "lucide-react";
import { fill, type Language } from "../lib/i18n";
import { countAnnotations, getAiCopy, joinList, type AiCopy } from "../lib/ai-copy";
import type { ByomModel } from "../lib/sam-models";
import type { RuntimeManifest } from "../lib/runtime-client";

type ByomWriteOutcome = { ok: true } | { ok: false; detail: string };

/** As duas etiquetas que separam os modelos automáticos, iguais em todas as telas. */
export function KindBadge({ kind, copy }: { kind: "native" | "container"; copy: AiCopy }) {
  return <span className={`ai-badge kind-${kind}`}>{kind === "native" ? <Layers size={11} /> : <Boxes size={11} />}{kind === "native" ? copy.badgeNative : copy.badgeContainer}</span>;
}

/**
 * O caminho da imagem num desenho só, com os três jeitos de usar a IA.
 *
 * A moldura é o argumento: tudo acontece dentro do computador da pessoa, e
 * nenhuma seta sai dela. Cada caixa da direita é um dos modos, com o mesmo nome
 * que ele tem nas abas, para quem lê ligar o desenho à tela.
 */
function ConnectionDiagram({ copy }: { copy: AiCopy }) {
  const box = (x: number, y: number, w: number, h: number, title: string, sub: string, strong = false) => <g>
    <rect x={x} y={y} width={w} height={h} rx="9" fill="var(--surface)" stroke={strong ? "var(--green)" : "var(--line)"} strokeWidth={strong ? 1.5 : 1} />
    <text x={x + w / 2} y={y + h / 2 - 2} fontSize="11" fontWeight="700" fill="var(--ink)" textAnchor="middle">{title}</text>
    <text x={x + w / 2} y={y + h / 2 + 12} fontSize="9" fill="var(--muted)" textAnchor="middle">{sub}</text>
  </g>;
  const arrow = (d: string) => <path d={d} fill="none" stroke="var(--muted)" strokeWidth="1.2" markerEnd="url(#poligome-how-arrow)" />;
  return <svg className="ai-how-diagram" viewBox="0 0 560 230" role="img" aria-label={`${copy.howBoxBrowser} → ${copy.howBoxConnector} → ${copy.howBoxSam}, ${copy.howBoxContainer}; ${copy.howBoxBrowser} → ${copy.howBoxRuntime} → ${copy.howBoxNative}`}>
    <defs>
      <marker id="poligome-how-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="var(--muted)" /></marker>
    </defs>
    <rect x="8" y="22" width="544" height="200" rx="12" fill="none" stroke="var(--line)" strokeDasharray="5 4" />
    <text x="22" y="16" fontSize="10" fill="var(--muted)">{copy.howDiagram}</text>
    {box(22, 96, 116, 50, copy.howBoxBrowser, "poligome.com")}
    {box(200, 42, 140, 50, copy.howBoxConnector, "127.0.0.1:7860", true)}
    {box(200, 152, 140, 50, copy.howBoxRuntime, "127.0.0.1:7861", true)}
    {box(400, 34, 136, 40, copy.howBoxSam, copy.tabAssisted)}
    {box(400, 84, 136, 40, copy.howBoxContainer, `${copy.tabAutomatic} · ${copy.badgeContainer}`)}
    {box(400, 157, 136, 40, copy.howBoxNative, `${copy.tabAutomatic} · ${copy.badgeNative}`)}
    {arrow("M138 112 L198 70")}
    {arrow("M138 130 L198 174")}
    {arrow("M340 60 L398 54")}
    {arrow("M340 74 L398 102")}
    {arrow("M340 177 L398 177")}
  </svg>;
}

export function HowItWorksPanel({ language }: { language: Language }) {
  const copy = getAiCopy(language);
  return <div className="byom-panel">
    <section className="sam-model-hero">
      <h3>{copy.howTitle}</h3>
      <p>{copy.howIntro}</p>
    </section>
    <section className="local-connection">
      <ConnectionDiagram copy={copy} />
      <ul className="ai-how-rows">
        <li>{copy.howRowAssisted}</li>
        <li>{copy.howRowContainer}</li>
        <li>{copy.howRowNative}</li>
      </ul>
    </section>
    <section className="byom-steps">
      <article><b>{copy.howFindsTitle}</b><p>{copy.howFindsBody}</p></article>
    </section>
    <section className="sam-privacy"><ShieldCheck size={16} /><div><b>{copy.howPrivacyTitle}</b><p>{copy.howPrivacyBody}</p></div></section>
  </div>;
}

const RUNTIME_REPO = "https://github.com/eduardoafonso1089/poligome-runtime";

/**
 * Como pôr um modelo nativo para rodar, do zero.
 *
 * São os comandos exatos que levam do nada ao Faster R-CNN de exemplo servindo
 * na porta padrão: sem eles, "inicie o Poligome Runtime" deixava a pessoa sem
 * saber o que é nem onde conseguir.
 */
export function RuntimeInstallPanel({ copy }: { copy: AiCopy }) {
  const steps = [
    { title: copy.rtStepClone, body: "", command: `git clone ${RUNTIME_REPO}.git\ncd poligome-runtime` },
    {
      title: copy.rtStepInstall,
      body: copy.rtStepInstallBody,
      command: "python3 -m venv .venv\n.venv/bin/pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu\n.venv/bin/pip install -e \".[server]\" -e adapters/fasterrcnn",
    },
    { title: copy.rtStepRun, body: copy.rtStepRunBody, command: ".venv/bin/python examples/serve_runtime.py --adapter fasterrcnn" },
  ];
  return <section className="sam-install-panel">
    <div><b>{copy.rtInstallTitle}</b><p>{copy.rtInstallIntro}</p></div>
    <p className="sam-manual-note">{copy.rtWindowsNote}</p>
    <ol className="sam-steps">
      {steps.map((step) => <li key={step.title}>
        <b>{step.title}</b>
        {step.body && <p>{step.body}</p>}
        <code>{step.command}</code>
      </li>)}
    </ol>
    <a className="sam-step-download" href={RUNTIME_REPO} target="_blank" rel="noreferrer">{copy.rtRepo}</a>
  </section>;
}

/**
 * Nativo ou Contêiner, explicado pelo que a pessoa ganha e não pela
 * infraestrutura. A tabela responde à pergunta que ela traz — "minhas imagens
 * são enormes", "quero só esta região" — antes de qualquer palavra técnica.
 */
export function AutomaticGuidePanel({ copy }: { copy: AiCopy }) {
  const rows: Array<[string, string, string]> = [
    [copy.guideRowLarge, copy.guideYes, copy.guideLargeContainer],
    [copy.guideRowRegion, copy.guideYes, copy.guideNo],
    [copy.guideRowParams, copy.guideYes, copy.guideNo],
    [copy.guideRowLive, copy.guideYes, copy.guideNo],
    [copy.guideRowBatch, copy.guideYes, copy.guideYes],
    [copy.guideRowEffort, copy.guideEffortNative, copy.guideEffortContainer],
  ];
  return <div className="byom-panel">
    <section className="sam-model-hero">
      <h3>{copy.autoGuideTitle}</h3>
      <p>{copy.guideIntro}</p>
    </section>
    <section className="ai-guide-kinds">
      <article><b>{copy.guideNativeTitle}</b><p>{copy.guideNativeBody}</p></article>
      <article><b>{copy.guideContainerTitle}</b><p>{copy.guideContainerBody}</p></article>
    </section>
    <section className="ai-guide-table">
      <table>
        <thead><tr><th>{copy.guideColumnNeed}</th><th><KindBadge kind="native" copy={copy} /></th><th><KindBadge kind="container" copy={copy} /></th></tr></thead>
        <tbody>{rows.map(([need, native, container]) => <tr key={need}>
          <th>{need}</th>
          <td className={native === copy.guideNo ? "no" : native === copy.guideYes ? "yes" : ""}>{native}</td>
          <td className={container === copy.guideNo ? "no" : container === copy.guideYes ? "yes" : ""}>{container}</td>
        </tr>)}</tbody>
      </table>
    </section>
    <p className="ai-guide-rule"><Sparkles size={14} /><span>{copy.guideRule}</span></p>
    <p className="byom-import-hint">{copy.guideReview}</p>
  </div>;
}

const GEOMETRY_KEYS: Record<string, keyof AiCopy> = {
  box: "geomBox", bbox: "geomBox", polygon: "geomPolygon", polyline: "geomPolyline",
  keypoint: "geomKeypoint", keypoints: "geomKeypoint", point: "geomKeypoint", mask: "geomMask",
};
const PROMPT_KEYS: Record<string, keyof AiCopy> = {
  region: "promptRegion", points: "promptPoints", point: "promptPoints", box: "promptBox", text: "promptText",
};

/** Traduz o que o manifest declara; o que não se conhece aparece como veio. */
function describeTerms(copy: AiCopy, terms: readonly string[], keys: Record<string, keyof AiCopy>): string {
  return terms.length ? joinList(copy, terms.map((term) => keys[term] ? copy[keys[term]] : term)) : copy.nativeNone;
}

export function RuntimeModelPanel({
  copy, manifest, endpoint, onPreannotate, onOpenConnections,
}: {
  copy: AiCopy;
  manifest: RuntimeManifest | null;
  endpoint: string;
  onPreannotate: () => void;
  onOpenConnections: () => void;
}) {
  if (!manifest) {
    return <div className="byom-panel">
      <section className="sam-model-hero">
        <div><KindBadge kind="native" copy={copy} /></div>
        <h3>{copy.runtimeOfflineTitle}</h3>
        <p>{copy.runtimeOfflineBody}</p>
      </section>
      <RuntimeInstallPanel copy={copy} />
      <p className="byom-import-hint">{fill(copy.runtimeOfflineAddress, { endpoint })}{" "}
        <button className="ai-link" onClick={onOpenConnections}><Server size={12} />{copy.openConnections}</button>
      </p>
    </div>;
  }
  const tiled = manifest.tiling && manifest.tiling !== "none" && manifest.maxEdge > 0;
  return <div className="byom-detail">
    <section className="sam-model-hero">
      <div><KindBadge kind="native" copy={copy} /><span className="byom-state up">{copy.stateUp}</span></div>
      <h3>{manifest.name}</h3>
      <p>{fill(copy.nativeServedBy, { endpoint })}</p>
    </section>
    <section className="byom-facts">
      <article><b>{copy.nativeProduces}</b><p>{describeTerms(copy, manifest.produces, GEOMETRY_KEYS)}</p></article>
      {manifest.accepts.length > 0 && <article><b>{copy.nativeAccepts}</b><p>{describeTerms(copy, manifest.accepts, PROMPT_KEYS)}</p></article>}
      <article><b>{copy.nativeLarge}</b><p>{tiled ? fill(copy.nativeLargeValue, { px: manifest.maxEdge }) : copy.nativeLargeWhole}</p></article>
      <article><b>{copy.nativeVersion}</b><p>{manifest.version}{manifest.license ? ` · ${copy.nativeLicense}: ${manifest.license}` : ""}</p></article>
      <article><b>{copy.nativeParams}</b><p>{manifest.params?.length ? manifest.params.map((param) => param.label).join(" · ") : copy.nativeNoParams}</p></article>
    </section>
    <div className="byom-entry-actions"><button className="byom-run" onClick={onPreannotate}><ScanSearch size={14} />{copy.usePreannotate}</button></div>
  </div>;
}

/** A explicação do contêiner, montada do que ele declara ou do que já devolveu. */
function describeContainer(copy: AiCopy, model: ByomModel): string {
  const parts: string[] = [];
  if (model.metadata?.task) parts.push(`${model.metadata.task}.`);
  if (model.metadata?.description) parts.push(model.metadata.description);
  const declared = model.metadata?.categories ?? [];
  const observed = model.last_run?.categories ?? [];
  const categories = declared.length ? declared : observed;
  if (categories.length) {
    const template = declared.length
      ? (categories.length === 1 ? copy.byomDeclaresOne : copy.byomDeclares)
      : (categories.length === 1 ? copy.byomObservedOne : copy.byomObserved);
    parts.push(fill(template, { n: categories.length, list: joinList(copy, categories) }));
  }
  const geometry = (model.metadata?.geometry ?? model.last_run?.geometry ?? [])
    .map((item) => GEOMETRY_KEYS[item] ? copy[GEOMETRY_KEYS[item]] : item);
  if (geometry.length) parts.push(fill(copy.byomExports, { list: joinList(copy, geometry) }));
  if (model.last_run) parts.push(fill(copy.byomLastImage, { count: countAnnotations(copy, model.last_run.annotations) }));
  if (!parts.length) return model.ready ? copy.byomNoMetadataReady : copy.byomNoMetadataDown;
  return parts.join(" ");
}

type ContainerModelPanelProps = {
  commandOs?: "native" | "unix";
  copy: AiCopy;
  model: ByomModel;
  busy: boolean;
  onPreannotate: (modelId: string) => void;
  onRemove: (modelId: string) => void;
  onSave: (entry: { modelId: string; name: string; port: number; notes: string }) => Promise<ByomWriteOutcome>;
};

export function ContainerModelPanel(props: ContainerModelPanelProps) {
  // A newly saved model gets a fresh form; ordinary health checks keep its draft.
  const formKey = JSON.stringify([props.model.model_id, props.model.name, props.model.notes]);
  return <ContainerModelForm key={formKey} {...props} />;
}

function ContainerModelForm({ copy, model, busy, commandOs = "unix", onPreannotate, onRemove, onSave }: ContainerModelPanelProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(model.name);
  const [port, setPort] = useState(String(Number(model.endpoint.split(":").at(-1)) || 8080));
  const [notes, setNotes] = useState(model.notes);
  // A ficha só fecha quando o registro foi gravado: fechar antes descartava a
  // correção e não dizia o motivo.
  const [saveError, setSaveError] = useState("");
  const portNumber = Number(port);
  const canSave = Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65535 && name.trim().length > 0;

  return <div className="byom-detail">
    <section className="sam-model-hero">
      <div>
        <KindBadge kind="container" copy={copy} />
        <span className={model.ready ? "byom-state up" : "byom-state down"}>{model.ready ? copy.containerUp : copy.containerDown}</span>
      </div>
      <h3>{model.name}</h3>
      <p>{model.model_id} · {model.endpoint}{model.image ? ` · ${fill(copy.containerImage, { name: model.image })}` : ""}</p>
    </section>

    {/* Parado, o que a pessoa precisa é o comando para ligar este modelo; o erro
        técnico do conector fica recolhido para quem quiser investigar. */}
    {!model.ready && <section className="byom-limits ai-stopped">
      <AlertTriangle size={15} />
      <div>
        <b>{copy.containerStoppedHint}</b>
        <code>{commandOs === "native"
          ? `powershell -ExecutionPolicy Bypass -File .\\poligome-byom-windows.ps1 start -ModelId ${model.model_id}`
          : `bash poligome-byom-macos-linux.sh start --model-id ${model.model_id}`}</code>
        {model.unavailable_reason && <details><summary>{copy.containerErrorDetail}</summary><p>{model.unavailable_reason}</p></details>}
      </div>
    </section>}
    <p className="byom-summary">{describeContainer(copy, model)}</p>

    {model.metadata?.limitations && <section className="byom-limits">
      <AlertTriangle size={15} />
      <div><b>{copy.containerLimits}</b><p>{model.metadata.limitations}</p></div>
    </section>}

    {(model.metadata?.categories.length || Object.keys(model.metadata?.parameters ?? {}).length || Object.keys(model.env).length || model.last_run) ? <section className="byom-facts">
      {model.metadata?.categories.length ? <article><b>{copy.containerClasses}</b><p>{model.metadata.categories.join(", ")}</p></article> : null}
      {Object.entries(model.metadata?.parameters ?? {}).length ? <article><b>{copy.containerParams}</b><p>{Object.entries(model.metadata!.parameters).map(([key, value]) => `${key}=${value}`).join(" · ")}</p></article> : null}
      {Object.entries(model.env).length ? <article><b>{copy.containerEnv}</b><p>{Object.entries(model.env).map(([key, value]) => `${key}=${value}`).join(" · ")}</p></article> : null}
      {model.last_run ? <article><b>{copy.containerLastRun}</b><p>{countAnnotations(copy, model.last_run.annotations)}{model.last_run.categories.length ? ` · ${model.last_run.categories.join(", ")}` : ""}</p></article> : null}
    </section> : null}

    {model.notes && !editing && <p className="byom-note">{model.notes}</p>}

    {editing ? <div className="byom-edit">
      <label>{copy.fieldName}<input value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>{copy.fieldPort}<input type="number" min={1} max={65535} value={port} onChange={(event) => setPort(event.target.value)} /></label>
      <label className="byom-edit-notes">{copy.fieldNote}<textarea rows={3} value={notes} placeholder={copy.fieldNotePlaceholder} onChange={(event) => setNotes(event.target.value)} /></label>
      <div className="byom-edit-actions">
        <button onClick={() => { setName(model.name); setNotes(model.notes); setEditing(false); }}>{copy.cancel}</button>
        <button
          className="primary"
          disabled={!canSave}
          onClick={async () => {
            setSaveError("");
            const outcome = await onSave({ modelId: model.model_id, name: name.trim(), port: portNumber, notes: notes.trim() });
            if (outcome.ok) setEditing(false);
            else setSaveError(outcome.detail);
          }}
        ><Check size={13} />{copy.save}</button>
      </div>
      {saveError && <p className="byom-reason">{fill(copy.saveFailed, { detail: saveError })}</p>}
    </div> : <div className="byom-entry-actions">
      <button className="byom-run" disabled={!model.ready || busy} title={model.ready ? undefined : copy.paStopped} onClick={() => onPreannotate(model.model_id)}>
        {busy ? <Gauge className="spin" size={14} /> : <ScanSearch size={14} />}{copy.usePreannotate}
      </button>
      <button className="byom-icon" title={copy.editContainer} aria-label={copy.editContainer} onClick={() => setEditing(true)}><Pencil size={14} /></button>
      <button className="byom-icon danger" title={copy.removeContainer} aria-label={copy.removeContainer} onClick={() => onRemove(model.model_id)}><Trash2 size={14} /></button>
    </div>}
  </div>;
}

/**
 * Um campo de endereço que só vale quando a pessoa termina de digitar.
 *
 * Gravar a cada tecla disparava uma sondagem por letra, e cada uma espera
 * segundos por uma porta que ainda está pela metade.
 */
function EndpointField({ copy, value, placeholder, onCommit, onValidityChange }: { copy: AiCopy; value: string; placeholder: string; onCommit: (value: string) => void; onValidityChange: (valid: boolean) => void }) {
  const [draftState, setDraft] = useState({ source: value, text: value });
  const draft = draftState.source === value ? draftState.text : value;
  const errorId = useId();
  const reason = localEndpointError(draft);
  useEffect(() => { onValidityChange(!localEndpointError(value)); }, [value, onValidityChange]);
  const commit = () => { const next = draft.trim(); if (!localEndpointError(next) && next !== value) onCommit(next); };
  return <label className="ai-conn-address">{copy.connAddress}<input
    type="url" value={draft} placeholder={placeholder} spellCheck={false}
    aria-invalid={Boolean(reason)} aria-describedby={reason ? errorId : undefined}
    onChange={(event) => { setDraft({ source: value, text: event.target.value }); onValidityChange(!localEndpointError(event.target.value)); }}
    onBlur={commit}
    onKeyDown={(event) => { if (event.key === "Enter") commit(); if (event.key === "Escape") { event.stopPropagation(); setDraft({ source: value, text: value }); onValidityChange(!localEndpointError(value)); } }}
  />{reason && <span id={errorId} role="alert" className="byom-reason">{reason === "remote" ? copy.connLocalOnly : copy.connInvalidAddress}</span>}</label>;
}

type ServiceState = "checking" | "ready" | "offline";

function StatusPill({ copy, state }: { copy: AiCopy; state: ServiceState }) {
  return <span className={`ai-conn-status ${state}`}><em />{state === "ready" ? copy.connUp : state === "checking" ? copy.connChecking : copy.connDown}</span>;
}

export function ConnectionsPanel({
  copy, connector, runtime, containers, onShowInstall, onShowAddModel, onShowRuntimeInstall,
}: {
  copy: AiCopy;
  connector: { state: ServiceState; endpoint: string; host: string | null; serving: string; modelState?: "ready" | "loading" | "error"; onEndpoint: (value: string) => void; onRetry: () => void };
  runtime: { state: ServiceState; endpoint: string; serving: string; onEndpoint: (value: string) => void; onRetry: () => void };
  containers: readonly ByomModel[];
  onShowInstall: () => void;
  onShowAddModel: () => void;
  onShowRuntimeInstall: () => void;
}) {
  const up = containers.filter((model) => model.ready).length;
  const [connectorAddressValid, setConnectorAddressValid] = useState(() => !localEndpointError(connector.endpoint));
  const [runtimeAddressValid, setRuntimeAddressValid] = useState(() => !localEndpointError(runtime.endpoint));
  const runtimePort = (() => { try { return new URL(runtime.endpoint).port; } catch { return ""; } })();
  return <div className="byom-panel">
    <section className="sam-model-hero">
      <h3>{copy.tabConnections}</h3>
      <p>{copy.connIntro}</p>
    </section>

    <section className="ai-conn-card">
      <header><span className="ai-conn-icon"><Cpu size={16} /></span><div><b>{copy.connConnectorTitle}</b><small>{copy.connConnectorRole}</small></div><StatusPill copy={copy} state={connector.state} /></header>
      {connector.state === "ready" && connector.modelState === "error" ? <>
        <p className="ai-conn-detail" role="alert">{copy.connModelError}</p>
        <details><summary>{copy.containerErrorDetail}</summary><code>{connector.serving}</code></details>
      </> : connector.state === "ready" && connector.modelState === "loading" ? <p className="ai-conn-detail">{copy.connModelLoading}</p>
        : connector.state === "ready" && <p className="ai-conn-detail">{fill(copy.connServing, { model: connector.serving })}{connector.host ? ` · ${fill(copy.connHost, { host: connector.host })}` : ""}</p>}
      {connector.state === "offline" && <p className="ai-conn-detail">{copy.connConnectorHow}</p>}
      <div className="ai-conn-row">
        <EndpointField copy={copy} value={connector.endpoint} placeholder="http://127.0.0.1:7860/predict" onCommit={connector.onEndpoint} onValidityChange={setConnectorAddressValid} />
        <button disabled={!connectorAddressValid} onClick={connector.onRetry}><RefreshCw size={13} />{copy.connRetry}</button>
        {connector.state === "offline" && <button className="primary" onClick={onShowInstall}>{copy.connConnectorHowButton}</button>}
      </div>
    </section>

    <section className="ai-conn-card">
      <header><span className="ai-conn-icon"><Layers size={16} /></span><div><b>{copy.connRuntimeTitle}</b><small>{copy.connRuntimeRole}</small></div><StatusPill copy={copy} state={runtime.state} /></header>
      {runtime.state === "ready" && runtime.serving && <p className="ai-conn-detail">{fill(copy.connServing, { model: runtime.serving })}</p>}
      {runtime.state === "offline" && <p className="ai-conn-detail">{copy.runtimeOfflineBody}</p>}
      {runtime.state === "offline" && runtimePort === "7861" && <p className="ai-conn-warning"><AlertTriangle size={13} /><span>{copy.connPortClash}</span></p>}
      <div className="ai-conn-row">
        <EndpointField copy={copy} value={runtime.endpoint} placeholder="http://127.0.0.1:7861" onCommit={runtime.onEndpoint} onValidityChange={setRuntimeAddressValid} />
        <button disabled={!runtimeAddressValid} onClick={runtime.onRetry}><RefreshCw size={13} />{copy.connRetry}</button>
        {runtime.state === "offline" && <button className="primary" onClick={onShowRuntimeInstall}>{copy.connRuntimeHowButton}</button>}
      </div>
    </section>

    <section className="ai-conn-card">
      <header><span className="ai-conn-icon"><Boxes size={16} /></span><div><b>{copy.connContainersTitle}</b><small>{copy.connContainersRole}</small></div>
        {connector.state === "ready" && containers.length > 0 && <span className={`ai-conn-status ${up ? "ready" : "offline"}`}><em />{fill(copy.connContainersCount, { up, total: containers.length })}</span>}
      </header>
      {connector.state !== "ready"
        ? <p className="ai-conn-detail">{copy.connContainersNeedConnector}</p>
        : containers.length === 0
          ? <p className="ai-conn-detail">{copy.connContainersNone}</p>
          : <ul className="ai-conn-list">{containers.map((model) => <li key={model.model_id}>
              <span className={model.ready ? "up" : "down"} /><b>{model.name}</b><small>{model.endpoint} · {model.ready ? copy.stateUp : copy.stateDown}</small>
            </li>)}</ul>}
      <div className="ai-conn-row"><button onClick={onShowAddModel}>{copy.connContainersHowButton}</button></div>
    </section>
  </div>;
}
