"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle, Boxes, Check, Cpu, Gauge, Layers, Pencil, RefreshCw, Server, ShieldCheck, Sparkles, Trash2, ScanSearch,
} from "lucide-react";
import { getCopy, fill, type Language } from "../lib/i18n";
import { countAnnotations, getAiCopy, joinList, type AiCopy } from "../lib/ai-copy";
import type { ByomModel } from "../lib/sam-models";
import type { RuntimeManifest } from "../lib/runtime-client";
import { LocalConnectionExplainer } from "./LocalConnectionExplainer";

type ByomWriteOutcome = { ok: true } | { ok: false; detail: string };

/** As duas etiquetas que separam os modelos automáticos, iguais em todas as telas. */
export function KindBadge({ kind, copy }: { kind: "native" | "container"; copy: AiCopy }) {
  return <span className={`ai-badge kind-${kind}`}>{kind === "native" ? <Layers size={11} /> : <Boxes size={11} />}{kind === "native" ? copy.badgeNative : copy.badgeContainer}</span>;
}

export function HowItWorksPanel({ language }: { language: Language }) {
  const copy = getAiCopy(language);
  return <div className="byom-panel">
    <section className="sam-model-hero">
      <h3>{copy.howTitle}</h3>
      <p>{copy.howIntro}</p>
    </section>
    <LocalConnectionExplainer copy={getCopy(language)} />
    <section className="byom-steps">
      <article><b>{copy.howFindsTitle}</b><p>{copy.howFindsBody}</p></article>
      <article><b>{copy.howModesTitle}</b><p>{copy.howModesBody}</p></article>
    </section>
    <section className="sam-privacy"><ShieldCheck size={16} /><div><b>{copy.howPrivacyTitle}</b><p>{copy.howPrivacyBody}</p></div></section>
  </div>;
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
        <div><KindBadge kind="native" copy={copy} /><span className="byom-state down">{copy.autoNativeOffline}</span></div>
        <h3>{copy.runtimeOfflineTitle}</h3>
        <p>{copy.runtimeOfflineBody}</p>
        <p>{fill(copy.runtimeOfflineAddress, { endpoint })}</p>
      </section>
      <div className="byom-entry-actions"><button className="byom-run" onClick={onOpenConnections}><Server size={14} />{copy.openConnections}</button></div>
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
      <article><b>{copy.nativeAccepts}</b><p>{describeTerms(copy, manifest.accepts, PROMPT_KEYS)}</p></article>
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

export function ContainerModelPanel({
  copy, model, busy, onPreannotate, onRemove, onSave,
}: {
  copy: AiCopy;
  model: ByomModel;
  busy: boolean;
  onPreannotate: (modelId: string) => void;
  onRemove: (modelId: string) => void;
  onSave: (entry: { modelId: string; name: string; port: number; notes: string }) => Promise<ByomWriteOutcome>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(model.name);
  const [port, setPort] = useState(String(Number(model.endpoint.split(":").at(-1)) || 8080));
  const [notes, setNotes] = useState(model.notes);
  // A ficha só fecha quando o registro foi gravado: fechar antes descartava a
  // correção e não dizia o motivo.
  const [saveError, setSaveError] = useState("");
  useEffect(() => { setEditing(false); setName(model.name); setNotes(model.notes); setSaveError(""); }, [model.model_id, model.name, model.notes]);
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

    {!model.ready && <p className="byom-reason">{model.unavailable_reason || copy.containerStoppedHint}</p>}
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
function EndpointField({ copy, value, placeholder, onCommit }: { copy: AiCopy; value: string; placeholder: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => { const next = draft.trim(); if (next && next !== value) onCommit(next); else setDraft(value); };
  return <label className="ai-conn-address">{copy.connAddress}<input
    type="url" value={draft} placeholder={placeholder} spellCheck={false}
    onChange={(event) => setDraft(event.target.value)}
    onBlur={commit}
    onKeyDown={(event) => { if (event.key === "Enter") commit(); if (event.key === "Escape") { event.stopPropagation(); setDraft(value); } }}
  /></label>;
}

type ServiceState = "checking" | "ready" | "offline";

function StatusPill({ copy, state }: { copy: AiCopy; state: ServiceState }) {
  return <span className={`ai-conn-status ${state}`}><em />{state === "ready" ? copy.connUp : state === "checking" ? copy.connChecking : copy.connDown}</span>;
}

export function ConnectionsPanel({
  copy, connector, runtime, containers, onShowInstall, onShowAddModel,
}: {
  copy: AiCopy;
  connector: { state: ServiceState; endpoint: string; host: string | null; serving: string; onEndpoint: (value: string) => void; onRetry: () => void };
  runtime: { state: ServiceState; endpoint: string; serving: string; onEndpoint: (value: string) => void; onRetry: () => void };
  containers: readonly ByomModel[];
  onShowInstall: () => void;
  onShowAddModel: () => void;
}) {
  const up = containers.filter((model) => model.ready).length;
  const runtimePort = (() => { try { return new URL(runtime.endpoint).port; } catch { return ""; } })();
  return <div className="byom-panel">
    <section className="sam-model-hero">
      <h3>{copy.tabConnections}</h3>
      <p>{copy.connIntro}</p>
    </section>

    <section className="ai-conn-card">
      <header><span className="ai-conn-icon"><Cpu size={16} /></span><div><b>{copy.connConnectorTitle}</b><small>{copy.connConnectorRole}</small></div><StatusPill copy={copy} state={connector.state} /></header>
      {connector.state === "ready" && <p className="ai-conn-detail">{fill(copy.connServing, { model: connector.serving })}{connector.host ? ` · ${fill(copy.connHost, { host: connector.host })}` : ""}</p>}
      {connector.state === "offline" && <p className="ai-conn-detail">{copy.connConnectorHow}</p>}
      <div className="ai-conn-row">
        <EndpointField copy={copy} value={connector.endpoint} placeholder="http://127.0.0.1:7860/predict" onCommit={connector.onEndpoint} />
        <button onClick={connector.onRetry}><RefreshCw size={13} />{copy.connRetry}</button>
        {connector.state === "offline" && <button className="primary" onClick={onShowInstall}>{copy.connConnectorHowButton}</button>}
      </div>
    </section>

    <section className="ai-conn-card">
      <header><span className="ai-conn-icon"><Layers size={16} /></span><div><b>{copy.connRuntimeTitle}</b><small>{copy.connRuntimeRole}</small></div><StatusPill copy={copy} state={runtime.state} /></header>
      {runtime.state === "ready" && runtime.serving && <p className="ai-conn-detail">{fill(copy.connServing, { model: runtime.serving })}</p>}
      {runtime.state === "offline" && <p className="ai-conn-detail">{copy.runtimeOfflineBody}</p>}
      {runtime.state === "offline" && runtimePort === "7861" && <p className="ai-conn-warning"><AlertTriangle size={13} /><span>{copy.connPortClash}</span></p>}
      <div className="ai-conn-row">
        <EndpointField copy={copy} value={runtime.endpoint} placeholder="http://127.0.0.1:7861" onCommit={runtime.onEndpoint} />
        <button onClick={runtime.onRetry}><RefreshCw size={13} />{copy.connRetry}</button>
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
