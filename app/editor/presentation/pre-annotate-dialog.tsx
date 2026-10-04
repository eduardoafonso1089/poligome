"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Image as ImageIcon, Images, ScanSearch, SquareDashed, X } from "lucide-react";
import { fill, type Language } from "../../lib/i18n";
import { getAiCopy } from "../../lib/ai-copy";
import type { ByomModel } from "../../lib/sam-models";
import type { RuntimeManifest, RuntimeParamSpec } from "../../lib/runtime-client";
import { KindBadge } from "../../components/AiHubPanels";
import type { RuntimeState } from "./use-runtime-status";

export type PreannotateScope = "image" | "region" | "all";
export type RuntimeParams = Record<string, number | boolean | string>;

/** O pedido que o diálogo entrega ao editor, onde as imagens existem. */
export type PreannotateRequest =
  | { source: "runtime"; modelName: string; scope: PreannotateScope; params: RuntimeParams }
  | { source: "byom"; modelId: string; modelName: string; scope: Exclude<PreannotateScope, "region"> };

export const PREANNOTATE_EVENT = "poligome:preannotate";
const MODEL_KEY = "poligome-auto-model";
const RUNTIME_OPTION = "runtime";
/** O mesmo teto do conector (POLIGOME_MAX_IMAGE_PIXELS), que recusa acima disso. */
const CONNECTOR_MAX_PIXELS = 16_000_000;

type Option = { key: string; kind: "native" | "container"; name: string; ready: boolean };

function defaultParams(specs: readonly RuntimeParamSpec[] | undefined): RuntimeParams {
  return Object.fromEntries((specs ?? []).map((spec) => [spec.key, spec.default]));
}

function ParamControl({ spec, value, onChange }: { spec: RuntimeParamSpec; value: number | boolean | string; onChange: (value: number | boolean | string) => void }) {
  if (spec.type === "boolean") {
    return <label className="pa-param pa-param-check"><input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} /><span>{spec.label}</span></label>;
  }
  if (spec.type === "enum") {
    return <label className="pa-param"><span>{spec.label}</span><select value={String(value)} onChange={(event) => onChange(event.target.value)}>{spec.options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
  }
  return <label className="pa-param"><span>{spec.label}</span><input type="range" min={spec.min} max={spec.max} step={spec.step} value={Number(value)} onChange={(event) => onChange(Number(event.target.value))} /><output>{Number(value)}</output></label>;
}

export function PreannotateDialog({
  language, runtimeState, manifest, containers, initialModel, hasAsset, assetsCount, selectionIsBox, imagePixels, busy,
  onRun, onClose, onOpenHub,
}: {
  language: Language;
  runtimeState: RuntimeState;
  manifest: RuntimeManifest | null;
  containers: readonly ByomModel[];
  /** Modelo pedido por quem abriu o diálogo, como a ficha de um modelo na central. */
  initialModel?: string | null;
  hasAsset: boolean;
  assetsCount: number;
  selectionIsBox: boolean;
  imagePixels: number;
  busy: boolean;
  onRun: (request: PreannotateRequest) => void;
  onClose: () => void;
  onOpenHub: () => void;
}) {
  const copy = getAiCopy(language);

  const options = useMemo<Option[]>(() => [
    ...(runtimeState === "ready" && manifest ? [{ key: RUNTIME_OPTION, kind: "native" as const, name: manifest.name, ready: true }] : []),
    ...containers.map((model) => ({ key: model.model_id, kind: "container" as const, name: model.name, ready: model.ready })),
  ], [containers, manifest, runtimeState]);

  const [choice, setChoice] = useState<string | null>(null);
  const [scope, setScope] = useState<PreannotateScope>("image");
  const [params, setParams] = useState<RuntimeParams>(() => defaultParams(manifest?.params));

  // A escolha inicial: o que foi pedido, senão a última usada, senão o primeiro
  // modelo pronto. Só se fixa quando as opções chegam, porque elas vêm de
  // sondagens que podem terminar depois de o diálogo abrir.
  useEffect(() => {
    if (choice && options.some((option) => option.key === choice)) return;
    const stored = (() => { try { return localStorage.getItem(MODEL_KEY); } catch { return null; } })();
    const usable = (key: string | null | undefined) => options.find((option) => option.key === key && option.ready)?.key;
    setChoice(usable(initialModel) ?? usable(stored) ?? options.find((option) => option.ready)?.key ?? null);
  }, [choice, initialModel, options]);

  useEffect(() => { setParams(defaultParams(manifest?.params)); }, [manifest?.id, manifest?.params]);

  useEffect(() => {
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeydown, true);
    return () => window.removeEventListener("keydown", onKeydown, true);
  }, [onClose]);

  const chosen = options.find((option) => option.key === choice) ?? null;
  const native = chosen?.kind === "native";
  // Região só existe para o Nativo, e só com uma caixa selecionada. Quando a
  // escolha muda para algo que não a aceita, o escopo volta para a imagem em vez
  // de ficar marcado num rádio desabilitado.
  const regionReason = !native ? copy.paRegionNativeOnly : !selectionIsBox ? copy.paRegionNeedsBox : null;
  useEffect(() => { if (scope === "region" && regionReason) setScope("image"); }, [regionReason, scope]);

  const largeForContainer = chosen?.kind === "container" && scope !== "all" && imagePixels > CONNECTOR_MAX_PIXELS;
  const canRun = Boolean(chosen?.ready) && hasAsset && !busy && !(scope === "region" && regionReason);

  const run = () => {
    if (!chosen || !canRun) return;
    try { localStorage.setItem(MODEL_KEY, chosen.key); } catch { /* vale para esta aba */ }
    if (chosen.kind === "native") onRun({ source: "runtime", modelName: chosen.name, scope, params });
    else onRun({ source: "byom", modelId: chosen.key, modelName: chosen.name, scope: scope === "region" ? "image" : scope });
  };

  return <div className="modal-backdrop preannotate-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="sam-modal preannotate-modal" role="dialog" aria-modal="true" aria-labelledby="preannotate-title">
      <header>
        <div><span><ScanSearch size={18} /></span><div><h2 id="preannotate-title">{copy.preAnnotate}</h2><p>{copy.paSubtitle}</p></div></div>
        <button onClick={onClose} aria-label={copy.close}><X size={19} /></button>
      </header>

      {options.length === 0 ? <div className="pa-empty">
        <b>{copy.paNoModels}</b>
        <p>{copy.paNoModelsHint}</p>
        <button className="connect" onClick={onOpenHub}>{copy.paOpenHub}</button>
      </div> : <>
        <fieldset className="pa-group">
          <legend>{copy.paModel}</legend>
          {options.map((option) => <label key={option.key} className={`pa-model${option.key === choice ? " active" : ""}${option.ready ? "" : " disabled"}`}>
            <input type="radio" name="pa-model" disabled={!option.ready} checked={option.key === choice} onChange={() => setChoice(option.key)} />
            <span className="pa-model-text">
              <b>{option.name}</b>
              <small>{option.ready ? (option.kind === "native" ? copy.paCapNative : copy.paCapContainer) : copy.paStopped}</small>
            </span>
            <KindBadge kind={option.kind} copy={copy} />
          </label>)}
        </fieldset>

        <fieldset className="pa-group">
          <legend>{copy.paWhere}</legend>
          <div className="pa-scopes">
            <label className={scope === "image" ? "active" : ""}><input type="radio" name="pa-scope" checked={scope === "image"} onChange={() => setScope("image")} /><ImageIcon size={15} />{copy.paScopeImage}</label>
            <label className={`${scope === "region" ? "active" : ""}${regionReason ? " disabled" : ""}`} title={regionReason ?? undefined}><input type="radio" name="pa-scope" disabled={Boolean(regionReason)} checked={scope === "region"} onChange={() => setScope("region")} /><SquareDashed size={15} />{copy.paScopeRegion}</label>
            <label className={scope === "all" ? "active" : ""}><input type="radio" name="pa-scope" disabled={assetsCount < 2} checked={scope === "all"} onChange={() => setScope("all")} /><Images size={15} />{fill(copy.paScopeAll, { n: assetsCount })}</label>
          </div>
          {regionReason && chosen && <p className="pa-note">{regionReason}</p>}
        </fieldset>

        {native && manifest?.params?.length ? <fieldset className="pa-group">
          <legend>{copy.paParams}</legend>
          {manifest.params.map((spec) => <ParamControl key={spec.key} spec={spec} value={params[spec.key] ?? spec.default} onChange={(value) => setParams((current) => ({ ...current, [spec.key]: value }))} />)}
        </fieldset> : null}

        {largeForContainer && <p className="pa-warning"><AlertTriangle size={14} /><span>{fill(copy.paLargeImage, { mp: Math.round(imagePixels / 1e6) })}</span></p>}
        {!hasAsset && <p className="pa-note">{copy.paNoImage}</p>}
        {busy && <p className="pa-note">{copy.paBusy}</p>}
      </>}

      <footer>
        <button onClick={onClose}>{copy.cancel}</button>
        {options.length > 0 && <button className="connect" disabled={!canRun} onClick={run}><ScanSearch size={15} />{copy.preAnnotate}</button>}
      </footer>
    </section>
  </div>;
}
