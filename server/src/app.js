import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createWorkspaces, workspaceFrom } from './workspaces.js';
import { listScenarios } from './scenarios.js';
import { FINDINGS } from './lint.js';
import { hostCheck, sameOriginWrites } from './safety.js';
import { createHealth } from './health.js';
import { LIVE_REFUSAL } from './config.js';
import { diagramByName } from './diagramData.js';
import { TALK_TRACK } from './talkTrack.js';
import { DEMO, SPEC_SOURCES } from './spec.js';
import { shelfInfo } from './shelfLink.js';

export { DEMO, SPEC_SOURCES };

const WEB_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');

export function createApp({ health = createHealth(), workspaces = createWorkspaces(), webDist = WEB_DIST } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(hostCheck);
  app.use(sameOriginWrites);
  app.use((_req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });
  app.use(express.json({ limit: '100kb' }));

  // demo-health/1 (see demo-shelf docs/health-contract.md): public, GET only, no detail.
  app.use('/api/health', health.router);

  // Rule 13: the workspace id (X-Workspace, default "default") scopes the runs. A malformed id is refused, never echoed.
  app.use('/api', (req, res, next) => {
    const id = workspaceFrom(req);
    if (!id) return res.status(400).json({ error: 'bad_workspace' });
    req.lab = workspaces.get(id);
    req.workspaceId = id;
    next();
  });
  // The mode is always mock. Live is not available here and says so (the header toggle shows `live.reason` when it is clicked).
  app.get('/api/info', (_req, res) => res.set('Cache-Control', 'no-store').json({ mode: 'mock', modes: ['mock', 'live'], live: { available: false, reason: LIVE_REFUSAL }, simulated: true }));
  app.get('/api/spec', (_req, res) => res.json({ ...SPEC_SOURCES, findings: FINDINGS }));
  app.get('/api/talk-track', (_req, res) => res.json({ talkTrack: TALK_TRACK }));
  app.get('/api/diagram', (req, res) => {
    const doc = diagramByName(typeof req.query.name === 'string' ? req.query.name : 'elicitation-actors');
    return doc ? res.json(doc) : res.status(404).json({ error: 'not_found' });
  });
  app.get('/api/scenarios', (_req, res) => res.json({ scenarios: listScenarios() }));
  app.post('/api/reset', (req, res) => res.json({ ...req.lab.reset(), workspace: req.workspaceId }));
  app.get('/api/runs', (req, res) => res.json({ runs: req.lab.list() }));
  app.get('/api/runs/:id', (req, res) => { const r = req.lab.get(req.params.id); return r ? res.json(r) : res.status(404).json({ error: 'not_found' }); });

  const CODES = { unknown_scenario: 400, bad_caps: 400, bad_user: 400, bad_autopilot: 400, bad_action: 400, not_found: 404, not_waiting: 409 };
  const fail = (res, next, e) => (CODES[e.code] ? res.status(CODES[e.code]).json({ error: e.code, reason: e.message }) : next(e));
  app.post('/api/runs', async (req, res, next) => {
    const { scenarioId, caps, autopilot, user } = req.body ?? {};
    if (typeof scenarioId !== 'string') return res.status(400).json({ error: 'scenarioId_required' });
    try { return res.status(201).json(await req.lab.start({ scenarioId, caps, autopilot, user })); } catch (e) { return fail(res, next, e); }
  });
  app.post('/api/runs/:id/respond', async (req, res, next) => {
    const { action, content } = req.body ?? {};
    if (typeof action !== 'string') return res.status(400).json({ error: 'action_required' });
    try { return res.json(await req.lab.respond(req.params.id, { action, content })); } catch (e) { return fail(res, next, e); }
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));
  if (fs.existsSync(path.join(webDist, 'index.html'))) {
    app.use(express.static(webDist));
app.get('/api/shelf', (_req, res) => { res.set('Cache-Control', 'no-store'); res.json(shelfInfo()); }); // the header "Shelf" button
    app.get('*', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }
  // The last two handlers catch everything that is left, for every method and every path: Express's default answers ("Cannot POST /<path>")
  // would echo the path the visitor typed. Fixed JSON, no path.
  app.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large' });
    return res.status(500).json({ error: 'internal_error' });
  });
  return app;
}
