import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEventStream, decodeRle } from '../app/lib/runtime-client.ts';

/** Um ReadableStream que entrega exatamente os pedaços dados, na ordem. */
function streamOf(...chunks) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function frame(event) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

async function collect(stream, signal) {
  const events = [];
  for await (const event of parseEventStream(stream, signal)) events.push(event);
  return events;
}

test('lê os eventos de um fluxo bem comportado, na ordem', async () => {
  const events = await collect(streamOf(
    frame({ type: 'result', annotations: [], partial: true }),
    frame({ type: 'progress', done: 1, total: 3 }),
    frame({ type: 'result', annotations: [], partial: false }),
  ));
  assert.deepEqual(events.map(e => e.type), ['result', 'progress', 'result']);
  assert.equal(events[1].done, 1);
});

test('um frame partido entre chunks não vira JSON.parse em metade de evento', async () => {
  // A rede corta onde quiser, inclusive no meio de um número.
  const whole = frame({ type: 'progress', done: 12, total: 34 });
  const events = await collect(streamOf(whole.slice(0, 20), whole.slice(20)));
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], { type: 'progress', done: 12, total: 34 });
});

test('vários eventos num único chunk são todos lidos', async () => {
  const events = await collect(streamOf(
    frame({ type: 'progress', done: 1, total: 2 }) + frame({ type: 'progress', done: 2, total: 2 }),
  ));
  assert.equal(events.length, 2);
});

test('um chunk com um byte por vez ainda produz o evento inteiro', async () => {
  const whole = frame({ type: 'result', annotations: [{ kind: 'box', box: { x: 1, y: 2, width: 3, height: 4 } }], partial: false });
  const events = await collect(streamOf(...whole.split('')));
  assert.equal(events.length, 1);
  assert.equal(events[0].annotations[0].box.width, 3);
});

test('um frame incompleto no fim do fluxo é descartado, não meio-lido', async () => {
  const events = await collect(streamOf(
    frame({ type: 'progress', done: 1, total: 2 }) + 'data: {"type":"progr',
  ));
  assert.equal(events.length, 1);
});

test('linhas que não são data: são ignoradas', async () => {
  const events = await collect(streamOf(`: keep-alive\n\n${frame({ type: 'progress', done: 1, total: 1 })}`));
  assert.deepEqual(events.map(e => e.type), ['progress']);
});

test('o evento de erro chega como qualquer outro, com o código do contrato', async () => {
  const events = await collect(streamOf(
    frame({ type: 'error', error: { code: 'unsupported_prompt', message: 'sem prompt de texto' } }),
  ));
  assert.equal(events[0].error.code, 'unsupported_prompt');
});

test('um signal já abortado não entrega evento nenhum', async () => {
  const controller = new AbortController();
  controller.abort();
  const events = await collect(streamOf(frame({ type: 'progress', done: 1, total: 1 })), controller.signal);
  assert.equal(events.length, 0);
});

test('decodeRle começa pelo fundo e alterna', () => {
  // 2x2, dois de fundo e dois de frente.
  assert.deepEqual([...decodeRle([2, 2], 2, 2)], [0, 0, 1, 1]);
});

test('decodeRle aceita um run de fundo vazio quando a máscara começa preenchida', () => {
  assert.deepEqual([...decodeRle([0, 4], 2, 2)], [1, 1, 1, 1]);
});

test('decodeRle devolve tudo zero para uma máscara vazia', () => {
  assert.deepEqual([...decodeRle([], 2, 2)], [0, 0, 0, 0]);
});
