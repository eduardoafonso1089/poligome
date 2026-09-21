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

// ---------------------------------------------------------------------------
// Contexto em volta da região, resposta dentro dela
// ---------------------------------------------------------------------------

import { withContext, clipToRegion, CONTEXT_MARGIN } from '../app/lib/runtime-annotations.ts';

test('a margem cresce com o tamanho da caixa', () => {
  const padded = withContext({ x: 400, y: 400, width: 200, height: 200 }, 2000, 2000);
  assert.equal(padded.x, 400 - 200 * CONTEXT_MARGIN);
  assert.equal(padded.width, 200 + 2 * 200 * CONTEXT_MARGIN);
});

test('uma caixa pequena ainda ganha um mínimo de contexto', () => {
  // 25% de 8px seriam 2px, que não é contexto nenhum.
  const padded = withContext({ x: 100, y: 100, width: 8, height: 8 }, 2000, 2000);
  assert.ok(padded.width >= 8 + 2 * 32);
});

test('a margem não sai da imagem', () => {
  const padded = withContext({ x: 0, y: 0, width: 100, height: 100 }, 120, 120);
  assert.equal(padded.x, 0);
  assert.equal(padded.y, 0);
  assert.ok(padded.x + padded.width <= 120);
  assert.ok(padded.y + padded.height <= 120);
});

test('a caixa que cobre a região com margem volta recortada na região pedida', () => {
  // É o caso do classificador: ele devolve o recorte inteiro como uma caixa só.
  const asked = { x: 100, y: 100, width: 200, height: 200 };
  const clipped = clipToRegion(
    { kind: 'box', box: { x: 50, y: 50, width: 300, height: 300 }, label: 'telhado' },
    asked,
  );
  assert.deepEqual(clipped.box, asked);
  assert.equal(clipped.label, 'telhado');
});

test('o que a margem revelou pela metade fica de fora', () => {
  const asked = { x: 100, y: 100, width: 100, height: 100 };
  // Centro em (40,150): fora da região no eixo x.
  const out = clipToRegion({ kind: 'box', box: { x: 10, y: 130, width: 60, height: 40 } }, asked);
  assert.equal(out, null);
});

test('o que está dentro passa', () => {
  const asked = { x: 100, y: 100, width: 100, height: 100 };
  const kept = clipToRegion({ kind: 'box', box: { x: 120, y: 120, width: 40, height: 40 } }, asked);
  assert.deepEqual(kept.box, { x: 120, y: 120, width: 40, height: 40 });
});

test('contorno com o centro dentro não é mutilado pelo recorte', () => {
  // Cortar um polígono traçado partiria um objeto que o modelo viu inteiro.
  const asked = { x: 100, y: 100, width: 100, height: 100 };
  const polygon = { kind: 'polygon', vertices: [{ x: 90, y: 140 }, { x: 160, y: 140 }, { x: 160, y: 160 }] };
  assert.deepEqual(clipToRegion(polygon, asked), polygon);
});

test('um ponto fora da região some', () => {
  const asked = { x: 100, y: 100, width: 100, height: 100 };
  assert.equal(clipToRegion({ kind: 'keypoint', at: { x: 50, y: 50 } }, asked), null);
});

test('sem região pedida, nada é descartado', () => {
  const annotations = [{ kind: 'box', box: { x: 0, y: 0, width: 10, height: 10 } }];
  assert.equal(toEditorAnnotations(annotations, {
    asset: 'img', fallbackLabelId: 'u', makeId: () => 'a-1',
  }).length, 1);
});

test('com região pedida, o que veio só da margem não vira anotação', () => {
  const converted = toEditorAnnotations([
    { kind: 'box', box: { x: 120, y: 120, width: 20, height: 20 } },   // dentro
    { kind: 'box', box: { x: 0, y: 0, width: 20, height: 20 } },       // só na margem
  ], {
    asset: 'img', fallbackLabelId: 'u', makeId: () => `a-${Math.random()}`,
    clipTo: { x: 100, y: 100, width: 100, height: 100 },
  });
  assert.equal(converted.length, 1);
});

// ---------------------------------------------------------------------------
// Editar o parcial sem perdê-lo quando o final chega
// ---------------------------------------------------------------------------

import { reconcileDrafts, withoutEdited, sameGeometry } from '../app/lib/runtime-annotations.ts';

const drawn = (id, x, label = 'l-1') => ({ id, asset: 'img', label, type: 'box', x, y: 0, width: 50, height: 50 });

test('rascunho intocado é descartado quando o final chega', () => {
  const drafts = new Map([['d-1', drawn('d-1', 10)]]);
  const { discard, keptOriginals } = reconcileDrafts(drafts, [drawn('d-1', 10)]);
  assert.deepEqual(discard, ['d-1']);
  assert.equal(keptOriginals.length, 0);
});

test('rascunho que a pessoa moveu fica', () => {
  const drafts = new Map([['d-1', drawn('d-1', 10)]]);
  const { discard, keptOriginals } = reconcileDrafts(drafts, [drawn('d-1', 90)]);
  assert.deepEqual(discard, []);
  assert.equal(keptOriginals.length, 1);
  assert.equal(keptOriginals[0].x, 10, 'preserva a geometria original, não a editada');
});

test('rascunho que a pessoa reclassificou fica', () => {
  const drafts = new Map([['d-1', drawn('d-1', 10, 'l-1')]]);
  const { discard } = reconcileDrafts(drafts, [drawn('d-1', 10, 'l-2')]);
  assert.deepEqual(discard, []);
});

test('rascunho que a pessoa apagou não é apagado de novo nem preservado', () => {
  const drafts = new Map([['d-1', drawn('d-1', 10)]]);
  const { discard, keptOriginals } = reconcileDrafts(drafts, []);
  assert.deepEqual(discard, []);
  assert.equal(keptOriginals.length, 0);
});

test('o final descarta o que o modelo repetiria sobre a anotação já editada', () => {
  // A comparação é com a geometria original: é por ela que se reconhece o
  // mesmo objeto depois de a pessoa tê-lo arrastado.
  const kept = [drawn('d-1', 10)];
  const settled = withoutEdited([drawn('f-1', 12), drawn('f-2', 500)], kept);
  assert.deepEqual(settled.map(a => a.id), ['f-2']);
});

test('sem edição nenhuma, o final passa inteiro', () => {
  const settled = withoutEdited([drawn('f-1', 10), drawn('f-2', 500)], []);
  assert.equal(settled.length, 2);
});

test('sameGeometry distingue forma, posição e classe', () => {
  assert.ok(sameGeometry(drawn('a', 10), drawn('b', 10)));
  assert.ok(!sameGeometry(drawn('a', 10), drawn('b', 11)));
  assert.ok(!sameGeometry(drawn('a', 10, 'l-1'), drawn('b', 10, 'l-2')));
});

test('sameGeometry compara vértices de um polígono', () => {
  const poly = (id, x) => ({ id, asset: 'img', label: 'l', type: 'polygon',
                             vertices: [{ id: 'v1', x, y: 0 }, { id: 'v2', x: 5, y: 5 }], holes: [] });
  assert.ok(sameGeometry(poly('a', 1), poly('b', 1)));
  assert.ok(!sameGeometry(poly('a', 1), poly('b', 2)));
});
