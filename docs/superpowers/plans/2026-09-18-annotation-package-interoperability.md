# Annotation Package Interoperability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export standards-shaped, annotation-only COCO and YOLO ZIPs, re-import those ZIPs against already loaded images with explicit match warnings, and remove every new-project image export path.

**Architecture:** Keep COCO as the canonical in-editor import representation. A new package reader detects and merges COCO ZIP documents or converts YOLO rows into a synthetic COCO document, then reuses the existing selection, worker, and conversion pipeline. Export uses one tested split assignment shared by COCO and every YOLO root; standard files are authoritative and a small optional Poligome manifest only improves exact round trips.

**Tech Stack:** TypeScript 5.9, React 19, JSZip 3.10, `yaml` parser, Node test runner, Vite/vinext.

**Spec:** `docs/superpowers/specs/2026-09-18-annotation-package-interoperability-design.md`

## Global Constraints

- COCO, YOLO, and newly saved `.plgm` files contain annotations and image references only; never image bytes.
- Keep legacy `.plgm` files with `bundled_path` readable.
- Accept standalone COCO JSON plus standards-conforming COCO and YOLO ZIPs without requiring Poligome metadata.
- Preserve standard YOLO label/image stem equality and reject duplicate output label paths.
- Warn once per missing or ambiguous image reference and import the matched subset only.
- In `both` mode, produce independent `bbox/` and `polygon/` YOLO datasets.
- Localize all new UI in Portuguese, English, French, and Spanish.
- Follow TDD for every behavior change and commit each task independently.

---

### Task 1: Shared split assignment and package metadata

**Files:**
- Create: `app/editor/export/dataset-split.ts`
- Create: `app/editor/export/annotation-package-manifest.ts`
- Modify: `app/editor/export/export-files.ts`
- Test: `tests/dataset-split.test.mjs`

**Interfaces:**
- Consumes: existing `Asset`, `EditorAnnotation`, and `ExportSplitOptions` values.
- Produces: `assignDatasetSplits(assets, annotations, options, random?) => DatasetSplitAssignment`, `splitAssets(assignment, assets)`, `buildAnnotationPackageManifest(...)`, and stable manifest types used by Tasks 2 and 4.

- [ ] **Step 1: Write failing split tests**

```js
test('random allocation uses largest remainders and optional test', () => {
  const result = assignDatasetSplits(assets(10), [], {
    train: 70, val: 20, test: 10, includeTest: true, strategy: 'random'
  }, () => 0.25);
  assert.deepEqual(counts(result), { train: 7, val: 2, test: 1 });
});

test('balanced allocation targets instance proportions', () => {
  const result = assignDatasetSplits(fourAssets, annotationsWithCounts([8, 6, 2, 0]), {
    train: 50, val: 50, test: 0, includeTest: false, strategy: 'balanced'
  });
  assert.deepEqual(instanceCounts(result), { train: 8, val: 8 });
});
```

- [ ] **Step 2: Run the split tests and verify RED**

Run: `node --import tsx --import ./tests/helpers/register-hooks.mjs --test tests/dataset-split.test.mjs`

Expected: FAIL because `app/editor/export/dataset-split.ts` does not exist.

- [ ] **Step 3: Implement normalized target counts and assignment**

```ts
export type DatasetSplit = "train" | "val" | "test";
export type DatasetSplitAssignment = Map<string, DatasetSplit>;

export function assignDatasetSplits(
  assets: Asset[],
  annotations: EditorAnnotation[],
  options: ExportSplitOptions,
  random: () => number = Math.random,
): DatasetSplitAssignment;

export function splitAssets(
  assignment: DatasetSplitAssignment,
  assets: Asset[],
): Partial<Record<DatasetSplit, Asset[]>>;
```

Use largest-remainder integer counts for random splits. For balanced splits,
sort assets by descending instance count and assign each to the greatest
remaining proportional instance deficit; break ties with remaining image-count
deficit and then split order. Assign zero-instance images from image deficits.

- [ ] **Step 4: Add and test the optional manifest contract**

```ts
export type AnnotationPackageManifest = {
  format: "poligome-annotation-package";
  version: 1;
  annotation_format: "coco" | "yolo";
  geometry_mode: "mixed" | "bbox" | "polygon";
  images: Array<{
    asset_id: string;
    file_name: string;
    width: number;
    height: number;
    split: DatasetSplit;
  }>;
};
```

Assert that the manifest contains no `src`, blob, data URL, or bundled image
path and that the same assignment is reusable by multiple export roots.

- [ ] **Step 5: Run focused tests and commit**

Run: `node --import tsx --import ./tests/helpers/register-hooks.mjs --test tests/dataset-split.test.mjs`

Expected: PASS.

```bash
git add app/editor/export/dataset-split.ts app/editor/export/annotation-package-manifest.ts app/editor/export/export-files.ts tests/dataset-split.test.mjs
git commit -m "feat: add reusable annotation dataset splits"
```

---

### Task 2: Standards-shaped YOLO annotation package

**Files:**
- Modify: `app/editor/export/export-files.ts`
- Modify: `tests/yolo-export.test.mjs`
- Modify: `README.md`

**Interfaces:**
- Consumes: `assignDatasetSplits`, `splitAssets`, and `buildAnnotationPackageManifest` from Task 1.
- Produces: `buildYoloArchive(...) => Promise<JSZip>` for test inspection and `exportEditorYoloZip(...) => Promise<Blob>` for UI use.

- [ ] **Step 1: Replace prefix-based expectations with standard filename tests**

```js
test('YOLO labels preserve the exact image stem and split lists preserve extension', async () => {
  const zip = await buildYoloArchive(
    [{ id: 'a', name: 'field sample.JPG', src: '', width: 100, height: 50 }],
    labels,
    boxes,
    { mode: 'bbox', train: 100, val: 0, test: 0, includeTest: false, strategy: 'random' },
    () => 0.5,
  );
  assert.ok(zip.file('labels/train/field sample.txt'));
  assert.equal(await zip.file('train.txt').async('string'), 'images/train/field sample.JPG\n');
});

test('YOLO export rejects duplicate label stems', async () => {
  await assert.rejects(() => buildYoloArchive(
    duplicateStemAssets,
    labels,
    [],
    options,
  ), /yoloDuplicateLabelPath/);
});
```

- [ ] **Step 2: Run the YOLO tests and verify RED**

Run: `node --import tsx --import ./tests/helpers/register-hooks.mjs --test tests/yolo-export.test.mjs`

Expected: FAIL because current output prefixes filenames and exposes no archive builder.

- [ ] **Step 3: Implement standard root writer**

```ts
export async function buildYoloArchive(
  assets: Asset[],
  labels: Label[],
  annotations: EditorAnnotation[],
  options: YoloExportOptions,
  random: () => number = Math.random,
): Promise<JSZip>;

function writeYoloDataset(
  zip: JSZip,
  root: string,
  assets: Asset[],
  labels: Label[],
  annotations: EditorAnnotation[],
  assignment: DatasetSplitAssignment,
  mode: "bbox" | "polygon",
): void;
```

For each root, write `data.yaml`, split list files, non-empty conventional
label files, `classes.txt`, README, and `poligome-manifest.json`. Use YAML-safe
quoted names, normalized coordinates, and no numeric filename prefix. Create
`bbox/` and `polygon/` roots for `both` using the same assignment.

- [ ] **Step 4: Assert standard bbox, polygon, both, and annotation-only contents**

Add assertions that five-token rows exist only under bbox roots, polygon rows
have at least three coordinate pairs, all values are finite and within `[0,1]`,
`data.yaml` points at the split list files, no archive path starts with
`images/`, and no entry contains source image bytes.

- [ ] **Step 5: Run focused tests and commit**

Run: `node --import tsx --import ./tests/helpers/register-hooks.mjs --test tests/yolo-export.test.mjs tests/export-options-dialog.test.mjs`

Expected: PASS.

```bash
git add app/editor/export/export-files.ts tests/yolo-export.test.mjs README.md
git commit -m "feat: export interoperable YOLO annotation packages"
```

---

### Task 3: Complete COCO ZIP export

**Files:**
- Modify: `app/editor/export/export-files.ts`
- Create: `tests/coco-export.test.mjs`
- Modify: `tests/canonical-export-files.test.mjs`

**Interfaces:**
- Consumes: the shared assignment and manifest contract from Task 1.
- Produces: `buildCocoArchive(...) => Promise<JSZip>` and the existing `exportEditorCocoZip(...) => Promise<Blob>`.

- [ ] **Step 1: Write failing COCO archive tests**

```js
test('COCO ZIP writes complete independent split documents', async () => {
  const zip = await buildCocoArchive(assets, labels, annotations, options, () => 0.5);
  const train = JSON.parse(await zip.file('annotations/instances_train.json').async('string'));
  assert.deepEqual(Object.keys(train).sort(), ['annotations', 'categories', 'images', 'info']);
  assert.ok(train.images.every(image => image.file_name && image.width > 0 && image.height > 0));
  assert.ok(train.annotations.every(annotation =>
    Array.isArray(annotation.bbox) && Number.isFinite(annotation.area) && annotation.iscrowd === 0));
});

test('COCO ZIP contains no image entries or image bytes', async () => {
  const zip = await buildCocoArchive(assets, labels, annotations, options);
  assert.equal(Object.keys(zip.files).some(path => /^images\//i.test(path)), false);
});
```

- [ ] **Step 2: Run the COCO tests and verify RED**

Run: `node --import tsx --import ./tests/helpers/register-hooks.mjs --test tests/coco-export.test.mjs`

Expected: FAIL because `buildCocoArchive` does not exist and the old splitter is not reusable.

- [ ] **Step 3: Implement the COCO archive builder**

```ts
export async function buildCocoArchive(
  assets: Asset[],
  labels: Label[],
  annotations: EditorAnnotation[],
  options: ExportSplitOptions,
  random: () => number = Math.random,
): Promise<JSZip>;
```

Build every split document from the shared assignment. Keep image and category
IDs internally consistent per document, write one root manifest with
`geometry_mode: "mixed"`, and preserve all supported box, polygon, and keypoint
fields produced by `annotationToCoco`.

- [ ] **Step 4: Run focused tests and commit**

Run: `node --import tsx --import ./tests/helpers/register-hooks.mjs --test tests/coco-export.test.mjs tests/canonical-export-files.test.mjs`

Expected: PASS.

```bash
git add app/editor/export/export-files.ts tests/coco-export.test.mjs tests/canonical-export-files.test.mjs
git commit -m "feat: complete COCO annotation package export"
```

---

### Task 4: Format-neutral ZIP inspection and image matching

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `app/editor/import/image-reference-match.ts`
- Create: `app/editor/import/annotation-package-import.ts`
- Create: `app/editor/import/yolo-package-import.ts`
- Modify: `app/editor/import/coco-document-import.ts`
- Test: `tests/annotation-package-import.test.mjs`
- Test: `tests/yolo-package-import.test.mjs`
- Modify: `tests/coco-document-import.test.mjs`

**Interfaces:**
- Consumes: `JSZip`, `yaml.parse`, `CocoDocumentInput`, loaded `Asset[]`, and the optional manifest type.
- Produces: `inspectAnnotationFile(file, assets) => Promise<AnnotationPackageInspection>` and a shared non-ambiguous matcher.

```ts
export type ImageMatchIssue = {
  reference: string;
  reason: "missing" | "ambiguous" | "invalid";
};

export type AnnotationPackageInspection = {
  format: "coco" | "yolo";
  roots: string[];
  document: CocoDocumentInput;
  issues: ImageMatchIssue[];
};

export function matchImageReference(
  reference: string,
  assets: Asset[],
): { asset: Asset } | { issue: ImageMatchIssue };

export async function inspectAnnotationFile(
  file: File,
  assets: Asset[],
): Promise<AnnotationPackageInspection>;
```

- [ ] **Step 1: Add failing matcher tests**

Test normalized path, case-insensitive filename, unique stem fallback, missing
image, and two loaded assets with the same basename returning `ambiguous`.

- [ ] **Step 2: Run matcher tests and verify RED**

Run: `node --import tsx --import ./tests/helpers/register-hooks.mjs --test tests/annotation-package-import.test.mjs`

Expected: FAIL because the matcher and inspector do not exist.

- [ ] **Step 3: Implement safe matching and COCO ZIP merge**

Normalize slash direction, strip harmless leading `./`, reject absolute and
parent-traversal paths, and never select from multiple matches. Scan JSON files,
recognize COCO by array structure, and remap image/category/annotation IDs while
merging split documents into one `CocoDocumentInput`. Deduplicate issues by
normalized image reference so warnings are per image.

- [ ] **Step 4: Add `yaml` through the configured npm mirror**

Run: `npm config get registry`

Run: `npm install yaml@^2.8.1 --save`

Expected: `package.json` and `package-lock.json` declare the parser; installation
uses the configured mirror rather than changing registry settings.

- [ ] **Step 5: Write failing external YOLO fixture tests**

```js
test('imports a standard YOLO detect ZIP without a Poligome manifest', async () => {
  const zip = standardYoloZip({ row: '0 0.5 0.5 0.4 0.2' });
  const result = await inspectAnnotationFile(asFile(zip, 'external.zip'), loadedAssets);
  assert.equal(result.format, 'yolo');
  assert.equal(result.document.annotations?.[0].bbox?.length, 4);
  assert.deepEqual(result.issues, []);
});

test('detects separate bbox and polygon dataset roots', async () => {
  const result = await inspectAnnotationFile(asFile(bothRootsZip, 'both.zip'), loadedAssets);
  assert.deepEqual(result.roots.sort(), ['bbox', 'polygon']);
  assert.deepEqual(cocoGeometryTypes(result.document.annotations[0]), ['box']);
  assert.deepEqual(cocoGeometryTypes(result.document.annotations[1]), ['polygon']);
});
```

- [ ] **Step 6: Implement YOLO parsing into synthetic COCO**

Find standard YAML names nearest each dataset root. Parse `names` as map or
array, follow split `.txt` lists, and otherwise infer references from
`labels/<split>`. Treat exactly five tokens as bbox and odd rows with at least
three coordinate pairs as polygons. Validate class IDs and normalized finite
coordinates. Use matched asset dimensions to convert normalized coordinates to
pixel COCO fields. Record missing, ambiguous, invalid, and unsupported entries
without mutating editor state.

- [ ] **Step 7: Run import tests and commit**

Run: `node --import tsx --import ./tests/helpers/register-hooks.mjs --test tests/annotation-package-import.test.mjs tests/yolo-package-import.test.mjs tests/coco-document-import.test.mjs`

Expected: PASS.

```bash
git add package.json package-lock.json app/editor/import/image-reference-match.ts app/editor/import/annotation-package-import.ts app/editor/import/yolo-package-import.ts app/editor/import/coco-document-import.ts tests/annotation-package-import.test.mjs tests/yolo-package-import.test.mjs tests/coco-document-import.test.mjs
git commit -m "feat: inspect COCO and YOLO annotation ZIPs"
```

---

### Task 5: Import review UI and localized unmatched warnings

**Files:**
- Modify: `app/editor/import/coco-import-control.tsx`
- Modify: `app/editor/import/coco-import.worker.ts`
- Modify: `app/lib/i18n.ts`
- Modify: `app/globals.css`
- Modify: `tests/annotation-import-control.test.mjs`
- Create: `tests/annotation-import-localization.test.mjs`

**Interfaces:**
- Consumes: `inspectAnnotationFile` and `AnnotationPackageInspection` from Task 4.
- Produces: the existing `CocoImportHandle` with a format-neutral `.json,.zip` file picker and localized review diagnostics.

- [ ] **Step 1: Write failing source/UI contract tests**

```js
assert.match(importer, /accept="application\/json,application\/zip,.json,.zip"/);
assert.match(importer, /inspectAnnotationFile\(file, assets\)/);
assert.match(importer, /copy\.imagesWithoutMatch/);
assert.match(importer, /onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/);
```

Check every language exposes keys for detected format, matched images, missing
images, ambiguous images, invalid entries, partial import, and no matching
images.

- [ ] **Step 2: Run UI tests and verify RED**

Run: `node --import tsx --import ./tests/helpers/register-hooks.mjs --test tests/annotation-import-control.test.mjs tests/annotation-import-localization.test.mjs`

Expected: FAIL because ZIP acceptance and diagnostic copy are missing.

- [ ] **Step 3: Integrate package inspection into the modal**

Replace direct `JSON.parse(await file.text())` with `inspectAnnotationFile`.
Store `format`, `roots`, and `issues` in pending state. Display a warning panel
grouped by issue reason, list representative names plus remaining count, keep
matched candidates selectable, and disable OK only when no matched selectable
annotations exist. Include skipped-image counts in the completion message.

- [ ] **Step 4: Localize all new labels and stabilize modal events**

Add exact Portuguese, English, French, and Spanish messages. Use pointer-down
backdrop dismissal and stop propagation on the dialog, matching the corrected
export modal behavior.

- [ ] **Step 5: Run focused tests and commit**

Run: `node --import tsx --import ./tests/helpers/register-hooks.mjs --test tests/annotation-import-control.test.mjs tests/annotation-import-localization.test.mjs tests/export-controls-rendering.test.mjs`

Expected: PASS.

```bash
git add app/editor/import/coco-import-control.tsx app/editor/import/coco-import.worker.ts app/lib/i18n.ts app/globals.css tests/annotation-import-control.test.mjs tests/annotation-import-localization.test.mjs
git commit -m "feat: review COCO and YOLO ZIP imports"
```

---

### Task 6: Remove all new image-export paths

**Files:**
- Modify: `app/lib/project.ts`
- Modify: `app/lib/types.ts`
- Modify: `app/editor/session/editor-session-io.ts`
- Modify: `app/editor/presentation/pre-refactor-chrome.tsx`
- Modify: `app/editor/workbench/canonical-editor-workbench.tsx`
- Modify: `app/lib/i18n.ts`
- Modify: `tests/project-v4.test.mjs`
- Modify: `tests/raster-project.test.mjs`
- Modify: `tests/runtime-raster-persistence.test.mjs`
- Modify: `tests/editor-session-io.test.mjs`
- Modify: `tests/project-lifecycle-parity.test.mjs`

**Interfaces:**
- Consumes: current V4 project manifest reader.
- Produces: annotation-only `savePoligomeProjectV4(projectName, assets, labels, annotations, copy, layout?)` and `saveEditorProject(projectName, assets, labels, annotations, copy, layout?)`; legacy read behavior remains unchanged.

- [ ] **Step 1: Write failing annotation-only save tests**

```js
await savePoligomeProjectV4('Only annotations', assets, labels, annotations, getCopy('en'));
const zip = await JSZip.loadAsync(await saved.arrayBuffer());
assert.deepEqual(Object.keys(zip.files), ['project.json']);
const manifest = JSON.parse(await zip.file('project.json').async('string'));
assert.equal(manifest.assets[0].missing, true);
assert.equal('bundled_path' in manifest.assets[0], false);
assert.equal('source' in manifest.assets[0], false);
```

Create the legacy bundled read fixture directly with JSZip and verify
`openPoligomeProjectV4` still restores its object URL and raster file handle.

- [ ] **Step 2: Run project tests and verify RED**

Run: `node --import tsx --import ./tests/helpers/register-hooks.mjs --test tests/project-v4.test.mjs tests/raster-project.test.mjs tests/runtime-raster-persistence.test.mjs`

Expected: FAIL while save signatures and complete-mode tests still exist.

- [ ] **Step 3: Remove the write mode and bundling implementation**

Delete `ProjectSaveMode`, `safeFileName`, image fetching, `portableAssets` mode
branches, and every `complete` save call. Serialize assets as metadata plus
`missing: true`. Keep `PortableAsset.bundled_path`, `source`, and
`hydrateAssets` only in the reader for backwards compatibility.

- [ ] **Step 4: Simplify the project-save UI**

Change topbar `onSaveProject` to `() => void`, remove the radio modal and its
`Images` option, invoke annotation-only save directly from the menu/button, and
remove stale `saveMode` state. Rewrite copy in all four languages so it never
suggests image export or a complete project.

- [ ] **Step 5: Run project and UI tests and commit**

Run: `node --import tsx --import ./tests/helpers/register-hooks.mjs --test tests/project-v4.test.mjs tests/raster-project.test.mjs tests/runtime-raster-persistence.test.mjs tests/editor-session-io.test.mjs tests/project-lifecycle-parity.test.mjs`

Expected: PASS, including handcrafted legacy bundled-project read coverage.

```bash
git add app/lib/project.ts app/lib/types.ts app/editor/session/editor-session-io.ts app/editor/presentation/pre-refactor-chrome.tsx app/editor/workbench/canonical-editor-workbench.tsx app/lib/i18n.ts tests/project-v4.test.mjs tests/raster-project.test.mjs tests/runtime-raster-persistence.test.mjs tests/editor-session-io.test.mjs tests/project-lifecycle-parity.test.mjs
git commit -m "refactor: make project export annotation only"
```

---

### Task 7: End-to-end round trips and final verification

**Files:**
- Create: `tests/annotation-package-roundtrip.test.mjs`
- Modify: `README.md`
- Modify: `docs/PLATFORM.md`

**Interfaces:**
- Consumes: archive builders from Tasks 2 and 3 and inspector from Task 4.
- Produces: executable proof that Poligome can read its own outputs and documented annotation-only behavior.

- [ ] **Step 1: Write round-trip integration tests**

```js
for (const mode of ['bbox', 'polygon', 'both']) {
  test(`round-trips Poligome YOLO ${mode} ZIP`, async () => {
    const zip = await buildYoloArchive(assets, labels, annotations, { ...options, mode });
    const inspected = await inspectAnnotationFile(asFile(zip, `${mode}.zip`), assets);
    const imported = importCocoDocument(inspected.document, assets, [], makeId);
    assert.equal(imported.unmatched, 0);
    assert.deepEqual(annotationKinds(imported.annotations), expectedKinds[mode]);
  });
}

test('round-trips a split COCO ZIP and warns for one absent image', async () => {
  const zip = await buildCocoArchive(assets, labels, annotations, options);
  const inspected = await inspectAnnotationFile(asFile(zip, 'coco.zip'), assets.slice(0, -1));
  assert.equal(inspected.issues.filter(issue => issue.reason === 'missing').length, 1);
});
```

- [ ] **Step 2: Run round-trip tests and verify RED if any contract is incomplete**

Run: `node --import tsx --import ./tests/helpers/register-hooks.mjs --test tests/annotation-package-roundtrip.test.mjs`

Expected before final fixes: any mismatch exposes the precise exporter/importer contract gap.

- [ ] **Step 3: Make only the minimal contract fixes exposed by the tests**

Keep fixes inside the owning exporter/importer modules. Do not add image bytes,
proprietary required fields, silent filename rewrites, or fallback matching that
selects an ambiguous asset.

- [ ] **Step 4: Update user documentation**

Document supported COCO/YOLO ZIP layouts, the need to load original images
before importing annotations, unmatched-image warnings, standard filename
matching, split strategies, optional test split, and the annotation-only `.plgm`
policy with legacy read compatibility.

- [ ] **Step 5: Run full verification**

Run: `npm run typecheck`

Expected: PASS.

Run: `npm run test:unit`

Expected: all tests PASS, with only intentionally documented skips.

Run: `npm run build`

Expected: production build PASS.

Run: `rtk git diff --check`

Expected: no whitespace errors.

- [ ] **Step 6: Commit the integration proof and documentation**

```bash
git add tests/annotation-package-roundtrip.test.mjs README.md docs/PLATFORM.md
git commit -m "test: verify annotation package round trips"
```
