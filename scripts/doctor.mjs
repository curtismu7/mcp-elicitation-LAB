// Preflight: the same checks GET /api/health reports from (Node version, mode, bind, port range, every scenario behaves as declared, diagram data,
// talk track, netguard self-test), plus whether the port is free, plus one real run through the HTTP API on a throwaway port.
// Prints only pass/fail lines, never a setting's value. Exit 1 on failure. Needs no network and no other service.
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (p) => import(pathToFileURL(path.join(root, p)));
const { installNetguard } = await load('server/src/netguard.js');
installNetguard();
const { applySharedSettings } = await load('server/src/settings.js');
applySharedSettings();

const { runChecks } = await load('server/src/doctor.js');
let failed = 0;
const report = (level, name, detail) => { if (level === 'fail') failed++; console.log(`${level.toUpperCase().padEnd(4)}  ${name}: ${detail}`); };
for (const c of await runChecks()) report(c.level, c.id, c.detail);

// A real cycle through the HTTP layer, in this process, on an ephemeral loopback port.
try {
  const { createApp } = await load('server/src/app.js');
  const { createHealth } = await load('server/src/health.js');
  const health = createHealth({ runChecks: async () => [], intervalMs: 3_600_000 });
  await health.ready;
  const server = await new Promise((resolve, reject) => { const s = createApp({ health }).listen(0, '127.0.0.1', () => resolve(s)); s.once('error', reject); });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const h = { 'content-type': 'application/json', origin: base, 'x-workspace': 'doctor' };
    const hz = await (await fetch(`${base}/api/health`)).json();
    const run = await (await fetch(`${base}/api/runs`, { method: 'POST', headers: h, body: JSON.stringify({ scenarioId: 'url-required', autopilot: true }) })).json();
    const reset = await (await fetch(`${base}/api/reset`, { method: 'POST', headers: h, body: '{}' })).json();
    const left = (await (await fetch(`${base}/api/runs`, { headers: h })).json()).runs.length;
    const ok = hz.schema === 'demo-health/1' && run.status === 'done' && run.findings.length === 0 && reset.reset === true && left === 0;
    report(ok ? 'pass' : 'fail', 'http-cycle', ok ? 'health answers demo-health/1; a -32042 run finished over HTTP; Reset cleared the workspace' : 'the health, run and reset cycle did not complete');
  } finally { health.stop(); await new Promise((res) => server.close(res)); }
} catch { report('fail', 'http-cycle', 'the HTTP cycle could not run'); }

const port = Number(process.env.PORT) || 6800;
await new Promise((resolve) => {
  const s = net.createServer();
  s.once('error', (e) => { report('fail', 'port-free', `${port} is not free (${e.code}). Set PORT to a free port in 6800-6849`); resolve(); });
  s.listen(port, '127.0.0.1', () => s.close(() => { report('pass', 'port-free', `${port} is free`); resolve(); }));
});
process.exit(failed ? 1 : 0);
