import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderTalkTrackMarkdown, TALK_TRACK } from '../server/src/talkTrack.js';
import { SCENARIOS } from '../server/src/scenarios.js';

test('docs/talk-track.md is exactly what the talk-track data renders (run: npm run talk-track)', () => {
  assert.equal(fs.readFileSync(new URL('../docs/talk-track.md', import.meta.url), 'utf8'), renderTalkTrackMarkdown());
});

test('every scenario appears in the generated doc, and every presenter note names a scenario group that exists', () => {
  const md = renderTalkTrackMarkdown();
  for (const s of SCENARIOS) assert.ok(md.includes(s.title), s.id);
  const groups = new Set(SCENARIOS.map((s) => s.group));
  for (const t of TALK_TRACK) for (const g of t.for) assert.ok(groups.has(g), `${t.id}: ${g}`);
  for (const g of groups) assert.ok(TALK_TRACK.some((t) => t.for.includes(g)), `no note for the group ${g}`);
});

test('the talk track says what is UNVERIFIED and names the unread pages', () => {
  const t = TALK_TRACK.find((x) => x.id === 'what-is-simulated');
  assert.match(t.say, /UNVERIFIED/);
  assert.match(t.say, /security_best_practices/);
});
