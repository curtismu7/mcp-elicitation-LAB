// The talk track is DATA. The Talk track section in the page, the presenter-mode notes and docs/talk-track.md (npm run talk-track) are all
// rendered from it, and a test fails when the committed doc drifts. `for` names the scenario groups a note goes with in presenter mode.
// Every claim is about the MCP specification revision 2025-11-25 (elicitation page, read in full 2026-10-22) or about what this lab does.
import { SCENARIOS } from './scenarios.js';
import { SPEC_SOURCES } from './spec.js';

export const TALK_TRACK = [
  { id: 'what-it-is', title: 'What an elicitation is', for: ['Form mode', 'URL mode'], say: 'Halfway through a tool call, an MCP server needs more from the person. It cannot ask the person directly, so it asks the client. There are two modes: form mode, where structured data passes through the client, and URL mode, where the person goes to a page the client never sees. Whichever mode, the person can accept, decline or cancel.' },
  { id: 'three-actions', title: 'Accept, decline and cancel are three different answers', for: ['Form mode'], say: 'Accept means the person agreed and, for a form, submitted data. Decline is an explicit no, and the server should handle it, for example by offering alternatives. Cancel means the person closed the dialog without choosing, so the server may ask again later. Run the three form scenarios and compare the outcome line.' },
  { id: 'client-validates', title: 'The client checks the form before it sends it', for: ['Form mode'], say: 'The form is built from a flat schema of primitives. A client SHOULD validate the answers against that schema before sending. In the validation scenario the first attempt breaks the schema; open the Messages and see that nothing reached the server until the corrected form was sent.' },
  { id: 'never-secrets', title: 'Never ask for a password in a form', for: ['Server breaks a rule'], say: 'A form passes through the client and its logs, so a server MUST NOT use form mode for passwords, API keys, access tokens or payment credentials. That is what URL mode is for. The password-form scenario shows the finding, with the page of the specification it comes from.' },
  { id: 'url-consent', title: 'In URL mode, accept means consent, not completion', for: ['URL mode'], say: 'The client shows the full URL and the domain, asks for consent, and only then opens it where neither the client nor the model can read what is typed. Accepting means "open it", not "it is done": a completion notification closes the loop. In this lab nothing is ever opened or fetched; the URL is analysed and shown.' },
  { id: 'error-32042', title: 'When the request cannot proceed: -32042', for: ['URL mode'], say: 'A tool call that needs the person to authorize a third party first can fail with -32042 URLElicitationRequired. After the out-of-band step and a completion notification, the client retries the original request. The error must list URL-mode elicitations, each with an elicitationId; the malformed-error scenario shows what happens when it does not.' },
  { id: 'phishing', title: 'Alice triggers it, Bob opens the link', for: ['Phishing'], say: 'If the person who opens the link is not the person the elicitation was generated for, a server that does not check binds Bob\'s account to Alice\'s session. Run the two phishing scenarios side by side: the vulnerable server accepts, the careful one refuses. The identity check here is a mock.' },
  { id: 'findings', title: 'Findings are rules the server broke', for: ['Server breaks a rule'], say: 'Every finding names the specification page it comes from and whether it is a MUST, a MUST NOT, a SHOULD or a SHOULD NOT. A new finding needs a citation and a test. Where the specification says nothing, for example what a client does with a schema it cannot render, the lab labels its own behaviour as lab behaviour.' },
  { id: 'what-is-simulated', title: 'What is simulated, and what was not read', for: [], say: `The MCP server and the MCP client are both mocks inside this app. Real clients were not probed, so whether they implement URL mode is UNVERIFIED. Only the 2025-11-25 and draft elicitation pages were read; ${SPEC_SOURCES.notRead.join(', ')} were not, and anything about them is UNVERIFIED.` },
];

export function renderTalkTrackMarkdown() {
  const parts = ['# Talk track', '', '<!-- Generated from server/src/talkTrack.js by `npm run talk-track`. Do not edit by hand. -->', '', `> MCP specification revision ${SPEC_SOURCES.protocol}, elicitation page read in full on ${SPEC_SOURCES.read}. Simulated: the server and the client are mocks, and no URL is opened or fetched.`, ''];
  for (const t of TALK_TRACK) parts.push(`## ${t.title}`, '', t.say, '');
  parts.push('## The scenarios', '');
  SCENARIOS.forEach((s, i) => parts.push(`${i + 1}. **${s.title}** (${s.group}). ${s.blurb}`));
  return `${parts.join('\n')}\n`;
}
