"use client";

import { useState } from "react";
import { Download, FileText, Globe, HardDriveDownload } from "lucide-react";
import type { Asset, Label } from "../../lib/types";
import { getCopy, storedLanguage, type Language } from "../../lib/i18n";
import { translateErrorCode } from "../../lib/error-message";
import type { EditorAnnotation } from "../models/annotation-model";
import { exportEditorCoco, exportEditorGeoJson, exportEditorYoloZip } from "./export-files";

export function ExportControls({
  assets,
  labels,
  annotations,
  language,
  disabled = false,
  onMessage,
}: {
  assets: Asset[];
  labels: Label[];
  annotations: EditorAnnotation[];
  language?: Language;
  disabled?: boolean;
  onMessage?: (message: string) => void;
}) {
  const [busy, setBusy] = useState<"coco" | "yolo" | "geojson" | null>(null);
  const copy = getCopy(language ?? storedLanguage());

  function coco() {
    try {
      exportEditorCoco(assets, labels, annotations);
      onMessage?.(copy.toastExportFile);
    } catch (error) {
      onMessage?.(translateErrorCode(error, copy, copy.toastExportFailed));
    }
  }

  async function yolo() {
    setBusy("yolo");
    try {
      await exportEditorYoloZip(assets, labels, annotations, copy.yoloReadme);
      onMessage?.(copy.toastExportYolo);
    } catch (error) {
      onMessage?.(translateErrorCode(error, copy, copy.toastExportFailed));
    } finally { setBusy(null); }
  }

  function geojson() {
    try {
      exportEditorGeoJson(assets, labels, annotations);
      onMessage?.(copy.toastExportGeoJson);
    } catch (error) {
      onMessage?.(translateErrorCode(error, copy, copy.toastExportFailed));
    }
  }

  function project() {
    const saveRow = Array.from(document.querySelectorAll<HTMLButtonElement>(".project-pop button"))
      .find((button) => button.querySelector("b")?.textContent === copy.saveProject);
    saveRow?.click();
  }

  const blocked = disabled || busy !== null || !assets.length;
  return <>
    <button role="menuitem" title={`${copy.export}: COCO · ${copy.cocoDesc}`} onClick={coco} disabled={blocked}>
      <FileText size={14} /><span><b>COCO JSON</b><small>{copy.cocoDesc}</small></span>
    </button>
    <button role="menuitem" title={`${copy.export}: YOLO · ${copy.yoloDesc}`} onClick={() => void yolo()} disabled={blocked}>
      <HardDriveDownload size={14} /><span><b>{busy === "yolo" ? "YOLO ZIP…" : "YOLO ZIP"}</b><small>{copy.yoloDesc}</small></span>
    </button>
    <button role="menuitem" title={`${copy.export}: GeoJSON · ${copy.geojsonDesc}`} onClick={geojson} disabled={blocked || !annotations.length}>
      <Globe size={14} /><span><b>GeoJSON</b><small>{copy.geojsonDesc}</small></span>
    </button>
    <button role="menuitem" title={`${copy.export}: Poligome`} onClick={project} disabled={blocked}>
      <Download size={14} /><span><b>Poligome</b><small>{copy.projectBackup}</small></span>
    </button>
  </>;
}
