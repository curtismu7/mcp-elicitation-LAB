import { describe, expect, it } from 'vitest';
import { analyzeUrl, urlWarnings } from '../src/url.js';
import { schemaProblems, validateContent, defaultContent } from '../src/schema.js';
import { lintElicitation, lintUrlRequired } from '../src/lint.js';
import { normalizeCaps } from '../src/engine.js';

describe('analyzeUrl', () => {
  it('splits subdomain from the domain the client should highlight', () => {
    expect(analyzeUrl('https://login.account.mcp.example/x')).toMatchObject({ subdomain: 'login.account', apex: 'mcp.example', https: true });
    expect(analyzeUrl('https://mcp.example.evil.invalid/x')).toMatchObject({ apex: 'evil.invalid', subdomain: 'mcp.example' }); // the spoof is visible
  });
  it('flags credentials, sensitive parameters, Punycode and plain http, but trusts loopback http', () => {
    const a = analyzeUrl('http://u:p@xn--bcher-kva.example/?access_token=abc&elicitationId=1');
    expect(a).toMatchObject({ userinfo: true, punycode: true, https: false, sensitiveParams: ['access_token'] });
    expect(urlWarnings(a)).toHaveLength(4);
    expect(urlWarnings(analyzeUrl('http://localhost:3000/cb'))).toEqual([]);
    expect(analyzeUrl('not a url').valid).toBe(false);
  });
  it('never makes a request: it only parses', () => {
    // Pure function: no fetch, no DNS. (The netguard test proves a whole run attempts nothing.)
    expect(analyzeUrl.toString()).not.toMatch(/fetch|http\.request|dns/);
  });
});

describe('form schemas', () => {
  const ok = { type: 'object', properties: { a: { type: 'string', maxLength: 5 }, b: { type: 'integer', minimum: 1 }, c: { type: 'boolean' }, d: { type: 'string', enum: ['x', 'y'] }, e: { type: 'array', items: { type: 'string', enum: ['p', 'q'] }, minItems: 1 } }, required: ['a'] };
  it('accepts flat primitives and enums', () => expect(schemaProblems(ok)).toEqual([]));
  it('rejects nesting, arrays of objects, unknown keywords and bad formats', () => {
    expect(schemaProblems({ type: 'object', properties: { o: { type: 'object', properties: {} } } }).join()).toMatch(/not a supported primitive/);
    expect(schemaProblems({ type: 'object', properties: { l: { type: 'array', items: { type: 'object' } } } }).join()).toMatch(/multi-select enums/);
    expect(schemaProblems({ type: 'object', properties: { s: { type: 'string', format: 'uuid' } } }).join()).toMatch(/format/);
    expect(schemaProblems({ type: 'object', properties: { s: { type: 'string', $ref: '#' } } }).join()).toMatch(/keyword/);
    expect(schemaProblems(null)).toHaveLength(1);
  });
  it('validates content: required, types, bounds, enums, formats, unknown fields', () => {
    expect(validateContent(ok, { a: 'hi', b: 2, c: true, d: 'x', e: ['p'] }).ok).toBe(true);
    const v = validateContent(ok, { b: 0, c: 'yes', d: 'z', e: [], extra: 1 });
    expect(v.errors).toMatchObject({ a: 'Required', b: 'At least 1', c: 'Must be true or false', d: 'Must be one of: x, y', e: 'Pick at least 1', extra: 'Not a requested field' });
    const f = { type: 'object', properties: { m: { type: 'string', format: 'email' }, w: { type: 'string', format: 'date' }, u: { type: 'string', format: 'uri' } } };
    expect(validateContent(f, { m: 'a@b.co', w: '2026-02-28', u: 'https://x.example' }).ok).toBe(true);
    expect(validateContent(f, { m: 'nope', w: '2026-02-30', u: 'zzz' }).errors).toMatchObject({ m: expect.any(String), w: expect.any(String), u: expect.any(String) });
  });
  it('pre-populates defaults', () => expect(defaultContent({ type: 'object', properties: { a: { type: 'string', default: 'x' }, b: { type: 'string' } } })).toEqual({ a: 'x' }));
});

describe('lint', () => {
  const caps = { form: {}, url: {} };
  it('finds a sensitive field by name, title or message, only when asked to type it', () => {
    const f = (props, message = 'Hello') => lintElicitation({ mode: 'form', message, requestedSchema: { type: 'object', properties: props } }, caps).map((x) => x.id);
    expect(f({ password: { type: 'string' } })).toContain('form-sensitive');
    expect(f({ code: { type: 'string', title: 'API key' } })).toContain('form-sensitive');
    expect(f({ name: { type: 'string', title: 'Your name' } }, 'Please enter your password')).toContain('form-sensitive');
    expect(f({ name: { type: 'string', title: 'Your name' } }, 'Tell us your username and email')).toEqual([]); // names and emails are not categorically banned
  });
  it('treats a missing mode as form, and an empty capability object as form-only', () => {
    const url = { mode: 'url', elicitationId: 'e1', url: 'https://x.example/a', message: 'm' };
    expect(lintElicitation(url, {}).map((x) => x.id)).toEqual(['mode-undeclared']);
    expect(lintElicitation({ message: 'm', requestedSchema: { type: 'object', properties: {} } }, {}).map((x) => x.id)).toEqual([]);
    expect(lintElicitation({ message: 'm', requestedSchema: { type: 'object', properties: {} } }, null).map((x) => x.id)).toEqual(['mode-undeclared']);
  });
  it('checks the -32042 shape', () => {
    expect(lintUrlRequired({ data: {} }, caps).map((x) => x.id)).toEqual(['error-shape']);
    expect(lintUrlRequired({ data: { elicitations: [{ mode: 'url', elicitationId: 'e', url: 'https://x.example/', message: 'm' }] } }, caps)).toEqual([]);
    expect(lintUrlRequired({ data: { elicitations: [{ mode: 'form' }] } }, caps).map((x) => x.id)).toEqual(['error-shape', 'error-shape']);
  });
  it('every finding names the spec page it comes from', async () => {
    const { FINDINGS } = await import('../src/lint.js');
    for (const [id, f] of Object.entries(FINDINGS)) { expect(f.cite, id).toMatch(/^2025-11-25 > /); expect(['MUST', 'MUST NOT', 'SHOULD', 'SHOULD NOT']).toContain(f.level); }
  });
});

describe('capabilities', () => {
  it('normalises, and refuses anything else', () => {
    expect(normalizeCaps(undefined)).toBeUndefined();
    expect(normalizeCaps(null)).toBeNull();
    expect(normalizeCaps({ url: { x: 1 } })).toEqual({ url: {} });
    expect(() => normalizeCaps({ sampling: {} })).toThrow(/unknown capability/);
    expect(() => normalizeCaps('form')).toThrow();
  });
});
