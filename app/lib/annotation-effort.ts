import type { EffortRecord, EffortVersion } from "../editor/models/annotation-effort-model";

export const EFFORT_CHANGED_EVENT = "poligome:annotation-effort-changed";
export type EffortJournal = { version: 1; enabled: boolean; records: EffortRecord[]; versions: EffortVersion[]; persistent: boolean };
const memory = new Map<string, EffortJournal>();
const storageKey = (projectId: string) => `poligome-annotation-effort:v1:${projectId}`;
const empty = (): EffortJournal => ({ version: 1, enabled: false, records: [], versions: [], persistent: true });

export function readEffortJournal(projectId: string): EffortJournal {
  if (typeof window === "undefined") return empty();
  if (memory.has(projectId)) return structuredClone(memory.get(projectId)!);
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(projectId)) ?? "null");
    if (value?.version === 1 && Array.isArray(value.records) && Array.isArray(value.versions)) {
      const nullableString = (v: unknown) => v === null || typeof v === "string";
      const count = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;
      const records = value.records.filter((r: EffortRecord) => r && typeof r.id === "string" && typeof r.assetId === "string" && r.source
        && [r.source.modelId, r.source.device, r.source.fingerprint].every(nullableString)
        && (r.source.adapter === undefined || r.source.adapter === null
          || typeof r.source.adapter.projectId === "string" && typeof r.source.adapter.runId === "string")
        && Array.isArray(r.annotationIds) && r.annotationIds.every(id => typeof id === "string")
        && Number.isFinite(r.startedAt) && Math.abs(r.startedAt) <= 8.64e15 && typeof r.mixed === "boolean"
        && [r.workMs, r.waitMs, r.clicks, r.boxes, r.corrections, r.requests, r.coldRequests].every(n => Number.isFinite(n) && n >= 0)
        && ["points", "box"].includes(r.mode) && ["in_progress", "reviewed", "discarded", "interrupted"].includes(r.outcome))
        .slice(-1000).map((r: EffortRecord) => ({ ...r, geometryKeys: r.geometryKeys && typeof r.geometryKeys === "object" && !Array.isArray(r.geometryKeys)
          ? Object.fromEntries(Object.entries(r.geometryKeys).filter(([, key]) => typeof key === "string")) : {},
          outcome: r.outcome === "in_progress" ? "interrupted" as const : r.outcome }));
      const versions = value.versions.filter((v: EffortVersion) => v && typeof v.key === "string" && typeof v.name === "string"
        && (v.trainingMasks === null || count(v.trainingMasks)) && (v.trainingGroups === null || count(v.trainingGroups))).slice(-100);
      const journal: EffortJournal = { version: 1, enabled: value.enabled === true, records, versions, persistent: true };
      memory.set(projectId, journal);
      return structuredClone(journal);
    }
  } catch { return { ...empty(), persistent: false }; }
  return empty();
}

export function writeEffortJournal(projectId: string, journal: EffortJournal): EffortJournal {
  let next = { ...journal, records: journal.records.slice(-1000), versions: journal.versions.slice(-100), persistent: true };
  try { localStorage.setItem(storageKey(projectId), JSON.stringify(next)); }
  catch { next = { ...next, persistent: false }; }
  memory.set(projectId, structuredClone(next));
  window.dispatchEvent(new CustomEvent(EFFORT_CHANGED_EVENT, { detail: projectId }));
  return next;
}

export function effortCsv(records: readonly EffortRecord[], versions: readonly EffortVersion[] = []): string {
  const cell = (value: unknown) => {
    let text = String(value ?? "");
    if (/^[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const columns = ["started_at", "model", "device", "base_fingerprint", "adapter_state", "adapter_project", "adapter_version", "version_name", "training_masks", "training_groups", "mode", "outcome", "reviewed_masks", "clicks", "boxes", "corrections", "work_seconds", "wait_seconds", "cold_requests", "mixed_models"];
  return [columns.join(","), ...records.map(r => {
    const version = r.source.adapter && versions.find(v => v.key === JSON.stringify([r.source.modelId, r.source.adapter!.projectId, r.source.adapter!.runId]));
    return [new Date(r.startedAt).toISOString(), r.source.modelId, r.source.device,
    r.source.fingerprint, r.source.adapter === undefined ? "unknown" : r.source.adapter === null ? "original" : "adapted",
    r.source.adapter?.projectId, r.source.adapter?.runId, version ? version.name : null,
    version ? version.trainingMasks : null, version ? version.trainingGroups : null, r.mode, r.outcome,
    r.outcome === "reviewed" ? r.annotationIds.length : 0, r.clicks, r.boxes, r.corrections,
    (r.workMs / 1000).toFixed(3), (r.waitMs / 1000).toFixed(3), r.coldRequests, r.mixed].map(cell).join(",");
  })].join("\n");
}
