import { installNetguard } from './netguard.js';
import { createApp } from './app.js';
import { allPassed, runChecks } from './doctor.js';
import { assertBindAllowed, bindHost, parseAllowedHosts, proxyHostSet, resolvePort } from './safety.js';
import { modeFrom } from './config.js';
import { applySharedSettings } from './settings.js';

const allowedNames = parseAllowedHosts(); // LAB_ALLOWED_HOSTS, before any server or timer starts

installNetguard(); // before anything else can open a socket

// The one shared settings file (rulebook): ~/Development/.env, or STANDALONE_ENV. Optional; only this lab's own key is taken; never printed.
applySharedSettings();

const checks = await runChecks();
if (!allPassed(checks)) {
  for (const c of checks.filter((x) => x.level === 'fail')) console.error(`[mcp-elicitation-lab] refusing to start: ${c.id}: ${c.detail}`);
  process.exit(1);
}
const mode = modeFrom(process.env);
const host = assertBindAllowed(bindHost(), process.env);
const port = resolvePort();
createApp({ proxyHosts: proxyHostSet(allowedNames, port) }).listen(port, host, () => console.log(`[mcp-elicitation-lab] simulated lab at http://${host}:${port}/ (${mode} mode; loopback, no outbound network; health: /api/health)`));
