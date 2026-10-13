/**
 * Adaptive AI, browser side: what counts as an approved mask, how images are
 * grouped and sent, how the project keeps its identity, and what the panel
 * renders for real connector payloads.
 *
 * tests/fixtures/adaptive-backend.json was produced by the Python service
 * (tests/adaptive-lora.test.py's toy harness, a real training run), so the
 * component assertions double as a contract test between the two sides.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { render, text, countClass } from "./helpers/render.mjs";
import { polygon, box } from "./helpers/editor-fixtures.mjs";
import {
  buildItemPayload, classifyAnnotation, diffAgainstConnector, itemKeyFor, newAdaptiveProjectId,
  planAdaptiveCandidates, planAdaptiveDataset, sequenceGroup,
} from "../app/lib/adaptive-dataset.ts";
import { markRuntimePredictions } from "../app/lib/runtime-annotations.ts";
import { ADAPTIVE_PROJECT_ID_PATTERN, openPoligomeProjectV4, savePoligomeProjectV4 } from "../app/lib/project.ts";
import { getCopy } from "../app/lib/i18n.ts";
import { getAdaptiveCopy } from "../app/lib/adaptive-copy.ts";
import {
  AdaptiveAiPanel, ComparisonView, LearningCurveView, MetricChart, NextStepCard, ReadinessView, SuggestionsView, TrainingView, imagesStillNeeded, nextStep, reasonText, runLabel,
} from "../app/components/AdaptiveAiPanel.tsx";
import SamSetupModal from "../app/components/SamSetupModal.tsx";

const backend = JSON.parse(readFileSync(new URL("./fixtures/adaptive-backend.json", import.meta.url), "utf8"));
const asset = { id: "img-1", name: "image.png", src: "data:image/png;base64,eA==", local: true, width: 1000, height: 800 };
const square = (overrides = {}) => polygon({
  asset: "img-1",
  vertices: [{ id: "a", x: 10, y: 10 }, { id: "b", x: 210, y: 10 }, { id: "c", x: 210, y: 210 }, { id: "d", x: 10, y: 210 }],
  ...overrides,
});

test("only verified masks are approved for training", () => {
  assert.deepEqual(classifyAnnotation(square(), asset), { usable: true, origin: "manual" });
  assert.deepEqual(classifyAnnotation(box({ asset: "img-1" }), asset), { usable: false, reason: "not_a_mask" });
  assert.deepEqual(classifyAnnotation(square({ reviewScore: 2 }), asset), { usable: false, reason: "rejected_by_review" });
  assert.deepEqual(classifyAnnotation(square(), { ...asset, reviewScore: 1 }), { usable: false, reason: "image_rejected" });
  assert.deepEqual(classifyAnnotation(square(), { ...asset, missing: true, src: "" }), { usable: false, reason: "image_missing" });
  const tiny = square({ vertices: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 2, y: 0 }, { id: "c", x: 2, y: 2 }] });
  assert.deepEqual(classifyAnnotation(tiny, asset), { usable: false, reason: "too_small" });

  const [predicted] = markRuntimePredictions([square()], "runtime model");
  assert.deepEqual(classifyAnnotation(predicted, asset), { usable: false, reason: "unverified_prediction" });
  assert.deepEqual(classifyAnnotation({ ...predicted, reviewScore: 5 }, asset), { usable: true, origin: "reviewed_prediction" });
  const edited = { ...predicted, vertices: predicted.vertices.map((vertex, index) => index === 0 ? { ...vertex, x: vertex.x + 3 } : vertex) };
  assert.deepEqual(classifyAnnotation(edited, asset), { usable: true, origin: "corrected_prediction" });
});

test("sequential file names share a source, camera names do not", () => {
  assert.equal(sequenceGroup("paciente07_corte_012.png"), sequenceGroup("paciente07_corte_013.png"));
  assert.equal(sequenceGroup("video3-frame-0041.jpg"), "name:video3");
  assert.notEqual(sequenceGroup("video3-frame-0041.jpg"), sequenceGroup("video4-frame-0041.jpg"));
  assert.equal(sequenceGroup("IMG_1234.JPG"), null);
  assert.equal(sequenceGroup("DSC0042.jpg"), null);
  assert.equal(sequenceGroup("roof.png"), null);
});

test("the plan counts, groups and fingerprints what will be sent", () => {
  const assets = [asset, { ...asset, id: "img-2", name: "exam1_002.png" }, { ...asset, id: "img-3", name: "tile.tif", raster: { kind: "cog", mode: "tiled", sourceType: "local" } }];
  const [predicted] = markRuntimePredictions([square({ id: "pred" })], "byom");
  const annotations = [square({ id: "m1" }), predicted, box({ asset: "img-1" }), square({ id: "m2", asset: "img-2" }), square({ id: "m3", asset: "img-3" })];
  const labels = [{ id: "roof", name: "Roof", color: "#000", key: "1" }];
  const plan = planAdaptiveDataset(assets, labels, annotations, { groupSequences: true });
  assert.equal(plan.items.length, 2);
  assert.equal(plan.usableInstances, 2);
  assert.equal(plan.excluded.unverified_prediction, 1);
  assert.equal(plan.excluded.not_a_mask, 1);
  assert.equal(plan.excluded.image_missing, 1);
  assert.equal(plan.items[1].group, "name:exam1");
  assert.equal(planAdaptiveDataset(assets, labels, annotations, { groupSequences: false }).items[1].group, null);
  assert.match(plan.items[0].key, /^[A-Za-z0-9_-]{8,96}$/);
  assert.equal(plan.items[0].key, itemKeyFor("img-1"));

  const again = planAdaptiveDataset(assets, labels, annotations, { groupSequences: true });
  assert.equal(again.items[0].fingerprint, plan.items[0].fingerprint, "fingerprints must be stable");
  const moved = annotations.map((annotation) => annotation.id === "m1" ? { ...annotation, vertices: annotation.vertices.map((vertex) => ({ ...vertex, x: vertex.x + 1 })) } : annotation);
  assert.notEqual(planAdaptiveDataset(assets, labels, moved, { groupSequences: true }).items[0].fingerprint, plan.items[0].fingerprint);
});

test("payload coordinates follow the downscaled image that is uploaded", () => {
  const plan = planAdaptiveDataset([asset], [], [square({ holes: [[{ id: "h1", x: 50, y: 50 }, { id: "h2", x: 100, y: 50 }, { id: "h3", x: 100, y: 100 }]] })], { groupSequences: true });
  const payload = buildItemPayload(plan.items[0], { url: "data:image/jpeg;base64,AA==", sentWidth: 500, sentHeight: 400, sourceWidth: 1000, sourceHeight: 800 });
  assert.equal(payload.width, 500);
  assert.deepEqual(payload.instances[0].polygons[0], [5, 5, 105, 5, 105, 105, 5, 105]);
  assert.deepEqual(payload.instances[0].holes[0], [25, 25, 50, 25, 50, 50]);
  assert.equal(payload.instances[0].origin, "manual");
  assert.equal(payload.fingerprint, plan.items[0].fingerprint);
});

test("only changed items are sent and deleted images are removed", () => {
  const plan = planAdaptiveDataset([asset, { ...asset, id: "img-2" }], [], [square(), square({ id: "x", asset: "img-2" })], { groupSequences: true });
  const remote = { [plan.items[0].key]: plan.items[0].fingerprint, [plan.items[1].key]: "stale", aGONE0000000000000: "x" };
  const diff = diffAgainstConnector(plan, remote);
  assert.deepEqual(diff.upload.map((item) => item.key), [plan.items[1].key]);
  assert.deepEqual(diff.remove, ["aGONE0000000000000"]);
  assert.equal(diff.unchanged, 1);
});

test("the project keeps its Adaptive AI identity across save and open", async () => {
  const id = newAdaptiveProjectId();
  assert.match(id, ADAPTIVE_PROJECT_ID_PATTERN);
  let saved;
  const originals = { document: globalThis.document, window: globalThis.window, create: URL.createObjectURL };
  URL.createObjectURL = (blob) => { saved = blob; return "blob:fixture"; };
  globalThis.document = { createElement: () => ({ style: {}, click() {}, remove() {} }), body: { appendChild() {} } };
  globalThis.window = { setTimeout: (callback) => { callback(); return 1; } };
  try {
    await savePoligomeProjectV4("P", [asset], [], [square()], getCopy("en"), undefined, id);
    const loaded = await openPoligomeProjectV4(await saved.arrayBuffer(), getCopy("en"));
    assert.equal(loaded.adaptiveProjectId, id);
    const zip = await JSZip.loadAsync(await saved.arrayBuffer());
    const manifest = JSON.parse(await zip.file("project.json").async("string"));
    manifest.adaptive_project_id = "../../etc";
    zip.file("project.json", JSON.stringify(manifest));
    const tampered = await openPoligomeProjectV4(await zip.generateAsync({ type: "uint8array" }), getCopy("en"));
    assert.equal(tampered.adaptiveProjectId, undefined, "an invalid id must be dropped, not trusted");
  } finally {
    globalThis.document = originals.document;
    globalThis.window = originals.window;
    URL.createObjectURL = originals.create;
  }
});

test("every language carries every string with the same placeholders", () => {
  const pt = getAdaptiveCopy("pt");
  const placeholders = (value) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join(",");
  for (const language of ["en", "fr", "es"]) {
    const copy = getAdaptiveCopy(language);
    for (const [key, value] of Object.entries(pt)) {
      assert.equal(typeof copy[key], "string", `${language}.${key} missing`);
      assert.ok(copy[key].length > 0 || ["activation_inactive", "precision_float32"].includes(key), `${language}.${key} empty`);
      assert.equal(placeholders(copy[key]), placeholders(value), `${language}.${key} placeholders differ`);
    }
  }
});

test("every server code in the fixture has a translated sentence", () => {
  const t = getAdaptiveCopy("en");
  for (const reason of [...backend.readiness.reasons, ...backend.readiness.gaps, ...backend.run.comparison.decision.reasons]) {
    assert.notEqual(reasonText(t, reason), reason.code, `untranslated reason ${reason.code}`);
    assert.doesNotMatch(reasonText(t, reason), /\{\w+\}/, `unfilled placeholder in ${reason.code}`);
  }
  assert.ok(t[`state_${backend.readiness.state}`]);
  assert.ok(t[`diag_${backend.run.diagnosis.state}`]);
});

test("readiness view explains the state and labels the indicators honestly", () => {
  const t = getAdaptiveCopy("pt");
  const markup = render(ReadinessView, { t, report: backend.readiness });
  const content = text(markup);
  assert.match(content, new RegExp(t[`state_${backend.readiness.state}`]));
  assert.match(content, /não a probabilidade/);
  assert.match(content, /Imagens independentes/);
  assert.equal(countClass(markup, "adaptive-meter"), backend.readiness.components.filter((component) => component.target).length);
});

test("training view shows measured epochs and marks the best one", () => {
  const t = getAdaptiveCopy("en");
  const run = backend.run;
  const markup = render(TrainingView, { t, record: run, busy: false, onCancel: () => {} });
  const content = text(markup);
  assert.match(content, /Completed/);
  assert.match(content, new RegExp(`★ ${run.best_epoch}`));
  assert.match(content, new RegExp(t[`diag_${run.diagnosis.state}`]));
  assert.equal(countClass(markup, "adaptive-chart"), 2);
  assert.equal(countClass(markup, "adaptive-progress"), 0, "a finished run has no progress bar");
  const running = render(TrainingView, { t, record: { ...run, status: "training", progress: { phase: "training", epoch: 2, max_epochs: 10, done: 3, total: 12 } }, busy: false, onCancel: () => {} });
  assert.match(text(running), /Epoch 2 of up to 10: image 3 of 12/);
  assert.match(running, /<progress[^>]*max="12"[^>]*value="3"/);
});

test("round ids read as their start time", () => {
  assert.equal(runLabel("run-20261013t144705z-b2c8f2"), "2026-10-13 14:47 UTC");
});

test("metric chart refuses to draw without data", () => {
  assert.equal(render(MetricChart, { title: "x", epochs: [], series: [] }), "");
});

test("comparison view states the decision, the interval and the simulation caveat", () => {
  const t = getAdaptiveCopy("en");
  const markup = render(ComparisonView, { t, comparison: backend.run.comparison, examples: {} });
  const content = text(markup);
  assert.match(content, new RegExp(t[`outcome_${backend.run.comparison.decision.outcome}`]));
  assert.match(content, /95% CI/);
  assert.match(content, /simulated/);
  assert.match(content, /Original SAM/);
  assert.equal(countClass(markup, "adaptive-example-placeholder"), backend.run.comparison.examples.length);
});

test("the panel without a project asks for one instead of showing numbers", () => {
  const markup = render(AdaptiveAiPanel, { language: "en", endpoint: "http://127.0.0.1:7860/predict", project: null });
  assert.match(text(markup), /Open or create a project/);
  assert.doesNotMatch(markup, /adaptive-chart/);
});

test("the AI hub has an Adaptive AI tab that renders the panel", () => {
  const props = {
    language: "en", tab: "adaptive", onTabChange: () => {}, selectedModelId: "sam2.1-hiera-small", loadedModelId: null,
    connectionState: "offline", samActive: false, runtimeLabel: "", loadError: null, availability: [], connectorHost: null,
    endpoint: "http://127.0.0.1:7860/predict", byomModels: [], byomBusy: false,
    runtime: { state: "offline", endpoint: "http://127.0.0.1:7861", manifest: null, setEndpoint: () => {}, refresh: () => {} },
    onSelectModel: () => {}, onPreannotate: () => {}, onRegisterByomModel: async () => ({ ok: true }), onRemoveByomModel: () => {},
    onUnselectAll: () => {}, onEndpointChange: () => {}, onRecheckConnector: () => {}, onConnect: () => {}, onClose: () => {},
    adaptiveProject: { id: "p-test-project", name: "P", assets: [asset], labels: [], annotations: [square()] },
  };
  const markup = render(SamSetupModal, props);
  assert.match(markup, /aria-selected="true"[^>]*><svg[^>]*>.*?<b>Adaptive AI<\/b>/s);
  assert.match(text(markup), /Looking for the local connector/);
});

test("single letters before a number do not merge unrelated names", () => {
  const groups = ["field-f5.png", "field-s18.png", "field-t19.png", "field-a0.png"].map(sequenceGroup);
  assert.equal(new Set(groups).size, 4, JSON.stringify(groups));
});

test("installers pin the adaptive module they download", async () => {
  const { createHash } = await import("node:crypto");
  const digest = createHash("sha256").update(readFileSync(new URL("../public/poligome-sam-adaptive.py", import.meta.url))).digest("hex");
  const bash = readFileSync(new URL("../public/poligome-sam-macos-linux.sh", import.meta.url), "utf8");
  const powershell = readFileSync(new URL("../public/poligome-sam-windows-native.ps1", import.meta.url), "utf8");
  assert.match(bash, new RegExp(`^DEFAULT_ADAPTIVE_SHA256="${digest}"$`, "m"), "bash installer pin is stale: run the pin update");
  assert.match(powershell, new RegExp(`^\\$DefaultAdaptiveSha256 = '${digest}'\\r?$`, "m"), "PowerShell installer pin is stale");
});

test("readiness says how many more independent images to annotate", () => {
  const t = getAdaptiveCopy("en");
  const report = backend.readiness;
  const needed = imagesStillNeeded(report);
  assert.equal(needed, Math.max(0, report.thresholds.target_independent - report.counts.independent_groups));
  const short = { ...report, counts: { ...report.counts, independent_groups: 10 } };
  assert.equal(imagesStillNeeded(short), report.thresholds.target_independent - 10);
  assert.match(text(render(ReadinessView, { t, report: short })), new RegExp(`annotate about ${report.thresholds.target_independent - 10} images from new sources`));
  const frozen = { ...report, split_frozen: true, counts: { ...report.counts, independent_groups: 40, holdout: { ...report.counts.holdout, groups: 4 } } };
  assert.equal(imagesStillNeeded(frozen), Math.ceil((report.thresholds.target_holdout_groups - 4) / report.thresholds.holdout_fraction));
});

test("learning curve view answers how many images, with its caveats", () => {
  const t = getAdaptiveCopy("en");
  const curve = backend.run.learning_curve;
  assert.ok(curve.points.length >= 4, "fixture must carry a real curve");
  const markup = render(LearningCurveView, { t, curve });
  const content = text(markup);
  assert.match(content, new RegExp(t[`curveTrend_${curve.trend}`]));
  assert.match(content, /With \d+ training groups/);
  assert.match(content, /order of magnitude/);
  assert.equal(countClass(markup, "adaptive-chart"), 1);
  assert.match(text(render(LearningCurveView, { t, curve: { skipped: "too_few_groups" } })), /too few training groups/);
});

test("suggestions list the most novel unannotated image first and open it", () => {
  const t = getAdaptiveCopy("en");
  const names = new Map(backend.suggestions.suggestions.map((entry, index) => [entry.key, { id: `asset-${index}`, name: `image-${index}.png` }]));
  const markup = render(SuggestionsView, { t, suggestions: backend.suggestions.suggestions, names, method: backend.suggestions.method, analyzed: 2 });
  const content = text(markup);
  assert.match(content, /image-0\.png.*very different/s);
  assert.match(content, /near-copy of an annotated image/);
  assert.equal((markup.match(/<button/g) ?? []).length, 2);
});

test("candidates are the available images without approved masks", () => {
  const assets = [asset, { ...asset, id: "img-2", name: "b.png" }, { ...asset, id: "img-3", missing: true, src: "" }];
  const plan = planAdaptiveDataset(assets, [], [square()], { groupSequences: true });
  const candidates = planAdaptiveCandidates(assets, plan);
  assert.deepEqual(candidates.map((candidate) => candidate.asset.id), ["img-2"]);
  assert.equal(candidates[0].key, itemKeyFor("img-2"));
});

test("the next step follows the real state, one action at a time", () => {
  const ready = backend.readiness;
  const run = backend.run;
  const with_ = (outcome, extra = {}) => ({ ...run, comparison: { ...run.comparison, decision: { outcome, reasons: [] } }, ...extra });
  assert.deepEqual(nextStep({ report: null, record: null, activeHere: false }), { stage: 0, key: "analyze" });
  const notReady = { ...ready, can_train: false, counts: { ...ready.counts, independent_groups: 5 } };
  assert.deepEqual(nextStep({ report: notReady, record: null, activeHere: false }), { stage: 0, key: "annotate", n: ready.thresholds.target_independent - 5 });
  assert.equal(nextStep({ report: ready, record: null, activeHere: false }).key, "train");
  assert.equal(nextStep({ report: ready, record: { ...run, status: "training" }, activeHere: false }).key, "training");
  assert.equal(nextStep({ report: ready, record: with_("improved"), activeHere: false }).key, "activate");
  assert.equal(nextStep({ report: ready, record: with_("improved", { activation: "active" }), activeHere: true }).key, "active");
  assert.equal(nextStep({ report: ready, record: with_("insufficient_evidence"), activeHere: false }).key, "more_evidence");
  assert.equal(nextStep({ report: ready, record: with_("not_improved"), activeHere: false }).key, "kept");
  assert.equal(nextStep({ report: ready, record: { ...run, status: "failed" }, activeHere: false }).key, "failed");
  const markup = render(NextStepCard, { t: getAdaptiveCopy("en"), step: { stage: 0, key: "annotate", n: 7 } });
  assert.match(text(markup), /Annotate about 7 images from new sources/);
  assert.match(markup, /aria-current="step"/);
});
