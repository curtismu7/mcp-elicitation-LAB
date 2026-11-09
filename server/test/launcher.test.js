// Behind the family lab-proxy: Host is this lab's LAB_ALLOWED_HOSTS name with its port, the browser's Origin is the
// launcher's, and the proxy says so in X-Forwarded-Host/-Proto. Placeholder names here; compose sets the real one.
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createHealth } from '../src/health.js';
import { parseAllowedHosts, proxyHostSet } from '../src/safety.js';

const NAME = 'mcp-elicitation-lab.proxy.example';
const XFH = 'launcher.example:8443';
const PROXY = `https://${XFH}`;
const PORT = 6800;
const app = () => createApp({
  health: createHealth({ runChecks: async () => [], intervalMs: 3_600_000 }),
  webDist: '/nonexistent',
  proxyHosts: proxyHostSet(parseAllowedHosts({ LAB_ALLOWED_HOSTS: ` ${NAME.toUpperCase()} ` }), PORT),
});
const fwd = { 'X-Forwarded-Host': XFH, 'X-Forwarded-Proto': 'https' };
const post = (headers) => request(app()).post('/api/mode').set(headers).send({ source: 'mock' });

describe('lab-proxy (LAB_ALLOWED_HOSTS)', () => {
  it('parses a comma list of host names; unset is loopback only; a port or URL is refused at start', () => {
    expect(parseAllowedHosts({})).toEqual([]);
    expect(parseAllowedHosts({ LAB_ALLOWED_HOSTS: 'A.example, b.example,' })).toEqual(['a.example', 'b.example']);
    for (const bad of ['a.example:6800', 'http://a.example', 'a.example/x']) expect(() => parseAllowedHosts({ LAB_ALLOWED_HOSTS: bad })).toThrow();
  });
  it('accepts the launcher Host <name>:<port>; refuses the bare name, another port, or a Host outside the set', async () => {
    expect((await request(app()).get('/api/health').set('Host', `${NAME}:${PORT}`)).status).toBe(200);
    for (const host of [NAME, `${NAME}:1`, `proxy.example:${PORT}`, XFH, `evil.example:${PORT}`]) {
      const res = await request(app()).get('/api/health').set('Host', host);
      expect(res.status, host).toBe(403);
      expect(res.body.error).toBe('bad_host');
    }
  });
  it('accepts a proxied same-origin write; refuses a foreign or mismatched Origin', async () => {
    const host = `${NAME}:${PORT}`;
    expect((await post({ Host: host, ...fwd, Origin: PROXY, 'Sec-Fetch-Site': 'same-origin' })).status).toBe(200);
    for (const origin of ['https://evil.example', `http://${XFH}`, `https://${XFH.split(':')[0]}`]) {
      expect((await post({ Host: host, ...fwd, Origin: origin })).status, origin).toBe(403);
    }
    expect((await post({ Host: host, ...fwd, 'X-Forwarded-Proto': 'ftp', Origin: `ftp://${XFH}` })).status).toBe(403);
    expect((await post({ Host: host, 'X-Forwarded-Proto': 'https', Origin: 'https://' })).status).toBe(403);
    expect((await post({ Host: host, 'X-Forwarded-Host': XFH, Origin: PROXY })).status).toBe(403);
  });
  it('ignores forwarded headers on a loopback Host; a Host outside the set is refused before any Origin check', async () => {
    expect((await post({ Host: `127.0.0.1:${PORT}`, ...fwd, Origin: PROXY })).status).toBe(403);
    expect((await post({ Host: `localhost:${PORT}`, 'X-Forwarded-Host': 'evil.example', 'X-Forwarded-Proto': 'https', Origin: 'https://evil.example' })).status).toBe(403);
    const res = await post({ Host: `evil.example:${PORT}`, 'X-Forwarded-Host': 'evil.example', 'X-Forwarded-Proto': 'https', Origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('bad_host');
  });
});
