import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyImportFiles, filesFromDrop, importFilePath } from '../app/editor/import/dropped-files.ts';
import { inspectAnnotationFiles } from '../app/editor/import/annotation-package-import.ts';
import { matchImageReference } from '../app/editor/import/image-reference-match.ts';
import { FileDropZone } from '../app/editor/import/file-drop-zone.tsx';
import { fileDropCopy } from '../app/editor/import/file-drop-copy.ts';
import { render, countAttribute } from './helpers/render.mjs';

const file = (name, content = '', path = '') => {
  const value = new File([content], name);
  if (path) Object.defineProperty(value, 'webkitRelativePath', { value: path });
  return value;
};
const entry = name => ({ name, isFile: true, isDirectory: false, file: callback => queueMicrotask(() => callback(file(name))) });
const directory = (name, batches) => ({ name, isFile: false, isDirectory: true,
  createReader: () => { let batch = 0; return { readEntries: callback => queueMicrotask(() => callback(batches[batch++] ?? [])) }; } });

test('folder drop reads all directory batches and subfolders, preserving paths', async () => {
  const root = directory('dataset', [Array.from({ length: 100 }, (_, i) => entry(`${i}.png`)), [directory('labels', [[entry('one.txt')]]), entry('.DS_Store'), entry('last.png')]]);
  const transfer = { items: [{ kind: 'file', webkitGetAsEntry: () => root, getAsFile: () => null }], files: [] };
  const pending = filesFromDrop(transfer);
  transfer.items = []; // Native drag data becomes unavailable after dispatch.
  const files = await pending;
  assert.equal(files.length, 102);
  assert.equal(importFilePath(files[100]), 'dataset/labels/one.txt');
  assert.equal(importFilePath(files[101]), 'dataset/last.png');
});

test('file drops work without directory APIs and directory read errors propagate', async () => {
  const image = file('one.png');
  assert.deepEqual(await filesFromDrop({ items: [{ kind: 'file', getAsFile: () => image }], files: [image] }), [image]);
  assert.deepEqual(await filesFromDrop({ items: [], files: [image] }), [image]);
  const unreadable = { ...entry('one.png'), file: (_, reject) => reject(new DOMException('Denied')) };
  await assert.rejects(filesFromDrop({ items: [{ kind: 'file', getAsFile: () => null, webkitGetAsEntry: () => unreadable }], files: [] }), /Denied/);
});

test('mixed files are routed to the correct importer and unsupported files are counted', () => {
  const parts = classifyImportFiles(['a.PNG', 'b.jpg', 'instances.json', 'labels.txt', 'data.yaml', 'dataset.zip', 'project.plgm', 'notes.pdf', 'large.tif'].map(name => file(name)));
  assert.equal(parts.images.length, 2);
  assert.equal(parts.annotations.length, 4);
  assert.equal(parts.projects.length, 1);
  assert.equal(parts.unsupported.length, 2);
});

const assets = [
  { id: 'train', name: 'dataset/images/train/same.png', src: '', width: 100, height: 50 },
  { id: 'val', name: 'dataset/images/val/same.png', src: '', width: 100, height: 50 },
];

test('relative paths distinguish repeated filenames and YOLO path stems', () => {
  assert.equal(matchImageReference('images/train/same.png', assets).asset.id, 'train');
  assert.equal(matchImageReference('images/val/same', assets, { allowStem: true }).asset.id, 'val');
  assert.equal(matchImageReference('same.png', assets).issue.reason, 'ambiguous');
});

test('COCO in a folder matches images in the same batch with duplicate basenames', async () => {
  const document = { images: [{ id: 1, file_name: 'images/train/same.png' }, { id: 2, file_name: 'images/val/same.png' }], categories: [{ id: 1, name: 'object' }], annotations: [{ id: 1, image_id: 1, category_id: 1, bbox: [1, 2, 10, 10] }, { id: 2, image_id: 2, category_id: 1, bbox: [20, 2, 10, 10] }] };
  const result = await inspectAnnotationFiles([file('instances.json', JSON.stringify(document), 'dataset/annotations/instances.json')], assets);
  assert.equal(result.document.annotations.length, 2);
  assert.deepEqual(result.issues, []);
});

test('YOLO folder preserves YAML classes and train/val paths', async () => {
  const result = await inspectAnnotationFiles([
    file('data.yaml', 'train: images/train\nval: images/val\nnames: [Tree]\n', 'dataset/data.yaml'),
    file('same.txt', '0 0.5 0.5 0.2 0.2\n', 'dataset/labels/train/same.txt'),
    file('same.txt', '0 0.3 0.3 0.2 0.2\n', 'dataset/labels/val/same.txt'),
  ], assets);
  assert.equal(result.format, 'yolo');
  assert.equal(result.document.annotations.length, 2);
  assert.equal(result.document.categories[0].name, 'Tree');
  assert.deepEqual(result.issues, []);
});

test('loose YOLO labels also accept data.yaml without treating it as geometry', async () => {
  const result = await inspectAnnotationFiles([
    file('data.yaml', 'names: [Tree]\n'),
    file('unique.txt', '0 0.5 0.5 0.2 0.2\n'),
  ], [{ id: 'image', name: 'unique.png', src: '', width: 100, height: 50 }]);
  assert.equal(result.document.annotations.length, 1);
  assert.equal(result.document.categories[0].name, 'Tree');
  assert.deepEqual(result.issues, []);
});

test('drop area has accessible file and folder alternatives in every language', () => {
  for (const language of ['pt', 'en', 'fr', 'es']) {
    const html = render(FileDropZone, { language, onImport: async () => '' });
    assert.ok(html.includes(fileDropCopy(language).title));
    assert.equal(countAttribute(html, 'type', 'file'), 2);
    assert.match(html, /webkitdirectory/);
    assert.equal(countAttribute(html, 'aria-busy', 'false'), 1);
  }
});
