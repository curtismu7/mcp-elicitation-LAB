// What a client must show and warn about before a person consents to open a URL. Pure, no network: the lab never fetches a URL
// (spec 2025-11-25: clients MUST NOT pre-fetch the URL or its metadata).
const SENSITIVE_PARAM = /^(token|access_token|id_token|refresh_token|api[_-]?key|apikey|key|secret|client_secret|password|passwd|pwd|sig|signature|auth|authorization|session|sessionid|code)$/i;
const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[?::1\]?)$/;

export function analyzeUrl(raw) {
  const full = String(raw ?? '');
  let u;
  try { u = new URL(full); } catch { return { valid: false, full }; }
  const labels = u.hostname.split('.');
  const apex = labels.length > 2 ? labels.slice(-2).join('.') : u.hostname; // approximate: no public suffix list
  const subdomain = labels.length > 2 ? labels.slice(0, -2).join('.') : '';
  const sensitiveParams = [...u.searchParams.keys()].filter((k) => SENSITIVE_PARAM.test(k));
  return {
    valid: true, full, scheme: u.protocol.replace(':', ''), host: u.hostname, port: u.port || null,
    subdomain, apex, // the client should highlight `apex` so a long subdomain cannot hide the real domain
    https: u.protocol === 'https:', loopback: LOOPBACK.test(u.hostname),
    userinfo: u.username !== '' || u.password !== '',
    punycode: labels.some((l) => l.toLowerCase().startsWith('xn--')),
    nonAsciiInInput: /[^\x00-\x7f]/.test(full),
    sensitiveParams,
  };
}

// Warnings a client SHOULD show next to the URL (2025-11-25: highlight the domain; warn on ambiguous or suspicious URIs, e.g. Punycode).
export function urlWarnings(a) {
  if (!a.valid) return ['This is not a valid URL.'];
  const w = [];
  if (a.punycode || a.nonAsciiInInput) w.push('The host uses Punycode or non-ASCII characters: it may imitate another site.');
  if (a.userinfo) w.push('The URL contains a username or password before the host.');
  if (a.sensitiveParams.length) w.push(`The URL carries sensitive-looking parameters (${a.sensitiveParams.join(', ')}).`);
  if (!a.https && !a.loopback) w.push('The URL is not HTTPS.');
  return w;
}
