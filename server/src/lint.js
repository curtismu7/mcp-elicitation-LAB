import { analyzeUrl } from './url.js';
import { schemaProblems } from './schema.js';

// Findings are sourced ONLY from the two spec pages fetched and read on 2026-10-22:
//   https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation   (called "2025-11-25" below)
//   https://modelcontextprotocol.io/specification/draft/client/elicitation        (the draft; unstable)
// Anything those pages do not say is not a finding here. Pages NOT read (security best practices, authorization) are UNVERIFIED.
const SPEC = '2025-11-25';
export const FINDINGS = {
  'form-sensitive': { level: 'MUST NOT', who: 'server', title: 'Sensitive information requested through a form', cite: `${SPEC} > User Interaction Model (warning) and Form Mode Security`, text: 'Servers MUST NOT use form mode to request passwords, API keys, access tokens or payment credentials. Use URL mode.' },
  'form-schema': { level: 'MUST', who: 'server', title: 'Schema is not a flat object of primitives', cite: `${SPEC} > Form Mode > Requested Schema`, text: 'Form schemas are limited to flat objects with primitive properties (string, number, boolean, enums). Nested structures are intentionally not supported.' },
  'form-clickable': { level: 'SHOULD NOT', who: 'server', title: 'Clickable URL inside a form request', cite: `${SPEC} > Safe URL Handling (server rules)`, text: 'Servers SHOULD NOT include URLs intended to be clickable in any field of a form mode request.' },
  'url-missing-id': { level: 'MUST', who: 'server', title: 'URL mode request without an elicitationId', cite: `${SPEC} > URL Mode Elicitation Requests`, text: 'URL mode requests MUST include url and elicitationId. (The draft removes elicitationId; this lab targets 2025-11-25.)' },
  'url-invalid': { level: 'MUST', who: 'server', title: 'The url is not a valid URL', cite: `${SPEC} > URL Mode Elicitation Requests`, text: 'The url parameter MUST contain a valid URL.' },
  'url-sensitive': { level: 'MUST NOT', who: 'server', title: 'Sensitive or pre-authenticated information in the URL', cite: `${SPEC} > Safe URL Handling (server rules)`, text: 'Servers MUST NOT put sensitive user information (credentials, PII) in the URL, and MUST NOT give a pre-authenticated URL: a malicious client could use it to impersonate the user.' },
  'url-not-https': { level: 'SHOULD', who: 'server', title: 'URL is not HTTPS', cite: `${SPEC} > Safe URL Handling (server rules)`, text: 'Servers SHOULD use HTTPS URLs for non-development environments.' },
  'url-punycode': { level: 'SHOULD', who: 'client', title: 'Ambiguous or suspicious host (Punycode)', cite: `${SPEC} > Safe URL Handling (client rules)`, text: 'Clients SHOULD warn for ambiguous or suspicious URIs (for example Punycode) and SHOULD highlight the domain to mitigate subdomain spoofing.' },
  'mode-undeclared': { level: 'MUST NOT', who: 'server', title: 'Mode the client did not declare', cite: `${SPEC} > Capabilities and Error Handling`, text: 'Servers MUST NOT send elicitation requests with modes the client does not support. A client MUST answer such a request with -32602 (Invalid params).' },
  'error-shape': { level: 'MUST', who: 'server', title: 'Malformed URLElicitationRequired (-32042) error', cite: `${SPEC} > URL Elicitation Required Error`, text: 'The error MUST include a list of elicitations; every one MUST be URL mode and have an elicitationId.' },
  'phish-identity': { level: 'MUST', who: 'server', title: 'Did not verify who opened the URL', cite: `${SPEC} > Security Considerations > Phishing`, text: 'The server MUST verify that the user who opens the URL is the same user the elicitation was generated for. Otherwise Bob can complete Alice\'s flow and her session gets bound to his account.' },
};

const SENSITIVE_WORD = /(pass(word|wd)?|secret|api[\s_-]?key|access[\s_-]?token|\btoken\b|credit[\s_-]?card|card[\s_-]?number|\bcvv\b|\bssn\b)/i;
const LINK = /\bhttps?:\/\/\S+/i;

const add = (list, id, detail) => { if (!list.some((f) => f.id === id && f.detail === detail)) list.push({ id, ...FINDINGS[id], detail }); };

// Server-side problems in one elicitation/create request (or one entry of a -32042 error). `caps` = what the client declared.
export function lintElicitation(params, caps) {
  const out = [];
  const mode = params.mode ?? 'form';
  const declared = mode === 'form' ? Boolean(caps?.form || (caps && Object.keys(caps).length === 0)) : Boolean(caps?.url);
  if (!declared) add(out, 'mode-undeclared', `The client did not declare ${mode} mode.`);
  if (mode === 'form') {
    const probs = schemaProblems(params.requestedSchema);
    if (probs.length) add(out, 'form-schema', probs.join('; '));
    const props = params.requestedSchema?.properties && typeof params.requestedSchema.properties === 'object' ? Object.entries(params.requestedSchema.properties) : [];
    for (const [name, p] of props) {
      if (SENSITIVE_WORD.test(`${name} ${p?.title ?? ''} ${p?.description ?? ''}`)) add(out, 'form-sensitive', `Field "${name}" asks for sensitive information.`);
      if (LINK.test(`${p?.title ?? ''} ${p?.description ?? ''}`)) add(out, 'form-clickable', `Field "${name}" contains a link.`);
    }
    if (SENSITIVE_WORD.test(params.message ?? '') && /(enter|provide|type|paste|send)/i.test(params.message ?? '')) add(out, 'form-sensitive', 'The message asks the person to type sensitive information.');
    if (LINK.test(params.message ?? '')) add(out, 'form-clickable', 'The message contains a link.');
  } else if (mode === 'url') {
    if (!params.elicitationId) add(out, 'url-missing-id', 'No elicitationId.');
    const a = analyzeUrl(params.url);
    if (!a.valid) add(out, 'url-invalid', `"${a.full}" does not parse.`);
    else {
      if (a.userinfo || a.sensitiveParams.length) add(out, 'url-sensitive', [a.userinfo ? 'username/password in the URL' : null, a.sensitiveParams.length ? `parameters: ${a.sensitiveParams.join(', ')}` : null].filter(Boolean).join('; '));
      if (!a.https && !a.loopback) add(out, 'url-not-https', `Scheme is ${a.scheme}.`);
      if (a.punycode || a.nonAsciiInInput) add(out, 'url-punycode', `Host ${a.host}`);
    }
  }
  return out;
}

// -32042 error data: every entry must be url mode with an elicitationId (plus the per-entry URL checks).
export function lintUrlRequired(error, caps) {
  const out = [];
  const list = error?.data?.elicitations;
  if (!Array.isArray(list) || list.length === 0) { add(out, 'error-shape', 'data.elicitations is missing or empty.'); return out; }
  list.forEach((e, i) => {
    if (e?.mode !== 'url') add(out, 'error-shape', `Entry ${i + 1} is not url mode.`);
    if (!e?.elicitationId) add(out, 'error-shape', `Entry ${i + 1} has no elicitationId.`);
    if (e?.mode === 'url' && e?.elicitationId) for (const f of lintElicitation(e, caps)) if (!out.some((o) => o.id === f.id && o.detail === f.detail)) out.push(f);
  });
  return out;
}
