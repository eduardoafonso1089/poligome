"use client";

/**
 * Cliente das rotas /adaptive do conector local. Como o resto do conector, fala
 * só com 127.0.0.1: imagens e máscaras aprovadas vão para o processo local que
 * já roda o SAM, e de lá não saem.
 */

import type { Copy } from "./i18n";
import { assetAsDataUrl } from "./sam";
import { buildItemPayload, diffAgainstConnector, type AdaptiveCandidate, type AdaptiveDatasetPlan } from "./adaptive-dataset";

export type AdaptiveErrorDetail = { code: string; message: string; params?: Record<string, unknown> };

export class AdaptiveRequestError extends Error {
  constructor(public status: number, public detail: AdaptiveErrorDetail) {
    super(detail.message);
  }
}

export type AdaptiveStatus = {
  api_version: number;
  available: boolean;
  model: { model_id: string; family: string; device: string; supported: boolean } | null;
  active: { project_id: string; run_id: string; base_model_id: string; applied: boolean } | null;
  training: { project_id: string; run_id: string; status: string; progress: AdaptiveProgress } | null;
};

export type AdaptiveProgress = { phase?: string; epoch?: number; max_epochs?: number; done?: number; total?: number; model?: string };

export type AdaptiveReason = { code: string; params: Record<string, unknown>; severity?: string };

export type ReadinessComponent = { id: string; value: number; target: number | null; minimum?: number; status: "ok" | "low" | "missing" | "info" };

export type ReadinessReport = {
  state: "collecting" | "potentially_sufficient" | "ready" | "insufficient_validation" | "collect_more" | "retrain_useful" | "retrain_not_needed" | "unsupported_model";
  can_train: boolean;
  recommend_training: boolean;
  counts: {
    approved_images: number;
    instances: number;
    independent_groups: number;
    near_duplicate_pairs: number;
    quarantined_images: number;
    rejected_instances: number;
    holdout: { images: number; groups: number; instances: number };
    train: { images: number; groups: number; instances: number };
    by_origin: Record<string, number>;
    classes: number;
  };
  classes: Array<{ label: string; name: string; instances: number; images: number; holdout_instances: number }>;
  sizes: Record<"small" | "medium" | "large", number>;
  diversity: { method: "sam2_embedding" | "low_level"; vendi: number; redundancy: number };
  components: ReadinessComponent[];
  reasons: AdaptiveReason[];
  gaps: AdaptiveReason[];
  continual: { previous_runs: number; recommend: boolean; new_groups?: number; required_new_groups?: number; backoff?: boolean } | null;
  split_frozen: boolean;
  model_id: string | null;
  thresholds?: Record<string, number | null>;
};

export type EpochMetrics = {
  epoch: number;
  train_loss?: number;
  train_dice?: number;
  val_loss: number;
  val_dice: number;
  val_iou: number;
  val_boundary_iou: number;
  seconds?: number;
};

export type MetricPair = { reference: number; candidate: number };

export type ComparisonSummary = {
  primary: {
    reference_mean: number; candidate_mean: number; mean_delta: number; ci_low: number; ci_high: number;
    relative_gain: number | null; share_improved: number; share_worsened: number; share_unchanged: number; images: number;
  };
  protocols: Record<"box" | "point" | "box_jitter", Record<"dice" | "iou" | "boundary_iou", MetricPair>>;
  subgroups: Array<{ kind: "class" | "size"; name: string; instances: number; groups?: number; images?: number; reference_mean: number; candidate_mean: number; mean_delta: number; ci_low: number; ci_high: number; regression: "none" | "possible" | "significant" }>;
  interactive: {
    max_clicks: number;
    reference: { noc85: number | null; noc90: number | null; fail85: number; fail90: number; curve: number[] };
    candidate: { noc85: number | null; noc90: number | null; fail85: number; fail90: number; curve: number[] };
    noc90_delta: number | null; noc90_ci_low?: number; noc90_ci_high?: number;
  };
  holdout: { images: number; groups: number; instances: number };
  reference: { kind: "base" | "adapter"; run_id: string | null };
  versus_base?: ComparisonSummary["primary"];
  decision: { outcome: "improved" | "not_improved" | "insufficient_evidence"; reasons: AdaptiveReason[] };
  examples: Array<{ file: string; label_name: string; reference_dice: number; candidate_dice: number; delta: number; prompt: string }>;
};

export type Interval = { median: number; low: number; high: number };

export type LearningCurve = {
  skipped?: "no_improvement" | "too_few_groups" | "error";
  message?: string;
  points?: Array<{ groups: number; mean: number; ci_low: number; ci_high: number; kind: "base" | "subset" | "full" }>;
  fit?: { a: number; b: number; c: number; ceiling: number } | null;
  projection?: { double: ({ groups: number } & Interval) | null; plus10: ({ groups: number } & Interval) | null };
  additional_groups_for_one_point?: (Partial<Interval> & { share_beyond_range: number }) | null;
  last_step_gain?: Interval | null;
  trend?: "rising" | "plateau" | "uncertain";
  single_seed?: boolean;
  projection_interval_level?: number;
  training_variance_measured?: boolean;
  train_groups?: number;
  epochs?: number;
};

export type Suggestion = { key: string; rank: number; novelty: number | null; reason: "first_examples" | "novel" | "typical" | "similar" | "near_duplicate" };

export type RunRecord = {
  run_id: string;
  project_id: string;
  created_at: string;
  finished_at?: string;
  status: "queued" | "preparing" | "training" | "evaluating" | "completed" | "failed" | "cancelled" | "interrupted";
  stage?: string;
  activation: "inactive" | "active" | "rejected" | "superseded";
  base_model: { model_id: string; family: string; device: string };
  config: Record<string, unknown>;
  resolved?: { learning_rate: number; max_epochs: number; device?: string; precision?: "bfloat16" | "float32" };
  lora?: { strategy: string; rank: number; alpha: number; target_count: number; trainable_params: number; total_params: number; encoder_blocks: number };
  data?: Record<"fit" | "internal_val" | "holdout", { images: number; groups: number; instances: number }>;
  epochs: EpochMetrics[];
  best_epoch?: number;
  epochs_run?: number;
  diagnosis?: { state: "in_progress" | "improving" | "converged" | "overfitting" | "inconclusive"; best_epoch: number; stopped_early?: boolean; no_improvement_over_base?: boolean };
  comparison?: ComparisonSummary;
  learning_curve?: LearningCurve;
  timing?: { seconds_per_epoch?: number; total_seconds?: number };
  error?: { code: string; message: string };
  progress?: AdaptiveProgress;
  reference?: { kind: string; run_id: string | null };
};

export type RunSummary = {
  run_id: string; created_at: string; finished_at?: string; status: RunRecord["status"]; activation: RunRecord["activation"];
  base_model_id: string; best_epoch?: number; epochs_run?: number; diagnosis?: string; outcome?: ComparisonSummary["decision"]["outcome"];
  mean_delta?: number; ci_low?: number; ci_high?: number; holdout_set_id?: string; error?: { code: string; message: string };
};

async function request<T>(base: string, path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  if (!base) throw new AdaptiveRequestError(0, { code: "offline", message: "conector não encontrado" });
  const { timeoutMs = 15_000, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      ...rest,
      headers: rest.body ? { "Content-Type": "application/json" } : undefined,
      signal: rest.signal ?? AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new AdaptiveRequestError(0, { code: "offline", message: "o conector não respondeu" });
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: unknown } | null;
    const detail = body?.detail;
    if (detail && typeof detail === "object" && "code" in detail) throw new AdaptiveRequestError(response.status, detail as AdaptiveErrorDetail);
    // 404 sem código: o conector é anterior ao Adaptive AI ou está sem a extensão.
    throw new AdaptiveRequestError(response.status, {
      code: response.status === 404 ? "not_installed" : "http_error",
      message: typeof detail === "string" ? detail : `HTTP ${response.status}`,
    });
  }
  return await response.json() as T;
}

const project = (id: string) => `/adaptive/projects/${encodeURIComponent(id)}`;

export const adaptiveApi = {
  status: (base: string) => request<AdaptiveStatus>(base, "/adaptive/status", { timeoutMs: 5_000 }),
  items: (base: string, id: string) => request<{ items: Record<string, string> }>(base, `${project(id)}/items`),
  assess: (base: string, id: string) => request<ReadinessReport>(base, `${project(id)}/assess`, { method: "POST", timeoutMs: 120_000 }),
  runs: (base: string, id: string) => request<{ runs: RunSummary[]; history: Array<Record<string, unknown>> }>(base, `${project(id)}/runs`),
  run: (base: string, id: string, runId: string) => request<RunRecord>(base, `${project(id)}/runs/${encodeURIComponent(runId)}`),
  start: (base: string, id: string, config: Record<string, unknown>) =>
    request<RunRecord>(base, `${project(id)}/runs`, { method: "POST", body: JSON.stringify({ config }), timeoutMs: 120_000 }),
  cancel: (base: string, id: string, runId: string) => request(base, `${project(id)}/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" }),
  activate: (base: string, id: string, runId: string, override: boolean) =>
    request<AdaptiveStatus>(base, `${project(id)}/runs/${encodeURIComponent(runId)}/activate`, { method: "POST", body: JSON.stringify({ override }), timeoutMs: 120_000 }),
  reject: (base: string, id: string, runId: string) => request(base, `${project(id)}/runs/${encodeURIComponent(runId)}/reject`, { method: "POST" }),
  rollback: (base: string, id: string) => request<AdaptiveStatus>(base, `${project(id)}/rollback`, { method: "POST", timeoutMs: 120_000 }),
  suggestions: (base: string, id: string, limit = 10) =>
    request<{ method: string | null; suggestions: Suggestion[]; annotated: number; candidates?: number }>(base, `${project(id)}/suggestions?limit=${limit}`),
  deactivate: (base: string) => request<AdaptiveStatus>(base, "/adaptive/deactivate", { method: "POST", timeoutMs: 60_000 }),
  /** Busca o PNG como blob: `<img>` direto no localhost esbarra no Private Network Access. */
  async example(base: string, id: string, runId: string, file: string): Promise<string> {
    const response = await fetch(`${base}${project(id)}/runs/${encodeURIComponent(runId)}/examples/${encodeURIComponent(file)}`, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new AdaptiveRequestError(response.status, { code: "example_not_found", message: `HTTP ${response.status}` });
    return URL.createObjectURL(await response.blob());
  },
};

/**
 * Envia ao conector só o que mudou desde o último envio e remove o que saiu do
 * projeto. Cada imagem sobe na mesma resolução que o SAM recebe no editor.
 */
export async function syncAdaptiveDataset({
  base, projectId, plan, copy, onProgress, signal,
}: {
  base: string;
  projectId: string;
  plan: AdaptiveDatasetPlan;
  copy: Copy;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}): Promise<{ uploaded: number; removed: number; unchanged: number; failed: Array<{ name: string; message: string }> }> {
  const remote = await adaptiveApi.items(base, projectId);
  const diff = diffAgainstConnector(plan, remote.items);
  const failed: Array<{ name: string; message: string }> = [];
  const total = diff.upload.length + diff.remove.length;
  let done = 0;
  onProgress?.(done, total);
  for (const key of diff.remove) {
    if (signal?.aborted) throw new DOMException("Cancelado", "AbortError");
    await request(base, `${project(projectId)}/items/${encodeURIComponent(key)}`, { method: "DELETE" });
    onProgress?.(++done, total);
  }
  for (const item of diff.upload) {
    if (signal?.aborted) throw new DOMException("Cancelado", "AbortError");
    try {
      const image = await assetAsDataUrl(item.asset, copy, signal);
      const payload = buildItemPayload(item, {
        url: image.url,
        sentWidth: image.larguraEnvio,
        sentHeight: image.alturaEnvio,
        sourceWidth: image.larguraOrigem,
        sourceHeight: image.alturaOrigem,
      });
      await request(base, `${project(projectId)}/items/${encodeURIComponent(item.key)}`, {
        method: "POST", body: JSON.stringify(payload), timeoutMs: 120_000, signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      failed.push({ name: item.asset.name, message: error instanceof Error ? error.message : String(error) });
    }
    onProgress?.(++done, total);
  }
  return { uploaded: diff.upload.length - failed.length, removed: diff.remove.length, unchanged: diff.unchanged, failed };
}

/**
 * Envia as imagens ainda sem anotação aprovada, só para medir quais acrescentam
 * mais cobertura. O conector guarda descritores e embedding, não a imagem.
 */
export async function syncAdaptiveCandidates({
  base, projectId, candidates, copy, onProgress, signal,
}: {
  base: string;
  projectId: string;
  candidates: AdaptiveCandidate[];
  copy: Copy;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}): Promise<{ failed: number }> {
  const remote = await request<{ items: Record<string, string> }>(base, `${project(projectId)}/candidates`);
  const wanted = new Map(candidates.map((candidate) => [candidate.key, candidate]));
  const upload = candidates.filter((candidate) => remote.items[candidate.key] !== candidate.fingerprint);
  const remove = Object.keys(remote.items).filter((key) => !wanted.has(key));
  const total = upload.length + remove.length;
  let done = 0;
  let failed = 0;
  onProgress?.(done, total);
  for (const key of remove) {
    if (signal?.aborted) throw new DOMException("Cancelado", "AbortError");
    await request(base, `${project(projectId)}/candidates/${encodeURIComponent(key)}`, { method: "DELETE" });
    onProgress?.(++done, total);
  }
  for (const candidate of upload) {
    if (signal?.aborted) throw new DOMException("Cancelado", "AbortError");
    try {
      const image = await assetAsDataUrl(candidate.asset, copy, signal);
      await request(base, `${project(projectId)}/candidates/${encodeURIComponent(candidate.key)}`, {
        method: "POST", body: JSON.stringify({ image: image.url, fingerprint: candidate.fingerprint }), timeoutMs: 120_000, signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      failed += 1;
    }
    onProgress?.(++done, total);
  }
  return { failed };
}
