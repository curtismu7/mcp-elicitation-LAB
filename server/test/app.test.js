import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp, DEMO } from '../src/app.js';
import { createHealth } from '../src/health.js';
import { LIVE_REFUSAL, modeFrom } from '../src/config.js';
import { installNetguard, netguardSelfTest } from '../src/netguard.js';
import { createWorkspaces, workspaceFrom } from '../src/workspaces.js';
import { applySharedSettings, readSharedSettings } from '../src/settings.js';
import { assertBindAllowed, portProblem, resolvePort } from '../src/safety.js';
import { allPassed, runChecks } from '../src/doctor.js';
import { diagramByName } from '../src/diagramData.js';
import { TALK_TRACK } from '../src/talkTrack.js';

const health = (runChecks = async () => []) => createHealth({ runChecks, now: () => new Date('2026-10-22T12:00:00Z'), intervalMs: 3_600_000 });
const make = (h = health()) => createApp({ health: h, webDist: '/nonexistent' });
afterEach(() => { /* health timers are unref'd */ });

describe('health and info', () => {
  it('answers demo-health/1 and says what this build is', async () => {
    const h = health();
    await h.ready;
    const res = await request(make(h)).get('/api/health');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({ schema: 'demo-health/1', at: '2026-10-22T12:00:00.000Z', state: 'ready', runtime: 'offline', demo: DEMO });
    expect(DEMO).toMatchObject({ id: 'mcp-elicitation-lab', version: JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version });
    expect((await request(make(h)).post('/api/health').send({})).status).toBe(405);
    h.stop();
  });
  it('reports broken when a doctor check fails, and unknown when the checks throw', async () => {
    const broken = health(async () => [{ id: 'x', level: 'fail', detail: 'd' }]); await broken.ready;
    expect((await request(make(broken)).get('/api/health')).body.state).toBe('broken');
    const unknown = health(async () => { throw new Error('boom'); }); await unknown.ready;
    expect((await request(make(unknown)).get('/api/health')).body.state).toBe('unknown');
  });
  it('info: always mock; Real is not available and carries the honest reason (rule 19 shape)', async () => {
    const i = (await request(make()).get('/api/info')).body;
    expect(i).toEqual({ mode: 'mock', source: 'mock', realAvailable: false, realReason: LIVE_REFUSAL, modes: ['mock', 'live'], live: { available: false, reason: LIVE_REFUSAL }, simulated: true });
    expect(LIVE_REFUSAL).toMatch(/not available/);
  });
  it('mode: POST /api/mode takes exactly {source}, refuses real with 409 and the honest reason, and never changes the mode', async () => {
    const app = make();
    const mock = (await request(app).post('/api/mode').send({ source: 'mock' }));
    expect(mock.status).toBe(200);
    expect(mock.body).toEqual({ mode: 'mock', source: 'mock', realAvailable: false, realReason: LIVE_REFUSAL });
    const real = await request(app).post('/api/mode').send({ source: 'real' });
    expect(real.status).toBe(409);
    expect(real.body.error).toBe('real_not_available');
    expect(real.body.message).toBe(LIVE_REFUSAL);
    expect(real.body.source).toBe('mock');
    expect((await request(app).get('/api/info')).body.source).toBe('mock', 'a refused switch leaves the mode unchanged');
    for (const body of [{ source: 'live' }, { source: 1 }, { source: null }, {}, { source: 'mock', extra: 1 }, { mode: 'mock' }, []]) {
      expect((await request(app).post('/api/mode').send(body)).status).toBe(400, JSON.stringify(body));
    }
    expect((await request(app).post('/api/mode')).status).toBe(400);
    expect((await request(app).get('/api/mode')).status).toBe(404, 'there is one toggle endpoint, POST /api/mode');
  });
  it('cites its spec sources and lists what it did not read', async () => {
    const s = (await request(make()).get('/api/spec')).body;
    expect(s.pages.map((p) => p.id)).toEqual(['2025-11-25', 'draft']);
    expect(s.notRead.length).toBeGreaterThan(0);
    expect(Object.keys(s.findings).length).toBeGreaterThan(8);
  });
});

describe('diagram and talk track are data served by name', () => {
  it('serves the diagram-studio/1 document by name, and 404s an unknown name without echoing it', async () => {
    const d = (await request(make()).get('/api/diagram?name=elicitation-actors')).body;
    expect(d).toMatchObject({ schema: 'diagram-studio/1', id: 'elicitation-actors' });
    expect(d.nodes.map((n) => n.id)).toEqual(['person', 'client', 'server', 'browser']);
    const nope = await request(make()).get('/api/diagram?name=sk-should-not-echo');
    expect(nope.status).toBe(404);
    expect(JSON.stringify(nope.body)).not.toContain('sk-should');
    expect(diagramByName('__proto__')).toBeNull();
    expect(diagramByName('constructor')).toBeNull();
  });
  it('serves the talk track from the same data the doc is generated from', async () => {
    expect((await request(make()).get('/api/talk-track')).body.talkTrack).toEqual(TALK_TRACK);
  });
});

describe('API', () => {
  it('runs a scenario end to end over HTTP, parks, and resumes', async () => {
    const a = request.agent(make());
    const run = (await a.post('/api/runs').send({ scenarioId: 'form-accept' })).body;
    expect(run.status).toBe('awaiting_user');
    const bad = (await a.post(`/api/runs/${run.id}/respond`).send({ action: 'accept', content: { partySize: 0 } })).body;
    expect(bad.pending.errors.partySize).toBeTruthy();
    const done = (await a.post(`/api/runs/${run.id}/respond`).send({ action: 'accept', content: { partySize: 2, date: '2026-11-30' } })).body;
    expect(done.status).toBe('done');
  });
  it('validates input, with honest status codes, and never echoes what was typed', async () => {
    const a = request.agent(make());
    expect((await a.post('/api/runs').send({})).status).toBe(400);
    expect((await a.post('/api/runs').send({ scenarioId: 'nope' })).body.error).toBe('unknown_scenario');
    for (const inherited of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      const r = await a.post('/api/runs').send({ scenarioId: inherited });
      expect([inherited, r.status, r.body.error]).toEqual([inherited, 400, 'unknown_scenario']);
    }
    const caps = await a.post('/api/runs').send({ scenarioId: 'form-accept', caps: { 'sk-live-ABCDEF123456': {} } });
    expect(caps.body.error).toBe('bad_caps');
    expect(JSON.stringify(caps.body)).not.toContain('ABCDEF123456');
    expect((await a.post('/api/runs').send({ scenarioId: 'form-accept', autopilot: 'delete' })).body.error).toBe('bad_autopilot');
    expect((await a.post('/api/runs').send({ scenarioId: 'form-accept', user: 'Alice1' })).body.error).toBe('bad_user');
    expect((await a.post('/api/runs/none/respond').send({ action: 'cancel' })).status).toBe(404);
    expect((await a.get('/api/runs/none')).status).toBe(404);
    const bad = await a.post('/api/runs').set('content-type', 'application/json').send('{"scenarioId": ');
    expect(bad.status).toBe(400); expect(bad.body.error).toBe('bad_json');
    expect((await a.post('/api/runs').send({ scenarioId: 'form-accept', pad: 'x'.repeat(200_000) })).status).toBe(413);
  });
  it('every unknown path and method answers fixed JSON that does not echo the path', async () => {
    const app = make();
    for (const [method, url] of [['get', '/api/sk-secret-path-12345'], ['post', '/nope/sk-secret-path-12345'], ['put', '/api/runs/sk-secret-path-12345'], ['delete', '/x']]) {
      const r = await request(app)[method](url).send({});
      expect(r.status).toBe(404);
      expect(r.body).toEqual({ error: 'not_found' });
      expect(r.text).not.toContain('secret-path');
    }
  });
});

describe('safety (rules: loopback, host check, same-origin, zero outbound)', () => {
  it('refuses a non-loopback Host and cross-origin writes', async () => {
    const app = make();
    expect((await request(app).get('/api/health').set('Host', 'evil.invalid')).status).toBe(403);
    const post = (origin) => request(app).post('/api/reset').set('Host', '127.0.0.1:6800').set('Origin', origin).send({});
    expect((await post('http://127.0.0.1:6800')).status).toBe(200);
    expect((await post('https://evil.invalid')).status).toBe(403);
    expect((await request(app).post('/api/reset').set('Sec-Fetch-Site', 'cross-site').send({})).status).toBe(403);
  });
  it('a full run of every scenario makes zero outbound attempts, even URL scenarios (a URL is shown, never fetched)', async () => {
    expect((await netguardSelfTest()).ok).toBe(true);
    const g = installNetguard();
    const a = request.agent(make());
    for (const id of ['url-create', 'url-required', 'bad-leaky-url', 'bad-idn-http', 'phish-vulnerable']) expect((await a.post('/api/runs').send({ scenarioId: id, autopilot: true })).status).toBe(201);
    expect(g.attempts).toEqual([]);
    g.restore();
  });
  it('the self-test covers seven routes out, including a UDP connect', async () => {
    const r = await netguardSelfTest();
    expect(r.blocked).toBe(7);
    expect(r.detail).toMatch(/udp: blocked.*udp-connect: blocked/);
    installNetguard().restore();
  });
});

describe('configuration: one lab key, no bare MODE', () => {
  it('mock is the default; Live is refused with the honest message; anything else is refused', () => {
    expect(modeFrom({})).toBe('mock');
    expect(modeFrom({ MEL_LAB_MODE: '' })).toBe('mock');
    expect(modeFrom({ MEL_LAB_MODE: 'mock' })).toBe('mock');
    expect(() => modeFrom({ MEL_LAB_MODE: 'live' })).toThrow(LIVE_REFUSAL);
    expect(() => modeFrom({ MEL_LAB_MODE: 'bogus' })).toThrow(/only has mock/);
    expect(modeFrom({ MODE: 'live' })).toBe('mock'); // another app's MODE does not switch this one
  });
  it('ports stay inside 6800-6849 and off the reserved list; a wildcard bind needs the opt-in', () => {
    expect(resolvePort({})).toBe(6800);
    expect(resolvePort({ PORT: '6849' })).toBe(6849);
    for (const p of ['6850', '6799', '8080', '5173', '4600', 'abc', '68.5']) expect(() => resolvePort({ PORT: p }), p).toThrow();
    expect(portProblem(4840)).toMatch(/reserved/);
    expect(() => assertBindAllowed('0.0.0.0', {})).toThrow(/loopback only/);
    expect(assertBindAllowed('0.0.0.0', { MEL_LAB_BIND: '0.0.0.0' })).toBe('0.0.0.0');
    expect(assertBindAllowed('127.0.0.1', {})).toBe('127.0.0.1');
  });
  it('the shared settings file: only this lab\'s key is taken, and an environment value wins', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mel-settings-'));
    const file = path.join(dir, '.env');
    fs.writeFileSync(file, 'MEL_LAB_MODE=mock\nOTHER_APP_SECRET=zzz\nMODE=live\nPORT=1\n');
    expect(readSharedSettings(file)).toEqual({ MEL_LAB_MODE: 'mock' });
    const env = { STANDALONE_ENV: file };
    applySharedSettings(env);
    expect(env).toEqual({ STANDALONE_ENV: file, MEL_LAB_MODE: 'mock' });
    const set = { MEL_LAB_MODE: 'x' }; applySharedSettings(set, file);
    expect(set.MEL_LAB_MODE).toBe('x');
    expect(readSharedSettings(path.join(dir, 'missing'))).toEqual({});
    fs.rmSync(dir, { recursive: true });
  });
  it('the doctor passes on a clean setup and fails on a bad port or mode', async () => {
    expect(allPassed(await runChecks({ env: { STANDALONE_ENV: '/nonexistent' } }))).toBe(true);
    expect(allPassed(await runChecks({ env: { PORT: '80' } }))).toBe(false);
    expect(allPassed(await runChecks({ env: { MEL_LAB_MODE: 'live' } }))).toBe(false);
  });
});

describe('rule 13: one workspace never touches another', () => {
  const ws = (app, id) => ({ get: (u) => request(app).get(u).set('X-Workspace', id), post: (u, b = {}) => request(app).post(u).set('X-Workspace', id).send(b) });
  it('each workspace has its own runs and reset; the default is "default"', async () => {
    const app = make();
    const a = ws(app, 'tab-a'); const b = ws(app, 'tab-b');
    await a.post('/api/runs', { scenarioId: 'form-accept' }); // A has a parked run
    expect((await b.get('/api/runs')).body.runs).toHaveLength(0);
    expect((await b.post('/api/reset')).body).toEqual({ reset: true, workspace: 'tab-b' });
    expect((await a.get('/api/runs')).body.runs).toHaveLength(1); // B's reset did nothing to A
    expect((await a.post('/api/reset')).body).toEqual({ reset: true, workspace: 'tab-a' });
    expect((await a.get('/api/runs')).body.runs).toHaveLength(0); // A's own reset really clears A's runs
    expect((await request(app).get('/api/runs')).body.runs).toHaveLength(0); // no header: the "default" workspace
    expect((await request(app).post('/api/reset').send({})).body.workspace).toBe('default');
  });
  it('refuses a malformed id without echoing it, and bounds the store', async () => {
    const app = make();
    for (const bad of ['../../etc', 'A'.repeat(41), 'has space', 'UPPER', '']) {
      const r = await request(app).get('/api/runs').set('X-Workspace', bad);
      expect(r.status, bad).toBe(400);
      expect(r.body).toEqual({ error: 'bad_workspace' });
    }
    expect(workspaceFrom({ headers: {} })).toBe('default');
    expect(workspaceFrom({ headers: { 'x-workspace': ['a', 'b'] } })).toBeNull();
    let t = 0;
    const spaces = createWorkspaces({ now: () => new Date(t), max: 2, idleMs: 1000 });
    const first = spaces.get('a'); spaces.get('b'); spaces.get('c');
    expect(spaces.size()).toBe(2); expect(spaces.get('a')).not.toBe(first);
    t = 5000; spaces.get('z'); expect(spaces.size()).toBe(1);
  });
});

describe('shelf link', () => {
  it('serves /api/shelf from SHELF_URL with no web build, and refuses POST', async () => {
    const prev = process.env.SHELF_URL;
    process.env.SHELF_URL = 'https://shelf.example:8443/';
    try {
      const res = await request(make()).get('/api/shelf');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ shelfUrl: 'https://shelf.example:8443' });
      expect((await request(make()).post('/api/shelf').send({})).status).not.toBe(200);
    } finally {
      if (prev === undefined) delete process.env.SHELF_URL; else process.env.SHELF_URL = prev;
    }
  });
});
