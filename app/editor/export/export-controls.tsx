"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, FileText, Globe, HardDriveDownload, Info, SlidersHorizontal, X } from "lucide-react";
import type { Asset, Label } from "../../lib/types";
import { getCopy, storedLanguage, type Copy, type Language } from "../../lib/i18n";
import { translateErrorCode } from "../../lib/error-message";
import type { EditorAnnotation } from "../models/annotation-model";
import { defaultYoloExportOptions, exportEditorCocoZip, exportEditorGeoJson, exportEditorYoloZip, type YoloExportOptions } from "./export-files";

export function validExportRatios(options: YoloExportOptions) {
  const values = options.includeTest ? [options.train, options.val, options.test] : [options.train, options.val];
  return values.every((value) => Number.isFinite(value) && value >= 0 && value <= 100) && values.reduce((sum, value) => sum + value, 0) === 100;
}

export function ExportChoiceDialog({ format, options, copy, busy, onChange, onClose, onSingle, onSplit }: {
  format: "coco" | "yolo";
  options: YoloExportOptions;
  copy: Copy;
  busy: boolean;
  onChange: (change: Partial<YoloExportOptions>) => void;
  onClose: () => void;
  onSingle: () => void;
  onSplit: () => void;
}) {
  return <div className="modal-backdrop" role="presentation" onPointerDown={(event) => event.stopPropagation()} onMouseDown={onClose}>
    <section className="sam-modal export-options-modal" role="dialog" aria-modal="true" aria-labelledby="export-choice-title" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><span><HardDriveDownload size={18} /></span><div><h2 id="export-choice-title">{copy.exportChoiceTitle} {format.toUpperCase()}</h2><p>{copy.exportChoiceHint}</p></div></div><button type="button" onClick={onClose} aria-label={copy.close}><X size={19} /></button></header>
      {format === "yolo" && <fieldset className="export-option-group"><legend>{copy.exportAnnotations}</legend><div className="export-choice-grid" role="radiogroup" aria-label={copy.exportAnnotations}>
        {(["bbox", "polygon", "both"] as const).map((mode) => <button type="button" role="radio" aria-checked={options.mode === mode} className={options.mode === mode ? "active" : ""} onClick={() => onChange({ mode })} key={mode}>{mode === "bbox" ? copy.exportBBox : mode === "polygon" ? copy.exportPolygons : copy.exportBoth}</button>)}
      </div></fieldset>}
      {format === "yolo" && options.mode === "both" && <div className="export-notice"><Info size={16} /><p>{copy.exportBothHint}</p></div>}
      <div className="export-structure-grid">
        <button type="button" disabled={busy} onClick={onSingle}><Download size={18} /><span><b>{copy.exportSingleDataset}</b><small>{copy.exportSingleDatasetHint}</small></span></button>
        <button type="button" disabled={busy} onClick={onSplit}><SlidersHorizontal size={18} /><span><b>{copy.exportSplitDataset}</b><small>{copy.exportSplitDatasetHint}</small></span></button>
      </div>
      <div className="export-privacy"><Info size={15} /><span>{copy.exportImagesExcluded}</span></div>
      <footer><button type="button" onClick={onClose}>{copy.cancel}</button></footer>
    </section>
  </div>;
}

export function ExportOptionsDialog({ format, options, copy, busy, onChange, onClose, onExport }: {
  format: "coco" | "yolo";
  options: YoloExportOptions;
  copy: Copy;
  busy: boolean;
  onChange: (change: Partial<YoloExportOptions>) => void;
  onClose: () => void;
  onExport: () => void;
}) {
  const valid = validExportRatios(options);
  return <div className="modal-backdrop" role="presentation" onPointerDown={(event) => event.stopPropagation()} onMouseDown={onClose}>
    <section className="sam-modal export-options-modal" role="dialog" aria-modal="true" aria-labelledby="export-options-title" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><span><SlidersHorizontal size={18} /></span><div><h2 id="export-options-title">{copy.exportSettingsTitle} {format.toUpperCase()}</h2><p>{copy.exportSettingsHint}</p></div></div><button type="button" onClick={onClose} aria-label={copy.close}><X size={19} /></button></header>
      <fieldset className="export-option-group"><legend>{copy.exportFormat}</legend><label className="export-test-toggle"><input type="checkbox" checked={options.includeTest} onChange={(event) => onChange(event.target.checked ? { includeTest: true, train: options.train === 80 ? 70 : options.train, test: options.test || 10 } : { includeTest: false, test: 0, train: options.train === 70 ? 80 : options.train })} /><span>{copy.exportIncludeTest}</span></label>
        <div className={`export-ratios ${options.includeTest ? "with-test" : ""}`}>
          <label><span>{copy.exportTrain}</span><div><input aria-label={copy.exportTrain} type="number" min="0" max="100" value={options.train} onChange={(event) => onChange({ train: Number(event.target.value) })} /><b>%</b></div></label>
          <label><span>{copy.exportValidation}</span><div><input aria-label={copy.exportValidation} type="number" min="0" max="100" value={options.val} onChange={(event) => onChange({ val: Number(event.target.value) })} /><b>%</b></div></label>
          {options.includeTest && <label><span>{copy.exportTest}</span><div><input aria-label={copy.exportTest} type="number" min="0" max="100" value={options.test} onChange={(event) => onChange({ test: Number(event.target.value) })} /><b>%</b></div></label>}
        </div>
        {!valid && <p className="export-ratio-error" role="alert">{copy.exportInvalidRatios}</p>}
      </fieldset>
      <fieldset className="export-option-group"><legend>{copy.exportDistribution}</legend><div className="export-choice-grid two" role="radiogroup" aria-label={copy.exportDistribution}>{(["random", "balanced"] as const).map((strategy) => <button type="button" role="radio" aria-checked={options.strategy === strategy} className={options.strategy === strategy ? "active" : ""} onClick={() => onChange({ strategy })} key={strategy}>{strategy === "random" ? copy.exportRandom : copy.exportBalanced}</button>)}</div></fieldset>
      <div className="export-privacy"><Info size={15} /><span>{copy.exportImagesExcluded}</span></div>
      <footer><button type="button" onClick={onClose}>{copy.cancel}</button><button type="button" className="connect" disabled={!valid || busy} onClick={onExport}><Download size={15} />{copy.generateExport}</button></footer>
    </section>
  </div>;
}

export function ExportControls({ assets, labels, annotations, language, disabled = false, onMessage }: { assets: Asset[]; labels: Label[]; annotations: EditorAnnotation[]; language?: Language; disabled?: boolean; onMessage?: (message: string) => void }) {
  const [busy, setBusy] = useState<"coco" | "yolo" | null>(null);
  const [format, setFormat] = useState<"coco" | "yolo" | null>(null);
  const [stage, setStage] = useState<"choice" | "split">("choice");
  const [options, setOptions] = useState<YoloExportOptions>(defaultYoloExportOptions);
  const copy = getCopy(language ?? storedLanguage());
  const update = (change: Partial<YoloExportOptions>) => setOptions((current) => ({ ...current, ...change }));
  function closeExport() { setFormat(null); setStage("choice"); }
  function openExport(nextFormat: "coco" | "yolo") { setFormat(nextFormat); setStage("choice"); }
  useEffect(() => { if (!format) return; const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setFormat(null); setStage("choice"); } }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, [format]);
  async function runExport(splitDataset: boolean) { if (!format || (splitDataset && !validExportRatios(options))) return; setBusy(format); const exportOptions = { ...options, splitDataset }; try { if (format === "yolo") await exportEditorYoloZip(assets, labels, annotations, copy.yoloReadme, exportOptions); else await exportEditorCocoZip(assets, labels, annotations, exportOptions); onMessage?.(format === "yolo" ? copy.toastExportYolo : copy.toastExportFile); } catch (error) { onMessage?.(translateErrorCode(error, copy, copy.toastExportFailed)); } finally { setBusy(null); closeExport(); } }
  function geojson() { try { exportEditorGeoJson(assets, labels, annotations); onMessage?.(copy.toastExportGeoJson); } catch (error) { onMessage?.(translateErrorCode(error, copy, copy.toastExportFailed)); } }
  function project() { Array.from(document.querySelectorAll<HTMLButtonElement>(".project-pop button")).find((button) => button.querySelector("b")?.textContent === copy.saveProject)?.click(); }
  const blocked = disabled || busy !== null || !assets.length;
  return <>
    <button role="menuitem" title={`${copy.export}: COCO · ${copy.cocoDesc}`} onClick={() => openExport("coco")} disabled={blocked}><FileText size={14} /><span><b>COCO ZIP</b><small>{copy.cocoDesc}</small></span></button>
    <button role="menuitem" title={`${copy.export}: YOLO · ${copy.yoloDesc}`} onClick={() => openExport("yolo")} disabled={blocked}><HardDriveDownload size={14} /><span><b>YOLO ZIP</b><small>{copy.yoloDesc}</small></span></button>
    <button role="menuitem" title={`${copy.export}: GeoJSON · ${copy.geojsonDesc}`} onClick={geojson} disabled={blocked || !annotations.length}><Globe size={14} /><span><b>GeoJSON</b><small>{copy.geojsonDesc}</small></span></button>
    <button role="menuitem" title={`${copy.export}: Poligome`} onClick={project} disabled={blocked}><Download size={14} /><span><b>Poligome</b><small>{copy.projectBackup}</small></span></button>
    {format && typeof document !== "undefined" && createPortal(stage === "choice"
      ? <ExportChoiceDialog format={format} options={options} copy={copy} busy={busy !== null} onChange={update} onClose={closeExport} onSingle={() => void runExport(false)} onSplit={() => setStage("split")} />
      : <ExportOptionsDialog format={format} options={options} copy={copy} busy={busy !== null} onChange={update} onClose={closeExport} onExport={() => void runExport(true)} />, document.body)}
  </>;
}
