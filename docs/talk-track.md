# Talk track

<!-- Generated from server/src/talkTrack.js by `npm run talk-track`. Do not edit by hand. -->

> MCP specification revision 2025-11-25, elicitation page read in full on 2026-10-22. Simulated: the server and the client are mocks, and no URL is opened or fetched.

## What an elicitation is

Halfway through a tool call, an MCP server needs more from the person. It cannot ask the person directly, so it asks the client. There are two modes: form mode, where structured data passes through the client, and URL mode, where the person goes to a page the client never sees. Whichever mode, the person can accept, decline or cancel.

## Accept, decline and cancel are three different answers

Accept means the person agreed and, for a form, submitted data. Decline is an explicit no, and the server should handle it, for example by offering alternatives. Cancel means the person closed the dialog without choosing, so the server may ask again later. Run the three form scenarios and compare the outcome line.

## The client checks the form before it sends it

The form is built from a flat schema of primitives. A client SHOULD validate the answers against that schema before sending. In the validation scenario the first attempt breaks the schema; open the Messages and see that nothing reached the server until the corrected form was sent.

## Never ask for a password in a form

A form passes through the client and its logs, so a server MUST NOT use form mode for passwords, API keys, access tokens or payment credentials. That is what URL mode is for. The password-form scenario shows the finding, with the page of the specification it comes from.

## In URL mode, accept means consent, not completion

The client shows the full URL and the domain, asks for consent, and only then opens it where neither the client nor the model can read what is typed. Accepting means "open it", not "it is done": a completion notification closes the loop. In this lab nothing is ever opened or fetched; the URL is analysed and shown.

## When the request cannot proceed: -32042

A tool call that needs the person to authorize a third party first can fail with -32042 URLElicitationRequired. After the out-of-band step and a completion notification, the client retries the original request. The error must list URL-mode elicitations, each with an elicitationId; the malformed-error scenario shows what happens when it does not.

## Alice triggers it, Bob opens the link

If the person who opens the link is not the person the elicitation was generated for, a server that does not check binds Bob's account to Alice's session. Run the two phishing scenarios side by side: the vulnerable server accepts, the careful one refuses. The identity check here is a mock.

## Findings are rules the server broke

Every finding names the specification page it comes from and whether it is a MUST, a MUST NOT, a SHOULD or a SHOULD NOT. A new finding needs a citation and a test. Where the specification says nothing, for example what a client does with a schema it cannot render, the lab labels its own behaviour as lab behaviour.

## What is simulated, and what was not read

The MCP server and the MCP client are both mocks inside this app. Real clients were not probed, so whether they implement URL mode is UNVERIFIED. Only the 2025-11-25 and draft elicitation pages were read; basic/security_best_practices, basic/authorization, basic/patterns/mrtr were not, and anything about them is UNVERIFIED.

## The scenarios

1. **Form: the person accepts** (Form mode). A booking needs a few details. The client shows a form built from the schema, pre-filled with defaults, and the person submits it.
2. **Form: the person declines** (Form mode). Decline is an explicit no. The server must handle it (offer alternatives), not treat it as an error.
3. **Form: the person dismisses it** (Form mode). Cancel is "closed the dialog, pressed Escape, the browser failed to load": no explicit choice. The server may ask again later.
4. **Form: the client validates before sending** (Form mode). The first attempt breaks the schema (party of 99, bad date). The client blocks it and shows why; the corrected form is sent.
5. **Empty capability means form only** (Form mode). A client that declares elicitation as {} is treated as form-only (backwards compatibility). Form requests work.
6. **URL mode: a secret goes to the server, not the client** (URL mode). An API key is typed on the server's own page. The client only shows the full URL and asks for consent; accept means consent, not completion. A completion notification closes the loop.
7. **URL mode: -32042 then retry** (URL mode). A tool call cannot proceed until the person authorizes a third party. The server answers -32042 URLElicitationRequired; after the out-of-band step and a completion notification the client retries.
8. **URL mode: the person declines to open the link** (URL mode). No consent, no navigation. The original request cannot proceed and the client offers a manual retry.
9. **URL mode: the client did not declare it** (URL mode). A well-behaved server checks the declared capabilities first and falls back, instead of sending a mode the client never offered.
10. **URL mode: a stray completion notification** (URL mode). A notification naming an unknown elicitationId arrives first. The client must ignore it and carry on.
11. **A form asks for a password and an API key** (Server breaks a rule). The spec says servers MUST NOT collect passwords, API keys, tokens or payment credentials through form mode: they would pass through the client and its logs.
12. **A form schema is nested** (Server breaks a rule). Form schemas are flat objects of primitives. This one nests an object and an array of objects. The lab client cannot render it and cancels (that fallback is the lab's own choice: the spec does not define it).
13. **A form hides a link** (Server breaks a rule). Servers SHOULD NOT put clickable URLs in form fields; clients SHOULD NOT render them as clickable. Use URL mode for links.
14. **The URL carries a password and a token** (Server breaks a rule). A URL with credentials and an access token in it is sensitive and pre-authenticated: a malicious client could replay it. The client still shows the full URL and warns before any consent.
15. **Look-alike host over plain HTTP** (Server breaks a rule). A Punycode host over http. The client SHOULD highlight the domain and warn about the ambiguous host; the server SHOULD use HTTPS.
16. **A mode the client never declared** (Server breaks a rule). The client declared form only; the server sends URL mode anyway. The client MUST answer -32602 (Invalid params).
17. **A malformed -32042 error** (Server breaks a rule). The error lists a form-mode entry with no elicitationId. -32042 may only carry URL mode elicitations, each with an id.
18. **Phishing: the server does not check who opens the link** (Phishing). Alice triggers an elicitation but sends the link to Bob. Bob opens it and completes it. A server that does not verify the user binds Bob's account to Alice's session.
19. **Phishing: the server verifies the person** (Phishing). The same attack, but the server's connect page compares the person opening the link with the person the elicitation was generated for, and refuses.
