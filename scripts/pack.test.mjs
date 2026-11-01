import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { buildPack } from './build-content-pack.mjs';
import { validatePack } from './validate-content-pack.mjs';
import { SCENARIOS } from '../server/src/scenarios.js';
import { FINDINGS } from '../server/src/lint.js';

test('the content pack validates against the hub schema', () => assert.deepEqual(validatePack(buildPack()), []));

test('the committed content-pack.json is up to date with the scenarios', () => {
  const committed = JSON.parse(fs.readFileSync(new URL('../content-pack.json', import.meta.url), 'utf8'));
  assert.deepEqual(committed, JSON.parse(JSON.stringify(buildPack())), 'run: npm run pack');
});

test('every scenario has a unique id, names its spec sections, and only expects findings that exist', () => {
  assert.equal(new Set(SCENARIOS.map((s) => s.id)).size, SCENARIOS.length);
  for (const s of SCENARIOS) {
    assert.ok(s.spec.length > 0, `${s.id} needs spec references`);
    for (const f of s.expect.findings) assert.ok(FINDINGS[f], `${s.id} expects unknown finding ${f}`);
  }
});

test('every finding cites a spec page this lab actually read (no claim without a source)', () => {
  for (const [id, f] of Object.entries(FINDINGS)) assert.match(f.cite, /^2025-11-25 > /, id);
});

test('the catalog id D37 is the same in the shelf entry and the content pack, and the shelf entry is portable', () => {
  const entry = JSON.parse(fs.readFileSync(new URL('../docs/shelf-entry.json', import.meta.url), 'utf8')).demos[0];
  assert.equal(entry.catalogId, 'D37');
  assert.equal(buildPack().demo.catalog, 'D37');
  assert.equal(buildPack().schema, 'demo-content-pack/1');
  assert.equal(entry.id, 'mcp-elicitation-lab');
  assert.equal(entry.kind, 'Tester');
  assert.equal(entry.healthPath, '/api/health');
  assert.match(entry.url, /^http:\/\/localhost:68[0-4]\d$/);
  assert.equal(entry.composeFile, 'mcp-elicitation-LAB/docker-compose.yml');
  assert.ok(!path.isAbsolute(entry.composeFile) && !/\/Users\//.test(JSON.stringify(entry)), 'composeFile must be relative or a placeholder; no absolute home path');
});

test('a broken pack is caught: unknown term and unknown story', () => {
  const pack = buildPack();
  pack.cards[0].terms = ['nope'];
  pack.cards[1].story = 'ghost';
  const errors = validatePack(pack).join('\n');
  assert.match(errors, /unknown term nope/);
  assert.match(errors, /unknown story ghost/);
});

test('every card links to a scenario the page can open (#scenario-<id>), and every scenario has a story and a card', () => {
  const pack = buildPack();
  assert.equal(pack.stories.length, SCENARIOS.length);
  for (const s of SCENARIOS) assert.ok(pack.cards.some((c) => c.action.href === `/#scenario-${s.id}`), s.id);
});
