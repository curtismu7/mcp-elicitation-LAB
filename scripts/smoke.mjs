#!/usr/bin/env node
// Drives every scenario through a RUNNING lab over HTTP and fails on any surprise. Also proves the interactive path (a run parks, a
// blocked form is not sent, the person's choice resumes it) and that Reset works. Loopback only. Uses its own workspace (X-Workspace: smoke).
//   BASE_URL=http://127.0.0.1:6800 node scripts/smoke.mjs
import { isLoopbackHost } from '../server/src/safety.js';

const base = new URL(process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || 6800}`);
if (!isLoopbackHost(base.hostname)) { console.error(`refusing ${base.hostname}: loopback only`); process.exit(2); }
const api = async (path, body) => {
  const headers = { 'x-workspace': 'smoke', ...(body === undefined ? {} : { 'content-type': 'application/json', origin: base.origin }) };
  const r = await fetch(new URL(path, base), body === undefined ? { headers } : { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
let failed = 0;
const check = (ok, name, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`); };

const info = await api('/api/info');
console.log(`INFO  mode=${info.body.mode} (live available: ${info.body.live?.available})`);
check(info.body.mode === 'mock' && info.body.live?.available === false, 'info: mock, and Live is refused with a reason', String(info.body.live?.reason ?? '').slice(0, 40));
await api('/api/reset', {});
const { body: { scenarios } } = await api('/api/scenarios');
const expectIds = (s) => [...s.expectedFindings].sort().join(',');
for (const sc of scenarios) {
  const r = await api('/api/runs', { scenarioId: sc.id, autopilot: true });
  const got = [...new Set((r.body.findings ?? []).map((f) => f.id))].sort().join(',');
  check(r.status === 201 && r.body.status === 'done' && got === expectIds(sc), `${sc.id}: done, findings [${got}]`, got === expectIds(sc) ? '' : `expected [${expectIds(sc)}]`);
}

// Interactive: the run parks, an invalid form is blocked (nothing sent), a valid one resumes it.
const run = (await api('/api/runs', { scenarioId: 'form-accept' })).body;
check(run.status === 'awaiting_user' && run.pending?.kind === 'form', 'interactive: the run parks with a form dialog');
const bad = (await api(`/api/runs/${run.id}/respond`, { action: 'accept', content: { partySize: 99, date: 'tomorrow' } })).body;
check(bad.status === 'awaiting_user' && bad.pending?.errors?.partySize, 'interactive: an invalid form is blocked and explained');
check(bad.transcript.filter((m) => m.method === 'elicitation/create').length === 1 && !bad.transcript.some((m) => m.dir === 'client→server' && m.json?.result?.action === 'accept'), 'interactive: nothing was sent to the server');
const done = (await api(`/api/runs/${run.id}/respond`, { action: 'accept', content: { partySize: 2, date: '2026-12-24' } })).body;
check(done.status === 'done' && /Booked 2/.test(done.outcome), 'interactive: the valid form resumes and finishes the run');
const u = (await api('/api/runs', { scenarioId: 'url-required' })).body;
check(u.status === 'awaiting_user' && u.pending?.kind === 'url' && /^https:\/\//.test(u.pending.url.full) && !u.transcript.some((m) => m.kind === 'browser'), 'interactive: a URL dialog shows the full URL and nothing is opened before consent');
check((await api(`/api/runs/${u.id}/respond`, { action: 'decline' })).body.outcome?.startsWith('not connected'), 'interactive: decline stops the flow');

await api('/api/reset', {});
check((await api('/api/runs')).body.runs.length === 0, 'reset clears every run');
console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
