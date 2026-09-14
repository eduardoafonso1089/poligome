"use client";

import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Check, X } from "lucide-react";
import type { Asset, Label } from "../../lib/types";
import { getCopy, storedLanguage, type Language } from "../../lib/i18n";
import { translateErrorCode } from "../../lib/error-message";
import type { EditorAnnotation } from "../models/annotation-model";
import type { CocoGeometry } from "./coco-import";
import {
  importCocoDocument,
  planCocoDocument,
  type CocoDocumentInput,
  type CocoDocumentPlan,
} from "./coco-document-import";

function afterNextPaint() {
  return new Promise<void>((resolve) => {
    let done = false;
    let fallback = 0;
    let firstFrame = 0;
    let secondFrame = 0;
    const finish = () => {
      if (done) return;
      done = true;
      window.clearTimeout(fallback);
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      document.removeEventListener("visibilitychange", resumeWhenVisible);
      resolve();
    };
    const queuePaint = () => {
      firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(finish);
      });
    };
    const resumeWhenVisible = () => {
      if (document.visibilityState !== "visible") return;
      // A hidden tab can have a queued frame or throttled timer. Start a fresh
      // turn as soon as it returns instead of waiting for either one.
      window.clearTimeout(fallback);
      fallback = window.setTimeout(finish, 0);
      queuePaint();
    };
    document.addEventListener("visibilitychange", resumeWhenVisible);
    if (document.visibilityState === "visible") queuePaint();
    // Browsers pause animation frames in background tabs. The timeout keeps the
    // import advancing when allowed and visibilitychange guarantees recovery
    // immediately when the user returns to the editor.
    fallback = window.setTimeout(finish, 100);
  });
}

type PendingCoco = {
  file: File;
  document: CocoDocumentInput;
  plan: CocoDocumentPlan;
};

export type CocoImportHandle = { open: () => void };

type CocoImportControlProps = {
  assets: Asset[];
  labels: Label[];
  annotations: EditorAnnotation[];
  makeId: (prefix: string) => string;
  language?: Language;
  disabled?: boolean;
  showTrigger?: boolean;
  onImported: (result: { labels: Label[]; annotations: EditorAnnotation[]; message: string }) => void;
};

export const CocoImportControl = forwardRef<CocoImportHandle, CocoImportControlProps>(function CocoImportControl({
  assets,
  labels,
  annotations,
  makeId,
  language,
  disabled = false,
  showTrigger = true,
  onImported,
}, ref) {
  const inputRef = useRef<HTMLInputElement>(null);
  const importingRef = useRef(false);
  const cancelledRef = useRef(false);
  const selectionTouchedRef = useRef(false);
  const importSelectionRef = useRef<{ geometryTypes: CocoGeometry[]; selectedIndexes: number[] }>({ geometryTypes: [], selectedIndexes: [] });
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pending, setPending] = useState<PendingCoco | null>(null);
  const [geometryTypes, setGeometryTypes] = useState<CocoGeometry[]>([]);
  const [selectedIndexes, setSelectedIndexes] = useState<number[]>([]);
  const [tab, setTab] = useState<"categories" | "annotations">("categories");
  const copy = getCopy(language ?? storedLanguage());

  useImperativeHandle(ref, () => ({ open: () => inputRef.current?.click() }), []);

  const visibleCandidates = useMemo(() => pending?.plan.candidates.filter((candidate) =>
    candidate.geometries.some((geometry) => geometryTypes.includes(geometry)),
  ) ?? [], [geometryTypes, pending]);
  const activeImportSelection = pending ? currentImportSelection(pending) : { geometryTypes: [], selectedIndexes: [] };
  const canImport = activeImportSelection.geometryTypes.length > 0 && activeImportSelection.selectedIndexes.length > 0;

  async function inspectFile(file: File) {
    setBusy(true);
    try {
      const document = JSON.parse(await file.text()) as CocoDocumentInput;
      const plan = planCocoDocument(document, assets, { unlabeledName: copy.unlabeled });
      if (!plan.candidates.length) {
        onImported({ labels, annotations, message: copy.noCategoriesSelected });
        return;
      }
      setPending({ file, document, plan });
      updateImportSelection(plan.geometryTypes, plan.candidates.map((candidate) => candidate.index), false);
      setTab("categories");
    } catch (error) {
      onImported({
        labels,
        annotations,
        message: translateErrorCode(error, copy, copy.projectOpenError),
      });
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setPending(null);
    updateImportSelection([], [], false);
    setTab("categories");
  }

  // Always dismissable: if a load is running, flag it to stop and close right away.
  function requestClose() {
    cancelledRef.current = true;
    close();
  }

  function updateImportSelection(nextGeometryTypes: CocoGeometry[], nextSelectedIndexes: number[], touched = true) {
    selectionTouchedRef.current = touched;
    importSelectionRef.current = { geometryTypes: nextGeometryTypes, selectedIndexes: nextSelectedIndexes };
    setGeometryTypes(nextGeometryTypes);
    setSelectedIndexes(nextSelectedIndexes);
  }

  function currentImportSelection(currentPending: PendingCoco) {
    if (!selectionTouchedRef.current) {
      return {
        geometryTypes: currentPending.plan.geometryTypes,
        selectedIndexes: currentPending.plan.candidates.map((candidate) => candidate.index),
      };
    }
    return importSelectionRef.current;
  }

  function toggleGeometry(geometry: CocoGeometry) {
    const currentSelection = importSelectionRef.current;
    const enabled = currentSelection.geometryTypes.includes(geometry);
    const candidates = pending?.plan.candidates ?? [];
    const affected = candidates.filter((candidate) => candidate.geometries.includes(geometry)).map((candidate) => candidate.index);
    if (enabled) {
      const nextGeometryTypes = currentSelection.geometryTypes.filter((item) => item !== geometry);
      updateImportSelection(
        nextGeometryTypes,
        currentSelection.selectedIndexes.filter((index) => candidates.find((candidate) => candidate.index === index)?.geometries.some((item) => nextGeometryTypes.includes(item))),
      );
    } else {
      updateImportSelection(
        [...currentSelection.geometryTypes, geometry],
        Array.from(new Set([...currentSelection.selectedIndexes, ...affected])),
      );
    }
  }

  function toggleCandidate(index: number) {
    const currentSelection = importSelectionRef.current;
    updateImportSelection(
      currentSelection.geometryTypes,
      currentSelection.selectedIndexes.includes(index)
        ? currentSelection.selectedIndexes.filter((item) => item !== index)
        : [...currentSelection.selectedIndexes, index],
    );
  }

  async function importSelected() {
    if (!pending) return;
    const { geometryTypes: selectedGeometryTypes, selectedIndexes: currentSelectedIndexes } = currentImportSelection(pending);
    if (importingRef.current || !currentSelectedIndexes.length || !selectedGeometryTypes.length) return;
    importingRef.current = true;
    cancelledRef.current = false;
    // Close the dialog immediately on OK; the load then streams in the background
    // so the annotations appear progressively while the user keeps working.
    flushSync(() => {
      setImporting(true);
      close();
    });
    await afterNextPaint();
    let nextLabels = labels;
    const importedAnnotations: EditorAnnotation[] = [];
    let unmatched = 0;
    try {
      const sourceAnnotations = pending.document.annotations ?? [];
      const selectedAnnotations = currentSelectedIndexes.flatMap((index) => sourceAnnotations[index] ? [sourceAnnotations[index]] : []);
      const chunkSize = selectedGeometryTypes.includes("polygon") ? 25 : 500;

      for (let offset = 0; offset < selectedAnnotations.length; offset += chunkSize) {
        if (cancelledRef.current) break;
        const chunk = selectedAnnotations.slice(offset, offset + chunkSize);
        const chunkResult = importCocoDocument(
          { ...pending.document, annotations: chunk },
          assets,
          nextLabels,
          makeId,
          { geometryTypes: selectedGeometryTypes, unlabeledName: copy.unlabeled },
        );
        nextLabels = chunkResult.labels;
        importedAnnotations.push(...chunkResult.annotations);
        unmatched += chunkResult.unmatched;
        // Apply what has loaded so far, then yield so the browser stays responsive.
        onImported({
          labels: nextLabels,
          annotations: [...annotations, ...importedAnnotations],
          message: `${importedAnnotations.length} ${copy.annotationsToLoad}${unmatched ? ` · ${unmatched}` : ""}.`,
        });
        await afterNextPaint();
      }
      onImported({
        labels: nextLabels,
        annotations: [...annotations, ...importedAnnotations],
        message: `${importedAnnotations.length} ${copy.annotationsToLoad}${unmatched ? ` · ${unmatched}` : ""}.`,
      });
    } catch (error) {
      onImported({
        labels: nextLabels,
        annotations: [...annotations, ...importedAnnotations],
        message: translateErrorCode(error, copy, copy.projectOpenError),
      });
    } finally {
      importingRef.current = false;
      setImporting(false);
    }
  }

  const geometryLabel = (geometry: CocoGeometry) => geometry === "box" ? copy.box : geometry === "point" ? copy.point : copy.polygon;

  return <>
    <input
      ref={inputRef}
      type="file"
      accept="application/json,.json"
      hidden
      onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) void inspectFile(file);
        event.currentTarget.value = "";
      }}
    />
    {showTrigger && <button onClick={() => inputRef.current?.click()} disabled={disabled || busy || !assets.length}>
      {busy ? `${copy.progress}…` : "COCO"}
    </button>}

    {pending && <div className="modal-backdrop" role="presentation" onMouseDown={requestClose}>
      <section className="sam-modal coco-import-modal" role="dialog" aria-modal="true" aria-busy={importing} aria-labelledby="coco-import-title" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><strong>{copy.chooseAnnotations}</strong><div style={{ fontSize: 13, opacity: .72, marginTop: 4 }}>{copy.chooseAnnotationsHint}</div><div style={{ fontSize: 12, opacity: .6, marginTop: 2 }}>{pending.file.name}</div></div>
          <button type="button" onClick={requestClose} aria-label={copy.close}><X size={19} /></button>
        </header>

        <div className="coco-import-tabs">
          <button type="button" className={tab === "categories" ? "active" : ""} aria-pressed={tab === "categories"} onClick={() => setTab("categories")}>{copy.annotationCategories}</button>
          <button type="button" className={tab === "annotations" ? "active" : ""} aria-pressed={tab === "annotations"} onClick={() => setTab("annotations")}>{copy.annotations} ({visibleCandidates.length})</button>
        </div>

        {tab === "categories" ? <>
          <div className="coco-import-actions">
            <button type="button" onClick={() => updateImportSelection(pending.plan.geometryTypes, pending.plan.candidates.map((candidate) => candidate.index))}>{copy.selectAllCategories}</button>
            <button type="button" onClick={() => updateImportSelection([], [])}>{copy.clearClassSelection}</button>
          </div>
          <div className="coco-import-list">
            {pending.plan.geometryTypes.map((geometry) => {
              const checked = geometryTypes.includes(geometry);
              const count = pending.plan.candidates.filter((candidate) => candidate.geometries.includes(geometry)).length;
              return <button type="button" key={geometry} className={checked ? "selected" : ""} aria-pressed={checked} onClick={() => toggleGeometry(geometry)}>
                <i>{checked && <Check size={13} />}</i><span><b>{geometryLabel(geometry)}</b><small>{count} {copy.annotationsToLoad}</small></span>
              </button>;
            })}
          </div>
        </> : <>
          <div className="coco-import-actions">
            <button type="button" onClick={() => updateImportSelection(importSelectionRef.current.geometryTypes, Array.from(new Set([...importSelectionRef.current.selectedIndexes, ...visibleCandidates.map((candidate) => candidate.index)])))}>{copy.selectAllAnnotations}</button>
            <button type="button" onClick={() => updateImportSelection(importSelectionRef.current.geometryTypes, importSelectionRef.current.selectedIndexes.filter((index) => !visibleCandidates.some((candidate) => candidate.index === index)))}>{copy.clearAnnotationSelection}</button>
          </div>
          <div className="coco-import-list">
            {visibleCandidates.map((candidate) => {
              const checked = selectedIndexes.includes(candidate.index);
              const geometries = candidate.geometries.filter((geometry) => geometryTypes.includes(geometry));
              return <button type="button" key={candidate.index} className={checked ? "selected" : ""} aria-pressed={checked} onClick={() => toggleCandidate(candidate.index)}>
                <i>{checked && <Check size={13} />}</i><span><b>{candidate.labelName}</b><small>{candidate.imageName} · {geometries.map(geometryLabel).join(" + ")}</small></span>
              </button>;
            })}
            {!visibleCandidates.length && <p className="coco-import-empty">{copy.noCategoriesSelected}</p>}
          </div>
        </>}

        <footer>
          <button type="button" onClick={requestClose}>{copy.cancel}</button>
          <button type="button" disabled={importing || !canImport} onClick={() => void importSelected()}>OK</button>
        </footer>
      </section>
    </div>}
  </>;
});
