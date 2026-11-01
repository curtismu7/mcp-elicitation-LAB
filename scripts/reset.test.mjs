import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/src/app.js';
import { createHealth } from '../server/src/health.js';
import { createWorkspaces } from '../server/src/workspaces.js';
import { reset } from './reset.mjs';

test('the reset script clears the default workspace only, and refuses a non-loopback host', async () => {
  const workspaces = createWorkspaces();
  const health = createHealth({ runChecks: async () => [], intervalMs: 3_600_000 });
  const server = await new Promise((resolve) => { const s = createApp({ health, workspaces, webDist: '/nonexistent' }).listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    await workspaces.get('default').start({ scenarioId: 'form-accept' });
    await workspaces.get('other').start({ scenarioId: 'form-accept' });
    assert.equal(workspaces.get('default').list().length, 1);
    assert.deepEqual(await reset(base), { reset: true, workspace: 'default' });
    assert.equal(workspaces.get('default').list().length, 0);
    assert.equal(workspaces.get('other').list().length, 1, 'another workspace is untouched');
    await assert.rejects(reset('http://example.invalid:6800'), /loopback only/);
  } finally { health.stop(); await new Promise((r) => server.close(r)); }
});
