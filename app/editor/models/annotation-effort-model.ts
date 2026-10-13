import type { EditorAnnotation } from "./annotation-model";

/** Observed human effort. No timings or clicks are inferred from model scores. */
export type EffortMode = "points" | "box";
export type EffortSource = {
  modelId: string | null;
  device: string | null;
  fingerprint: string | null;
  /** undefined means an older connector did not identify the effective adapter. */
  adapter?: { projectId: string; runId: string } | null;
};
export type EffortRecord = {
  id: string;
  assetId: string;
  annotationIds: string[];
  geometryKeys: Record<string, string>;
  startedAt: number;
  mode: EffortMode;
  source: EffortSource;
  mixed: boolean;
  outcome: "in_progress" | "reviewed" | "discarded" | "interrupted";
  clicks: number;
  boxes: number;
  corrections: number;
  requests: number;
  coldRequests: number;
  workMs: number;
  waitMs: number;
};
export type EffortVersion = { key: string; name: string; trainingMasks: number | null; trainingGroups: number | null };

export function effortSourceKey(source: EffortSource): string {
  return JSON.stringify([source.modelId, source.device, source.fingerprint, source.adapter === undefined ? "unknown" : source.adapter]);
}

export function effortGeometryKey(annotation: EditorAnnotation): string {
  const geometry = annotation.type === "polygon" || annotation.type === "line"
    ? { type: annotation.type, vertices: annotation.vertices.map(v => [v.x, v.y]),
      holes: annotation.type === "polygon" ? annotation.holes.map(hole => hole.map(v => [v.x, v.y])) : [] }
    : annotation.type === "box" ? { type: "box", x: annotation.x, y: annotation.y, width: annotation.width,
      height: annotation.height, rotation: annotation.rotation ?? 0 } : { type: "point", x: annotation.x, y: annotation.y };
  const text = JSON.stringify(geometry);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `${text.length}:${hash >>> 0}`;
}

export class EffortTrial {
  record: EffortRecord;
  private lastTick: number;
  private visible = true;
  paused = false;
  private pending = new Set<object>();
  private lastCorrectionGesture: number | null = null;

  constructor(record: EffortRecord, now: number) {
    this.record = structuredClone(record);
    this.record.outcome = "in_progress";
    this.lastTick = now;
  }

  tick(now: number): void {
    const elapsed = Math.max(0, now - this.lastTick);
    if (this.visible && !this.paused) {
      if (this.pending.size) this.record.waitMs += elapsed;
      else this.record.workMs += elapsed;
    }
    this.lastTick = now;
  }

  setVisible(visible: boolean, now: number): void { this.tick(now); this.visible = visible; }
  setPaused(paused: boolean, now: number): void { this.tick(now); this.paused = paused; }
  prompt(now: number): void { this.tick(now); if (this.record.mode === "points") this.record.clicks++; else this.record.boxes++; }
  requestStarted(request: object, now: number): void { this.tick(now); this.pending.add(request); this.record.requests++; }
  requestEnded(request: object, now: number): void { this.tick(now); this.pending.delete(request); }

  identify(source: EffortSource, cold: boolean, now: number): void {
    this.tick(now);
    if (this.record.source.modelId && effortSourceKey(this.record.source) !== effortSourceKey(source)) this.record.mixed = true;
    this.record.source = structuredClone(source);
    if (cold) this.record.coldRequests++;
  }

  accept(annotationIds: string[], now: number): void { this.tick(now); this.record.annotationIds = [...annotationIds]; }
  correct(gesture: number, now: number): void {
    this.tick(now);
    if (gesture !== this.lastCorrectionGesture) { this.record.corrections++; this.lastCorrectionGesture = gesture; }
  }
  finish(outcome: EffortRecord["outcome"], now: number): EffortRecord {
    this.tick(now);
    this.record.outcome = outcome;
    return structuredClone(this.record);
  }
}

export type EffortSummary = {
  key: string; mode: EffortMode; source: EffortSource; mixed: boolean;
  reviewed: number; discarded: number; interrupted: number;
  totalMs: number; waitMs: number; prompts: number; corrections: number; coldRequests: number;
  secondsPerReviewed: number | null; promptsPerReviewed: number | null; correctionsPerReviewed: number | null;
};

export function summarizeEffort(records: readonly EffortRecord[], mode: EffortMode): EffortSummary[] {
  const summaries = new Map<string, EffortSummary>();
  for (const record of records) {
    if (record.mode !== mode) continue;
    const key = JSON.stringify([effortSourceKey(record.source), record.mixed]);
    let summary = summaries.get(key);
    if (!summary) {
      summary = { key: effortSourceKey(record.source), mode, source: record.source, mixed: record.mixed,
        reviewed: 0, discarded: 0, interrupted: 0, totalMs: 0, waitMs: 0, prompts: 0, corrections: 0,
        coldRequests: 0, secondsPerReviewed: null, promptsPerReviewed: null, correctionsPerReviewed: null };
      summaries.set(key, summary);
    }
    if (record.outcome === "interrupted" || record.outcome === "in_progress") { summary.interrupted++; continue; }
    summary.reviewed += record.outcome === "reviewed" ? record.annotationIds.length : 0;
    summary.discarded += record.outcome === "discarded" ? 1 : 0;
    // Discarded attempts cost time and actions too; do not remove them from the numerator.
    summary.totalMs += record.workMs + record.waitMs;
    summary.waitMs += record.waitMs;
    summary.prompts += record.clicks + record.boxes;
    summary.corrections += record.corrections;
    summary.coldRequests += record.coldRequests;
  }
  return [...summaries.values()].map(summary => ({ ...summary,
    secondsPerReviewed: summary.reviewed ? summary.totalMs / summary.reviewed / 1000 : null,
    promptsPerReviewed: summary.reviewed ? summary.prompts / summary.reviewed : null,
    correctionsPerReviewed: summary.reviewed ? summary.corrections / summary.reviewed : null,
  }));
}

/** Exploratory amortization at the observed pace, never a prediction of training sufficiency. */
export function compareEffort(base: EffortSummary, candidate: EffortSummary): { timePercent: number; promptsDelta: number } | null {
  if (base.reviewed < 5 || candidate.reviewed < 5
    || base.mixed || candidate.mixed || base.source.adapter !== null || !candidate.source.adapter
    || !base.source.fingerprint || base.source.fingerprint !== candidate.source.fingerprint
    || !base.source.device || base.source.device !== candidate.source.device
    || base.source.modelId !== candidate.source.modelId || base.mode !== candidate.mode
    || base.secondsPerReviewed === null || base.secondsPerReviewed <= 0 || candidate.secondsPerReviewed === null
    || base.promptsPerReviewed === null || candidate.promptsPerReviewed === null) return null;
  return { timePercent: (candidate.secondsPerReviewed / base.secondsPerReviewed - 1) * 100,
    promptsDelta: candidate.promptsPerReviewed - base.promptsPerReviewed };
}

export function effortBreakEven(preparationMinutes: number, base: EffortSummary, candidate: EffortSummary): number | null {
  if (!Number.isFinite(preparationMinutes) || preparationMinutes < 0 || !compareEffort(base, candidate)) return null;
  const savedSeconds = base.secondsPerReviewed! - candidate.secondsPerReviewed!;
  return savedSeconds > 0 ? Math.ceil(preparationMinutes * 60 / savedSeconds) : null;
}
