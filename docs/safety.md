# Safety, and what is simulated

## Rules this repo keeps

- **Nothing leaves the machine.** Both the MCP server and the MCP client are mocks inside one process. A URL in a scenario is analysed and shown, never fetched (the spec says a client MUST NOT pre-fetch the URL or its metadata). The netguard blocks every socket, DNS lookup, fetch, UDP send and UDP connect except loopback, has a self-test (seven routes out, all refused), and a test runs the URL scenarios and asserts zero attempts. A real browser check saw no request to any other host.
- **Loopback only.** The server binds 127.0.0.1. The container binds 0.0.0.0 inside (`MEL_LAB_BIND`), and compose publishes on 127.0.0.1 only; a test pins it. A wildcard bind needs `MEL_LAB_BIND`.
- **Host check and same-origin writes.** A non-loopback Host header gets 403. A cross-origin or cross-site write gets 403.
- **No secrets exist here.** There are no credentials, tokens or tenant identifiers. The scenario that "stores an API key" never receives one: that is the point of URL mode. The one settings key (`MEL_LAB_MODE`) is read from the shared settings file with `util.parseEnv`, and nothing else from that file enters the process.
- **User-supplied text is data.** Capability toggles are validated against a closed list; a scenario id must match a known one; a workspace id must match `[a-z0-9-]{1,40}`; the person's form answers are checked against the schema before anything is "sent". Error answers never echo what was typed, and an unknown path gets a fixed JSON 404. The raw JSON-RPC transcript does show what the person submitted in a form: that is the education, so do not type a real secret into the booking form.
- **Only Mock exists.** Live is refused, in the page and at start-up.
- **Hosts.** Every host in shipped text is `.example` or `.invalid`. The exception is the two public spec page links (modelcontextprotocol.io), which are shown for the reader to follow and are never fetched.

## Spec basis

Every finding cites a section of the MCP elicitation page, revision **2025-11-25**, read in full on 2026-10-22 (https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation). The current draft page was also read in full; it differs a lot (see below) and is unstable.

**Not read, so UNVERIFIED:** `basic/security_best_practices`, `basic/authorization`, `basic/patterns/mrtr`. This lab says nothing about them beyond the pointers the elicitation page itself makes.

### The draft differs from 2025-11-25

- The client capability moves to `_meta."io.modelcontextprotocol/clientCapabilities"` on each request.
- Elicitation arrives inside an `InputRequiredResult` and the client retries the original request with the answers (multi round-trip), instead of a server-to-client `elicitation/create` request.
- No `elicitationId`, no `-32042 URLElicitationRequired` and no `notifications/elicitation/complete` on the draft page.
- Same three actions, same flat form schema, same safety rules. The draft drops rate limiting from the security list and the `pattern` keyword from its string example.

## What is simulated versus real

| Piece | Status |
| --- | --- |
| The MCP server, its tools and its out-of-band web pages | Simulated: mock, in process |
| The MCP client and its dialogs | Simulated: a client written to follow the spec's MUST and SHOULD rules. "Secure browser view" and "opens the URL" are narration, not behaviour |
| The wire format (JSON-RPC shapes, error codes, actions) | Taken from the spec page; the tests pin the shapes this lab sends |
| Lab client behaviour the spec does not define | Labelled "lab behaviour" on screen: cancelling a form it cannot render, ending a malformed -32042 |
| Real clients (Claude, ChatGPT, others) and whether they implement URL mode | UNVERIFIED: not probed |
| Phishing scenarios | A model of the attack the spec describes, with a mock identity check; not an exploit of anything |
