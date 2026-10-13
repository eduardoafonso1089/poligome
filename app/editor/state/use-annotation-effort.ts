"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { EditorAnnotation } from "../models/annotation-model";
import { EffortTrial, effortGeometryKey as geometryKey, type EffortMode, type EffortRecord } from "../models/annotation-effort-model";
import { EFFORT_CHANGED_EVENT, readEffortJournal, writeEffortJournal } from "../../lib/annotation-effort";
import type { SamPredictionResult } from "../../lib/sam";

export function useAnnotationEffort(projectId: string, assetId: string | null, annotations: readonly EditorAnnotation[], selectedIds: readonly string[]) {
  const trial = useRef<{ projectId: string; value: EffortTrial } | null>(null);
  const gesture = useRef(0);
  const enabledRef = useRef(false);
  const latestAnnotations = useRef(annotations);
  useEffect(() => { latestAnnotations.current = annotations; }, [annotations]);
  const [enabled, setEnabled] = useState(false);
  const [view, setView] = useState<{ record: EffortRecord; paused: boolean } | null>(null);

  const api = useMemo(() => {
    const now = () => performance.now();
    const publish = () => {
      if (!trial.current) return;
      const { projectId: owner, value } = trial.current;
      const journal = readEffortJournal(owner);
      const record = structuredClone(value.record);
      const index = journal.records.findIndex(r => r.id === record.id);
      if (index === -1) journal.records.push(record); else journal.records[index] = record;
      writeEffortJournal(owner, journal);
      setView({ record, paused: value.paused });
    };
    const stop = (outcome: EffortRecord["outcome"]) => {
      if (!trial.current) return;
      const owner = trial.current.projectId;
      const record = trial.current.value.finish(outcome, now());
      trial.current = null;
      const journal = readEffortJournal(owner);
      journal.records = [...journal.records.filter(r => r.id !== record.id), record];
      writeEffortJournal(owner, journal);
      setView(null);
    };
    const observe = () => {
      const active = trial.current?.value;
      if (!active?.record.annotationIds.length) return;
      const shapes = active.record.annotationIds.map(id => latestAnnotations.current.find(a => a.id === id));
      if (shapes.every(shape => !shape)) { stop("discarded"); return; }
      if (shapes.some(shape => !shape)) {
        active.correct(gesture.current, now());
        active.record.annotationIds = shapes.flatMap(shape => shape ? [shape.id] : []);
        active.record.geometryKeys = Object.fromEntries(active.record.annotationIds.map(id => [id, active.record.geometryKeys[id]]));
        publish();
      }
      for (const shape of shapes) {
        if (!shape) continue;
        const key = geometryKey(shape);
        if (active.record.geometryKeys[shape.id] !== key) {
          if (active.paused) active.setPaused(false, now());
          active.correct(gesture.current, now());
          active.record.geometryKeys[shape.id] = key;
          publish();
        }
      }
    };
    return {
      publish, stop, observe,
      prompt(mode: EffortMode) {
        if (!enabledRef.current || !assetId) return;
        if (trial.current && (trial.current.projectId !== projectId || trial.current.value.record.annotationIds.length || trial.current.value.record.mode !== mode)) stop("interrupted");
        if (!trial.current) {
          const record: EffortRecord = { id: crypto.randomUUID(), assetId, annotationIds: [], geometryKeys: {}, startedAt: Date.now(),
            mode, source: { modelId: null, device: null, fingerprint: null }, mixed: false, outcome: "in_progress",
            clicks: 0, boxes: 0, corrections: 0, requests: 0, coldRequests: 0, workMs: 0, waitMs: 0 };
          trial.current = { projectId, value: new EffortTrial(record, now()) };
        }
        if (trial.current.value.paused) trial.current.value.setPaused(false, now());
        trial.current.value.prompt(now());
        publish();
      },
      requestStarted(request: object) { trial.current?.value.requestStarted(request, now()); },
      requestEnded(request: object) { trial.current?.value.requestEnded(request, now()); publish(); },
      result(result: SamPredictionResult) {
        if (!trial.current) return;
        trial.current.value.identify({ modelId: result.modelId, device: result.device ?? null,
          fingerprint: result.fingerprint ?? null, adapter: result.adapter }, result.embeddingKnown === true && result.reusedEmbedding === false, now());
        publish();
      },
      accept(shapes: readonly EditorAnnotation[]) {
        if (!trial.current) return;
        trial.current.value.accept(shapes.map(a => a.id), now());
        trial.current.value.record.geometryKeys = Object.fromEntries(shapes.map(a => [a.id, geometryKey(a)]));
        publish();
      },
      complete() { observe(); if (trial.current?.value.record.annotationIds.length) stop("reviewed"); },
      restart() { stop(trial.current?.value.record.annotationIds.length ? "interrupted" : "discarded"); },
      pause() { if (trial.current) { trial.current.value.setPaused(!trial.current.value.paused, now()); publish(); } },
      visible() { trial.current?.value.setVisible(document.visibilityState !== "hidden", now()); publish(); },
      tick() { trial.current?.value.tick(now()); publish(); },
      resume(record: EffortRecord) {
        trial.current = { projectId, value: new EffortTrial(record, now()) };
        publish();
      },
    };
  }, [projectId, assetId]);

  useEffect(() => {
    const refresh = () => {
      const next = readEffortJournal(projectId).enabled;
      enabledRef.current = next;
      setEnabled(next);
      if (!next && trial.current) api.stop("interrupted");
    };
    refresh();
    const change = (event: Event) => { if ((event as CustomEvent).detail === projectId) refresh(); };
    const visibility = () => api.visible();
    const action = () => { gesture.current++; };
    const unload = () => api.stop("interrupted");
    window.addEventListener(EFFORT_CHANGED_EVENT, change);
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("pointerdown", action, true);
    document.addEventListener("keydown", action, true);
    window.addEventListener("pagehide", unload);
    const timer = window.setInterval(api.tick, 1000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(EFFORT_CHANGED_EVENT, change);
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("pointerdown", action, true);
      document.removeEventListener("keydown", action, true);
      window.removeEventListener("pagehide", unload);
      api.stop("interrupted");
    };
  }, [projectId, api]);

  useEffect(() => {
    if (!enabledRef.current) return;
    if (!trial.current) {
      const record = readEffortJournal(projectId).records.slice().reverse().find(r => r.assetId === assetId
        && r.annotationIds.some(id => selectedIds.includes(id)) && (r.outcome === "interrupted"
          || r.outcome === "reviewed" && r.annotationIds.some(id => {
            const shape = annotations.find(a => a.id === id);
            return shape && r.geometryKeys?.[id] !== geometryKey(shape);
          })));
      if (record) api.resume(record);
    }
    api.observe();
  }, [annotations, selectedIds, projectId, assetId, api]);

  return { ...api, enabled, record: view?.record ?? null, paused: view?.paused ?? false };
}
