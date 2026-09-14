"use client";

import type { CSSProperties } from "react";
import type { Asset, Label } from "../../lib/types";
import type { Copy, Language } from "../../lib/i18n";
import type { EditorAnnotation } from "../models/annotation-model";
import { buildQualitySummary } from "./quality-review-model";
import ui from "../editor-interface.module.css";

function classes(...items: Array<string | false | null | undefined>) {
  return items.filter(Boolean).join(" ");
}

function ScoreButtons({ value, onChange, label }: { value?: number; onChange: (score: number) => void; label: string }) {
  return <div className={ui.scoreRow} aria-label={label}>
    {[1, 2, 3, 4, 5].map((score) => <button
      key={score}
      type="button"
      aria-label={`${label}: ${score} de 5`}
      aria-pressed={value === score}
      onClick={() => onChange(score)}
      className={classes(ui.scoreButton, score > (value ?? 0) && ui.scoreOff)}
    >★</button>)}
    <small className={ui.helperText}>{value ? `${value}/5` : "sem nota"}</small>
  </div>;
}

export function QualityReviewPanel({
  mode,
  assets,
  labels,
  annotations,
  activeAsset,
  activeAnnotation,
  activeLabelId,
  copy,
  language,
  onModeChange,
  onActiveLabelChange,
  onAssetReview,
  onAnnotationReview,
  onLabelReview,
  onFocusAsset,
  onFocusLabel,
  showTabs = true,
}: {
  mode: "quality" | "review";
  assets: Asset[];
  labels: Label[];
  annotations: EditorAnnotation[];
  activeAsset: Asset | null;
  activeAnnotation: EditorAnnotation | null;
  activeLabelId: string;
  copy: Copy;
  language: Language;
  onModeChange: (mode: "quality" | "review") => void;
  onActiveLabelChange: (id: string) => void;
  onAssetReview: (score: number) => void;
  onAnnotationReview: (score: number) => void;
  onLabelReview: (score: number) => void;
  onFocusAsset?: (id: string) => void;
  onFocusLabel?: (id: string) => void;
  showTabs?: boolean;
}) {
  const quality = buildQualitySummary(assets, labels, annotations);
  const activeLabel = labels.find((label) => label.id === activeLabelId) ?? labels[0] ?? null;

  return <aside className={ui.reviewPanel} aria-label={`${copy.quality} / ${copy.reviewTab}`}>
    {showTabs && <div className={ui.reviewTabs}>
      <button type="button" aria-pressed={mode === "quality"} onClick={() => onModeChange("quality")}>{copy.quality}</button>
      <button type="button" aria-pressed={mode === "review"} onClick={() => onModeChange("review")}>{copy.reviewTab}</button>
    </div>}

    {mode === "quality" ? <div>
      <section className={ui.reviewSection}>
        <b>{copy.qualityBalanceByImage}</b>
        <small className={ui.helperText}>{copy.qualityInstancesPerImage.replace("{min}", String(quality.minPerImage)).replace("{max}", String(quality.maxPerImage))}</small>
        {quality.perImage.map(({ item, count }) => <button type="button" key={item.id} className={ui.metricRow} onClick={() => onFocusAsset?.(item.id)} aria-label={`${copy.reviewImage}: ${item.name}`}>
          <span title={item.name} className={ui.metricName}>{item.name}</span>
          <i className={ui.metricTrack}><em className={ui.metricFill} style={{ width: `${quality.maxPerImage ? count / quality.maxPerImage * 100 : 0}%` }} /></i>
          <b>{count}</b>
        </button>)}
      </section>

      <section className={ui.reviewSection}>
        <b>{copy.qualityClassBalance}</b>
        {quality.counts.filter(({ label }) => label.id !== "unlabeled").map(({ label, count }) => {
          const dotStyle = { "--label-color": label.color } as CSSProperties;
          return <button type="button" key={label.id} className={ui.metricClassRow} onClick={() => onFocusLabel?.(label.id)} aria-label={`${copy.reviewClass}: ${label.name}`}>
            <i className={ui.metricDot} style={dotStyle} />
            <span>{label.name}</span>
            <b>{count}</b>
            <small>{count === quality.maxCount && count > 0 ? copy.qualityMajority : count <= Math.max(1, quality.maxCount * .25) ? copy.qualityMinority : copy.qualityBalanced}</small>
          </button>;
        })}
      </section>

      <section className={ui.reviewSection}>
        <b>{copy.qualitySegmentationArea}</b>
        <small className={ui.helperText}>{copy.qualitySegmentationHint}</small>
        {quality.counts.map(({ label }) => {
          const dotStyle = { "--label-color": label.color } as CSSProperties;
          return <div key={`${label.id}-area`} className={ui.metricAreaRow}>
            <i className={ui.metricDot} style={dotStyle} />
            <span className={ui.metricGrow}>{label.name}</span>
            <b>{Math.round(quality.areas.get(label.id) ?? 0).toLocaleString(language === "pt" ? "pt-BR" : language)} px²</b>
          </div>;
        })}
      </section>

      <section className={ui.reviewSection}>
        <b>{copy.qualitySuggestedClasses}</b>
        {quality.emptyLabelIds.length ? <p>{copy.qualityEmptyClasses.replace("{classes}", quality.emptyLabelIds.map((id) => labels.find((label) => label.id === id)?.name ?? id).join(", "))}</p>
          : <p>{quality.emptyAssetIds.length ? copy.qualityImagesWithoutInstances : copy.qualityNoClassSuggestion}</p>}
      </section>
    </div> : <div>
      <section className={ui.reviewSection}>
        <b>{copy.reviewImage}</b>
        <small className={ui.helperText}>{activeAsset?.name ?? copy.reviewSelectImage}</small>
        <ScoreButtons label={copy.reviewImageScore} value={activeAsset?.reviewScore} onChange={onAssetReview} />
      </section>
      <section className={ui.reviewSection}>
        <b>{copy.reviewAnnotation}</b>
        <small className={ui.helperText}>{activeAnnotation ? `${labels.find((label) => label.id === activeAnnotation.label)?.name ?? activeAnnotation.label} · ${activeAnnotation.type}` : copy.reviewSelectAnnotation}</small>
        <ScoreButtons label={copy.reviewAnnotationScore} value={activeAnnotation?.reviewScore} onChange={onAnnotationReview} />
      </section>
      <section className={ui.reviewSection}>
        <b>{copy.reviewClass}</b>
        <select aria-label={copy.reviewSelectClass} value={activeLabel?.id ?? ""} onChange={(event) => onActiveLabelChange(event.target.value)} disabled={!labels.length}>
          {labels.map((label) => <option key={label.id} value={label.id}>{label.name}</option>)}
        </select>
        <ScoreButtons label={copy.reviewClassScore} value={activeLabel?.reviewScore} onChange={onLabelReview} />
      </section>
      <p className={ui.reviewHint}>{copy.reviewHint}</p>
    </div>}
  </aside>;
}
