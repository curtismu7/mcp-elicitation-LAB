// Safety rules. Pure functions plus two tiny middlewares. No I/O.
//  1. Loopback bind only unless MEL_LAB_BIND is set on purpose (the container sets it; compose publishes on 127.0.0.1 only).
//  2. Host header must be a loopback name, or <LAB_ALLOWED_HOSTS name>:<port> (DNS-rebinding defence).
//  3. A write must be same-origin: a cross-origin Origin, or a cross-site Sec-Fetch-Site, is refused.
//  4. Ports are 6800-6849 and never one of the forbidden ones.

export function isLoopbackHost(host) {
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(h);
}

export function bindHost(env = process.env) { return env.MEL_LAB_BIND || '127.0.0.1'; }

export function assertBindAllowed(host, env = process.env) {
  if (isLoopbackHost(host) || env.MEL_LAB_BIND) return host;
  throw new Error(`refusing to bind ${host}: loopback only. Set MEL_LAB_BIND to opt in (the container does; compose publishes on 127.0.0.1 only).`);
}

export const PORT_MIN = 6800;
export const PORT_MAX = 6849;
export const DEFAULT_PORT = 6800;
const FORBIDDEN_PORTS = new Set([8080, 5173, 3000, 3900, 4000, 4400, 4510, 4600, 4601, 4840, 18080, 19080, 19090]);
export function portProblem(port) {
  if (!Number.isInteger(port)) return 'PORT is not an integer';
  if (FORBIDDEN_PORTS.has(port)) return `port ${port} is reserved for something else`;
  if (port < PORT_MIN || port > PORT_MAX) return `port ${port} is outside ${PORT_MIN}-${PORT_MAX}`;
  return null;
}
export function resolvePort(env = process.env) {
  const port = env.PORT === undefined || env.PORT === '' ? DEFAULT_PORT : Number(env.PORT);
  const problem = portProblem(port);
  if (problem) throw new Error(problem);
  return port;
}

// Lab-proxy names (LAB_ALLOWED_HOSTS, comma list of host names, no ports). Unset means loopback only. Each name is accepted
// in Host only as "<name>:<port>" (the lab's own port), never bare and never with another port.
export function parseAllowedHosts(env = process.env) {
  const names = String(env.LAB_ALLOWED_HOSTS || '').split(',').map((n) => n.trim().toLowerCase()).filter(Boolean);
  for (const n of names) if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/.test(n)) throw new Error(`LAB_ALLOWED_HOSTS: "${n}" is not a host name`);
  return names;
}
export const proxyHostSet = (names, port) => new Set(names.map((n) => `${n}:${port}`));

// Behind the family lab-proxy the browser's Origin is the launcher's while Host is this lab's own LAB_ALLOWED_HOSTS name.
// X-Forwarded-Host/-Proto are believed only when Host is one of those names, so a request that did not come through the
// proxy (loopback Host, or any other Host) cannot use them.
export function isProxiedSameOrigin(headers, proxyHosts) {
  const xfh = String(headers['x-forwarded-host'] || '').trim().toLowerCase();
  const xfp = String(headers['x-forwarded-proto'] || '').trim().toLowerCase();
  return proxyHosts.has(String(headers.host || '').toLowerCase()) && xfh !== '' && (xfp === 'https' || xfp === 'http')
    && headers.origin === `${xfp}://${xfh}`;
}

export const makeHostCheck = (proxyHosts = new Set()) => function hostCheck(req, res, next) {
  const raw = String(req.headers.host || '');
  const host = raw.startsWith('[') ? raw.slice(0, raw.indexOf(']') + 1) : raw.replace(/:\d+$/, '');
  if (!isLoopbackHost(host) && !proxyHosts.has(raw.toLowerCase())) return res.status(403).json({ error: 'bad_host', message: 'Host must be a loopback name' });
  next();
};
export const hostCheck = makeHostCheck();

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
export const makeSameOriginWrites = (proxyHosts = new Set()) => function sameOriginWrites(req, res, next) {
  if (!WRITE.has(req.method)) return next();
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return res.status(403).json({ error: 'cross_origin', message: 'writes must be same-origin' });
  const origin = req.headers.origin;
  if (origin) {
    let ok = isProxiedSameOrigin(req.headers, proxyHosts);
    if (!ok) try { ok = new URL(origin).host.toLowerCase() === String(req.headers.host || '').toLowerCase(); } catch { /* malformed */ }
    if (!ok) return res.status(403).json({ error: 'cross_origin', message: 'writes must be same-origin' });
  }
  next();
};
export const sameOriginWrites = makeSameOriginWrites();
