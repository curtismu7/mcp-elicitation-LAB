// Preflight checks shared by `npm run doctor` and GET /api/health. Never prints a secret, needs no network.
// Each check: { id, level: 'pass' | 'info' | 'fail', detail }.
import fs from 'node:fs';
import { assertBindAllowed, bindHost, portProblem, DEFAULT_PORT, PORT_MIN, PORT_MAX } from './safety.js';
import { netguardSelfTest } from './netguard.js';
import { modeFrom } from './config.js';
import { settingsPath } from './settings.js';
import { createLab } from './engine.js';
import { SCENARIOS } from './scenarios.js';
import { FINDINGS } from './lint.js';
import { DIAGRAM_NAMES, loadDiagram } from './diagramData.js';
import { TALK_TRACK } from './talkTrack.js';

export async function runChecks({ env = process.env } = {}) {
  const checks = [];
  const add = (id, level, detail) => checks.push({ id, level, detail });

  const major = Number(process.versions.node.split('.')[0]);
  add('node', major >= 26 ? 'pass' : 'fail', `v${process.versions.node} (need >= 26)`);

  try { add('mode', 'pass', `${modeFrom(env)} (the only mode: the MCP server and client are mocks inside this app; Live is refused with a message)`); }
  catch (e) { add('mode', 'fail', e.message); }

  try { add('bind', 'pass', `${assertBindAllowed(bindHost(env), env)}${env.MEL_LAB_BIND ? ' (MEL_LAB_BIND opt-in)' : ' (loopback)'}`); }
  catch (e) { add('bind', 'fail', e.message); }

  const port = env.PORT === undefined || env.PORT === '' ? DEFAULT_PORT : Number(env.PORT);
  const problem = portProblem(port);
  add('port-range', problem ? 'fail' : 'pass', problem || `${port} is inside ${PORT_MIN}-${PORT_MAX} and not reserved`);

  const file = settingsPath(env);
  try { const m = fs.statSync(file).mode & 0o777; add('settings-file', m & 0o077 ? 'info' : 'pass', m & 0o077 ? 'the shared settings file is readable by others: chmod 600 it' : 'the shared settings file exists and is mode 600 (values are never printed)'); }
  catch { add('settings-file', 'info', 'no shared settings file: the lab needs none'); }

  // Every scenario, driven by its autopilot, must give exactly the findings and outcome it declares.
  const bad = [];
  for (const sc of SCENARIOS) {
    const r = await createLab().start({ scenarioId: sc.id, autopilot: true });
    const got = [...new Set(r.findings.map((f) => f.id))].sort().join(',');
    if (r.status !== 'done' || got !== [...sc.expect.findings].sort().join(',') || !String(r.outcome).includes(sc.expect.outcomeIncludes)) bad.push(sc.id);
  }
  add('scenarios', bad.length ? 'fail' : 'pass', bad.length ? `wrong result for ${bad.join(', ')}` : `${SCENARIOS.length} scenarios behave as declared`);

  const uncited = Object.entries(FINDINGS).filter(([, f]) => !/^2025-11-25 > /.test(f.cite)).map(([id]) => id);
  add('citations', uncited.length ? 'fail' : 'pass', uncited.length ? `findings without a spec citation: ${uncited.join(', ')}` : `${Object.keys(FINDINGS).length} findings, each citing the specification page it comes from`);

  try { for (const n of DIAGRAM_NAMES) loadDiagram(n); add('diagrams', 'pass', `${DIAGRAM_NAMES.length} diagram-studio/1 diagram loads and validates`); }
  catch (e) { add('diagrams', 'fail', e.message); }

  const ids = TALK_TRACK.map((t) => t.id);
  add('talk-track', new Set(ids).size === ids.length && TALK_TRACK.every((t) => t.title && t.say) ? 'pass' : 'fail', `${TALK_TRACK.length} talk-track entries, unique ids`);

  const ng = await netguardSelfTest();
  add('netguard', ng.ok ? 'pass' : 'fail', ng.ok ? `blocked fetch, socket, socket-by-IP, dns lookup, dns resolve, udp send and udp connect to a non-loopback host (${ng.blocked}/7)` : ng.detail);

  add('tenant', 'pass', 'simulated only: no tenant, no credentials, no outbound network; real MCP clients and the unread spec pages are UNVERIFIED');
  return checks;
}

export const allPassed = (checks) => checks.every((c) => c.level !== 'fail');
