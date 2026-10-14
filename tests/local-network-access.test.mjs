import test from 'node:test';
import assert from 'node:assert/strict';
import { queryLocalNetworkPermission } from '../app/lib/local-network-access.ts';

test('Firefox loopback prompt is detected without requiring the Chromium legacy name', async () => {
  const status = { state: 'prompt' };
  const calls = [];
  const result = await queryLocalNetworkPermission({ query: async ({ name }) => {
    calls.push(name);
    if (name === 'loopback-network') return status;
    throw new TypeError('unsupported permission');
  } });
  assert.equal(result, status);
  assert.deepEqual(calls, ['loopback-network']);
});

test('loopback grant takes precedence over pending LAN permission', async () => {
  const result = await queryLocalNetworkPermission({ query: async ({ name }) => ({ state: name === 'loopback-network' ? 'granted' : 'prompt' }) });
  assert.equal(result.state, 'granted');
});

for (const state of ['prompt', 'denied', 'granted']) test(`older Chromium ${state} falls back to its combined network permission`, async () => {
  const result = await queryLocalNetworkPermission({ query: async ({ name }) => {
    if (name === 'local-network-access') return { state };
    throw new TypeError('unsupported permission');
  } });
  assert.equal(result.state, state);
});

test('older browsers can expose only local-network', async () => {
  const result = await queryLocalNetworkPermission({ query: async ({ name }) => {
    if (name === 'local-network') return { state: 'denied' };
    throw new TypeError('unsupported permission');
  } });
  assert.equal(result.state, 'denied');
});

test('browsers without network permission queries remain unsupported', async () => {
  assert.equal(await queryLocalNetworkPermission({ query: async () => { throw new TypeError('unsupported permission'); } }), null);
});
