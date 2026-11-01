import { describe, expect, it } from 'vitest';
import { createLab } from '../src/engine.js';
import { SCENARIOS } from '../src/scenarios.js';

describe('every scenario, driven by its autopilot', () => {
  it.each(SCENARIOS.map((s) => [s.id, s]))('%s', async (_id, sc) => {
    const r = await createLab().start({ scenarioId: sc.id, autopilot: true });
    expect(r.status).toBe('done');
    expect([...new Set(r.findings.map((f) => f.id))].sort()).toEqual([...sc.expect.findings].sort());
    expect(r.outcome).toContain(sc.expect.outcomeIncludes);
    if (sc.expect.clientBlocked) expect(r.flags.clientBlocked).toBe(true);
    if (sc.expect.ignoredNotification) expect(r.flags.ignoredNotification).toBe(true);
    if (sc.expect.labBehaviour) expect(r.flags.labBehaviour).toBe(true);
  });

  it('every message carries a W3C traceparent and the run shares one trace id (rule 14)', async () => {
    const r = await createLab().start({ scenarioId: 'url-required', autopilot: true });
    expect(r.transcript.length).toBeGreaterThan(8);
    for (const m of r.transcript) expect(m.traceparent).toMatch(new RegExp(`^00-${r.traceId}-[0-9a-f]{16}-01$`));
  });

  it('shows the capability handshake: the client declares what it supports', async () => {
    const both = await createLab().start({ scenarioId: 'form-accept', autopilot: true });
    expect(both.transcript[0].json.params.capabilities).toEqual({ elicitation: { form: {}, url: {} } });
    const none = await createLab().start({ scenarioId: 'url-no-capability', autopilot: true, caps: null });
    expect(none.transcript[0].json.params.capabilities).toEqual({});
  });
});

describe('the three actions on the wire', () => {
  it('accept carries content for a form and none for a URL; decline and cancel carry none', async () => {
    const lab = createLab();
    const result = async (id) => (await lab.start({ scenarioId: id, autopilot: true })).transcript.find((m) => m.dir === 'client→server' && m.kind === 'response')?.json.result;
    expect(await result('form-accept')).toMatchObject({ action: 'accept', content: { partySize: 4 } });
    expect(await result('url-create')).toEqual({ action: 'accept' });
    expect(await result('form-decline')).toEqual({ action: 'decline' });
    expect(await result('form-cancel')).toEqual({ action: 'cancel' });
  });

  it('URL mode: accept is consent, not completion; the completion notification comes later and closes the loop', async () => {
    const r = await createLab().start({ scenarioId: 'url-create', autopilot: true });
    const idx = (pred) => r.transcript.findIndex(pred);
    const accept = idx((m) => m.dir === 'client→server' && m.json?.result?.action === 'accept');
    const complete = idx((m) => m.method === 'notifications/elicitation/complete');
    expect(accept).toBeGreaterThan(-1);
    expect(complete).toBeGreaterThan(accept);
  });

  it('an unknown completion id is ignored and the run still finishes', async () => {
    const r = await createLab().start({ scenarioId: 'url-unknown-complete', autopilot: true });
    expect(r.transcript.some((m) => m.note?.startsWith('Ignored:'))).toBe(true);
    expect(r.outcome).toContain('Key stored');
  });

  it('-32042 is only ever sent with url-mode elicitations that have ids, and the original request is retried', async () => {
    const r = await createLab().start({ scenarioId: 'url-required', autopilot: true });
    const err = r.transcript.find((m) => m.kind === 'error');
    expect(err.json.error.code).toBe(-32042);
    for (const e of err.json.error.data.elicitations) expect(e).toMatchObject({ mode: 'url' }), expect(e.elicitationId).toBeTruthy();
    expect(r.transcript.filter((m) => m.method === 'tools/call')).toHaveLength(2);
  });
});

describe('the interactive client: it parks until the person decides', () => {
  it('a form: parks with a dialog, blocks an invalid submit, sends a valid one', async () => {
    const lab = createLab();
    const r = await lab.start({ scenarioId: 'form-accept' });
    expect(r.status).toBe('awaiting_user');
    expect(r.pending).toMatchObject({ kind: 'form', server: { name: 'Example Concierge MCP (mock)' }, buttons: ['accept', 'decline', 'cancel'] });
    expect(r.pending.fields.find((f) => f.name === 'partySize').default).toBe(2); // defaults are pre-populated
    const bad = await lab.respond(r.id, { action: 'accept', content: { partySize: 99, date: 'tomorrow' } });
    expect(bad.status).toBe('awaiting_user');
    expect(bad.pending.errors).toMatchObject({ partySize: 'At most 12', date: 'Not a valid date' });
    expect(bad.transcript.filter((m) => m.method === 'elicitation/create')).toHaveLength(1); // nothing was sent to the server
    const ok = await lab.respond(r.id, { action: 'accept', content: { partySize: 3, date: '2026-12-24' } });
    expect(ok.status).toBe('done');
    expect(ok.outcome).toContain('Booked 3');
  });

  it('a URL: the dialog shows the full URL, the highlighted domain and a warning for a look-alike host; nothing opens before consent', async () => {
    const lab = createLab();
    const r = await lab.start({ scenarioId: 'bad-idn-http' });
    expect(r.pending.kind).toBe('url');
    expect(r.pending.url.full).toContain('xn--exmple-cua.mcp.example');
    expect(r.pending.url).toMatchObject({ apex: 'mcp.example', subdomain: 'xn--exmple-cua' });
    expect(r.pending.url.warnings.join(' ')).toMatch(/Punycode/);
    expect(r.pending.url.warnings.join(' ')).toMatch(/not HTTPS/);
    expect(r.transcript.some((m) => m.kind === 'browser')).toBe(false); // consent first
    const done = await lab.respond(r.id, { action: 'decline' });
    expect(done.transcript.some((m) => m.kind === 'browser')).toBe(false); // still nothing opened
  });

  it('rejects a reply for a run that is not waiting, and a bad action', async () => {
    const lab = createLab();
    const r = await lab.start({ scenarioId: 'form-accept' });
    await expect(lab.respond(r.id, { action: 'nope' })).rejects.toMatchObject({ code: 'bad_action' });
    await lab.respond(r.id, { action: 'cancel' });
    await expect(lab.respond(r.id, { action: 'cancel' })).rejects.toMatchObject({ code: 'not_waiting' });
    await expect(lab.respond('missing', { action: 'cancel' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('the person can choose which modes the client declares: a form-only client refuses URL mode with -32602', async () => {
    const r = await createLab().start({ scenarioId: 'bad-wrong-mode', autopilot: true, caps: { form: {} } });
    const err = r.transcript.find((m) => m.dir === 'client→server' && m.kind === 'error');
    expect(err.json.error).toEqual({ code: -32602, message: 'Invalid params' });
  });
});
