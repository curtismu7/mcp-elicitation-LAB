import { randomBytes, randomUUID } from 'node:crypto';
import { SCENARIO_BY_ID } from './scenarios.js';
import { TOOLS, SERVER_INFO, createServerState, handleBrowser, supports } from './servers.js';
import { lintElicitation, lintUrlRequired, FINDINGS } from './lint.js';
import { analyzeUrl, urlWarnings } from './url.js';
import { schemaProblems, validateContent, fieldsOf, defaultContent } from './schema.js';

export const PROTOCOL = '2025-11-25';
const CLIENT_INFO = { name: 'Lab Client (mock)', version: '0.1.0' };

// Capabilities a person may pick for the mock client. null = the client declares no elicitation capability at all.
export function normalizeCaps(c) {
  if (c === null) return null;
  if (c === undefined) return undefined;
  if (typeof c !== 'object' || Array.isArray(c)) throw Object.assign(new Error('caps must be null or an object'), { code: 'bad_caps' });
  const bad = Object.keys(c).filter((k) => !['form', 'url'].includes(k));
  if (bad.length) throw Object.assign(new Error('unknown capability (only form and url can be declared)'), { code: 'bad_caps' });
  return Object.fromEntries(Object.keys(c).map((k) => [k, {}]));
}

const modeAllowed = (caps, mode) => supports(caps, mode);

// One lab per workspace: holds that visitor's runs. A run plays one scenario: a mock client against a mock server.
export function createLab({ now = () => new Date() } = {}) {
  const runs = new Map();
  const ctxs = new Map(); // private: generator, server state, the pending-user resolver. Never sent to a client.

  const span = () => randomBytes(8).toString('hex');
  function log(run, dir, kind, json, note, method) {
    run.transcript.push({ n: run.transcript.length + 1, dir, kind, ...(method ? { method } : {}), json: json ?? null, ...(note ? { note } : {}), traceparent: `00-${run.traceId}-${span()}-01` });
  }
  const finding = (run, list) => { for (const f of list) if (!run.findings.some((x) => x.id === f.id && x.detail === f.detail)) run.findings.push(f); };
  const note = (run, text) => log(run, 'client', 'note', null, text);

  function dialogFor(ctx, params, { forError = false } = {}) {
    const mode = params.mode ?? 'form';
    const base = { server: { ...SERVER_INFO }, mode, message: params.message ?? '', buttons: ['accept', 'decline', 'cancel'], errors: null };
    if (mode === 'form') {
      return { ...base, kind: 'form', fields: fieldsOf(params.requestedSchema), requestedSchema: params.requestedSchema,
        compliance: [
          { level: 'MUST', text: 'Shows which server is asking.' }, { level: 'MUST', text: 'Offers clear decline and cancel.' },
          { level: 'MUST', text: 'Lets you review and change your answers before sending.' }, { level: 'SHOULD', text: 'Checks your answers against the schema before sending.' },
          { level: 'SHOULD NOT', text: 'Renders no link as clickable inside the form.' },
        ] };
    }
    const a = analyzeUrl(params.url);
    return { ...base, kind: 'url', elicitationId: params.elicitationId ?? null, viaError: forError,
      url: { full: a.full, valid: a.valid, scheme: a.scheme ?? null, host: a.host ?? null, subdomain: a.subdomain ?? '', apex: a.apex ?? null, warnings: urlWarnings(a) },
      compliance: [
        { level: 'MUST', text: 'Shows which server is asking.' }, { level: 'MUST', text: 'Shows the full URL before you consent.' },
        { level: 'MUST NOT', text: 'Opens nothing without your explicit consent.' }, { level: 'MUST NOT', text: 'Pre-fetches the URL or its metadata (this lab makes no request).' },
        { level: 'MUST', text: 'Opens it where the client and the model cannot read what you type (simulated).' }, { level: 'SHOULD', text: 'Highlights the domain and warns about suspicious hosts.' },
      ] };
  }

  // Wait for the person. Autopilot answers immediately (tests, smoke); otherwise the run parks until respond().
  async function waitForUser(run, ctx, dialog) {
    if (ctx.autopilot) {
      const action = ctx.autopilot;
      let content;
      if (dialog.kind === 'form' && action === 'accept') {
        const sc = ctx.scenario;
        if (sc.firstAttempt && !ctx.triedFirst) {
          ctx.triedFirst = true;
          const v = validateContent(dialog.requestedSchema, sc.firstAttempt);
          log(run, 'person', 'ui', { action: 'accept', content: sc.firstAttempt }, 'The person submits the form.');
          if (!v.ok) { run.flags.clientBlocked = true; note(run, `The client blocks sending: ${Object.entries(v.errors).map(([k, m]) => `${k}: ${m}`).join('; ')}. Nothing is sent to the server.`); }
        }
        content = sc.content ?? defaultContent(dialog.requestedSchema);
      }
      log(run, 'person', 'ui', { action, ...(content ? { content } : {}) }, dialog.kind === 'url' ? (action === 'accept' ? 'The person reads the full URL and consents.' : `The person chooses ${action}.`) : `The person chooses ${action}.`);
      return { action, ...(content ? { content } : {}) };
    }
    run.pending = dialog; run.status = 'awaiting_user';
    ctx.settle();
    const decision = await new Promise((res) => { ctx.resolveUser = res; });
    run.pending = null; run.status = 'running';
    log(run, 'person', 'ui', decision, decision.action === 'accept' ? (dialog.kind === 'url' ? 'The person reads the full URL and consents.' : 'The person submits the form.') : `The person chooses ${decision.action}.`);
    return decision;
  }

  async function clientElicit(run, ctx, params) {
    const sid = `s${++ctx.srvId}`;
    log(run, 'server→client', 'request', { jsonrpc: '2.0', id: sid, method: 'elicitation/create', params }, null, 'elicitation/create');
    finding(run, lintElicitation(params, ctx.caps));
    const mode = params.mode ?? 'form';
    if (!modeAllowed(ctx.caps, mode)) {
      const error = { code: -32602, message: 'Invalid params' };
      log(run, 'client→server', 'error', { jsonrpc: '2.0', id: sid, error }, `The client did not declare ${mode} mode, so it answers -32602 (a MUST).`);
      return { error };
    }
    if (mode === 'form') {
      const probs = schemaProblems(params.requestedSchema);
      if (probs.length) {
        run.flags.labBehaviour = true;
        note(run, 'The lab client cannot render this schema and answers cancel. (Lab behaviour: the spec does not say what a client does here.)');
        log(run, 'client→server', 'response', { jsonrpc: '2.0', id: sid, result: { action: 'cancel' } });
        return { action: 'cancel' };
      }
    }
    const dialog = dialogFor(ctx, params);
    const decision = await waitForUser(run, ctx, dialog);
    const result = { action: decision.action, ...(decision.action === 'accept' && dialog.kind === 'form' ? { content: decision.content } : {}) };
    log(run, 'client→server', 'response', { jsonrpc: '2.0', id: sid, result }, dialog.kind === 'url' && decision.action === 'accept' ? 'Accept means consent to open the URL, not that the interaction is complete.' : null);
    if (dialog.kind === 'url' && decision.action === 'accept') {
      ctx.active.add(params.elicitationId);
      log(run, 'client', 'browser', null, `The client opens ${dialog.url.host} in a secure browser view. The lab makes no request.`);
    }
    return result;
  }

  function clientNotified(run, ctx, step) {
    log(run, 'server→client', 'notification', { jsonrpc: '2.0', method: step.method, params: step.params }, null, step.method);
    const id = step.params?.elicitationId;
    if (ctx.active.has(id)) { ctx.active.delete(id); ctx.completed.add(id); note(run, 'The client now knows the out-of-band step is done. It may retry the request or update its UI, and still offers a manual retry.'); }
    else { run.flags.ignoredNotification = true; note(run, `Ignored: ${id} is unknown or already completed (a client MUST ignore these).`); }
  }

  function serverBrowser(run, ctx, step, verifyUser) {
    const who = ctx.scenario.browserUser ?? run.user;
    log(run, 'browser', 'browser', null, `${who} opens the link in a browser and uses the server's own page (${step.action}).`);
    const r = handleBrowser(ctx.server, step, who, { verifyUser });
    if (r.takeover) finding(run, [{ id: 'phish-identity', ...FINDINGS['phish-identity'], detail: `${who} completed ${run.user}'s flow; the result was bound to ${r.boundTo}.` }]);
    log(run, 'server', 'note', null, r.ok ? `The page accepted it for ${r.boundTo}${r.takeover ? ` (but ${who} is the one who used it)` : ''}.` : `The page refused: ${r.reason}.`);
    return r;
  }

  async function callTool(run, ctx) {
    const sc = ctx.scenario;
    const id = ++ctx.clientId;
    log(run, 'client→server', 'request', { jsonrpc: '2.0', id, method: 'tools/call', params: { name: sc.tool, arguments: sc.args } }, ctx.attempt > 1 ? 'Retry of the original request (optional per the spec).' : null, 'tools/call');
    const gen = TOOLS[sc.tool]({ args: sc.args, caps: ctx.caps, state: ctx.server, user: run.user, opts: { verifyUser: sc.verifyUser } });
    let reply;
    for (;;) {
      const { value, done } = await gen.next(reply);
      reply = undefined;
      if (done) return finishCall(run, ctx, id, value);
      if (value.type === 'elicit') reply = await clientElicit(run, ctx, value.params);
      else if (value.type === 'notify') clientNotified(run, ctx, value);
      else if (value.type === 'browser') reply = serverBrowser(run, ctx, value, sc.verifyUser !== false);
    }
  }

  async function finishCall(run, ctx, id, step) {
    if (step.type === 'result') {
      log(run, 'server→client', 'response', { jsonrpc: '2.0', id, result: { content: step.content, ...(step.isError ? { isError: true } : {}) } });
      run.outcome = step.content[0].text; run.status = 'done'; return;
    }
    // -32042 URLElicitationRequired
    const error = { code: -32042, message: step.message, data: { elicitations: step.elicitations } };
    log(run, 'server→client', 'error', { jsonrpc: '2.0', id, error }, 'The request cannot proceed until a URL-mode elicitation is completed.');
    const errFindings = lintUrlRequired(error, ctx.caps);
    finding(run, errFindings);
    const ok = Array.isArray(step.elicitations) && step.elicitations.length > 0 && step.elicitations.every((e) => e?.mode === 'url' && e?.elicitationId);
    if (!ok || !step.after) { run.outcome = 'The error was malformed, so the client cannot continue. (Lab behaviour.)'; run.status = 'done'; return; }
    const e = step.elicitations[0];
    if (!modeAllowed(ctx.caps, 'url')) { run.outcome = 'The client did not declare url mode, so it cannot act on -32042.'; run.status = 'done'; return; }
    const dialog = dialogFor(ctx, e, { forError: true });
    const decision = await waitForUser(run, ctx, dialog);
    if (decision.action !== 'accept') {
      note(run, 'No consent, so nothing is opened. The client shows a manual retry control.');
      run.outcome = `not connected: the person chose ${decision.action}. The original request cannot proceed.`; run.status = 'done'; return;
    }
    ctx.active.add(e.elicitationId);
    log(run, 'client', 'browser', null, `The client opens ${dialog.url.host} in a secure browser view. The lab makes no request.`);
    const r = serverBrowser(run, ctx, { elicitationId: e.elicitationId, action: step.after.action }, step.after.verifyUser);
    if (!r.ok) { run.outcome = `The page refused: ${r.reason}.`; run.status = 'done'; return; }
    clientNotified(run, ctx, { method: 'notifications/elicitation/complete', params: { elicitationId: e.elicitationId } });
    ctx.attempt += 1;
    await callTool(run, ctx);
  }

  async function drive(run, ctx) {
    try {
      log(run, 'client→server', 'request', { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: PROTOCOL, capabilities: ctx.caps === null ? {} : { elicitation: ctx.caps }, clientInfo: CLIENT_INFO } }, null, 'initialize');
      log(run, 'server→client', 'response', { jsonrpc: '2.0', id: 0, result: { protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: SERVER_INFO } });
      log(run, 'client→server', 'notification', { jsonrpc: '2.0', method: 'notifications/initialized' }, null, 'notifications/initialized');
      await callTool(run, ctx);
    } catch (e) { run.status = 'failed'; run.outcome = `Lab error: ${e.message}`; }
    ctx.settle();
  }

  function newSettle(ctx) { ctx.settled = new Promise((res) => { ctx.settle = () => { res(); }; }); }

  async function start({ scenarioId, caps, autopilot, user = 'alice' }) {
    const sc = Object.hasOwn(SCENARIO_BY_ID, scenarioId) ? SCENARIO_BY_ID[scenarioId] : null; // own keys only: '__proto__' or 'constructor' is not a scenario
    if (!sc) throw Object.assign(new Error('unknown scenario'), { code: 'unknown_scenario' });
    if (!/^[a-z]{2,16}$/.test(user)) throw Object.assign(new Error('bad user'), { code: 'bad_user' });
    const capsN = normalizeCaps(caps);
    const ap = autopilot === true ? sc.autopilot : autopilot || null;
    if (ap && !['accept', 'decline', 'cancel'].includes(ap)) throw Object.assign(new Error('bad autopilot'), { code: 'bad_autopilot' });
    const run = { id: randomUUID(), scenarioId, status: 'running', user, caps: capsN === undefined ? sc.caps : capsN, traceId: randomBytes(16).toString('hex'), startedAt: now().toISOString(), transcript: [], findings: [], flags: {}, pending: null, outcome: null };
    const ctx = { scenario: sc, caps: run.caps, server: createServerState(), srvId: 0, clientId: 0, attempt: 1, active: new Set(), completed: new Set(), autopilot: ap, triedFirst: false };
    newSettle(ctx);
    runs.set(run.id, run); ctxs.set(run.id, ctx);
    drive(run, ctx);
    await ctx.settled;
    return view(run);
  }

  async function respond(id, { action, content }) {
    const run = runs.get(id); const ctx = ctxs.get(id);
    if (!run) throw Object.assign(new Error('not found'), { code: 'not_found' });
    if (run.status !== 'awaiting_user' || !run.pending) throw Object.assign(new Error('this run is not waiting for the person'), { code: 'not_waiting' });
    if (!['accept', 'decline', 'cancel'].includes(action)) throw Object.assign(new Error('action must be accept, decline or cancel'), { code: 'bad_action' });
    if (action === 'accept' && run.pending.kind === 'form') {
      const v = validateContent(run.pending.requestedSchema, content);
      if (!v.ok) { run.pending.errors = v.errors; run.flags.clientBlocked = true; note(run, `The client blocks sending: ${Object.entries(v.errors).map(([k, m]) => `${k}: ${m}`).join('; ')}. Nothing is sent to the server.`); return view(run); }
    }
    newSettle(ctx);
    ctx.resolveUser({ action, ...(action === 'accept' && run.pending.kind === 'form' ? { content } : {}) });
    await ctx.settled;
    return view(run);
  }

  function view(run) {
    const { id, scenarioId, status, user, caps, traceId, startedAt, transcript, findings, flags, pending, outcome } = run;
    return { id, scenarioId, status, user, caps, traceId, startedAt, transcript, findings, flags, pending, outcome };
  }

  return { start, respond, get: (id) => (runs.has(id) ? view(runs.get(id)) : null), list: () => [...runs.values()].reverse().map(view), reset() { runs.clear(); ctxs.clear(); return { reset: true }; } };
}
