"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, BarChart3, Check, CircleSlash, Compass, Cpu, Database, GitCompare, History, LoaderCircle,
  Play, Power, RefreshCw, RotateCcw, ShieldCheck, Square, TrendingUp, Undo2, X,
} from "lucide-react";
import { getCopy, fill, type Language } from "../lib/i18n";
import { getAdaptiveCopy, type AdaptiveCopy } from "../lib/adaptive-copy";
import { connectorBaseUrl } from "../lib/sam-connector";
import { diffAgainstConnector, planAdaptiveCandidates, planAdaptiveDataset, SELECT_ASSET_EVENT } from "../lib/adaptive-dataset";
import {
  AdaptiveRequestError, adaptiveApi, syncAdaptiveCandidates, syncAdaptiveDataset,
  type AdaptiveReason, type AdaptiveStatus, type ComparisonSummary, type EpochMetrics, type LearningCurve, type ReadinessReport, type RunRecord, type RunSummary, type Suggestion,
} from "../lib/adaptive-client";
import type { Asset, Label } from "../lib/types";
import type { EditorAnnotation } from "../editor/models/annotation-model";

export type AdaptiveProject = {
  id: string;
  name: string;
  assets: readonly Asset[];
  labels: readonly Label[];
  annotations: readonly EditorAnnotation[];
};

type ConnectorState = "checking" | "ready" | "offline" | "not_installed";

const RUNNING = new Set(["queued", "preparing", "training", "evaluating"]);

const pct = (value: number | null | undefined, digits = 1) =>
  value === null || value === undefined || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(digits)}%`;
const points = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value) ? "—" : `${value >= 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(1)}`;
const num = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(digits);

/** "run-20261013t144705z-abc123" → "2026-10-13 14:47 UTC": o id da rodada é a data em que ela começou. */
export function runLabel(runId: string): string {
  const match = /^run-(\d{4})(\d{2})(\d{2})t(\d{2})(\d{2})/.exec(runId);
  return match ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]} UTC` : runId;
}

/** Uma frase por motivo, com os números do servidor; o código cru só se não houver tradução. */
export function reasonText(t: AdaptiveCopy, reason: AdaptiveReason): string {
  const key = `reason_${reason.code}` as keyof AdaptiveCopy;
  const template = t[key];
  if (!template) return reason.code;
  const params: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(reason.params ?? {})) {
    if (typeof value === "number") params[name] = ["low", "high", "share", "min_effect"].includes(name) ? (name === "share" ? pct(value, 0) : points(value)) : Number.isInteger(value) ? value : value.toFixed(1);
    else if (Array.isArray(value)) params[name] = value.join(", ");
    else if (typeof value === "boolean") params[name] = value ? t.yes : t.no;
    else if (value !== null && value !== undefined) params[name] = String(value);
  }
  return fill(template, params);
}

function errorText(t: AdaptiveCopy, error: unknown): string {
  if (error instanceof AdaptiveRequestError) {
    const key = `err_${error.detail.code}` as keyof AdaptiveCopy;
    return t[key] ? fill(t[key], { message: error.detail.message }) : error.detail.message;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Curvas por época, com a melhor época marcada. Um SVG simples: os valores são
 * os que o conector mediu, sem suavização e sem extrapolação.
 */
export function MetricChart({ title, epochs, series, best, percent }: {
  title: string;
  epochs: number[];
  series: Array<{ label: string; className: string; values: Array<number | null | undefined> }>;
  best?: number;
  percent?: boolean;
}) {
  const width = 300;
  const height = 130;
  const pad = { left: 34, right: 8, top: 10, bottom: 20 };
  const values = series.flatMap((entry) => entry.values.filter((value): value is number => typeof value === "number" && Number.isFinite(value)));
  if (!epochs.length || !values.length) return null;
  let low = Math.min(...values);
  let high = Math.max(...values);
  if (high - low < 1e-6) { low -= 0.05; high += 0.05; }
  const maxEpoch = Math.max(1, epochs[epochs.length - 1]);
  const x = (epoch: number) => pad.left + (epoch / maxEpoch) * (width - pad.left - pad.right);
  const y = (value: number) => pad.top + (1 - (value - low) / (high - low)) * (height - pad.top - pad.bottom);
  const label = (value: number) => percent ? `${Math.round(value * 100)}%` : value.toFixed(2);
  return <figure className="adaptive-chart">
    <figcaption>{title}</figcaption>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}: ${series.map((entry) => `${entry.label} ${entry.values.map((value) => typeof value === "number" ? label(value) : "—").join(", ")}`).join("; ")}`}>
      <line x1={pad.left} x2={width - pad.right} y1={height - pad.bottom} y2={height - pad.bottom} className="axis" />
      <line x1={pad.left} x2={pad.left} y1={pad.top} y2={height - pad.bottom} className="axis" />
      <text x={pad.left - 4} y={pad.top + 4} textAnchor="end" className="tick">{label(high)}</text>
      <text x={pad.left - 4} y={height - pad.bottom} textAnchor="end" className="tick">{label(low)}</text>
      <text x={pad.left} y={height - 6} className="tick">0</text>
      <text x={width - pad.right} y={height - 6} textAnchor="end" className="tick">{maxEpoch}</text>
      {best !== undefined && <g className="best">
        <line x1={x(best)} x2={x(best)} y1={pad.top} y2={height - pad.bottom} />
        <text x={x(best) + 3} y={pad.top + 8}>★ {best}</text>
      </g>}
      {series.map((entry) => {
        const pointsList = epochs.map((epoch, index) => [epoch, entry.values[index]] as const)
          .filter((pair): pair is readonly [number, number] => typeof pair[1] === "number" && Number.isFinite(pair[1]));
        return <g key={entry.label} className={entry.className}>
          <polyline fill="none" points={pointsList.map(([epoch, value]) => `${x(epoch).toFixed(1)},${y(value).toFixed(1)}`).join(" ")} />
          {pointsList.map(([epoch, value]) => <circle key={epoch} cx={x(epoch)} cy={y(value)} r={2} />)}
        </g>;
      })}
    </svg>
    <div className="adaptive-legend">{series.map((entry) => <span key={entry.label} className={entry.className}><i />{entry.label}</span>)}</div>
  </figure>;
}

/**
 * Quantas imagens de origens novas faltam para as referências de independência e
 * de avaliação. Um grupo novo vai para a avaliação com a fração do holdout, então
 * faltar k grupos lá pede k ÷ fração grupos novos no total.
 */
export function imagesStillNeeded(report: ReadinessReport): number {
  const thresholds = report.thresholds ?? {};
  const fraction = Number(thresholds.holdout_fraction) || 0.25;
  const independent = Math.max(0, (thresholds.target_independent ?? 24) - report.counts.independent_groups);
  const holdout = report.split_frozen
    ? Math.ceil(Math.max(0, (thresholds.target_holdout_groups ?? 6) - report.counts.holdout.groups) / fraction)
    : 0;
  return Math.max(independent, holdout);
}

export function ReadinessView({ t, report }: { t: AdaptiveCopy; report: ReadinessReport }) {
  const needed = imagesStillNeeded(report);
  const stateTitle = t[`state_${report.state}` as keyof AdaptiveCopy] ?? report.state;
  const stateBody = t[`state_${report.state}_body` as keyof AdaptiveCopy] ?? "";
  return <div className="adaptive-readiness">
    <div className={`adaptive-state ${report.can_train ? "ok" : "wait"}`} data-state={report.state}>
      <b>{stateTitle}</b>
      <p>{stateBody}</p>
      <ul>{report.reasons.map((reason, index) => <li key={index}>{reasonText(t, reason)}</li>)}</ul>
      {report.state !== "unsupported_model" && <p className="adaptive-need"><b>{needed > 0 ? fill(t.needMoreImages, { n: needed }) : t.reachedTargets}</b></p>}
    </div>
    <table className="adaptive-components">
      <caption>{t.componentsCaption}</caption>
      <thead><tr><th>{t.componentColumn}</th><th>{t.valueColumn}</th><th>{t.targetColumn}</th><th /></tr></thead>
      <tbody>{report.components.map((component) => {
        const share = component.target ? Math.min(1, component.value / component.target) : null;
        return <tr key={component.id} className={component.status}>
          <th>{t[`component_${component.id}` as keyof AdaptiveCopy] ?? component.id}</th>
          <td>{component.id === "effective_diversity" ? component.value.toFixed(1) : component.value}</td>
          <td>{component.target ?? "—"}{component.minimum !== undefined && component.minimum !== component.target ? ` (${fill(t.minimumShort, { n: component.minimum })})` : ""}</td>
          <td>{share !== null && <span className="adaptive-meter" aria-hidden="true"><i style={{ width: `${Math.round(share * 100)}%` }} /></span>}</td>
        </tr>;
      })}</tbody>
    </table>
    <p className="adaptive-note">{t.componentsNote}</p>
    <div className="adaptive-facts">
      <article><b>{t.factSplit}</b><p>{fill(t.factSplitBody, { train: report.counts.train.images, trainGroups: report.counts.train.groups, holdout: report.counts.holdout.images, holdoutGroups: report.counts.holdout.groups })}{report.split_frozen ? ` ${t.splitFrozen}` : ""}</p></article>
      <article><b>{t.factDuplicates}</b><p>{fill(t.factDuplicatesBody, { pairs: report.counts.near_duplicate_pairs, groups: report.counts.independent_groups, images: report.counts.approved_images })}</p></article>
      <article><b>{t.factDiversity}</b><p>{fill(report.diversity.method === "sam2_embedding" ? t.factDiversityEmbedding : t.factDiversityLowLevel, { vendi: report.diversity.vendi.toFixed(1), redundancy: pct(report.diversity.redundancy, 0) })}</p></article>
      <article><b>{t.factSizes}</b><p>{fill(t.factSizesBody, report.sizes)}</p></article>
    </div>
    {report.classes.length > 0 && <table className="adaptive-table">
      <caption>{t.classesCaption}</caption>
      <thead><tr><th>{t.classColumn}</th><th>{t.instancesColumn}</th><th>{t.imagesColumn}</th><th>{t.holdoutColumn}</th></tr></thead>
      <tbody>{report.classes.map((entry) => <tr key={entry.label}><th>{entry.name}</th><td>{entry.instances}</td><td>{entry.images}</td><td>{entry.holdout_instances}</td></tr>)}</tbody>
    </table>}
    {report.gaps.length > 0 && <section className="adaptive-gaps"><b><AlertTriangle size={13} />{t.gapsTitle}</b><ul>{report.gaps.map((gap, index) => <li key={index}>{reasonText(t, gap)}</li>)}</ul></section>}
  </div>;
}

export function TrainingView({ t, record, onCancel, busy }: { t: AdaptiveCopy; record: RunRecord; onCancel: () => void; busy: boolean }) {
  const running = RUNNING.has(record.status);
  const epochs = record.epochs ?? [];
  const progress = record.progress;
  const maxEpochs = record.resolved?.max_epochs;
  const epochNumbers = epochs.map((entry) => entry.epoch);
  const pick = (key: keyof EpochMetrics) => epochs.map((entry) => entry[key] as number | undefined);
  const diagnosis = record.diagnosis?.state;
  return <div className="adaptive-training">
    <div className={`adaptive-run-status ${record.status}`}>
      {running ? <LoaderCircle className="spin" size={15} /> : record.status === "completed" ? <Check size={15} /> : <CircleSlash size={15} />}
      <div>
        <b>{t[`status_${record.status}` as keyof AdaptiveCopy] ?? record.status}</b>
        {running && progress?.phase && <small>{fill(t[`phase_${progress.phase}` as keyof AdaptiveCopy] ?? progress.phase, {
          epoch: progress.epoch ?? "—", max: progress.max_epochs ?? maxEpochs ?? "—", done: progress.done ?? 0, total: progress.total ?? 0, model: progress.model ? (t[`model_${progress.model}` as keyof AdaptiveCopy] ?? progress.model) : "",
        })}</small>}
        {record.error && <small className="error">{t[`err_${record.error.code}` as keyof AdaptiveCopy] ? fill(t[`err_${record.error.code}` as keyof AdaptiveCopy], { message: record.error.message }) : record.error.message}</small>}
      </div>
      {running && <button onClick={onCancel} disabled={busy}><Square size={12} />{t.cancel}</button>}
    </div>
    {running && progress?.total ? <progress className="adaptive-progress" max={progress.total} value={progress.done ?? 0} aria-label={t.progressLabel} /> : null}
    {record.data && <p className="adaptive-note">{fill(t.dataSplitLine, {
      fit: record.data.fit.images, fitGroups: record.data.fit.groups, val: record.data.internal_val.images, valGroups: record.data.internal_val.groups,
      holdout: record.data.holdout.images, holdoutGroups: record.data.holdout.groups,
    })}</p>}
    {record.lora && <p className="adaptive-note">{fill(t.loraLine, {
      strategy: t[`strategy_${record.lora.strategy}` as keyof AdaptiveCopy] ?? record.lora.strategy, rank: record.lora.rank, alpha: record.lora.alpha,
      layers: record.lora.target_count, share: pct(record.lora.trainable_params / Math.max(1, record.lora.total_params), 2),
      lr: record.resolved?.learning_rate?.toExponential(1) ?? "—", epochs: maxEpochs ?? "—",
    })}</p>}
    {epochs.length > 0 && <div className="adaptive-charts">
      <MetricChart title={t.chartLoss} epochs={epochNumbers} best={record.best_epoch} series={[
        { label: t.seriesTrainLoss, className: "series-a", values: pick("train_loss") },
        { label: t.seriesValLoss, className: "series-b", values: pick("val_loss") },
      ]} />
      <MetricChart title={t.chartQuality} epochs={epochNumbers} best={record.best_epoch} percent series={[
        { label: t.seriesValDice, className: "series-b", values: pick("val_dice") },
        { label: t.seriesValIou, className: "series-c", values: pick("val_iou") },
        { label: t.seriesTrainDice, className: "series-a", values: pick("train_dice") },
      ]} />
    </div>}
    {epochs.length > 0 && <p className="adaptive-note">{t.chartNote}</p>}
    {diagnosis && <div className={`adaptive-diagnosis ${diagnosis}`}>
      <b>{t[`diag_${diagnosis}` as keyof AdaptiveCopy] ?? diagnosis}</b>
      <p>{t[`diag_${diagnosis}_body` as keyof AdaptiveCopy] ?? ""}</p>
      {record.best_epoch !== undefined && <p>{fill(t.bestEpochLine, { epoch: record.best_epoch, dice: pct(epochs.find((entry) => entry.epoch === record.best_epoch)?.val_dice), base: pct(epochs[0]?.val_dice) })}</p>}
      {record.diagnosis?.no_improvement_over_base && <p>{t.noImprovementOverBase}</p>}
    </div>}
  </div>;
}

export function ComparisonView({ t, comparison, examples }: { t: AdaptiveCopy; comparison: ComparisonSummary; examples: Record<string, string> }) {
  const primary = comparison.primary;
  const outcome = comparison.decision.outcome;
  const reference = comparison.reference.kind === "adapter" ? t.referenceAdapter : t.referenceBase;
  return <div className="adaptive-comparison">
    <div className={`adaptive-verdict ${outcome}`}>
      <b>{t[`outcome_${outcome}` as keyof AdaptiveCopy]}</b>
      <p>{t[`outcome_${outcome}_body` as keyof AdaptiveCopy]}</p>
      <ul>{comparison.decision.reasons.map((reason, index) => <li key={index}>{reasonText(t, reason)}</li>)}</ul>
    </div>
    <div className="adaptive-headline">
      <article><small>{reference}</small><b>{pct(primary.reference_mean)}</b><span>{t.diceLabel}</span></article>
      <article><small>{t.candidateLabel}</small><b>{pct(primary.candidate_mean)}</b><span>{t.diceLabel}</span></article>
      <article><small>{t.deltaLabel}</small><b>{points(primary.mean_delta)}</b><span>{fill(t.ciLine, { low: points(primary.ci_low), high: points(primary.ci_high) })}</span></article>
      <article><small>{t.imagesChangedLabel}</small><b>{pct(primary.share_improved, 0)} ↑ · {pct(primary.share_worsened, 0)} ↓</b><span>{fill(t.imagesOf, { n: primary.images })}</span></article>
    </div>
    <p className="adaptive-note">{fill(t.comparisonMethod, { images: comparison.holdout.images, groups: comparison.holdout.groups, instances: comparison.holdout.instances, relative: primary.relative_gain === null ? "—" : pct(primary.relative_gain) })}</p>
    {comparison.versus_base && <p className="adaptive-note">{fill(t.versusBaseLine, { delta: points(comparison.versus_base.mean_delta), low: points(comparison.versus_base.ci_low), high: points(comparison.versus_base.ci_high) })}</p>}
    <table className="adaptive-table">
      <caption>{t.protocolsCaption}</caption>
      <thead><tr><th>{t.promptColumn}</th><th>{t.metricColumn}</th><th>{reference}</th><th>{t.candidateLabel}</th><th>{t.deltaLabel}</th></tr></thead>
      <tbody>{(["box", "point", "box_jitter"] as const).flatMap((protocol) => (["dice", "iou", "boundary_iou"] as const).map((metric) => {
        const pair = comparison.protocols[protocol][metric];
        return <tr key={`${protocol}-${metric}`}>
          <th>{metric === "dice" ? t[`prompt_${protocol}`] : ""}</th>
          <td>{t[`metric_${metric}`]}</td><td>{pct(pair.reference)}</td><td>{pct(pair.candidate)}</td>
          <td className={pair.candidate - pair.reference < -0.005 ? "worse" : pair.candidate - pair.reference > 0.005 ? "better" : ""}>{points(pair.candidate - pair.reference)}</td>
        </tr>;
      }))}</tbody>
    </table>
    {comparison.subgroups.length > 0 && <table className="adaptive-table">
      <caption>{t.subgroupsCaption}</caption>
      <thead><tr><th>{t.subgroupColumn}</th><th>{t.instancesColumn}</th><th>{reference}</th><th>{t.candidateLabel}</th><th>{t.deltaLabel}</th><th /></tr></thead>
      <tbody>{comparison.subgroups.map((sub) => <tr key={`${sub.kind}-${sub.name}`} className={sub.regression}>
        <th>{sub.kind === "size" ? t[`size_${sub.name}` as keyof AdaptiveCopy] ?? sub.name : sub.name}</th>
        <td>{sub.instances}</td><td>{pct(sub.reference_mean)}</td><td>{pct(sub.candidate_mean)}</td>
        <td>{points(sub.mean_delta)} <small>[{points(sub.ci_low)}, {points(sub.ci_high)}]</small></td>
        <td>{sub.regression !== "none" ? t[`regression_${sub.regression}` as keyof AdaptiveCopy] : sub.instances < 3 ? t.fewInstances : ""}</td>
      </tr>)}</tbody>
    </table>}
    <section className="adaptive-interactive">
      <b>{t.interactiveTitle}</b>
      <p>{fill(t.interactiveBody, {
        refNoc: num(comparison.interactive.reference.noc90, 1), candNoc: num(comparison.interactive.candidate.noc90, 1),
        refFail: pct(comparison.interactive.reference.fail90, 0), candFail: pct(comparison.interactive.candidate.fail90, 0), max: comparison.interactive.max_clicks,
      })}</p>
      <p className="adaptive-note">{t.interactiveDisclaimer}</p>
    </section>
    {comparison.examples.length > 0 && <section className="adaptive-examples">
      <b>{t.examplesTitle}</b>
      <p className="adaptive-note">{fill(t.examplesLegend, { reference })}</p>
      <div>{comparison.examples.map((example) => <figure key={example.file}>
        {/* Blob local do conector: next/image não otimiza object URLs. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {examples[example.file] ? <img src={examples[example.file]} alt={fill(t.exampleAlt, { label: example.label_name })} /> : <span className="adaptive-example-placeholder" />}
        <figcaption>{example.label_name} · {pct(example.reference_dice)} → {pct(example.candidate_dice)} ({points(example.delta)})</figcaption>
      </figure>)}</div>
    </section>}
    <p className="adaptive-note">{t.limitationsNote}</p>
  </div>;
}

function LearningCurveChart({ t, curve }: { t: AdaptiveCopy; curve: LearningCurve }) {
  const points = curve.points ?? [];
  const projection = curve.projection?.double ?? null;
  if (points.length < 2) return null;
  const width = 320;
  const height = 150;
  const pad = { left: 36, right: 12, top: 12, bottom: 24 };
  const maxGroups = Math.max(...points.map((point) => point.groups), projection?.groups ?? 0, 1);
  const values = points.flatMap((point) => [point.ci_low, point.ci_high]).concat(projection ? [projection.low, projection.high] : []);
  let low = Math.min(...values);
  let high = Math.max(...values);
  if (high - low < 0.02) { low -= 0.01; high += 0.01; }
  const x = (groups: number) => pad.left + (groups / maxGroups) * (width - pad.left - pad.right);
  const y = (value: number) => pad.top + (1 - (value - low) / (high - low)) * (height - pad.top - pad.bottom);
  const measured = points.filter((point) => point.kind !== "base");
  const base = points.find((point) => point.kind === "base");
  return <figure className="adaptive-chart">
    <figcaption>{t.curveChart}</figcaption>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${t.curveChart}: ${points.map((point) => `${point.groups} ${pct(point.mean)}`).join(", ")}${projection ? `; ${projection.groups} ${pct(projection.median)}` : ""}`}>
      <line x1={pad.left} x2={width - pad.right} y1={height - pad.bottom} y2={height - pad.bottom} className="axis" />
      <line x1={pad.left} x2={pad.left} y1={pad.top} y2={height - pad.bottom} className="axis" />
      <text x={pad.left - 4} y={pad.top + 4} textAnchor="end" className="tick">{pct(high, 0)}</text>
      <text x={pad.left - 4} y={height - pad.bottom} textAnchor="end" className="tick">{pct(low, 0)}</text>
      <text x={pad.left} y={height - 8} className="tick">0</text>
      <text x={width - pad.right} y={height - 8} textAnchor="end" className="tick">{maxGroups} {t.curveAxis}</text>
      {base && <g className="baseline"><line x1={pad.left} x2={width - pad.right} y1={y(base.mean)} y2={y(base.mean)} /><text x={width - pad.right} y={y(base.mean) - 3} textAnchor="end">{t.referenceBase}</text></g>}
      <g className="series-b">
        <polyline fill="none" points={measured.map((point) => `${x(point.groups).toFixed(1)},${y(point.mean).toFixed(1)}`).join(" ")} />
        {measured.map((point) => <g key={point.groups}>
          <line x1={x(point.groups)} x2={x(point.groups)} y1={y(point.ci_low)} y2={y(point.ci_high)} />
          <circle cx={x(point.groups)} cy={y(point.mean)} r={2.6} />
        </g>)}
      </g>
      {projection && measured.length > 0 && <g className="projection">
        <line x1={x(measured[measured.length - 1].groups)} y1={y(measured[measured.length - 1].mean)} x2={x(projection.groups)} y2={y(projection.median)} />
        <line x1={x(projection.groups)} x2={x(projection.groups)} y1={y(projection.low)} y2={y(projection.high)} />
        <circle cx={x(projection.groups)} cy={y(projection.median)} r={2.6} />
      </g>}
    </svg>
  </figure>;
}

export function LearningCurveView({ t, curve }: { t: AdaptiveCopy; curve: LearningCurve }) {
  if (curve.skipped) {
    return <p className="adaptive-note">{fill(t[`curveSkipped_${curve.skipped}` as keyof AdaptiveCopy] ?? curve.skipped, { message: curve.message ?? "" })}</p>;
  }
  const points = curve.points ?? [];
  const full = points.find((point) => point.kind === "full");
  const base = points.find((point) => point.kind === "base");
  const need = curve.additional_groups_for_one_point;
  return <div className="adaptive-curve">
    <div className={`adaptive-diagnosis ${curve.trend === "rising" ? "improving" : curve.trend === "plateau" ? "converged" : "inconclusive"}`}>
      <b>{t[`curveTrend_${curve.trend ?? "uncertain"}` as keyof AdaptiveCopy]}</b>
      {full && <p>{fill(t.curveNow, { n: full.groups, dice: pct(full.mean), base: pct(base?.mean) })}</p>}
      {curve.projection?.double && <p>{fill(t.curveProjection, { groups: curve.projection.double.groups, median: pct(curve.projection.double.median), low: pct(curve.projection.double.low), high: pct(curve.projection.double.high) })}</p>}
      {need && need.median !== undefined && <p>{fill(t.curveNeed, { median: Math.round(need.median), low: Math.round(need.low ?? need.median), high: Math.round(need.high ?? need.median) })}</p>}
      {need && need.share_beyond_range >= 0.25 && <p>{fill(t.curveNeedBeyond, { share: pct(need.share_beyond_range, 0) })}</p>}
    </div>
    <LearningCurveChart t={t} curve={curve} />
    <p className="adaptive-note">{fill(t.curveNote, { points: points.filter((point) => point.kind !== "base").length })}</p>
  </div>;
}

export function SuggestionsView({ t, suggestions, names, method, analyzed }: {
  t: AdaptiveCopy;
  suggestions: readonly Suggestion[];
  names: ReadonlyMap<string, { id: string; name: string }>;
  method: string | null;
  analyzed: number;
}) {
  return <div className="adaptive-suggestions">
    {method && <p className="adaptive-note">{fill(t.suggestMethod, { count: analyzed, method: t[`method_${method}` as keyof AdaptiveCopy] ?? method })}</p>}
    <ol>{suggestions.map((suggestion) => {
      const asset = names.get(suggestion.key);
      if (!asset) return null;
      return <li key={suggestion.key} className={suggestion.reason}>
        <span><b>{asset.name}</b><small>{t[`suggestReason_${suggestion.reason}` as keyof AdaptiveCopy]}{suggestion.novelty !== null && suggestion.reason !== "near_duplicate" ? ` · ${suggestion.novelty.toFixed(1)}×` : ""}</small></span>
        <button onClick={() => window.dispatchEvent(new CustomEvent(SELECT_ASSET_EVENT, { detail: { assetId: asset.id } }))}>{t.suggestOpen}</button>
      </li>;
    })}</ol>
  </div>;
}

export type NextStep = { stage: 0 | 1 | 2 | 3; key: "analyze" | "annotate" | "train" | "training" | "activate" | "more_evidence" | "kept" | "active" | "failed"; n?: number };

/**
 * Uma ação por vez: o que a pessoa deveria fazer agora, derivado do estado real
 * (dados, rodada selecionada, adaptador ativo). Nada aqui é inventado: cada
 * caso corresponde a um estado que o conector devolveu.
 */
export function nextStep({ report, record, activeHere }: { report: ReadinessReport | null; record: RunRecord | null; activeHere: boolean }): NextStep {
  const compared = Boolean(record?.comparison) && (record?.status === "completed" || record?.stage === "learning_curve");
  if (record && RUNNING.has(record.status) && !compared) return { stage: 1, key: "training" };
  if (activeHere && (!record || record.activation === "active")) return { stage: 3, key: "active" };
  if (record && ["failed", "interrupted"].includes(record.status)) return { stage: 1, key: "failed" };
  const outcome = compared ? record?.comparison?.decision.outcome : undefined;
  if (outcome === "improved" && record?.activation !== "rejected") return { stage: 2, key: "activate" };
  if (outcome === "insufficient_evidence") return { stage: 0, key: "more_evidence" };
  if (outcome === "not_improved") return { stage: 0, key: "kept" };
  if (!report) return { stage: 0, key: "analyze" };
  if (!report.can_train) return { stage: 0, key: "annotate", n: Math.max(1, imagesStillNeeded(report)) };
  return { stage: 1, key: "train" };
}

export function NextStepCard({ t, step }: { t: AdaptiveCopy; step: NextStep }) {
  const stages = [t.stepData, t.stepTraining, t.stepComparison, t.stepUse];
  return <section className="adaptive-next" aria-live="polite">
    <ol className="adaptive-steps">{stages.map((label, index) => <li key={label} className={index < step.stage ? "done" : index === step.stage ? "current" : ""} aria-current={index === step.stage ? "step" : undefined}><i>{index + 1}</i>{label}</li>)}</ol>
    <p><b>{t.nextTitle}:</b> {fill(t[`next_${step.key}` as keyof AdaptiveCopy], { n: step.n ?? 0 })}</p>
  </section>;
}

export function AdaptiveAiPanel({ language, endpoint, project }: { language: Language; endpoint: string; project: AdaptiveProject | null }) {
  const t = getAdaptiveCopy(language);
  const copy = getCopy(language);
  const base = connectorBaseUrl(endpoint);
  const [groupSequences, setGroupSequences] = useState(true);
  const plan = useMemo(
    () => project ? planAdaptiveDataset(project.assets, project.labels, project.annotations, { groupSequences }) : null,
    [project, groupSequences],
  );
  const [connector, setConnector] = useState<ConnectorState>("checking");
  const [status, setStatus] = useState<AdaptiveStatus | null>(null);
  const [report, setReport] = useState<ReadinessReport | null>(null);
  const [syncProgress, setSyncProgress] = useState<{ done: number; total: number } | null>(null);
  const [syncNote, setSyncNote] = useState("");
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [loadedRecord, setRecord] = useState<RunRecord | null>(null);
  const [loadedExamples, setExamples] = useState<{ runId: string; urls: Record<string, string> } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmOverride, setConfirmOverride] = useState(false);
  const [settings, setSettings] = useState({ strategy: "auto", rank: 8, alpha: 16, learning_rate: 0, max_epochs: 0, batch_size: 4, learning_curve: true });
  const [suggested, setSuggested] = useState<{ items: Suggestion[]; method: string | null; analyzed: number } | null>(null);
  const syncAbort = useRef<AbortController | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const next = await adaptiveApi.status(base);
      setStatus(next);
      setConnector("ready");
      return next;
    } catch (failure) {
      setConnector(failure instanceof AdaptiveRequestError && failure.detail.code === "not_installed" ? "not_installed" : "offline");
      setStatus(null);
      return null;
    }
  }, [base]);

  const projectId = project?.id ?? null;
  const refreshRuns = useCallback(async () => {
    if (!projectId) return;
    try {
      const next = await adaptiveApi.runs(base, projectId);
      setRuns(next.runs);
      setSelectedRunId((current) => current ?? next.runs[0]?.run_id ?? null);
    } catch {
      setRuns([]);
    }
  }, [base, projectId]);

  useEffect(() => { void refreshStatus().then((next) => { if (next) void refreshRuns(); }); }, [refreshStatus, refreshRuns]);

  // Reabrir o painel não pode apagar a análise: ela está no conector. Busca o
  // que já foi enviado e a avaliação correspondente, sem reenviar nada.
  const [remoteItems, setRemoteItems] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    if (connector !== "ready" || !projectId) return;
    let cancelled = false;
    void (async () => {
      try {
        const remote = await adaptiveApi.items(base, projectId);
        if (cancelled) return;
        setRemoteItems(remote.items);
        if (Object.keys(remote.items).length) {
          const assessed = await adaptiveApi.assess(base, projectId);
          if (!cancelled) setReport((current) => current ?? assessed);
        }
      } catch {
        // Sem análise anterior: o botão de enviar continua sendo o caminho.
      }
    })();
    return () => { cancelled = true; };
  }, [base, projectId, connector]);
  const pendingSync = plan && remoteItems ? (() => { const diff = diffAgainstConnector(plan, remoteItems); return diff.upload.length + diff.remove.length; })() : 0;
  useEffect(() => () => { syncAbort.current?.abort(); }, []);

  useEffect(() => {
    if (!projectId || !selectedRunId || connector !== "ready") return;
    let cancelled = false;
    let timer: number | undefined;
    const load = async () => {
      try {
        const next = await adaptiveApi.run(base, projectId, selectedRunId);
        if (cancelled) return;
        setRecord(next);
        if (RUNNING.has(next.status)) timer = window.setTimeout(load, 2_000);
        else { void refreshRuns(); void refreshStatus(); }
      } catch (failure) {
        if (!cancelled) setError(errorText(t, failure));
      }
    };
    void load();
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
    // t muda só com o idioma; recarregar a rodada por isso não faz sentido.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, projectId, selectedRunId, connector]);

  // Derivados em vez de zerados por efeito: trocar de rodada ou perder o
  // conector some com o que estava na tela no mesmo render.
  const record = loadedRecord && loadedRecord.run_id === selectedRunId && connector === "ready" ? loadedRecord : null;
  const examples = loadedExamples && record && loadedExamples.runId === record.run_id ? loadedExamples.urls : {};

  const exampleFiles = record?.comparison?.examples.map((example) => example.file).join(",") ?? "";
  useEffect(() => {
    if (!projectId || !record?.comparison?.examples.length) return;
    let cancelled = false;
    const urls: string[] = [];
    const runId = record.run_id;
    void Promise.all(record.comparison.examples.map(async (example) => {
      try {
        const url = await adaptiveApi.example(base, projectId, runId, example.file);
        urls.push(url);
        return [example.file, url] as const;
      } catch {
        return null;
      }
    })).then((entries) => {
      if (!cancelled) setExamples({ runId, urls: Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry !== null)) });
    });
    return () => { cancelled = true; urls.forEach((url) => URL.revokeObjectURL(url)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, projectId, record?.run_id, exampleFiles]);

  async function reloadRecord() {
    if (projectId && selectedRunId) setRecord(await adaptiveApi.run(base, projectId, selectedRunId));
  }

  async function act(name: string, action: () => Promise<unknown>) {
    setBusy(name);
    setError("");
    try {
      await action();
    } catch (failure) {
      setError(errorText(t, failure));
    } finally {
      setBusy(null);
    }
  }

  const analyze = () => act("sync", async () => {
    if (!project || !plan) return;
    syncAbort.current?.abort();
    const controller = new AbortController();
    syncAbort.current = controller;
    setSyncNote("");
    try {
      const result = await syncAdaptiveDataset({ base, projectId: project.id, plan, copy, signal: controller.signal, onProgress: (done, total) => setSyncProgress({ done, total }) });
      setSyncNote(fill(t.syncResult, { uploaded: result.uploaded, removed: result.removed, unchanged: result.unchanged })
        + (result.failed.length ? ` ${fill(t.syncFailed, { n: result.failed.length, names: result.failed.slice(0, 3).map((entry) => entry.name).join(", ") })}` : ""));
      setReport(await adaptiveApi.assess(base, project.id));
      setRemoteItems((await adaptiveApi.items(base, project.id)).items);
    } finally {
      setSyncProgress(null);
    }
  });

  const startTraining = () => act("train", async () => {
    if (!project) return;
    const config: Record<string, unknown> = { strategy: settings.strategy, rank: settings.rank, alpha: settings.alpha, batch_size: settings.batch_size, learning_curve: settings.learning_curve };
    if (settings.learning_rate > 0) config.learning_rate = settings.learning_rate;
    if (settings.max_epochs > 0) config.max_epochs = settings.max_epochs;
    const started = await adaptiveApi.start(base, project.id, config);
    setRecord(started);
    setSelectedRunId(started.run_id);
    await refreshRuns();
  });

  const candidates = useMemo(() => project && plan ? planAdaptiveCandidates(project.assets, plan) : [], [project, plan]);
  const candidateNames = useMemo(() => new Map(candidates.map((candidate) => [candidate.key, { id: candidate.asset.id, name: candidate.asset.name }])), [candidates]);
  const suggest = () => act("suggest", async () => {
    if (!project) return;
    try {
      const result = await syncAdaptiveCandidates({ base, projectId: project.id, candidates, copy, onProgress: (done, total) => setSyncProgress({ done, total }) });
      const response = await adaptiveApi.suggestions(base, project.id, 8);
      setSuggested({ items: response.suggestions, method: response.method, analyzed: candidates.length - result.failed });
    } finally {
      setSyncProgress(null);
    }
  });

  const activeHere = status?.active && project && status.active.project_id === project.id ? status.active : null;
  const activeElsewhere = status?.active && project && status.active.project_id !== project.id ? status.active : null;
  const trainingElsewhere = status?.training && project && status.training.project_id !== project.id;
  const running = record ? RUNNING.has(record.status) : false;
  const outcome = record?.comparison?.decision.outcome;
  const modelSupported = status?.model?.supported ?? false;

  return <div className="byom-panel adaptive-panel">
    <section className="sam-model-hero">
      <div><span className={`family ${status?.model?.family === "sam3" ? "sam3" : "sam2"}`}>{status?.model?.family === "sam3" ? "SAM 3" : "SAM 2.1"} · LoRA</span><span className="experimental">{t.badge}</span></div>
      <h3>{t.title}</h3>
      <p>{t.intro}</p>
    </section>
    <section className="sam-privacy"><ShieldCheck size={16} /><div><b>{t.privacyTitle}</b><p>{t.privacyBody}</p></div></section>

    {!project || !project.assets.length ? <p className="adaptive-callout">{t.noProject}</p>
      : connector === "checking" ? <p className="adaptive-callout"><LoaderCircle className="spin" size={14} />{t.checking}</p>
      : connector === "offline" ? <p className="adaptive-callout warn"><AlertTriangle size={14} />{t.offline} <button onClick={() => void refreshStatus()}><RefreshCw size={12} />{t.retry}</button></p>
      : connector === "not_installed" ? <p className="adaptive-callout warn"><AlertTriangle size={14} />{t.notInstalled}</p>
      : <>
        {!status?.model ? <p className="adaptive-callout warn"><AlertTriangle size={14} />{t.modelLoading}</p>
          : !modelSupported ? <p className="adaptive-callout warn"><AlertTriangle size={14} />{fill(t.unsupportedModel, { model: status.model.model_id })}</p>
          : status.model.family === "sam3" ? <p className="adaptive-callout">{t.sam3Note}</p> : null}

        <section className="adaptive-active">
          <Power size={14} />
          <div>
            <b>{activeHere ? fill(t.activeAdapter, { run: runLabel(activeHere.run_id) }) : t.usingBase}</b>
            <small>{activeHere ? (activeHere.applied ? t.activeAppliedNote : t.activeNotAppliedNote) : activeElsewhere ? t.activeElsewhere : t.usingBaseNote}</small>
          </div>
          {(activeHere || activeElsewhere) && <button disabled={busy !== null} onClick={() => act("deactivate", async () => { setStatus(await adaptiveApi.deactivate(base)); await refreshRuns(); await reloadRecord(); })}><X size={12} />{t.deactivate}</button>}
          {activeHere && <button disabled={busy !== null} onClick={() => act("rollback", async () => { setStatus(await adaptiveApi.rollback(base, project.id)); await refreshRuns(); await reloadRecord(); })}><Undo2 size={12} />{t.rollback}</button>}
        </section>

        <NextStepCard t={t} step={nextStep({ report, record, activeHere: Boolean(activeHere) })} />

        <section className="adaptive-section">
          <h4><Database size={13} />{t.datasetTitle}</h4>
          {plan && <p className="adaptive-note">{fill(t.localSummary, {
            images: plan.items.length, masks: plan.usableInstances,
            manual: plan.byOrigin.manual, corrected: plan.byOrigin.corrected_prediction, reviewed: plan.byOrigin.reviewed_prediction,
          })}</p>}
          {plan && Object.values(plan.excluded).some((count) => count > 0) && <ul className="adaptive-excluded">
            {Object.entries(plan.excluded).filter(([, count]) => count > 0).map(([reason, count]) => <li key={reason}>{fill(t[`excluded_${reason}` as keyof AdaptiveCopy], { n: count })}</li>)}
          </ul>}
          <label className="sam-device-choice">
            <input type="checkbox" checked={groupSequences} onChange={(event) => setGroupSequences(event.target.checked)} />
            <span><b>{t.groupSequencesTitle}</b><small>{t.groupSequencesBody}</small></span>
          </label>
          <div className="adaptive-actions">
            <button className="primary" disabled={busy !== null || !plan?.items.length || !modelSupported} onClick={() => void analyze()}>
              {busy === "sync" ? <LoaderCircle className="spin" size={13} /> : <RefreshCw size={13} />}{t.analyze}
            </button>
            {syncProgress && <span>{fill(t.syncing, syncProgress)}</span>}
          </div>
          {syncProgress && syncProgress.total > 0 && <progress className="adaptive-progress" max={syncProgress.total} value={syncProgress.done} aria-label={t.syncingLabel} />}
          {syncNote && <p className="adaptive-note">{syncNote}</p>}
          {report && pendingSync > 0 && <p className="adaptive-callout warn"><AlertTriangle size={14} />{fill(t.pendingSync, { n: pendingSync })}</p>}
          {report && <ReadinessView t={t} report={report} />}
        </section>

        <section className="adaptive-section">
          <h4><Compass size={13} />{t.suggestTitle}</h4>
          <p className="adaptive-note">{t.suggestBody}</p>
          {candidates.length === 0 ? <p className="adaptive-note">{t.suggestNone}</p> : <div className="adaptive-actions">
            <button disabled={busy !== null || !modelSupported} onClick={() => void suggest()}>
              {busy === "suggest" ? <LoaderCircle className="spin" size={13} /> : <Compass size={13} />}{t.suggestButton}
            </button>
            {busy === "suggest" && syncProgress && <span>{fill(t.syncing, syncProgress)}</span>}
          </div>}
          {suggested && <SuggestionsView t={t} suggestions={suggested.items} names={candidateNames} method={suggested.method} analyzed={suggested.analyzed} />}
        </section>

        <section className="adaptive-section">
          <h4><BarChart3 size={13} />{t.trainingTitle}</h4>
          {status?.model && <p className="adaptive-device"><Cpu size={13} /><span><b>{fill(t.deviceLine, {
            device: t[`device_${status.model.device}` as keyof AdaptiveCopy] ?? status.model.device,
            precision: record?.resolved?.precision ? t[`precision_${record.resolved.precision}`] : "",
          })}</b><small>{status.model.device === "cpu" ? t.cpuNote : status.model.family === "sam3" ? t.sam3Note : t.gpuNote}</small></span></p>}
          {!report && <p className="adaptive-note">{t.analyzeFirst}</p>}
          {report && !report.can_train && <p className="adaptive-note">{t.cannotTrain}</p>}
          {report?.can_train && !report.recommend_training && <p className="adaptive-note">{t.notRecommended}</p>}
          {trainingElsewhere && <p className="adaptive-callout warn"><AlertTriangle size={14} />{t.trainingElsewhere}</p>}
          <details className="sam-uninstall adaptive-settings">
            <summary>{t.settingsTitle}</summary>
            <p>{t.settingsBody}</p>
            <div className="adaptive-settings-grid">
              <label>{t.settingStrategy}<select value={settings.strategy} onChange={(event) => setSettings({ ...settings, strategy: event.target.value })}>
                <option value="auto">{t.strategy_auto}</option><option value="decoder">{t.strategy_decoder}</option><option value="encoder_decoder" disabled={status?.model?.family === "sam3"}>{t.strategy_encoder_decoder}</option>
              </select></label>
              <label>{t.settingRank}<input type="number" min={1} max={64} value={settings.rank} onChange={(event) => setSettings({ ...settings, rank: Number(event.target.value) || 8 })} /></label>
              <label>{t.settingAlpha}<input type="number" min={1} max={256} value={settings.alpha} onChange={(event) => setSettings({ ...settings, alpha: Number(event.target.value) || 16 })} /></label>
              <label>{t.settingLearningRate}<input type="number" min={0} max={0.01} step={0.0001} value={settings.learning_rate} onChange={(event) => setSettings({ ...settings, learning_rate: Number(event.target.value) || 0 })} /></label>
              <label>{t.settingMaxEpochs}<input type="number" min={0} max={300} value={settings.max_epochs} onChange={(event) => setSettings({ ...settings, max_epochs: Number(event.target.value) || 0 })} /></label>
              <label>{t.settingBatch}<input type="number" min={1} max={64} value={settings.batch_size} onChange={(event) => setSettings({ ...settings, batch_size: Number(event.target.value) || 4 })} /></label>
              <label className="adaptive-check"><input type="checkbox" checked={settings.learning_curve} onChange={(event) => setSettings({ ...settings, learning_curve: event.target.checked })} />{t.settingLearningCurve}</label>
            </div>
          </details>
          <div className="adaptive-actions">
            <button className="primary" disabled={busy !== null || !report?.can_train || running || Boolean(status?.training)} onClick={() => void startTraining()}>
              {busy === "train" ? <LoaderCircle className="spin" size={13} /> : <Play size={13} />}{t.startTraining}
            </button>
          </div>
          {record && <TrainingView t={t} record={record} busy={busy !== null} onCancel={() => void act("cancel", () => adaptiveApi.cancel(base, project.id, record.run_id))} />}
        </section>

        {record?.comparison && <section className="adaptive-section">
          <h4><GitCompare size={13} />{t.comparisonTitle}</h4>
          <ComparisonView t={t} comparison={record.comparison} examples={examples} />
          <div className="adaptive-actions">
            {record.activation === "active" ? <span className="adaptive-badge"><Check size={12} />{t.isActive}</span> : <>
              {outcome === "improved" && <button className="primary" disabled={busy !== null || !modelSupported} onClick={() => act("activate", async () => { setStatus(await adaptiveApi.activate(base, project.id, record.run_id, false)); setRecord(await adaptiveApi.run(base, project.id, record.run_id)); await refreshRuns(); })}><Power size={13} />{t.activate}</button>}
              {outcome === "insufficient_evidence" && <>
                <label className="adaptive-confirm"><input type="checkbox" checked={confirmOverride} onChange={(event) => setConfirmOverride(event.target.checked)} />{t.confirmOverride}</label>
                <button disabled={busy !== null || !confirmOverride || !modelSupported} onClick={() => act("activate", async () => { setStatus(await adaptiveApi.activate(base, project.id, record.run_id, true)); setConfirmOverride(false); setRecord(await adaptiveApi.run(base, project.id, record.run_id)); await refreshRuns(); })}><Power size={13} />{t.activateAnyway}</button>
              </>}
              {outcome === "not_improved" && <span className="adaptive-note">{t.keptPrevious}</span>}
              {record.activation !== "rejected" && <button disabled={busy !== null} onClick={() => act("reject", async () => { await adaptiveApi.reject(base, project.id, record.run_id); await refreshRuns(); const next = await adaptiveApi.run(base, project.id, record.run_id); setRecord(next); })}><X size={13} />{t.reject}</button>}
            </>}
          </div>
        </section>}

        {record?.learning_curve && <section className="adaptive-section">
          <h4><TrendingUp size={13} />{t.curveTitle}</h4>
          <LearningCurveView t={t} curve={record.learning_curve} />
        </section>}

        {runs.length > 0 && <section className="adaptive-section">
          <h4><History size={13} />{t.historyTitle}</h4>
          <table className="adaptive-table adaptive-history">
            <thead><tr><th>{t.dateColumn}</th><th>{t.statusColumn}</th><th>{t.outcomeColumn}</th><th>{t.deltaLabel}</th><th>{t.activationColumn}</th></tr></thead>
            <tbody>{runs.map((run) => <tr key={run.run_id} className={run.run_id === selectedRunId ? "selected" : ""}>
              <th><button onClick={() => setSelectedRunId(run.run_id)}>{new Date(run.created_at).toLocaleString(language)}</button></th>
              <td>{t[`status_${run.status}` as keyof AdaptiveCopy] ?? run.status}</td>
              <td>{run.outcome ? t[`outcome_${run.outcome}` as keyof AdaptiveCopy] : "—"}</td>
              <td>{run.mean_delta === undefined || run.mean_delta === null ? "—" : `${points(run.mean_delta)} [${points(run.ci_low)}, ${points(run.ci_high)}]`}</td>
              <td>{t[`activation_${run.activation}` as keyof AdaptiveCopy] ?? run.activation}</td>
            </tr>)}</tbody>
          </table>
          {runs.some((run, index) => index > 0 && run.holdout_set_id && runs[0].holdout_set_id && run.holdout_set_id !== runs[0].holdout_set_id) && <p className="adaptive-note">{t.holdoutChanged}</p>}
          <button className="adaptive-link" onClick={() => void refreshRuns()}><RotateCcw size={12} />{t.refresh}</button>
        </section>}
      </>}
    {error && <p className="byom-reason" role="alert">{error}</p>}
  </div>;
}
