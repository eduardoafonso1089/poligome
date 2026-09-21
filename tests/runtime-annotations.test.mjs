import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureLabels, toEditorAnnotations, maskToPolygon } from '../app/lib/runtime-annotations.ts';

function ids() { let n = 0; return prefix => `${prefix}-${++n}`; }

const box = (label, geometry = { x: 10, y: 20, width: 30, height: 40 }) =>
  ({ kind: 'box', box: geometry, ...(label ? { label } : {}) });

// ---------------------------------------------------------------------------
// Classes e cores
// ---------------------------------------------------------------------------

test('cada classe nova ganha uma cor da paleta da importação', () => {
  const { labels } = ensureLabels(['telhado', 'carro'], [], ids());
  assert.equal(labels.length, 2);
  assert.notEqual(labels[0].color, labels[1].color);
  assert.match(labels[0].color, /^#[0-9a-f]{6}$/i);
});

test('uma classe repetida no mesmo lote não vira duas', () => {
  const { labels } = ensureLabels(['telhado', 'telhado'], [], ids());
  assert.equal(labels.length, 1);
});

test('uma classe que já existe é reaproveitada, sem olhar caixa', () => {
  const existing = [{ id: 'label-x', name: 'Telhado', color: '#123456', key: '' }];
  const { labels, byName } = ensureLabels(['telhado'], existing, ids());
  assert.equal(labels.length, 1);
  assert.equal(byName.get('telhado').id, 'label-x');
});

test('a anotação guarda o id da classe, não o nome', () => {
  // O canvas resolve a cor por labelById.get(annotation.label): guardar o nome
  // faz tudo cair no cinza padrão.
  const { byName } = ensureLabels(['telhado'], [], ids());
  const [annotation] = toEditorAnnotations([box('telhado')], {
    asset: 'img', fallbackLabelId: 'unlabeled', makeId: () => 'a-1', labelByName: byName,
  });
  assert.equal(annotation.label, byName.get('telhado').id);
  assert.notEqual(annotation.label, 'telhado');
});

test('sem rótulo do modelo, cai na classe ativa', () => {
  const [annotation] = toEditorAnnotations([box(null)], {
    asset: 'img', fallbackLabelId: 'label-ativa', makeId: () => 'a-1',
  });
  assert.equal(annotation.label, 'label-ativa');
});

test('um rótulo desconhecido não some: cai no padrão em vez de virar cinza sem classe', () => {
  const [annotation] = toEditorAnnotations([box('nunca-vista')], {
    asset: 'img', fallbackLabelId: 'label-ativa', makeId: () => 'a-1', labelByName: new Map(),
  });
  assert.equal(annotation.label, 'label-ativa');
});

// ---------------------------------------------------------------------------
// Escala entre o arquivo enviado e o asset
// ---------------------------------------------------------------------------

test('sem escala, a geometria passa intacta', () => {
  const [annotation] = toEditorAnnotations([box('t')], {
    asset: 'img', fallbackLabelId: 'u', makeId: () => 'a-1',
  });
  assert.deepEqual(
    { x: annotation.x, y: annotation.y, width: annotation.width, height: annotation.height },
    { x: 10, y: 20, width: 30, height: 40 },
  );
});

test('a caixa encolhe quando o asset é menor que o arquivo enviado', () => {
  const [annotation] = toEditorAnnotations([box('t')], {
    asset: 'img', fallbackLabelId: 'u', makeId: () => 'a-1', scaleX: 0.5, scaleY: 0.5,
  });
  assert.deepEqual(
    { x: annotation.x, y: annotation.y, width: annotation.width, height: annotation.height },
    { x: 5, y: 10, width: 15, height: 20 },
  );
});

test('a escala vale para cada eixo por separado', () => {
  const [annotation] = toEditorAnnotations([box('t')], {
    asset: 'img', fallbackLabelId: 'u', makeId: () => 'a-1', scaleX: 2, scaleY: 0.5,
  });
  assert.equal(annotation.width, 60);
  assert.equal(annotation.height, 20);
});

test('polígono e ponto escalam junto', () => {
  const [polygon] = toEditorAnnotations([
    { kind: 'polygon', vertices: [{ x: 10, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 40 }] },
  ], { asset: 'img', fallbackLabelId: 'u', makeId: () => 'a-1', scaleX: 0.5, scaleY: 0.5 });
  assert.deepEqual(polygon.vertices.map(v => [v.x, v.y]), [[5, 10], [15, 10], [15, 20]]);

  const [point] = toEditorAnnotations([{ kind: 'keypoint', at: { x: 10, y: 20 } }],
    { asset: 'img', fallbackLabelId: 'u', makeId: () => 'p-1', scaleX: 0.5, scaleY: 0.5 });
  assert.deepEqual([point.x, point.y], [5, 10]);
});

// ---------------------------------------------------------------------------
// Máscara
// ---------------------------------------------------------------------------

test('a máscara é escalada da grade do RLE para a área que ela ocupa', () => {
  // Grade 4x4 com um bloco central; bounds ocupam o dobro na imagem original.
  const mask = { bounds: { x: 100, y: 200, width: 8, height: 8 }, width: 4, height: 4,
                 rle: [5, 2, 2, 2, 5] };
  const points = maskToPolygon(mask);
  assert.ok(points && points.length >= 6);
  for (let i = 0; i < points.length; i += 2) {
    assert.ok(points[i] >= 100 && points[i] <= 108, `x fora de bounds: ${points[i]}`);
    assert.ok(points[i + 1] >= 200 && points[i + 1] <= 208, `y fora de bounds: ${points[i + 1]}`);
  }
});

test('uma máscara vazia não vira polígono', () => {
  assert.equal(maskToPolygon({ bounds: { x: 0, y: 0, width: 4, height: 4 }, width: 0, height: 0, rle: [] }), null);
});

test('uma máscara sem geometria aproveitável é descartada, não vira anotação torta', () => {
  const converted = toEditorAnnotations([
    { kind: 'mask', mask: { bounds: { x: 0, y: 0, width: 4, height: 4 }, width: 0, height: 0, rle: [] } },
  ], { asset: 'img', fallbackLabelId: 'u', makeId: () => 'm-1' });
  assert.equal(converted.length, 0);
});
