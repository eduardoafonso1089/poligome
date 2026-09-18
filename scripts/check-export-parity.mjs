import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, rmSync, symlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import JSZip from 'jszip';

const root = process.cwd();
const mainRoot = resolve('.tmp-export-main');

function round(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Number(value.toFixed(8)) : value;
  if (Array.isArray(value)) return value.map(round);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, round(item)]));
  }
  return value;
}

// The GeoJSON feature properties were renamed from Portuguese to English. The
// geometry, the CRS and every value are untouched, so the golden keeps comparing
// the payload by mapping the old key names onto the new ones. Recorded in
// tests/fixtures/export-parity-justifications.json under geojson.property_names.
const GEOJSON_RENAMES = {
  classe: 'class',
  classe_id: 'class_id',
  cor: 'color',
  forma: 'shape',
  rotacao: 'rotation',
  recorte: 'source_image',
  origem: 'source_raster',
};

function normalizeGeoJson(document) {
  const clone = JSON.parse(JSON.stringify(document));
  for (const feature of clone.features ?? []) {
    const properties = feature.properties ?? {};
    feature.properties = Object.fromEntries(
      Object.entries(properties).map(([key, value]) => [GEOJSON_RENAMES[key] ?? key, value]),
    );
  }
  return round(clone);
}

function normalizeCoco(document) {
  const clone = JSON.parse(JSON.stringify(document));
  for (const annotation of clone.annotations ?? []) {
    if ((annotation.num_keypoints ?? 0) > 0) {
      delete annotation.bbox;
      delete annotation.area;
    }
  }
  return round(clone);
}

function geoReferenceFor(asset) {
  return {
    source: 'demo.tif', crs: 'EPSG:4326', originX: -45, originY: -20,
    scaleX: 0.0001, scaleY: -0.0001,
    sourceWidth: asset.width, sourceHeight: asset.height,
    window: { x: 0, y: 0, w: asset.width, h: asset.height },
    cropWidth: asset.width, cropHeight: asset.height,
    transform: [0.0001, 0, -45, 0, -0.0001, -20],
  };
}

function normalizeProjectAnnotation(annotation) {
  if (annotation.type === 'box') {
    return round({
      id: annotation.id, asset: annotation.asset, label: annotation.label, type: annotation.type,
      x: annotation.x, y: annotation.y, width: annotation.width, height: annotation.height,
      rotation: annotation.rotation ?? 0,
    });
  }
  if (annotation.type === 'point') {
    return round({ id: annotation.id, asset: annotation.asset, label: annotation.label, type: annotation.type, x: annotation.x, y: annotation.y });
  }
  return round({
    id: annotation.id, asset: annotation.asset, label: annotation.label, type: annotation.type,
    vertices: annotation.vertices.flatMap((vertex) => [vertex.x, vertex.y]),
    holes: (annotation.holes ?? []).map((hole) => hole.flatMap((vertex) => [vertex.x, vertex.y])),
  });
}

// Poligome stopped exporting image bytes, and YOLO boxes and polygons became
// separate dataset roots because segmentation YOLO does not accept them mixed.
// The rows are what the golden protects, so both sides are reduced to the rows
// written per image: canonical main's mixed labels/<split>/<index>-<stem>.txt
// against the branch's bbox/ and polygon/ roots. Recorded in
// tests/fixtures/export-parity-justifications.json under yolo.package_layout.
//
// The branch is asked for one unsplit dataset carrying both geometries: no
// split means no shuffle, so the golden stays deterministic while still
// covering every annotation the demo holds.
const BRANCH_YOLO_OPTIONS = { mode: 'both', train: 80, val: 20, test: 0, includeTest: false, strategy: 'random', splitDataset: false };
const LABEL_PATH = /(?:^|\/)labels\/(?:[^/]+\/)?(?:\d+-)?(.+)\.txt$/;

function yoloRows(snapshot) {
  const rows = new Map();
  for (const [path, content] of Object.entries(snapshot)) {
    const match = LABEL_PATH.exec(path);
    if (!match) continue;
    const stem = match[1];
    rows.set(stem, [...(rows.get(stem) ?? []), ...content.split('\n').filter(Boolean)].sort());
  }
  return Object.fromEntries([...rows].sort(([a], [b]) => a.localeCompare(b)));
}

const imageEntries = (snapshot) => Object.keys(snapshot).filter((path) => /(?:^|\/)images\//.test(path));

async function zipSnapshot(blob) {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const output = {};
  for (const name of Object.keys(zip.files).sort()) {
    const entry = zip.files[name];
    if (entry.dir) continue;
    if (/\.(txt|yaml|json)$/i.test(name)) output[name] = await entry.async('string');
    else output[name] = createHash('sha256').update(await entry.async('uint8array')).digest('hex');
  }
  return output;
}

async function projectManifest(blob) {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const document = JSON.parse(await zip.file('project.json').async('string'));
  if ('saved_at' in document) document.saved_at = '<timestamp>';
  return document;
}

rmSync(mainRoot, { recursive: true, force: true });
execFileSync('git', ['worktree', 'add', '--detach', mainRoot, 'origin/main'], { stdio: 'ignore' });
if (!existsSync(resolve(mainRoot, 'node_modules'))) symlinkSync(resolve(root, 'node_modules'), resolve(mainRoot, 'node_modules'), 'dir');

const objectBlobs = new Map();
let objectId = 0;
let lastBlob = null;
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
const originalFetch = globalThis.fetch;
const originalDocument = globalThis.document;
const originalWindow = globalThis.window;
URL.createObjectURL = (blob) => { const url = `blob:parity-${++objectId}`; objectBlobs.set(url, blob); lastBlob = blob; return url; };
URL.revokeObjectURL = () => {};
globalThis.document = { createElement: () => ({ style: {}, click() {}, remove() {} }), body: { appendChild() {} } };
globalThis.window = { setTimeout: (callback) => { callback(); return 1; } };
globalThis.fetch = async (input) => {
  const url = String(input);
  if (url.startsWith('/demo/')) return new Response(new Blob([`fixture:${url}`], { type: 'image/jpeg' }), { status: 200 });
  if (objectBlobs.has(url)) return new Response(objectBlobs.get(url), { status: 200 });
  return new Response(null, { status: 404 });
};

const moduleAt = (base, path) => import(`${pathToFileURL(resolve(base, path)).href}?parity=${Date.now()}-${Math.random()}`);

function yoloArchive(exporters, assets, labels, annotations, readme, canonical) {
  return canonical
    ? exporters.exportEditorYoloZip(assets, labels, annotations, readme)
    : exporters.exportEditorYoloZip(assets, labels, annotations, readme, BRANCH_YOLO_OPTIONS);
}

async function snapshot(base, { canonical }) {
  const demoModule = await moduleAt(base, 'app/lib/demo.ts');
  const i18n = await moduleAt(base, 'app/lib/i18n.ts');
  const demo = await demoModule.createCanonicalDemoProject('pt');
  const assets = demo.assets.map((asset) => ({ ...asset, geo: geoReferenceFor(asset) }));
  const exporters = await moduleAt(base, 'app/editor/export/export-files.ts');
  const coco = JSON.parse(JSON.stringify(exporters.buildCocoDocument(assets, demo.labels, demo.annotations)));
  const yolo = await zipSnapshot(await yoloArchive(exporters, assets, demo.labels, demo.annotations, 'golden', canonical));
  const geojson = JSON.parse(JSON.stringify(exporters.buildGeoJson(assets, demo.labels, demo.annotations)));
  const project = await moduleAt(base, 'app/lib/project.ts');
  lastBlob = null;
  // Canonical main still takes the save mode the branch retired; every new
  // .plgm is annotation-only. Recorded under project.annotation_only_save.
  const copy = i18n.getCopy('pt');
  if (canonical) await project.savePoligomeProjectV4(demo.name, assets, demo.labels, demo.annotations, 'annotations', copy);
  else await project.savePoligomeProjectV4(demo.name, assets, demo.labels, demo.annotations, copy);
  const manifest = await projectManifest(lastBlob);

  return {
    coco, yolo, geojson, manifest,
    semanticProject: round({
      project_name: manifest.project_name,
      coordinate_space: manifest.coordinate_space,
      version: manifest.version,
      assets: manifest.assets.map((asset) => ({ id: asset.id, name: asset.name, width: asset.width, height: asset.height, missing: asset.missing })),
      labels: manifest.labels,
      annotations: manifest.annotations.map(normalizeProjectAnnotation),
    }),
  };
}

async function nonUniformYoloSnapshot(base, { canonical }) {
  const width = 4032;
  const height = 3024;
  const asset = { id: 'nonuniform', name: 'nonuniform.jpg', src: '/demo/nonuniform.jpg', local: false, width, height };
  const labels = [{ id: 'target', name: 'target', color: '#6c8cff', key: '' }];
  const annotations = [
    { id: 'box', asset: asset.id, label: labels[0].id, type: 'box', x: 403.2, y: 302.4, width: 1209.6, height: 907.2, rotation: 0 },
    { id: 'polygon', asset: asset.id, label: labels[0].id, type: 'polygon', vertices: [
      { id: 'p0', x: 403.2, y: 302.4 },
      { id: 'p1', x: 3628.8, y: 302.4 },
      { id: 'p2', x: 3628.8, y: 2721.6 },
      { id: 'p3', x: 403.2, y: 2721.6 },
    ], holes: [] },
  ];
  const exporters = await moduleAt(base, 'app/editor/export/export-files.ts');
  return zipSnapshot(await yoloArchive(exporters, [asset], labels, annotations, 'golden-nonuniform', canonical));
}

try {
  const main = await snapshot(mainRoot, { canonical: true });
  const branch = await snapshot(root, { canonical: false });
  const mainNonUniformYolo = await nonUniformYoloSnapshot(mainRoot, { canonical: true });
  const branchNonUniformYolo = await nonUniformYoloSnapshot(root, { canonical: false });

  const canonicalRows = yoloRows(main.yolo);
  assert.ok(Object.keys(canonicalRows).length > 0, 'no YOLO label path matched; the row normalization is reading nothing');

  assert.deepEqual(normalizeCoco(branch.coco), normalizeCoco(main.coco), 'COCO canonical main golden diverged');
  assert.deepEqual(yoloRows(branch.yolo), canonicalRows, 'YOLO canonical main rows diverged');
  assert.deepEqual(yoloRows(branchNonUniformYolo), yoloRows(mainNonUniformYolo), 'YOLO non-uniform source-dimension rows diverged');
  // The packaging change is asserted rather than assumed: the branch ships no
  // image bytes, and the label carries the image stem YOLO pairs it with.
  assert.deepEqual(imageEntries(branch.yolo), [], 'the branch YOLO package still carries image bytes');
  assert.ok(imageEntries(main.yolo).length > 0, 'canonical main no longer bundles images; this normalization is obsolete');
  assert.equal(branchNonUniformYolo['bbox/labels/nonuniform.txt'], '0 0.250000 0.250000 0.300000 0.300000');
  assert.equal(branchNonUniformYolo['polygon/labels/nonuniform.txt'], '0 0.100000 0.100000 0.900000 0.100000 0.900000 0.900000 0.100000 0.900000');
  assert.deepEqual(normalizeGeoJson(branch.geojson), normalizeGeoJson(main.geojson), 'GeoJSON canonical main golden diverged');
  // The rename itself is asserted rather than assumed: the branch must carry the
  // new names and none of the old ones.
  const branchKeys = new Set(branch.geojson.features.flatMap((feature) => Object.keys(feature.properties)));
  for (const [oldName, newName] of Object.entries(GEOJSON_RENAMES)) {
    assert.ok(!branchKeys.has(oldName), `GeoJSON still exports the Portuguese property ${oldName}`);
    assert.ok(branchKeys.has(newName), `GeoJSON is missing the renamed property ${newName}`);
  }
  assert.deepEqual(branch.semanticProject, main.semanticProject, 'semantic .plgm canonical main content diverged');

  console.log('Canonical-main goldens passed: COCO/YOLO rows/GeoJSON/.plgm plus non-uniform YOLO source-dimension parity.');
} finally {
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  globalThis.fetch = originalFetch;
  globalThis.document = originalDocument;
  globalThis.window = originalWindow;
  try { execFileSync('git', ['worktree', 'remove', '--force', mainRoot], { stdio: 'ignore' }); } catch {}
  rmSync(mainRoot, { recursive: true, force: true });
}
