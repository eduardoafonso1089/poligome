import test from "node:test";
import assert from "node:assert/strict";
import { EffortTrial, compareEffort, effortBreakEven, effortGeometryKey, summarizeEffort } from "../app/editor/models/annotation-effort-model.ts";
import { effortCsv, readEffortJournal, writeEffortJournal } from "../app/lib/annotation-effort.ts";
import { getEffortCopy } from "../app/lib/annotation-effort-copy.ts";
import { polygon } from "./helpers/editor-fixtures.mjs";

const base = { modelId: "sam3-concepts", device: "cpu", fingerprint: "a".repeat(64), adapter: null };
const candidate = { ...base, adapter: { projectId: "p-source", runId: "run-example" } };
function record(overrides = {}) {
  return { id: "session-1", assetId: "image-1", annotationIds: [], geometryKeys: {}, startedAt: 1000, mode: "points",
    source: { modelId: null, device: null, fingerprint: null }, mixed: false, outcome: "in_progress", clicks: 0, boxes: 0,
    corrections: 0, requests: 0, coldRequests: 0, workMs: 0, waitMs: 0, ...overrides };
}
test("clock partitions foreground work and model waiting, excluding pause and background", () => {
  const trial = new EffortTrial(record(), 0);
  const request = {};
  trial.prompt(100); trial.requestStarted(request, 100);
  trial.setVisible(false, 600); trial.requestEnded(request, 1000); trial.setVisible(true, 1500);
  trial.setPaused(true, 2000); trial.setPaused(false, 5000);
  trial.accept(["mask-1"], 5500);
  const saved = trial.finish("reviewed", 6000);
  assert.equal(saved.workMs, 1600);
  assert.equal(saved.waitMs, 500);
  assert.equal(saved.clicks, 1);
});
test("overlapping and aborted requests do not double-count wait", () => {
  const trial = new EffortTrial(record(), 0);
  const a = {}, b = {};
  trial.requestStarted(a, 0); trial.requestStarted(b, 100); trial.requestEnded(a, 200); trial.requestEnded(b, 400);
  assert.equal(trial.finish("discarded", 500).waitMs, 400);
});
test("a correction drag counts once, later correction or undo counts as another gesture", () => {
  const trial = new EffortTrial(record(), 0);
  for (let time = 0; time < 100; time++) trial.correct(1, time);
  trial.correct(2, 100);
  assert.equal(trial.record.corrections, 2);
});
test("switching actual adapters marks the session mixed", () => {
  const trial = new EffortTrial(record(), 0);
  trial.identify(base, true, 100); trial.identify(candidate, false, 200);
  assert.equal(trial.record.mixed, true);
  assert.equal(trial.record.coldRequests, 1);
});
test("post-acceptance correction time is included until explicit review completion", () => {
  const trial = new EffortTrial(record(), 0);
  trial.identify(base, false, 100); trial.accept(["mask-1"], 1000); trial.correct(1, 2000);
  assert.equal(trial.record.outcome, "in_progress");
  assert.equal(trial.finish("reviewed", 3000).workMs, 3000);
});
test("discarded attempts cost time and prompts; interrupted sessions are disclosed but excluded", () => {
  const rows = summarizeEffort([
    record({ source: base, outcome: "reviewed", annotationIds: ["mask"], workMs: 10000, clicks: 2 }),
    record({ source: base, outcome: "discarded", workMs: 5000, waitMs: 5000, clicks: 3 }),
    record({ source: base, outcome: "interrupted", workMs: 100000, clicks: 100 }),
  ], "points");
  assert.equal(rows[0].secondsPerReviewed, 20);
  assert.equal(rows[0].promptsPerReviewed, 5);
  assert.equal(rows[0].discarded, 1);
  assert.equal(rows[0].interrupted, 1);
});
test("box, device, fingerprint and adapter versions remain separate", () => {
  const data = [record({ source: base }), record({ source: candidate }), record({ source: { ...base, device: "cuda" } }),
    record({ source: { ...base, fingerprint: "b" } }), record({ mode: "box", source: base })];
  assert.equal(summarizeEffort(data, "points").length, 4);
  assert.equal(summarizeEffort(data, "box").length, 1);
});
test("break-even uses observed savings and cannot mix devices, unknown bases or tiny samples", () => {
  const summary = source => summarizeEffort([record({ source, annotationIds: ["a", "b", "c", "d", "e"], outcome: "reviewed", workMs: source.adapter ? 50000 : 100000 })], "points")[0];
  const before = summary(base), after = summary(candidate);
  assert.deepEqual(compareEffort(before, after), { timePercent: -50, promptsDelta: 0 });
  assert.deepEqual(compareEffort(before, { ...after, secondsPerReviewed: 30 }), { timePercent: 50, promptsDelta: 0 });
  assert.equal(effortBreakEven(10, before, after), 60);
  assert.equal(effortBreakEven(10, before, { ...after, source: { ...candidate, device: "cuda" } }), null);
  assert.equal(effortBreakEven(10, before, { ...after, reviewed: 4 }), null);
  assert.equal(effortBreakEven(10, before, { ...after, secondsPerReviewed: 30 }), null);
  assert.equal(effortBreakEven(10, before, { ...after, mixed: true }), null);
});
test("geometry bookkeeping, labels and review ratings are not counted as corrections", () => {
  const shape = polygon();
  assert.equal(effortGeometryKey(shape), effortGeometryKey({ ...shape, label: "other", reviewScore: 5,
    vertices: shape.vertices.map((v, i) => ({ ...v, id: `new-${i}` })) }));
  assert.notEqual(effortGeometryKey(shape), effortGeometryKey({ ...shape, vertices: shape.vertices.map(v => ({ ...v, x: v.x + 1 })) }));
});
test("CSV includes timings and outcomes, excludes geometry and protects spreadsheet cells", () => {
  const csv = effortCsv([record({ source: { ...base, modelId: "=HYPERLINK(1)" }, geometryKeys: { private: "hash" } })]);
  assert.match(csv, /"'=HYPERLINK/);
  assert.doesNotMatch(csv, /geometry|private|coordinates/);
  assert.match(csv, /wait_seconds/);
});
test("CSV preserves training evidence and distinguishes unidentified adapters from the original", () => {
  const version = { key: JSON.stringify([candidate.modelId, candidate.adapter.projectId, candidate.adapter.runId]),
    name: "Nuclei version 1", trainingMasks: 160, trainingGroups: 14 };
  const csv = effortCsv([record({ source: candidate }), record({ source: base }), record()], [version]);
  assert.match(csv, /version_name,training_masks,training_groups/);
  assert.match(csv, /"Nuclei version 1","160","14"/);
  assert.match(csv, /"adapted"/); assert.match(csv, /"original"/); assert.match(csv, /"unknown"/);
});
test("reload marks unfinished sessions incomplete and rejects malformed storage; quota failure keeps a temporary history", () => {
  const previous = { window: globalThis.window, storage: globalThis.localStorage };
  try {
    globalThis.window = { dispatchEvent() {} };
    globalThis.localStorage = { getItem: () => JSON.stringify({ version: 1, enabled: true,
      records: [record(), record({ id: "bad", source: { modelId: 4 } })], versions: [null, { key: "bad" }] }),
      setItem() { throw new Error("quota exceeded"); } };
    const saved = readEffortJournal("storage-regression-project");
    assert.equal(saved.records.length, 1); assert.equal(saved.records[0].outcome, "interrupted");
    assert.deepEqual(saved.versions, []);
    const next = writeEffortJournal("storage-regression-project", saved);
    assert.equal(next.persistent, false);
    assert.equal(readEffortJournal("storage-regression-project").records.length, 1);
    assert.equal(readEffortJournal("storage-regression-project").persistent, false);
  } finally {
    if (previous.window === undefined) delete globalThis.window; else globalThis.window = previous.window;
    if (previous.storage === undefined) delete globalThis.localStorage; else globalThis.localStorage = previous.storage;
  }
});
test("all four languages have the same effort controls and explanations", () => {
  const keys = Object.keys(getEffortCopy("pt")).sort();
  for (const language of ["en", "fr", "es"]) assert.deepEqual(Object.keys(getEffortCopy(language)).sort(), keys);
});
