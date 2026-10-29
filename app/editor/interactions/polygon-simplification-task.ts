import { simplifyPolygonBatch, type SimplificationJob } from "../geometry/polygon-simplification";
import type { SimplificationResponse } from "../geometry/polygon-simplification.worker";
import type { PolygonAnnotation } from "../models/annotation-model";

// Small edits stay immediate; dense masks and multi-selection run off the UI thread.
export function runPolygonSimplification(
  jobs: SimplificationJob[],
  signal: AbortSignal,
  createWorker: (() => Worker) | null = typeof Worker === "undefined" ? null :
    () => new Worker(new URL("../geometry/polygon-simplification.worker.ts", import.meta.url), { type: "module" }),
): Promise<PolygonAnnotation[]> {
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  const count = jobs.reduce((sum, { annotation }) => sum + annotation.vertices.length + annotation.holes.reduce((n, ring) => n + ring.length, 0), 0);
  if (count < 2000 || !createWorker) return Promise.resolve(simplifyPolygonBatch(jobs));
  return new Promise((resolve, reject) => {
    const worker = createWorker();
    let settled = false;
    const finish = (result?: PolygonAnnotation[], error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      worker.terminate();
      if (error) reject(error); else resolve(result ?? []);
    };
    const abort = () => finish(undefined, new DOMException("Aborted", "AbortError"));
    const timeout = setTimeout(() => finish(undefined, new Error("simplification-timeout")), 30_000);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { abort(); return; }
    worker.onmessage = ({ data }: MessageEvent<SimplificationResponse>) => {
      if (data.error) finish(undefined, new Error(data.error));
      else finish(data.annotations);
    };
    worker.onerror = event => { event.preventDefault(); finish(undefined, new Error("simplification-failed")); };
    try { worker.postMessage(jobs); }
    catch { finish(undefined, new Error("simplification-failed")); }
  });
}
