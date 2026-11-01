// Builds content-pack.json for the Learning Hub from the scenario data, so the pack cannot drift from the scenarios.
//   node scripts/build-content-pack.mjs        (writes content-pack.json)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENARIOS } from '../server/src/scenarios.js';
import { SPEC_SOURCES } from '../server/src/spec.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const storyId = (i) => `S${String(i + 1).padStart(2, '0')}`; // the hub wants S01, S02, ...

export function buildPack() {
  return {
    schema: 'demo-content-pack/1',
    id: 'mcp-elicitation-lab',
    title: 'MCP Elicitation LAB',
    version,
    demo: { id: 'mcp-elicitation-lab', name: 'MCP Elicitation LAB', catalog: 'D37', baseUrl: 'http://127.0.0.1:6800', doctor: '/api/health', tags: ['mcp', 'elicitation', 'form-mode', 'url-mode', 'consent', 'phishing', 'mock'] },
    glossary: [
      { id: 'elicitation', term: 'Elicitation', definition: 'An MCP server asking the person, through the client, for more input in the middle of a request. Two modes: form (structured data through the client) and URL (the person goes to a page the client never sees).' },
      { id: 'form-mode', term: 'Form mode', definition: 'The server sends a flat JSON schema of primitives; the client builds a form. The data passes through the client, so it must never be a password, API key, token or payment credential.' },
      { id: 'url-mode', term: 'URL mode', definition: 'The server sends a URL and an elicitationId. The client shows the full URL, asks for consent and opens it where neither the client nor the model can read what is typed. Accept means consent, not completion.' },
      { id: 'elicitation-actions', term: 'accept, decline, cancel', definition: 'Accept: the person agreed (and, for a form, submitted data). Decline: an explicit no. Cancel: dismissed without a choice (closed the dialog, the page failed to load).' },
      { id: 'url-elicitation-required', term: 'URLElicitationRequired (-32042)', definition: 'The error a server returns when a request cannot proceed until a URL-mode elicitation is completed. It carries the list of required elicitations, each URL mode with an elicitationId. Introduced in 2025-11-25; not in the current draft.' },
      { id: 'elicitation-phishing', term: 'Elicitation phishing', definition: 'Alice triggers an elicitation and sends the link to Bob. If the server does not check that the person opening the URL is the person it was generated for, Bob\'s account gets bound to Alice\'s session.' },
    ],
    sources: SPEC_SOURCES.pages.map((p) => ({ id: `mcp-elicitation-${p.id}`, title: `MCP specification ${p.id}: Elicitation`, url: p.url, kind: 'standard', use: p.id === 'draft' ? 'Draft differences (unstable)' : 'The revision this lab targets', status: 'read', checked: SPEC_SOURCES.read })),
    stories: SCENARIOS.map((s, i) => ({ id: storyId(i), title: s.title, say: s.blurb })),
    cards: SCENARIOS.map((s, i) => ({
      id: `try-${s.id}`, label: s.title, description: s.blurb, group: 'try-it', action: { type: 'route', href: `/#scenario-${s.id}` }, story: storyId(i),
      terms: s.tool.startsWith('book') || s.id.startsWith('form') ? ['form-mode', 'elicitation-actions'] : s.id.startsWith('phish') ? ['url-mode', 'elicitation-phishing'] : s.id === 'url-required' || s.id === 'bad-error-shape' ? ['url-mode', 'url-elicitation-required'] : ['elicitation'],
    })),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(path.join(ROOT, 'content-pack.json'), `${JSON.stringify(buildPack(), null, 2)}\n`);
  console.log('wrote content-pack.json');
}
