import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const SKIP = new Set(['node_modules', 'dist', '.git', 'package-lock.json']);
// Every shipped text file, except the test files that hold the patterns they look for.
function shipped(dir = root, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) shipped(p, out);
    else if (/\.(m?js|jsx|json|md|ya?ml|css|html)$/.test(name) && !/(^|\/)(repo|compose|pack|reset|talk-track)\.test\.mjs$/.test(p) && !/standalone-ui\.css$/.test(p) && !/content-pack\.schema\.json$/.test(p)) out.push(p);
  }
  return out;
}
const code = () => shipped().filter((p) => /\.(m?js|jsx)$/.test(p) && !/\.test\./.test(p));

test('the files the standalone rules ask for are present', () => {
  for (const f of ['README.md', 'CLAUDE.md', 'LICENSE', 'Dockerfile', 'docker-compose.yml', '.dockerignore', '.gitignore', '.github/workflows/ci.yml', 'docs/talk-track.md', 'docs/safety.md', 'docs/content-pack.schema.json', 'docs/shelf-entry.json', 'content-pack.json', 'scripts/doctor.mjs', 'scripts/reset.mjs', 'scripts/smoke.mjs', 'scripts/build-talk-track.mjs', 'web/src/styles/standalone-ui.css', 'server/diagrams/elicitation-actors.json', 'server/src/diagramData.js', 'server/src/netguard.js']) {
    assert.ok(fs.existsSync(path.join(root, f)), f);
  }
});

test('the lab ships no k8s manifests, no SE deploy code, no hosted mode and no bare MODE (k8s deferred by the owner, 2026-10-31)', () => {
  assert.ok(!fs.existsSync(path.join(root, 'k8s')));
  const hits = [];
  for (const p of code()) {
    const t = fs.readFileSync(p, 'utf8');
    if (/process\.env\.MODE|\benv\.MODE\b|LAB_HOSTED|ALLOWED_ORIGIN_HOST|__SE_HOST__|__IMAGE__|kubectl/.test(t)) hits.push(path.relative(root, p));
  }
  assert.deepEqual(hits, []);
  assert.ok(!/^\s*MODE:/m.test(read('docker-compose.yml')) && !/\bMODE=/.test(read('Dockerfile')));
});

test('settings come from the one shared file only: no per-app .env loader, and the settings reader takes only this lab\'s key', () => {
  for (const p of code()) assert.ok(!/loadEnvFile|dotenv/.test(fs.readFileSync(p, 'utf8')), path.relative(root, p));
  assert.ok(!fs.existsSync(path.join(root, '.env.example')));
  assert.match(read('server/src/settings.js'), /parseEnv/);
  assert.match(read('server/src/settings.js'), /SETTINGS_KEYS = \['MEL_LAB_MODE'\]/);
});

test('no EC key generation (it aborted on Node 20 in CI): P-256 keys are built from createECDH', () => {
  for (const p of shipped().filter((f) => /\.(m?js|jsx)$/.test(f))) assert.ok(!/generateKeyPair(Sync)?\(\s*['"]ec['"]/.test(fs.readFileSync(p, 'utf8')), path.relative(root, p));
});

test('no host in shipped text except .example / .invalid / loopback (and the two public spec page links, shown and never fetched); no foreign identifiers', () => {
  const ALLOWED = new Set(['modelcontextprotocol.io']);
  const hits = [];
  for (const p of shipped()) {
    const t = fs.readFileSync(p, 'utf8');
    for (const m of t.matchAll(/\b(?:https?|wss?|ftp):\/\/([^\s/?#"'`<>\\)\]]+)/gi)) {
      const h = m[1].replace(/^[^@]*@/, '').replace(/^\[::1\].*/, '::1').split(':')[0].toLowerCase(); // host part; ports and template placeholders after the colon are ignored
      if (!h || h.startsWith('${') || /(^|\.)(invalid|example)$/.test(h) || /^(localhost|127(\.\d{1,3}){3}|\[?::1\]?)$/.test(h) || ALLOWED.has(h) || /^github\.com$/.test(h)) continue;
      hits.push(`${path.relative(root, p)}: ${h}`);
    }
    if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(t) && !/content-pack\.json$/.test(p)) hits.push(`${path.relative(root, p)}: a UUID-shaped id`);
    if (/\/Users\/|cmuir|curtismu|ping-devops/i.test(t)) hits.push(`${path.relative(root, p)}: a personal path or name`);
  }
  assert.deepEqual(hits, []);
});

test('the CI workflow is GitHub-hosted, Node 26 only, and carries the build, test, doctor, forbidden-strings and gitleaks jobs', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /runs-on: ubuntu-latest/);
  assert.ok(!/self-hosted/.test(ci));
  const versions = [...ci.matchAll(/node-version: (\S+)/g)].map((m) => m[1]);
  assert.ok(versions.length >= 3 && versions.every((v) => v === '26'), versions.join());
  assert.match(ci, /actions\/checkout@v5/); assert.match(ci, /actions\/setup-node@v5/);
  for (const job of ['build:', 'test:', 'doctor:', 'forbidden-strings:', 'gitleaks:']) assert.ok(ci.includes(`\n  ${job}`), job);
  assert.match(ci, /npm run build/); assert.match(ci, /npm test/);
  assert.match(ci, /PORT=6849 npm run doctor/);
  assert.match(ci, /validate-content-pack\.mjs/);
});

test('package.json requires Node 26 and the Dockerfile uses a Node 26 base', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.engines.node, '>=26');
  assert.equal(pkg.license, 'MIT');
  for (const s of ['start', 'dev', 'test', 'build', 'doctor', 'reset', 'prepare', 'smoke']) assert.ok(pkg.scripts[s], s);
  assert.equal(read('.nvmrc').trim(), '26');
  assert.equal((read('Dockerfile').match(/^FROM node:26-alpine/gm) || []).length, 2);
});

test('README follows the README standard: title ends in LAB, plain Tier, Repo and Catalog lines, the port text, the sections in order; no internal names', () => {
  const r = read('README.md');
  assert.match(r.split('\n')[0], /^# .* LAB$/);
  assert.match(r, /^Tier: Tester$/m);
  assert.match(r, /^Repo: https:\/\/github.com/curtismu7\/mcp-elicitation-LAB$/m);
  assert.match(r, /^Catalog: D37$/m);
  const at = (h) => r.indexOf(`\n## ${h}`);
  const order = ['What is simulated', 'Run from a clone', 'Settings file', 'Ports, and what to do if the port is taken', 'Mock and live modes', 'Health, doctor and reset', 'Docker', 'Tests', 'Troubleshooting', 'Ownership'].map(at);
  assert.ok(order.every((i) => i > 0), order.join());
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'sections are in order');
  assert.match(r, /lsof -iTCP:6800 -sTCP:LISTEN -n -P/);
  assert.match(r, /PORT=<other port> npm start/);
  assert.match(r, /Port range for this app: 6800-6849\./);
  assert.match(r, /util\.parseEnv/);
  assert.match(r, /\/api\/health/);
  assert.ok(!/ping-devops|cmuir|curtismu/i.test(r));
});

test('app CSS follows the CSS standard: tokens only, no dark-mode media query, no forced priority, no italics, breakpoints 600 and 900 only, no purple, shared stylesheet first', () => {
  const css = read('web/src/app.css');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(css), 'no colour literal');
  assert.ok(!/prefers-color-scheme/.test(css)); assert.ok(!/!important/.test(css)); assert.ok(!/font-style:\s*italic/.test(css)); assert.ok(!/outline:\s*none/.test(css));
  const widths = [...css.matchAll(/@media \((?:max|min)-width: (\d+)px\)/g)].map((m) => m[1]);
  assert.ok(widths.length > 0 && widths.every((w) => w === '600' || w === '900'), widths.join());
  assert.ok(!/purple|violet|magenta|indigo/i.test(css));
  const main = read('web/src/main.jsx');
  assert.ok(main.indexOf('standalone-ui.css') < main.indexOf('app.css'), 'the shared stylesheet loads before the app stylesheet');
  assert.ok(!fs.existsSync(path.join(root, 'web/src/index.css')));
});

test('the web code has no style attributes, no <em>/<i>, no mermaid, no credential field, and Run buttons use aria-disabled', () => {
  const web = shipped().filter((p) => p.includes(`${path.sep}web${path.sep}src${path.sep}`) && /\.jsx$/.test(p) && !/\.test\./.test(p));
  assert.ok(web.length >= 6);
  for (const p of web) {
    const t = fs.readFileSync(p, 'utf8');
    assert.ok(!/style=\{\{|<em>|<i>|mermaid|type="password"/.test(t), path.relative(root, p));
    assert.ok(!/\sdisabled(=|\s|>)/.test(t), `${path.relative(root, p)}: use aria-disabled so focus is kept`);
  }
  assert.ok(!/mermaid/i.test(read('web/package.json')));
});

test('docs never use the word "door"', () => {
  for (const f of ['README.md', 'CLAUDE.md', 'docs/talk-track.md', 'docs/safety.md']) assert.ok(!/\bdoor\b/i.test(read(f)), f);
});
