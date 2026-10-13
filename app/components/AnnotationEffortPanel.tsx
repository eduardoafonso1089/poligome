"use client";
import { useEffect, useMemo, useState } from "react";
import { fill, type Language } from "../lib/i18n";
import { getEffortCopy } from "../lib/annotation-effort-copy";
import { EFFORT_CHANGED_EVENT, effortCsv, readEffortJournal, writeEffortJournal, type EffortJournal } from "../lib/annotation-effort";
import { compareEffort, effortBreakEven, summarizeEffort, type EffortMode, type EffortRecord, type EffortSummary, type EffortVersion } from "../editor/models/annotation-effort-model";

export const effortVersionKey = (model: string, project: string, run: string) => JSON.stringify([model, project, run]);
const number = (value: number | null) => value === null ? "—" : value.toFixed(1);

export function AnnotationEffortPanel({ language, projectId, version }: { language: Language; projectId: string; version?: EffortVersion | null }) {
  const t = getEffortCopy(language);
  const [journal, setJournal] = useState<EffortJournal>({ version: 1, enabled: false, records: [], versions: [], persistent: true });
  const [mode, setMode] = useState<EffortMode>("points");
  const [cost, setCost] = useState("");
  useEffect(() => {
    const refresh = () => setJournal(readEffortJournal(projectId));
    refresh();
    const update = (event: Event) => { if ((event as CustomEvent).detail === projectId) refresh(); };
    window.addEventListener(EFFORT_CHANGED_EVENT, update);
    return () => window.removeEventListener(EFFORT_CHANGED_EVENT, update);
  }, [projectId]);
  useEffect(() => {
    if (!version) return;
    const saved = readEffortJournal(projectId);
    if (JSON.stringify(saved.versions.find(v => v.key === version.key)) === JSON.stringify(version)) return;
    saved.versions = [...saved.versions.filter(v => v.key !== version.key), version];
    writeEffortJournal(projectId, saved);
  }, [projectId, version]);
  const rows = useMemo(() => summarizeEffort(journal.records, mode), [journal.records, mode]);
  const name = (row: EffortSummary) => row.mixed ? t.mixed : !row.source.modelId || row.source.adapter === undefined ? t.unknown
    : row.source.adapter === null ? t.original : journal.versions.find(v => v.key === effortVersionKey(row.source.modelId!, row.source.adapter!.projectId, row.source.adapter!.runId))?.name ?? t.adapted;
  const download = () => {
    const url = URL.createObjectURL(new Blob(["\ufeff", effortCsv(journal.records, journal.versions)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "annotation-effort.csv"; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  return <section className="adaptive-section annotation-effort-panel">
    <h4>{t.title}</h4>
    <label className="effort-enable"><input type="checkbox" checked={journal.enabled} onChange={event => {
      const saved = readEffortJournal(projectId); saved.enabled = event.target.checked; setJournal(writeEffortJournal(projectId, saved));
    }} />{t.enable}</label>
    <p>{t.instructions}</p>
    {(journal.enabled || journal.records.length > 0) && <>
    <p className="adaptive-note">{t.compare}</p>
    <div className="effort-actions"><div role="group" aria-label={t.prompts}>
      <button aria-pressed={mode === "points"} onClick={() => setMode("points")}>{t.points}</button>
      <button aria-pressed={mode === "box"} onClick={() => setMode("box")}>{t.box}</button>
    </div><button disabled={!journal.records.length} onClick={download}>{t.export}</button></div>
    {!rows.length ? <p className="adaptive-note">{t.empty}</p> : <div className="effort-table-scroll" tabIndex={0} role="region" aria-label={t.title}><table className="adaptive-table effort-table">
      <thead><tr>{[t.model, t.data, t.samples, t.time, t.prompts, t.corrections, t.wait, t.discarded].map(label => <th key={label}>{label}</th>)}</tr></thead>
      <tbody>{rows.map(row => {
        const metadata = row.source.adapter && journal.versions.find(v => v.key === effortVersionKey(row.source.modelId!, row.source.adapter!.projectId, row.source.adapter!.runId));
        const images = new Set(journal.records.filter(r => r.mode === mode && r.outcome === "reviewed" && r.source.modelId === row.source.modelId
          && JSON.stringify(r.source) === JSON.stringify(row.source) && r.mixed === row.mixed).map(r => r.assetId)).size;
        return <tr key={`${row.key}:${row.mixed}`}>
          <th><b>{name(row)}</b><small>{row.source.device ?? "—"}</small><small>{fill(t.cold, { n: row.coldRequests })}</small>
            {row.interrupted > 0 && <small>{fill(t.pending, { n: row.interrupted })}</small>}</th>
          <td>{row.source.adapter === null ? t.noAdjustment : metadata && metadata.trainingMasks !== null
            ? <>{metadata.trainingMasks} {t.masks}<small>{metadata.trainingGroups ?? "—"} {t.groups}</small></> : t.unknownData}</td>
          <td>{row.reviewed} / {images}</td><td>{number(row.secondsPerReviewed)}</td><td>{number(row.promptsPerReviewed)}</td>
          <td>{number(row.correctionsPerReviewed)}</td><td>{number(row.waitMs / 1000)} {t.seconds}</td><td>{row.discarded}</td>
        </tr>;
      })}</tbody>
    </table></div>}
    <p className="adaptive-note">{t.note}</p>
    <p className="adaptive-note">{t.observational}</p>
    {rows.map(candidate => {
      const base = rows.find(row => row.source.adapter === null && row.source.modelId === candidate.source.modelId
        && row.source.device === candidate.source.device && row.source.fingerprint === candidate.source.fingerprint && !row.mixed);
      const change = base ? compareEffort(base, candidate) : null;
      const signed = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}`;
      return change ? <p className="adaptive-callout" key={candidate.key}>{fill(t.change, {
        name: name(candidate), time: signed(change.timePercent), prompts: signed(change.promptsDelta),
      })}</p> : null;
    })}
    <label className="effort-cost">{t.preparation}<input type="number" min="0" step="1" value={cost} onChange={event => setCost(event.target.value)} /></label>
    <p className="adaptive-note">{t.costNote}</p>
    {cost.trim() && rows.map(candidate => {
      const base = rows.find(row => row.source.adapter === null && row.source.modelId === candidate.source.modelId
        && row.source.device === candidate.source.device && row.source.fingerprint === candidate.source.fingerprint && !row.mixed);
      const n = base ? effortBreakEven(Number(cost), base, candidate) : null;
      return n !== null ? <p className="adaptive-callout" key={candidate.key}>{fill(t.breakEven, { name: name(candidate), n })}</p> : null;
    })}
    <p className="adaptive-note">{t.breakNote}</p>
    <small className="adaptive-note">{journal.persistent ? t.local : t.storage}</small>
    </>}
  </section>;
}

export function AnnotationEffortLive({ language, record, paused, onPause, onFinish }: {
  language: Language; record: EffortRecord; paused: boolean; onPause: () => void; onFinish: () => void;
}) {
  const t = getEffortCopy(language);
  return <div className="annotation-effort-live">
    <div><b>{paused ? t.paused : record.annotationIds.length ? t.reviewing : t.live}</b>
      <small>{number((record.workMs + record.waitMs) / 1000)} {t.seconds} · {record.clicks || record.boxes} {record.mode === "points" ? t.points : t.box} · {record.corrections} {t.correctionActions}</small></div>
    <button onClick={onPause}>{paused ? t.resume : t.pause}</button>
    {record.annotationIds.length > 0 && <button className="effort-finish" onClick={onFinish}>{t.finish}</button>}
  </div>;
}
